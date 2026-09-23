import { describe, it, expect } from "vitest";
import { calculateKellyFraction, calculateOrderSizeShares } from "../src/kelly";

describe("Fractional Kelly Criterion Position Sizing", () => {
  it("should return zero allocation when win probability is below breakeven", () => {
    // Token ask 0.88, but win probability is only 0.70 (negative EV)
    const kelly = calculateKellyFraction({
      winProbability: 0.70,
      tokenAsk: 0.88,
      takerFeeRate: 0.07,
    });
    expect(kelly.fullKellyFraction).toBe(0);
    expect(kelly.recommendedFraction).toBe(0);
  });

  it("should calculate positive fraction when EV > 0", () => {
    // Token ask 0.86, win probability 0.98
    const kelly = calculateKellyFraction({
      winProbability: 0.98,
      tokenAsk: 0.86,
      takerFeeRate: 0.07,
      fractionMultiplier: 0.25, // Quarter Kelly
    });

    expect(kelly.fullKellyFraction).toBeGreaterThan(0.50);
    expect(kelly.recommendedFraction).toBeGreaterThan(0.10);
    expect(kelly.recommendedFraction).toBeLessThanOrEqual(0.25);
  });

  it("should increase allocation when stop-loss limits max loss", () => {
    // With stop loss exit at 0.65, loss is only ~25% instead of 100%
    const withoutStopLoss = calculateKellyFraction({
      winProbability: 0.92,
      tokenAsk: 0.86,
      stopLossPrice: 0, // 100% loss
    });

    const withStopLoss = calculateKellyFraction({
      winProbability: 0.92,
      tokenAsk: 0.86,
      stopLossPrice: 0.65, // ~25% max loss
    });

    // Loss is much smaller with stop-loss -> safer to allocate higher fraction
    expect(withStopLoss.fullKellyFraction).toBeGreaterThan(withoutStopLoss.fullKellyFraction);
  });

  it("should compute exact executable shares within capital constraints", () => {
    const size = calculateOrderSizeShares({
      availableBankrollUsd: 1000,
      tokenAsk: 0.85,
      fraction: 0.10, // 10% of bankroll = $100
      maxSingleTradeUsd: 150,
      minShares: 5,
    });

    // $100 / 0.85 ~ 117 shares
    expect(size.shares).toBeGreaterThanOrEqual(100);
    expect(size.shares).toBeLessThanOrEqual(120);
    expect(size.totalCostUsd).toBeLessThanOrEqual(150);
  });
});
