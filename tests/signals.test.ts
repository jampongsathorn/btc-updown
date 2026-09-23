import { describe, it, expect } from "vitest";
import { calculateSignals } from "../src/signals";
import { OrderbookLeg } from "../src/types";

describe("Signal & Parity Calculator", () => {
  const makeLeg = (bid: number, ask: number, depth: number): OrderbookLeg => ({
    tokenId: "test",
    bestBid: bid,
    bestAsk: ask,
    mid: (bid + ask) / 2,
    spread: ask - bid,
    bidDepthTotalUsd: depth,
    askDepthTotalUsd: depth,
    bidTopSize: 100,
    askTopSize: 100,
    imbalance: 0,
    bids: [[bid, 100]],
    asks: [[ask, 100]],
  });

  it("should calculate tri-parity metrics and net arbitrage edge", () => {
    // Up ask = 0.48, Down ask = 0.50 -> buyBothCost = 0.98 -> gross edge = 0.02
    const up = makeLeg(0.47, 0.48, 1000);
    const down = makeLeg(0.49, 0.50, 1000);
    const feeRate = 0.005; // 0.5% taker fee for test

    const signal = calculateSignals(up, down, feeRate);
    expect(signal.midParity).toBeCloseTo(0.97);
    expect(signal.buyBothCost).toBeCloseTo(0.98);
    expect(signal.buyBothGrossEdge).toBeCloseTo(0.02);
    expect(signal.executableDepthShares).toBe(100);
    expect(signal.buyBothNetEdge).toBeGreaterThan(0.01);
  });

  it("should calculate bid and ask orderbook imbalances correctly", () => {
    const up: OrderbookLeg = {
      ...makeLeg(0.50, 0.51, 1000),
      bidTopSize: 300,
      askTopSize: 100,
      imbalance: 0.5,
    };
    const down: OrderbookLeg = {
      ...makeLeg(0.48, 0.49, 1000),
      bidTopSize: 100,
      askTopSize: 300,
      imbalance: -0.5,
    };

    const signal = calculateSignals(up, down, 0.07);
    expect(signal.imbalanceUp).toBe(0.5);
    expect(signal.imbalanceDown).toBe(-0.5);
  });
});
