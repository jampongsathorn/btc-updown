export interface VolatilityEstimatorOptions {
  windowSeconds?: number;
  defaultAnnualizedVol?: number;
  minTicksForCalculation?: number;
}

interface PriceTick {
  price: number;
  timestampMs: number;
}

export class RealizedVolatilityEstimator {
  private windowMs: number;
  private defaultAnnualizedVol: number;
  private minTicks: number;
  private ticks: PriceTick[] = [];

  constructor(options?: VolatilityEstimatorOptions) {
    this.windowMs = (options?.windowSeconds ?? 120) * 1000;
    this.defaultAnnualizedVol = options?.defaultAnnualizedVol ?? 0.55;
    this.minTicks = options?.minTicksForCalculation ?? 5;
  }

  public recordPrice(price: number, timestampMs: number = Date.now()): void {
    if (price <= 0) return;

    this.ticks.push({ price, timestampMs });
    this.pruneOldTicks(timestampMs);
  }

  private pruneOldTicks(currentTimestampMs: number): void {
    const cutoff = currentTimestampMs - this.windowMs;
    while (this.ticks.length > 0 && this.ticks[0].timestampMs < cutoff) {
      this.ticks.shift();
    }
  }

  public getAnnualizedVol(): number {
    if (this.ticks.length < this.minTicks) {
      return this.defaultAnnualizedVol;
    }

    // Compute log returns between adjacent ticks
    const logReturns: number[] = [];
    let totalDtSeconds = 0;

    for (let i = 1; i < this.ticks.length; i++) {
      const pPrev = this.ticks[i - 1].price;
      const pCurr = this.ticks[i].price;
      const dtSec = (this.ticks[i].timestampMs - this.ticks[i - 1].timestampMs) / 1000;

      if (dtSec > 0 && pPrev > 0 && pCurr > 0) {
        logReturns.push(Math.log(pCurr / pPrev));
        totalDtSeconds += dtSec;
      }
    }

    if (logReturns.length < 2 || totalDtSeconds <= 0) {
      return this.defaultAnnualizedVol;
    }

    // Variance of returns
    const mean = logReturns.reduce((sum, r) => sum + r, 0) / logReturns.length;
    const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
    const avgDtSec = totalDtSeconds / logReturns.length;

    // Scale to 1 second variance
    const secondVariance = variance / Math.max(0.1, avgDtSec);
    const secondVol = Math.sqrt(secondVariance);

    // Annualize (seconds per year = 365.25 * 86400)
    const annualizedVol = secondVol * Math.sqrt(365.25 * 86400);

    // Bound between 0.15 (15%) and 2.50 (250%)
    return Math.max(0.15, Math.min(2.50, parseFloat(annualizedVol.toFixed(4))));
  }

  public getTickCount(): number {
    return this.ticks.length;
  }
}
