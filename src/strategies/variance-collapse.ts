/**
 * Standard Normal Cumulative Distribution Function Φ(x)
 * Accurate numerical approximation (Abramowitz and Stegun 7.1.26)
 */
export function normalCdf(x: number): number {
  if (x < -8.0) return 0.0;
  if (x > 8.0) return 1.0;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

export interface VarianceCollapseInput {
  currentSpot: number;
  priceToBeat: number;
  secondsRemaining: number;
  upAsk: number;
  upBid: number;
  downAsk: number;
  downBid: number;
  takerFeeRate?: number;
  annualizedVol?: number;
  minEvThreshold?: number;
  jumpSafetyBufferUsd?: number;
  currentPosition?: { side: "UP" | "DOWN"; entryPrice: number };
}

export interface VarianceCollapseResult {
  zScore: number;
  trueProbabilityUp: number;
  trueProbabilityDown: number;
  inSniperWindow: boolean;
  expectedValueUp: number;
  expectedValueDown: number;
  netEdgeUpPct: number;
  netEdgeDownPct: number;
  recommendedAction: "BUY_UP" | "BUY_DOWN" | "HOLD_NO_EDGE" | "STOP_LOSS_EXIT";
  reason: string;
  realizedVol?: number;
  kellyFraction?: number;
  recommendedShares?: number;
}

export function evaluateVarianceCollapse(input: VarianceCollapseInput): VarianceCollapseResult {
  const {
    currentSpot,
    priceToBeat,
    secondsRemaining,
    upAsk,
    downAsk,
    takerFeeRate = 0.07,
    annualizedVol = 0.55, // 55% annualized BTC volatility
    minEvThreshold = 0.03, // require at least +$0.03 expected value per share
    jumpSafetyBufferUsd = 35.0, // Minimum $35 BTC drift required to avoid flash-wick liquidation zone
    currentPosition,
  } = input;

  // Sniper window: minute 3:30 to 4:50 (tau between 10 and 90 seconds)
  const inSniperWindow = secondsRemaining <= 90 && secondsRemaining >= 10;

  // Diffusion standard deviation over remaining seconds tau
  const tauYears = Math.max(1, secondsRemaining) / (365.25 * 86400);
  const sigmaTau = annualizedVol * Math.sqrt(tauYears);

  // Return distance in standard deviations
  const priceDeltaUsd = currentSpot - priceToBeat;
  const logReturn = Math.log(currentSpot / Math.max(1, priceToBeat));
  const zScore = parseFloat((logReturn / Math.max(0.00001, sigmaTau)).toFixed(3));

  const trueProbabilityUp = parseFloat(normalCdf(zScore).toFixed(4));
  const trueProbabilityDown = parseFloat((1 - trueProbabilityUp).toFixed(4));

  // Polymarket taker fee formula: rate * P * (1 - P)
  const feeUp = upAsk > 0 ? takerFeeRate * upAsk * (1 - upAsk) : 0;
  const feeDown = downAsk > 0 ? takerFeeRate * downAsk * (1 - downAsk) : 0;

  // Net Expected Value: E[Payoff] - AskPrice - TakerFee
  const expectedValueUp = upAsk > 0 ? parseFloat((trueProbabilityUp * 1.00 - upAsk - feeUp).toFixed(4)) : -1;
  const expectedValueDown = downAsk > 0 ? parseFloat((trueProbabilityDown * 1.00 - downAsk - feeDown).toFixed(4)) : -1;

  const netEdgeUpPct = upAsk > 0 ? parseFloat(((expectedValueUp / upAsk) * 100).toFixed(2)) : 0;
  const netEdgeDownPct = downAsk > 0 ? parseFloat(((expectedValueDown / downAsk) * 100).toFixed(2)) : 0;

  let recommendedAction: "BUY_UP" | "BUY_DOWN" | "HOLD_NO_EDGE" | "STOP_LOSS_EXIT" = "HOLD_NO_EDGE";
  let reason = "No statistical edge or outside sniper window";

  // 1. Check Stop-Loss on existing open position first (protect against fat-tail jump / reversal)
  if (currentPosition) {
    if (currentPosition.side === "UP" && (priceDeltaUsd <= 5 || zScore < 0.6)) {
      return {
        zScore,
        trueProbabilityUp,
        trueProbabilityDown,
        inSniperWindow,
        expectedValueUp,
        expectedValueDown,
        netEdgeUpPct,
        netEdgeDownPct,
        recommendedAction: "STOP_LOSS_EXIT",
        reason: `Stop-loss triggered: BTC reversed near/below strike ($Delta: $${priceDeltaUsd.toFixed(1)}, Z: ${zScore}). Early exit to prevent 100% total loss!`,
      };
    } else if (currentPosition.side === "DOWN" && (priceDeltaUsd >= -5 || zScore > -0.6)) {
      return {
        zScore,
        trueProbabilityUp,
        trueProbabilityDown,
        inSniperWindow,
        expectedValueUp,
        expectedValueDown,
        netEdgeUpPct,
        netEdgeDownPct,
        recommendedAction: "STOP_LOSS_EXIT",
        reason: `Stop-loss triggered: BTC reversed near/above strike ($Delta: $${priceDeltaUsd.toFixed(1)}, Z: ${zScore}). Early exit to prevent 100% total loss!`,
      };
    }
  }

  // 2. New Entry: Require sniper window, EV threshold, AND Jump Safety Buffer
  const hasJumpBuffer = Math.abs(priceDeltaUsd) >= jumpSafetyBufferUsd;

  if (inSniperWindow) {
    if (!hasJumpBuffer) {
      reason = `In sniper window but inside flash-wick danger zone (Delta: $${priceDeltaUsd.toFixed(1)} < Buffer $${jumpSafetyBufferUsd}). Skipping trade for capital preservation.`;
    } else if (trueProbabilityUp >= 0.90 && expectedValueUp >= minEvThreshold && upAsk < 0.98) {
      recommendedAction = "BUY_UP";
      reason = `High statistical confidence Up (${(trueProbabilityUp * 100).toFixed(1)}%) with EV +$${expectedValueUp.toFixed(3)} (${netEdgeUpPct}% edge, Delta: +$${priceDeltaUsd.toFixed(1)})`;
    } else if (trueProbabilityDown >= 0.90 && expectedValueDown >= minEvThreshold && downAsk < 0.98) {
      recommendedAction = "BUY_DOWN";
      reason = `High statistical confidence Down (${(trueProbabilityDown * 100).toFixed(1)}%) with EV +$${expectedValueDown.toFixed(3)} (${netEdgeDownPct}% edge, Delta: -$${Math.abs(priceDeltaUsd).toFixed(1)})`;
    }
  }

  return {
    zScore,
    trueProbabilityUp,
    trueProbabilityDown,
    inSniperWindow,
    expectedValueUp,
    expectedValueDown,
    netEdgeUpPct,
    netEdgeDownPct,
    recommendedAction,
    reason,
  };
}
