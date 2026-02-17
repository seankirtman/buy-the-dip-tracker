/**
 * Calculate daily returns from an array of closing prices.
 * Returns an array of length (prices.length - 1).
 */
export function dailyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] === 0) {
      returns.push(0);
    } else {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  return returns;
}

/**
 * Calculate rolling mean over a specified window.
 * Returns an array of the same length as input; first (window-1) values are NaN.
 */
export function rollingMean(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) {
      sum += values[j];
    }
    result.push(sum / window);
  }
  return result;
}

/**
 * Calculate rolling standard deviation over a specified window.
 * Returns an array of the same length as input; first (window-1) values are NaN.
 */
export function rollingStdDev(values: number[], window: number): number[] {
  const means = rollingMean(values, window);
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1 || isNaN(means[i])) {
      result.push(NaN);
      continue;
    }
    let sumSqDiff = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const diff = values[j] - means[i];
      sumSqDiff += diff * diff;
    }
    result.push(Math.sqrt(sumSqDiff / window));
  }
  return result;
}

/**
 * Calculate z-scores given values, rolling means, and rolling standard deviations.
 */
export function zScores(
  values: number[],
  means: number[],
  stdDevs: number[]
): number[] {
  return values.map((v, i) => {
    if (isNaN(means[i]) || isNaN(stdDevs[i]) || stdDevs[i] === 0) {
      return 0;
    }
    return (v - means[i]) / stdDevs[i];
  });
}

/**
 * Calculate rolling average volume over a window.
 */
export function rollingAvgVolume(volumes: number[], window: number): number[] {
  return rollingMean(volumes, window);
}

/**
 * Mean of an array.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
