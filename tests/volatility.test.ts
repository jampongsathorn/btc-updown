import { describe, it, expect, beforeEach } from "vitest";
import { RealizedVolatilityEstimator } from "../src/volatility";

describe("Realized Volatility Estimator", () => {
  let estimator: RealizedVolatilityEstimator;

  beforeEach(() => {
    // Window of 60 seconds, fallback annualized vol 0.55
    estimator = new RealizedVolatilityEstimator({ windowSeconds: 60, defaultAnnualizedVol: 0.55 });
  });

  it("should return default annualized volatility when insufficient ticks exist", () => {
    expect(estimator.getAnnualizedVol()).toBeCloseTo(0.55, 2);
    estimator.recordPrice(65000, 1000);
    expect(estimator.getAnnualizedVol()).toBeCloseTo(0.55, 2);
  });

  it("should calculate annualized realized volatility from price ticks", () => {
    const baseTime = 100000;
    let price = 65000;

    // Simulate 30 ticks with realistic 1-second crypto micro-moves (~0.0001 per second)
    for (let i = 0; i < 30; i++) {
      price = price * (1 + (i % 2 === 0 ? 0.0001 : -0.00008));
      estimator.recordPrice(price, baseTime + i * 1000);
    }

    const vol = estimator.getAnnualizedVol();
    expect(vol).toBeGreaterThan(0.10);
    expect(vol).toBeLessThan(2.0); // Realistic crypto volatility range
  });

  it("should prune ticks older than the rolling window", () => {
    estimator.recordPrice(65000, 1000);
    estimator.recordPrice(65050, 2000);
    estimator.recordPrice(65020, 70000); // 69 seconds later, first ticks pruned
    expect(estimator.getTickCount()).toBeLessThanOrEqual(2);
  });
});
