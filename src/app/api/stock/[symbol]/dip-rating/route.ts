import { NextRequest, NextResponse } from 'next/server';
import { getRecommendationTrends } from '@/lib/api/finnhub';
import { getAnalystConsensus } from '@/lib/api/alpha-vantage';
import { getLatestPriceTargets } from '@/lib/api/fmp';
import { cacheManager } from '@/lib/db/cache';
import type { RecommendationTrend } from '@/lib/api/finnhub';
import type { AnalystConsensus } from '@/lib/api/alpha-vantage';
import type { FmpPriceTarget } from '@/lib/api/fmp';

const GRADES = [
  'F', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+',
] as const;

type Grade = (typeof GRADES)[number];

function scoreToGrade(score: number): Grade {
  const clamped = Math.max(0, Math.min(100, score));
  const idx = Math.min(Math.floor(clamped / 8.34), GRADES.length - 1);
  return GRADES[idx];
}

/**
 * Upside: how far above the current price is the consensus target?
 * Bigger gap → better dip opportunity.
 */
function computeUpsideScore(targetPrice: number | null, currentPrice: number): number {
  if (!targetPrice || currentPrice <= 0) return 50;
  const upside = ((targetPrice - currentPrice) / currentPrice) * 100;
  if (upside <= -15) return 0;
  if (upside >= 50) return 100;
  return Math.round(((upside + 15) / 65) * 100);
}

/**
 * Consensus: weighted average of analyst ratings.
 * strongBuy=5, buy=4, hold=3, sell=2, strongSell=1 → normalized to 0-100.
 */
function computeConsensusScore(c: AnalystConsensus): number {
  const total = c.strongBuy + c.buy + c.hold + c.sell + c.strongSell;
  if (total === 0) return 50;
  const weighted =
    c.strongBuy * 5 + c.buy * 4 + c.hold * 3 + c.sell * 2 + c.strongSell * 1;
  const avg = weighted / total; // 1-5 range
  return Math.round(((avg - 1) / 4) * 100);
}

/**
 * Momentum: compare latest month's buy-side vs prior month.
 * Improving sentiment → higher score.
 */
function computeMomentumScore(trends: RecommendationTrend[]): number {
  if (trends.length < 2) return 50;
  const latest = trends[0];
  const prior = trends[1];

  const latestBullish = latest.strongBuy + latest.buy;
  const priorBullish = prior.strongBuy + prior.buy;
  const latestBearish = latest.sell + latest.strongSell;
  const priorBearish = prior.sell + prior.strongSell;

  const bullDelta = latestBullish - priorBullish;
  const bearDelta = latestBearish - priorBearish;

  // net improvement = more bulls, fewer bears
  const net = bullDelta - bearDelta;
  // Clamp to ±10 range → normalize to 0-100
  const clamped = Math.max(-10, Math.min(10, net));
  return Math.round(((clamped + 10) / 20) * 100);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();

  const priceParam = request.nextUrl.searchParams.get('price');
  const currentPrice = priceParam ? parseFloat(priceParam) : NaN;
  if (!currentPrice || currentPrice <= 0) {
    return NextResponse.json(
      { error: 'Valid price parameter required' },
      { status: 400 }
    );
  }

  try {
    // Fetch analyst consensus (price target + ratings) — cached 12h
    const consensus = await cacheManager.getOrFetch<AnalystConsensus | null>(
      'fundamentals_cache',
      `analyst:${upperSymbol}`,
      43200,
      () => getAnalystConsensus(upperSymbol),
      upperSymbol
    );

    // Fetch recommendation trends (monthly snapshots) — cached 12h
    const trends = await cacheManager.getOrFetch<RecommendationTrend[]>(
      'fundamentals_cache',
      `reco:${upperSymbol}`,
      43200,
      () => getRecommendationTrends(upperSymbol),
      upperSymbol
    );

    // Fetch individual analyst price targets from FMP (graceful if key missing)
    const priceTargets = await cacheManager.getOrFetch<FmpPriceTarget[] | null>(
      'fundamentals_cache',
      `fmp-pt:${upperSymbol}`,
      43200,
      () => getLatestPriceTargets(upperSymbol),
      upperSymbol
    );

    if (!consensus && (!trends || trends.length === 0)) {
      return NextResponse.json({ error: 'No analyst data available' }, { status: 404 });
    }

    const upsideScore = computeUpsideScore(consensus?.targetPrice ?? null, currentPrice);
    const consensusScore = consensus ? computeConsensusScore(consensus) : 50;
    const momentumScore = computeMomentumScore(trends ?? []);

    const finalScore = Math.round(
      upsideScore * 0.50 + consensusScore * 0.25 + momentumScore * 0.25
    );
    const grade = scoreToGrade(finalScore);

    const upsidePercent =
      consensus?.targetPrice && currentPrice > 0
        ? ((consensus.targetPrice - currentPrice) / currentPrice) * 100
        : null;

    const totalAnalysts = consensus
      ? consensus.strongBuy + consensus.buy + consensus.hold + consensus.sell + consensus.strongSell
      : 0;

    const latestTarget = priceTargets?.[0] ?? null;

    return NextResponse.json({
      grade,
      score: finalScore,
      targetPrice: consensus?.targetPrice ?? null,
      upsidePercent: upsidePercent != null ? Math.round(upsidePercent * 10) / 10 : null,
      totalAnalysts,
      breakdown: { upsideScore, consensusScore, momentumScore },
      latestAnalyst: latestTarget
        ? {
            name: latestTarget.analystName,
            company: latestTarget.analystCompany,
            date: latestTarget.publishedDate,
            priceTarget: latestTarget.priceTarget,
          }
        : null,
    });
  } catch (err) {
    console.error('Dip rating error:', err);
    return NextResponse.json(
      { error: 'Failed to compute rating' },
      { status: 500 }
    );
  }
}
