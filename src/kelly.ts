export interface KellyInput {
  winProbability: number; // p* (e.g. 0.95)
  tokenAsk: number; // purchase price (e.g. 0.86)
  takerFeeRate?: number; // default 0.07
  stopLossPrice?: number; // expected exit price if stopped out (e.g. 0.65)
  fractionMultiplier?: number; // default 0.25 (Quarter-Kelly)
  maxBankrollAllocation?: number; // default 0.20 (max 20% of bankroll per single trade)
}

export interface KellyResult {
  fullKellyFraction: number;
  recommendedFraction: number;
  netEdgePct: number;
  expectedValuePerShare: number;
  winReturnRatio: number;
  lossRatio: number;
}

export interface OrderSizeInput {
  availableBankrollUsd: number;
  tokenAsk: number;
  fraction: number;
  maxSingleTradeUsd?: number;
  minShares?: number;
}

export interface OrderSizeResult {
  shares: number;
  totalCostUsd: number;
  allocationPct: number;
}

export function calculateKellyFraction(input: KellyInput): KellyResult {
  const {
    winProbability,
    tokenAsk,
    takerFeeRate = 0.07,
    stopLossPrice = 0,
    fractionMultiplier = 0.25,
    maxBankrollAllocation = 0.20,
  } = input;

  if (winProbability <= 0 || tokenAsk <= 0 || tokenAsk >= 1.0) {
    return {
      fullKellyFraction: 0,
      recommendedFraction: 0,
      netEdgePct: 0,
      expectedValuePerShare: 0,
      winReturnRatio: 0,
      lossRatio: 0,
    };
  }

  // Taker fee on entry
  const entryFee = takerFeeRate * tokenAsk * (1 - tokenAsk);
  const costBasis = tokenAsk + entryFee;

  // Win return per dollar invested: (1.00 - costBasis) / costBasis
  const winReturnRatio = Math.max(0.001, (1.00 - costBasis) / costBasis);

  // Loss per dollar invested:
  // If stop loss is active: loss is (costBasis - (stopLossPrice - exitFee)) / costBasis
  let lossRatio = 1.0;
  if (stopLossPrice > 0 && stopLossPrice < tokenAsk) {
    const exitFee = takerFeeRate * stopLossPrice * (1 - stopLossPrice);
    const recovered = Math.max(0, stopLossPrice - exitFee);
    lossRatio = Math.min(1.0, Math.max(0.05, (costBasis - recovered) / costBasis));
  }

  // Generalized Kelly: f* = p / a - (1 - p) / b
  // where a = lossRatio, b = winReturnRatio
  const p = winProbability;
  const q = 1 - p;

  const fullKelly = (p / lossRatio) - (q / winReturnRatio);

  const evPerShare = parseFloat((p * 1.00 - costBasis).toFixed(4));
  const netEdgePct = parseFloat(((evPerShare / costBasis) * 100).toFixed(2));

  if (fullKelly <= 0 || evPerShare <= 0) {
    return {
      fullKellyFraction: 0,
      recommendedFraction: 0,
      netEdgePct: Math.max(0, netEdgePct),
      expectedValuePerShare: evPerShare,
      winReturnRatio: parseFloat(winReturnRatio.toFixed(4)),
      lossRatio: parseFloat(lossRatio.toFixed(4)),
    };
  }

  const boundedFull = Math.min(1.0, fullKelly);
  const fractional = boundedFull * fractionMultiplier;
  const recommendedFraction = Math.min(maxBankrollAllocation, parseFloat(fractional.toFixed(4)));

  return {
    fullKellyFraction: parseFloat(boundedFull.toFixed(4)),
    recommendedFraction,
    netEdgePct,
    expectedValuePerShare: evPerShare,
    winReturnRatio: parseFloat(winReturnRatio.toFixed(4)),
    lossRatio: parseFloat(lossRatio.toFixed(4)),
  };
}

export function calculateOrderSizeShares(input: OrderSizeInput): OrderSizeResult {
  const {
    availableBankrollUsd,
    tokenAsk,
    fraction,
    maxSingleTradeUsd = 200,
    minShares = 5,
  } = input;

  if (availableBankrollUsd <= 0 || tokenAsk <= 0 || fraction <= 0) {
    return { shares: 0, totalCostUsd: 0, allocationPct: 0 };
  }

  const desiredUsd = Math.min(availableBankrollUsd * fraction, maxSingleTradeUsd);
  const rawShares = Math.floor(desiredUsd / tokenAsk);

  if (rawShares < minShares) {
    return { shares: 0, totalCostUsd: 0, allocationPct: 0 };
  }

  const totalCostUsd = parseFloat((rawShares * tokenAsk).toFixed(2));
  const allocationPct = parseFloat(((totalCostUsd / availableBankrollUsd) * 100).toFixed(2));

  return {
    shares: rawShares,
    totalCostUsd,
    allocationPct,
  };
}
