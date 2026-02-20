import { NextRequest, NextResponse } from 'next/server';
import { subDays, format } from 'date-fns';
import { getCompanyNews } from '@/lib/api/yahoo-finance';
import { cacheManager } from '@/lib/db/cache';
import type { NewsArticle } from '@/lib/types/event';

async function fetchRecentNewsSnippets(symbol: string): Promise<string[]> {
  const to = new Date();
  const from = subDays(to, 14);
  const fromStr = format(from, 'yyyy-MM-dd');
  const toStr = format(to, 'yyyy-MM-dd');
  const cacheKey = `news:summary:${symbol}:${fromStr}:${toStr}`;
  try {
    const articles = await cacheManager.getOrFetch<NewsArticle[]>(
      'news_cache',
      cacheKey,
      3600, // 1 hour TTL
      () => getCompanyNews(symbol, fromStr, toStr),
      symbol
    );
    return articles.slice(0, 7).map((a) => {
      const summarySnippet =
        a.summary && a.summary.trim()
          ? a.summary.slice(0, 120).trim() + (a.summary.length > 120 ? '…' : '')
          : '';
      return summarySnippet ? `${a.headline} — ${summarySnippet}` : a.headline;
    });
  } catch {
    return [];
  }
}

function getRangeTier(pct: number): string {
  if (pct <= 25) return '1-25';
  if (pct <= 50) return '26-50';
  if (pct <= 74) return '51-74';
  return '75-99';
}

function getTierGuidance(tier: string): string {
  switch (tier) {
    case '1-25':
      return 'Explain why the stock is trading so low in its 52-week range. Mention any reasons to consider buying (e.g., oversold, value opportunity, turnaround potential) or risks. Be concise and balanced.';
    case '26-50':
      return 'Explain the stock\'s position in its range. Indicate whether it appears to be on an upswing from its lows or has room to drop further. Consider recent price momentum. Be concise and balanced.';
    case '51-74':
      return 'Explain why the stock is trending higher in its range. Indicate whether there is room to drop further or if it is continuing to recover. Be concise and balanced.';
    case '75-99':
      return 'Assess whether the stock may be overvalued or still has room to run. Consider momentum and valuation context. Be concise and balanced.';
    default:
      return 'Provide a brief, balanced summary of the stock\'s position in its 52-week range.';
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();

  const pctOfRange = request.nextUrl.searchParams.get('pctOfRange');
  const week52High = request.nextUrl.searchParams.get('week52High');
  const week52Low = request.nextUrl.searchParams.get('week52Low');
  const price = request.nextUrl.searchParams.get('price');
  const companyName = request.nextUrl.searchParams.get('companyName') ?? upperSymbol;
  const industry = request.nextUrl.searchParams.get('industry') ?? '';
  const periodChangePercent = request.nextUrl.searchParams.get('periodChangePercent');

  const pct = pctOfRange ? parseFloat(pctOfRange) : NaN;
  if (Number.isNaN(pct) || pct < 0 || pct > 100) {
    return NextResponse.json(
      { error: 'Valid pctOfRange (0-100) is required' },
      { status: 400 }
    );
  }

  const apiKey =
    process.env.OPENAI_API_KEY ??
    process.env.OpenAI_API_KEY ??
    process.env.OPENAI_KEY;
  if (!apiKey || apiKey === 'your_openai_key_here' || apiKey.startsWith('sk-your')) {
    return NextResponse.json(
      { error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env.local (local) or Vercel env vars (deployed), then restart.' },
      { status: 500 }
    );
  }

  const tier = getRangeTier(pct);
  const guidance = getTierGuidance(tier);

  // Fetch recent news so the summary can reference actual catalysts
  const newsSnippets = await fetchRecentNewsSnippets(upperSymbol);

  const contextParts: string[] = [
    `${companyName} (${upperSymbol}) is trading at ${pct.toFixed(0)}% of its 52-week range.`,
    `Current price: $${price ?? 'N/A'}.`,
  ];
  if (week52High && week52Low) {
    contextParts.push(`52-week high: $${week52High}, low: $${week52Low}.`);
  }
  if (periodChangePercent !== null && periodChangePercent !== undefined && periodChangePercent !== '') {
    const change = parseFloat(periodChangePercent);
    if (!Number.isNaN(change)) {
      contextParts.push(
        `Over the selected period, the stock is ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}%.`
      );
    }
  }

  const isSoftwareSaaS =
    industry &&
    /software|saas|technology|application|cloud|enterprise/i.test(industry);

  const systemPrompt = `You are a clear, neutral stock storyteller writing for everyday investors.
Write one short paragraph (3-6 sentences) that explains the story behind where this stock is in its 52-week range.
Use plain language and avoid heavy financial jargon.
Focus on why the stock is here now (what likely happened), not just that the price moved.
IMPORTANT: When recent headlines are provided, prioritize and weave in specific catalysts from them (e.g., earnings, stock splits, deals, management changes). Do not give a generic summary if headlines clearly explain the move—reference the actual news.
Be balanced: include one reason it could improve and one reason it could fall further.
Do not give direct buy/sell advice, price targets, or certainty language.
If key facts are missing, state 2-3 likely explanations and label them as possibilities.
${isSoftwareSaaS ? "When relevant for software/SaaS companies, consider macro themes such as AI's impact on the sector, shifts in investor sentiment toward enterprise software, and how the competitive landscape is evolving." : ''}`;
  const newsBlock =
    newsSnippets.length > 0
      ? `\nRecent news (prioritize these as the main catalysts—reference specific items like stock splits, deals, earnings):\n${newsSnippets.map((s) => `• ${s}`).join('\n')}\n`
      : '';

  const userPrompt = `Stock context:
${contextParts.join(' ')}
${newsBlock}
Range tier:
${tier}% (${tier === '1-25' ? 'near 52-week low' : tier === '75-99' ? 'near 52-week high' : 'mid-range'})

Tier focus:
${guidance}

Task:
Write one concise paragraph in simple, story-style language.
Explain what likely put the stock in this spot, why people currently feel this way about it, and what could push it up or down next.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        // GPT-5-mini uses max_completion_tokens and can spend tokens on reasoning.
        // Keep reasoning minimal so we consistently get visible output text.
        max_completion_tokens: 500,
        reasoning_effort: 'minimal',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('OpenAI API error:', res.status, err);
      return NextResponse.json(
        { error: `Failed to generate summary (${res.status})` },
        { status: 502 }
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return NextResponse.json(
        { error: 'No summary returned' },
        { status: 502 }
      );
    }

    return NextResponse.json({ summary: content });
  } catch (err) {
    console.error('Range summary error:', err);
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}
