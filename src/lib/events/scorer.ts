import type { StockEvent, EventImpact } from '@/lib/types/event';
import type { OHLCDataPoint } from '@/lib/types/stock';
import type { CorrelatedAnomaly } from './correlator';
import crypto from 'crypto';

/**
 * Score, rank, and enrich correlated anomalies into full StockEvent objects.
 */
export function scoreAndRankEvents(
  correlatedAnomalies: CorrelatedAnomaly[],
  stockData: OHLCDataPoint[],
  symbol: string
): StockEvent[] {
  const currentPrice = stockData.length > 0 ? stockData[stockData.length - 1].close : 0;

  const events: StockEvent[] = correlatedAnomalies.map((ca) => {
    const { anomaly, eventType, title, description, newsArticles, newsRelevance } = ca;

    // Determine impact magnitude based on z-score
    const absZ = Math.abs(anomaly.zScore);
    let magnitude: EventImpact['magnitude'];
    if (absZ >= 3.0) magnitude = 'extreme';
    else if (absZ >= 2.5) magnitude = 'high';
    else magnitude = 'moderate';

    const direction: EventImpact['direction'] =
      anomaly.relativeReturn >= 0 ? 'positive' : 'negative';

    const impact: EventImpact = {
      magnitude,
      direction,
      absoluteMove: Math.abs(anomaly.stockReturn * anomaly.close),
      percentMove: anomaly.stockReturn * 100,
      volumeSpike: anomaly.volumeSpike,
    };

    // Calculate change since event
    const changeSinceEvent = currentPrice - anomaly.close;
    const changePercentSinceEvent =
      anomaly.close !== 0 ? ((currentPrice - anomaly.close) / anomaly.close) * 100 : 0;

    // Calculate recovery days
    const recoveryDays = computeRecoveryDays(anomaly, stockData);

    // Composite impact score
    const impactScore = computeImpactScore(absZ, anomaly.volumeSpike, newsRelevance);

    // Generate deterministic ID
    const id = crypto
      .createHash('md5')
      .update(`${symbol}:${anomaly.timeframe}:${anomaly.date}:${eventType}:${title}`)
      .digest('hex')
      .slice(0, 12);

    return {
      id,
      symbol,
      date: anomaly.date,
      type: eventType,
      title,
      description,
      impact,
      priceAtEvent: anomaly.close,
      priceNow: currentPrice,
      changeSinceEvent,
      changePercentSinceEvent,
      dailyReturn: anomaly.stockReturn * 100,
      sp500Return: anomaly.spyReturn * 100,
      relativeReturn: anomaly.relativeReturn * 100,
      zScore: anomaly.zScore,
      newsArticles,
      recoveryDays,
      impactScore,
    };
  });

  // Sort by impact score descending
  return events.sort((a, b) => b.impactScore - a.impactScore);
}

function computeImpactScore(
  absZScore: number,
  volumeSpike: number,
  newsRelevance: number
): number {
  return (
    absZScore * 0.5 +
    Math.min(volumeSpike / 5, 1) * 0.3 +
    newsRelevance * 0.2
  );
}

function computeRecoveryDays(
  anomaly: { date: string; close: number; relativeReturn: number },
  stockData: OHLCDataPoint[]
): number | null {
  const eventIdx = stockData.findIndex((d) => d.time === anomaly.date);
  if (eventIdx === -1 || eventIdx >= stockData.length - 1) return null;

  const priceAtEvent = anomaly.close;
  const wasNegative = anomaly.relativeReturn < 0;

  if (!wasNegative) {
    // For positive events, recovery concept doesn't apply the same way
    // Check if the price has held above the event price
    const subsequentPrices = stockData.slice(eventIdx + 1);
    const everDropped = subsequentPrices.some((d) => d.close < priceAtEvent);
    if (!everDropped) return 0; // Gains held
    return null; // Price dropped below at some point, complex recovery
  }

  // For negative events, find first day price recovered to pre-event level
  // Pre-event price is the close of the day before the event
  const preEventPrice = eventIdx > 0 ? stockData[eventIdx - 1].close : priceAtEvent;

  for (let i = eventIdx + 1; i < stockData.length; i++) {
    if (stockData[i].close >= preEventPrice) {
      // Count trading days
      return i - eventIdx;
    }
  }

  return null; // Has not recovered yet
}
