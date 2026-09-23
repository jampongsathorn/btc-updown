/**
 * Chainlink 60-Second TWAP Predictor & Basis Interpolator
 * 
 * Accurately models the exact Polymarket resolution rule:
 * Resolution Source: Chainlink BTC/USD 60s TWAP streams
 * Final Price = 1/60 * Integral_{t=240}^{300} Spot(u) du
 * 
 * Mathematical Properties:
 * 1. As time advances t in [240, 300], part of the TWAP integral is DETERMINISTICALLY LOCKED IN.
 * 2. Remaining uncertainty variance collapses cubically: Var(Integral W_u du) = tau^3 / 3.
 * 3. Therefore, TWAP variance collapses significantly faster than ordinary spot diffusion!
 */

export interface TwapPredictorOptions {
  slotEpoch: number;
  twapWindowSeconds?: number; // default 60 seconds
}

export interface TwapEstimate {
  currentSpot: number;
  lockedInFraction: number; // 0.0 at t <= 240, 1.0 at t = 300
  cumulativeTwapSoFar: number;
  expectedTwap: number;
  twapStdDev: number;
  zScoreVsStrike: number;
}

export class ChainlinkTwapPredictor {
  private slotEpoch: number;
  private twapWindowSec: number;
  private spotTicks: { spot: number; elapsedSec: number }[] = [];

  constructor(options: TwapPredictorOptions) {
    this.slotEpoch = options.slotEpoch;
    this.twapWindowSec = options.twapWindowSeconds ?? 60;
  }

  public recordSpotTick(spot: number, elapsedSecInSlot: number): void {
    if (spot <= 0) return;
    this.spotTicks.push({ spot, elapsedSec: elapsedSecInSlot });
  }

  public estimateFinalTwap(currentSpot: number, elapsedSec: number, annualizedVol: number = 0.55, strikePrice: number = currentSpot): TwapEstimate {
    const twapStartSec = 300 - this.twapWindowSec; // 240s
    const secondsInTwap = Math.max(0, Math.min(this.twapWindowSec, elapsedSec - twapStartSec));
    const lockedInFraction = secondsInTwap / this.twapWindowSec;
    const remainingTau = Math.max(0, 300 - elapsedSec);

    // Compute cumulative average of ticks observed inside [240, elapsedSec]
    const twapTicks = this.spotTicks.filter(t => t.elapsedSec >= twapStartSec && t.elapsedSec <= elapsedSec);
    let cumulativeTwapSoFar = currentSpot;

    if (twapTicks.length > 0) {
      const sum = twapTicks.reduce((acc, t) => acc + t.spot, 0);
      cumulativeTwapSoFar = sum / twapTicks.length;
    }

    // Expected final TWAP = lockedInFraction * cumulativeSoFar + (1 - lockedInFraction) * currentSpot
    const expectedTwap = lockedInFraction * cumulativeTwapSoFar + (1 - lockedInFraction) * currentSpot;

    // Standard deviation of remaining TWAP
    const twapStdDev = this.getRemainingTwapStdDev(remainingTau, currentSpot, annualizedVol);

    // Z-score of expected TWAP relative to strike
    const zScoreVsStrike = twapStdDev > 0 ? (expectedTwap - strikePrice) / twapStdDev : 0;

    return {
      currentSpot,
      lockedInFraction,
      cumulativeTwapSoFar: parseFloat(cumulativeTwapSoFar.toFixed(2)),
      expectedTwap: parseFloat(expectedTwap.toFixed(2)),
      twapStdDev: parseFloat(twapStdDev.toFixed(2)),
      zScoreVsStrike: parseFloat(zScoreVsStrike.toFixed(3)),
    };
  }

  public getSpotStdDev(tauSec: number, spot: number, annualizedVol: number): number {
    const tauYears = Math.max(0.1, tauSec) / (365.25 * 86400);
    return spot * annualizedVol * Math.sqrt(tauYears);
  }

  public getRemainingTwapStdDev(tauSec: number, spot: number, annualizedVol: number): number {
    if (tauSec <= 0) return 0.001;

    // Annualized second volatility
    const secondVol = annualizedVol / Math.sqrt(365.25 * 86400);

    // Remaining weight in the 60-second TWAP denominator
    const weightRemaining = Math.min(1.0, tauSec / this.twapWindowSec);

    // Standard deviation of the average of Brownian motion over tau:
    // Var(1/tau * \int_0^tau W_t dt) = (secondVol * spot)^2 * (tau / 3)
    // Scaled by weightRemaining:
    const twapSecondVariance = Math.pow(spot * secondVol, 2) * (tauSec / 3);
    const twapStdDev = weightRemaining * Math.sqrt(twapSecondVariance);

    return Math.max(0.01, twapStdDev);
  }
}
