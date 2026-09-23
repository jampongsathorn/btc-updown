import { OrderbookLeg, ExecutionScenario, ArbitrageScenario } from "./types.js";

export interface FeeSchedule {
  rate: number;
  exponent: number;
  takerOnly: boolean;
  rebateRate: number;
}

export interface EconomicsMetrics {
  feeSchedule: FeeSchedule;
  buyUp: ExecutionScenario;
  buyDown: ExecutionScenario;
  buyBothArbitrage: ArbitrageScenario;
}

export function walkAskDepth(
  asks: [number, number][],
  sharesNeeded: number
): { grossCost: number; avgPrice: number; slippageBps: number; filledShares: number } {
  if (asks.length === 0 || sharesNeeded <= 0) {
    return { grossCost: 0, avgPrice: 0, slippageBps: 0, filledShares: 0 };
  }

  const bestAsk = asks[0][0];
  let remaining = sharesNeeded;
  let totalCost = 0;
  let filled = 0;

  for (const [price, size] of asks) {
    const take = Math.min(remaining, size);
    totalCost += take * price;
    filled += take;
    remaining -= take;
    if (remaining <= 0) break;
  }

  const avgPrice = filled > 0 ? totalCost / filled : bestAsk;
  const slippageBps = bestAsk > 0 ? Math.round(((avgPrice - bestAsk) / bestAsk) * 10000) : 0;

  return {
    grossCost: parseFloat(totalCost.toFixed(4)),
    avgPrice: parseFloat(avgPrice.toFixed(4)),
    slippageBps,
    filledShares: filled,
  };
}

export function computeTakerFee(price: number, size: number, feeSchedule: FeeSchedule): number {
  if (!feeSchedule.takerOnly && feeSchedule.rate === 0) return 0;
  // Polymarket crypto fee curve formula: rate * price * (1 - price)^exponent
  // or linear approximation: rate * price * size
  const feeRate = feeSchedule.rate;
  return parseFloat((feeRate * price * size).toFixed(4));
}

export function calculateExecutionScenario(
  leg: OrderbookLeg,
  feeSchedule: FeeSchedule,
  benchmarkShares: number
): ExecutionScenario {
  const depthWalk = walkAskDepth(leg.asks, benchmarkShares);
  const estimatedTakerFeeUsd = computeTakerFee(depthWalk.avgPrice, depthWalk.filledShares, feeSchedule);
  const totalCost = depthWalk.grossCost + estimatedTakerFeeUsd;
  const effectivePricePerShare = depthWalk.filledShares > 0 ? parseFloat((totalCost / depthWalk.filledShares).toFixed(4)) : leg.bestAsk;

  return {
    marketPrice: leg.bestAsk,
    benchmarkShares,
    grossCostUsd: depthWalk.grossCost,
    estimatedTakerFeeUsd,
    effectivePricePerShare,
    slippageBps: depthWalk.slippageBps,
  };
}

export function calculateEconomics(
  up: OrderbookLeg,
  down: OrderbookLeg,
  feeSchedule: FeeSchedule,
  benchmarkShares: number = 100
): EconomicsMetrics {
  const buyUp = calculateExecutionScenario(up, feeSchedule, benchmarkShares);
  const buyDown = calculateExecutionScenario(down, feeSchedule, benchmarkShares);

  const askSum = parseFloat((up.bestAsk + down.bestAsk).toFixed(4));
  const maxExecutableShares = Math.min(up.askTopSize, down.askTopSize);
  const targetShares = Math.min(benchmarkShares, maxExecutableShares);

  const grossEdgePerShare = 1 - askSum;
  const grossEdgeUsd = parseFloat((grossEdgePerShare * targetShares).toFixed(4));

  const totalFees = (buyUp.estimatedTakerFeeUsd + buyDown.estimatedTakerFeeUsd) * (targetShares / Math.max(1, benchmarkShares));
  const estimatedTotalFeesUsd = parseFloat(totalFees.toFixed(4));
  const netEdgeUsd = parseFloat((grossEdgeUsd - estimatedTotalFeesUsd).toFixed(4));
  const isViable = grossEdgePerShare > 0 && netEdgeUsd > 0 && maxExecutableShares > 0;

  return {
    feeSchedule,
    buyUp,
    buyDown,
    buyBothArbitrage: {
      isViable,
      askSum,
      grossEdgeUsd,
      estimatedTotalFeesUsd,
      netEdgeUsd,
      maxExecutableShares,
    },
  };
}
