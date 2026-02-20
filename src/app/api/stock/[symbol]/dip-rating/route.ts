import { NextRequest, NextResponse } from 'next/server';
import { getRecommendationTrends } from '@/lib/api/finnhub';
import { getAnalystConsensus } from '@/lib/api/alpha-vantage';
import { getPriceTargetSummary } from '@/lib/api/fmp';
import { cacheManager } from '@/lib/db/cache';
import type { RecommendationTrend } from '@/lib/api/finnhub';
import type { AnalystConsensus } from '@/lib/api/alpha-vantage';
import type { FmpPriceTargetSummary } from '@/lib/api/fmp';

const GRADES = [
  'F', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+',
] as const;

type Grade = (typeof GRADES)[number];

function scoreToGrade(score: number): Grade {
  const clamped = Math.max(0, Math.min(100, score));
  const idx = Math.min(Math.floor(clamped / 8.34), GRADES.length - 1);
  return GRADES[idx];
}

function computeUpsideScore(targetPrice: number | null, currentPrice: number): number {
  if (!targetPrice || currentPrice <= 0) return 50;
  const upside = ((targetPrice - currentPrice) / currentPrice) * 100;
  if (upside <= -15) return 0;
  if (upside >= 50) return 100;
  return Math.round(((upside + 15) / 65) * 100);
}

function computeConsensusScore(c: AnalystConsensus): number {
  const total = c.strongBuy + c.buy + c.hold + c.sell + c.strongSell;
  if (total === 0) return 50;
  const weighted =
    c.strongBuy * 5 + c.buy * 4 + c.hold * 3 + c.sell * 2 + c.strongSell * 1;
  const avg = weighted / total;
  return Math.round(((avg - 1) / 4) * 100);
}

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

  const net = bullDelta - bearDelta;
  const clamped = Math.max(-10, Math.min(10, net));
  return Math.round(((clamped + 10) / 20) * 100);
}

/**
 * FMP fallback: derive momentum from recent vs prior update activity.
 * lastMonthCount / (lastQuarterCount/3) > 1 = above-average recent activity.
 */
function computeMomentumScoreFromFmp(fmp: FmpPriceTargetSummary): number {
  if (fmp.lastQuarterCount <= 0) return 50;
  const expectedPerMonth = fmp.lastQuarterCount / 3;
  const ratio = expectedPerMonth > 0 ? fmp.lastMonthCount / expectedPerMonth : 1;
  // ratio 0.5 -> ~40, 1.0 -> 50, 1.5 -> 60, 2.0+ -> 70
  const clamped = Math.max(0.3, Math.min(2, ratio));
  return Math.round(((clamped - 0.3) / 1.7) * 100);
}

async function fetchSafe<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`Dip rating: ${label} failed, using fallback`, err);
    return fallback;
  }
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
    const [consensus, trends, fmpSummary] = await Promise.all([
      fetchSafe<AnalystConsensus | null>('consensus', () =>
        cacheManager.getOrFetch<AnalystConsensus | null>(
          'fundamentals_cache',
          `analyst:${upperSymbol}`,
          43200,
          () => getAnalystConsensus(upperSymbol),
          upperSymbol
        ), null),
      fetchSafe<RecommendationTrend[]>('trends', () =>
        cacheManager.getOrFetch<RecommendationTrend[]>(
          'fundamentals_cache',
          `reco:${upperSymbol}`,
          43200,
          () => getRecommendationTrends(upperSymbol),
          upperSymbol
        ), []),
      fetchSafe<FmpPriceTargetSummary | null>('fmp', () =>
        cacheManager
          .getOrFetch<FmpPriceTargetSummary | null>(
            'fundamentals_cache',
            `fmp-pts:${upperSymbol}`,
            43200,
            async () => {
              const result = await getPriceTargetSummary(upperSymbol);
              if (!result) throw new Error('FMP_no_data');
              return result;
            },
            upperSymbol
          )
          .catch(() => null),
        null
      ),
    ]);

    if (!consensus && trends.length === 0 && !fmpSummary) {
      return NextResponse.json({ error: 'No analyst data available' }, { status: 404 });
    }

    // Upside: prefer Alpha Vantage target, fallback to FMP 30-day avg
    const targetPrice =
      consensus?.targetPrice ?? fmpSummary?.lastMonthAvgPriceTarget ?? null;
    const upsideScore = computeUpsideScore(targetPrice, currentPrice);
    const consensusScore = consensus ? computeConsensusScore(consensus) : 50;
    const momentumScore =
      trends.length >= 2
        ? computeMomentumScore(trends)
        : fmpSummary
          ? computeMomentumScoreFromFmp(fmpSummary)
          : 50;

    const finalScore = Math.round(
      upsideScore * 0.50 + consensusScore * 0.25 + momentumScore * 0.25
    );
    const grade = scoreToGrade(finalScore);

    const upsidePercent =
      targetPrice != null && currentPrice > 0
        ? ((targetPrice - currentPrice) / currentPrice) * 100
        : null;

    const totalAnalysts = consensus
      ? consensus.strongBuy + consensus.buy + consensus.hold + consensus.sell + consensus.strongSell
      : 0;

    return NextResponse.json({
      grade,
      score: finalScore,
      targetPrice: consensus?.targetPrice ?? fmpSummary?.lastMonthAvgPriceTarget ?? null,
      upsidePercent: upsidePercent != null ? Math.round(upsidePercent * 10) / 10 : null,
      totalAnalysts,
      breakdown: { upsideScore, consensusScore, momentumScore },
      fmpSummary: fmpSummary
        ? {
            last30DaysCount: fmpSummary.lastMonthCount,
            last30DaysAvgTarget: fmpSummary.lastMonthAvgPriceTarget,
            publishers: fmpSummary.publishers.slice(0, 5),
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
