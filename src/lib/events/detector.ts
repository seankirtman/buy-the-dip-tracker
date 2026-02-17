import type { OHLCDataPoint } from '@/lib/types/stock';
import { dailyReturns, rollingMean, rollingStdDev, zScores, rollingAvgVolume } from '@/lib/utils/stats';

export interface PriceAnomaly {
  index: number; // Index into the stock data array (offset by 1 due to returns calc)
  date: string;
  timeframe: 'daily' | 'weekly';
  stockReturn: number;
  spyReturn: number;
  relativeReturn: number;
  zScore: number;
  volumeSpike: number;
  close: number;
  volume: number;
}

const ROLLING_WINDOW = 60;
const VOLUME_WINDOW = 20;
const Z_SCORE_THRESHOLD = 2.0;
const VOLUME_SPIKE_THRESHOLD = 2.0;
const CLUSTER_DAYS = 2;

export interface AnomalyDetectionOptions {
  rollingWindow?: number;
  volumeWindow?: number;
  zScoreThreshold?: number;
  volumeSpikeThreshold?: number;
  clusterDays?: number;
  timeframe?: 'daily' | 'weekly';
}

/**
 * Detect price anomalies by comparing stock returns to SPY (S&P 500) returns.
 * Uses z-scores of relative returns to identify statistically significant moves.
 */
export function detectAnomalies(
  stockData: OHLCDataPoint[],
  spyData: OHLCDataPoint[],
  options: AnomalyDetectionOptions = {}
): PriceAnomaly[] {
  const rollingWindow = options.rollingWindow ?? ROLLING_WINDOW;
  const volumeWindow = options.volumeWindow ?? VOLUME_WINDOW;
  const zScoreThreshold = options.zScoreThreshold ?? Z_SCORE_THRESHOLD;
  const volumeSpikeThreshold = options.volumeSpikeThreshold ?? VOLUME_SPIKE_THRESHOLD;
  const clusterDays = options.clusterDays ?? CLUSTER_DAYS;
  const timeframe = options.timeframe ?? 'daily';

  // Align dates: only use dates present in both datasets
  const spyDateMap = new Map<string, OHLCDataPoint>();
  for (const d of spyData) {
    spyDateMap.set(d.time, d);
  }

  const alignedStock: OHLCDataPoint[] = [];
  const alignedSpy: OHLCDataPoint[] = [];

  for (const d of stockData) {
    const spyPoint = spyDateMap.get(d.time);
    if (spyPoint) {
      alignedStock.push(d);
      alignedSpy.push(spyPoint);
    }
  }

  if (alignedStock.length < rollingWindow + 1) {
    return []; // Not enough data
  }

  // Calculate daily returns
  const stockReturns = dailyReturns(alignedStock.map((d) => d.close));
  const spyReturns = dailyReturns(alignedSpy.map((d) => d.close));

  // Calculate relative returns (stock - spy)
  const relativeReturns = stockReturns.map((r, i) => r - spyReturns[i]);

  // Rolling stats on relative returns
  const rollMean = rollingMean(relativeReturns, rollingWindow);
  const rollStd = rollingStdDev(relativeReturns, rollingWindow);

  // Z-scores
  const zScoresArr = zScores(relativeReturns, rollMean, rollStd);

  // Volume analysis (using stock volume, offset by 1 to match returns array)
  const volumes = alignedStock.slice(1).map((d) => d.volume);
  const avgVolumes = rollingAvgVolume(volumes, volumeWindow);

  // Identify anomalies
  const rawAnomalies: PriceAnomaly[] = [];

  for (let i = rollingWindow; i < zScoresArr.length; i++) {
    const absZ = Math.abs(zScoresArr[i]);
    const volSpike = avgVolumes[i] > 0 ? volumes[i] / avgVolumes[i] : 1;

    // Primary condition: significant z-score
    // Secondary condition: volume spike can lower the z-score threshold
    const effectiveThreshold =
      volSpike >= volumeSpikeThreshold ? zScoreThreshold * 0.85 : zScoreThreshold;

    if (absZ >= effectiveThreshold) {
      rawAnomalies.push({
        index: i + 1, // +1 because returns array is offset by 1 from data array
        date: alignedStock[i + 1].time,
        timeframe,
        stockReturn: stockReturns[i],
        spyReturn: spyReturns[i],
        relativeReturn: relativeReturns[i],
        zScore: zScoresArr[i],
        volumeSpike: volSpike,
        close: alignedStock[i + 1].close,
        volume: volumes[i],
      });
    }
  }

  // Cluster nearby anomalies (within CLUSTER_DAYS of each other)
  return clusterAnomalies(rawAnomalies, clusterDays);
}

function clusterAnomalies(anomalies: PriceAnomaly[], clusterDays: number): PriceAnomaly[] {
  if (anomalies.length === 0) return [];

  const sorted = [...anomalies].sort((a, b) => a.date.localeCompare(b.date));
  const clusters: PriceAnomaly[][] = [];
  let currentCluster: PriceAnomaly[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = new Date(sorted[i - 1].date);
    const currDate = new Date(sorted[i].date);
    const daysDiff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysDiff <= clusterDays) {
      currentCluster.push(sorted[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [sorted[i]];
    }
  }
  clusters.push(currentCluster);

  // For each cluster, keep the anomaly with the highest absolute z-score
  return clusters.map((cluster) =>
    cluster.reduce((best, curr) =>
      Math.abs(curr.zScore) > Math.abs(best.zScore) ? curr : best
    )
  );
}
