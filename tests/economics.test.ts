import { describe, it, expect } from "vitest";
import { calculateEconomics } from "../src/economics";
import { OrderbookLeg } from "../src/types";

describe("Executable Economics Calculator", () => {
  const feeSchedule = { rate: 0.07, exponent: 1, takerOnly: true, rebateRate: 0.2 };

  it("should walk book depth to compute effective fill price with slippage and fees", () => {
    const up: OrderbookLeg = {
      tokenId: "up",
      bestBid: 0.50,
      bestAsk: 0.51,
      mid: 0.505,
      spread: 0.01,
      bidDepthTotalUsd: 500,
      askDepthTotalUsd: 500,
      bidTopSize: 50,
      askTopSize: 50,
      imbalance: 0,
      bids: [[0.50, 50]],
      asks: [[0.51, 50], [0.52, 50]], // 50 @ 0.51, 50 @ 0.52 -> avg 0.515
    };
    const down = { ...up, tokenId: "down" };

    const econ = calculateEconomics(up, down, feeSchedule, 100);
    expect(econ.buyUp.benchmarkShares).toBe(100);
    expect(econ.buyUp.grossCostUsd).toBeCloseTo(51.50);
    expect(econ.buyUp.effectivePricePerShare).toBeGreaterThan(0.51);
    expect(econ.buyUp.estimatedTakerFeeUsd).toBeGreaterThan(0);
  });

  it("should evaluate arbitrage viability including depth and fees", () => {
    const up: OrderbookLeg = {
      tokenId: "up",
      bestBid: 0.46,
      bestAsk: 0.47,
      mid: 0.465,
      spread: 0.01,
      bidDepthTotalUsd: 500,
      askDepthTotalUsd: 500,
      bidTopSize: 100,
      askTopSize: 100,
      imbalance: 0,
      bids: [[0.46, 100]],
      asks: [[0.47, 100]],
    };
    // Down ask = 0.48 -> sum = 0.95 -> gross edge = 0.05
    const down: OrderbookLeg = {
      tokenId: "down",
      bestBid: 0.47,
      bestAsk: 0.48,
      mid: 0.475,
      spread: 0.01,
      bidDepthTotalUsd: 500,
      askDepthTotalUsd: 500,
      bidTopSize: 80,
      askTopSize: 80,
      imbalance: 0,
      bids: [[0.47, 80]],
      asks: [[0.48, 80]],
    };

    const econ = calculateEconomics(up, down, { rate: 0.02, exponent: 1, takerOnly: true, rebateRate: 0.2 }, 50);
    expect(econ.buyBothArbitrage.askSum).toBeCloseTo(0.95);
    expect(econ.buyBothArbitrage.grossEdgeUsd).toBeCloseTo(2.50); // (1 - 0.95) * 50 = 2.50
    expect(econ.buyBothArbitrage.netEdgeUsd).toBeGreaterThan(0);
    expect(econ.buyBothArbitrage.isViable).toBe(true);
    expect(econ.buyBothArbitrage.maxExecutableShares).toBe(80);
  });
});
