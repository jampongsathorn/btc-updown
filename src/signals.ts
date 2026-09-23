import { OrderbookLeg } from "./types.js";

export interface SignalMetrics {
  midParity: number;
  buyBothCost: number;
  buyBothGrossEdge: number;
  sellBothValue: number;
  sellBothGrossEdge: number;
  executableDepthShares: number;
  buyBothNetEdge: number;
  imbalanceUp: number;
  imbalanceDown: number;
}

export function calculateSignals(
  up: OrderbookLeg,
  down: OrderbookLeg,
  takerFeeRate: number = 0.07
): SignalMetrics {
  const midParity = parseFloat((up.mid + down.mid).toFixed(4));
  const buyBothCost = parseFloat((up.bestAsk + down.bestAsk).toFixed(4));
  const buyBothGrossEdge = parseFloat((1 - buyBothCost).toFixed(4));

  const sellBothValue = parseFloat((up.bestBid + down.bestBid).toFixed(4));
  const sellBothGrossEdge = parseFloat((sellBothValue - 1).toFixed(4));

  const executableDepthShares = Math.min(up.askTopSize, down.askTopSize);

  // Estimated taker fees on executing both legs
  const totalTakerFees = (up.bestAsk + down.bestAsk) * takerFeeRate;
  const buyBothNetEdge = parseFloat((buyBothGrossEdge - totalTakerFees).toFixed(4));

  return {
    midParity,
    buyBothCost,
    buyBothGrossEdge,
    sellBothValue,
    sellBothGrossEdge,
    executableDepthShares,
    buyBothNetEdge,
    imbalanceUp: up.imbalance,
    imbalanceDown: down.imbalance,
  };
}
