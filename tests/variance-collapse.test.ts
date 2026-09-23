import { describe, it, expect } from "vitest";
import { evaluateVarianceCollapse, normalCdf } from "../src/strategies/variance-collapse";

describe("Variance Collapse Quantitative Strategy", () => {
  it("should calculate standard normal CDF accurately", () => {
    expect(normalCdf(0)).toBeCloseTo(0.50, 2);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(3.0)).toBeGreaterThan(0.998);
  });

  it("should identify high positive EV when spot is comfortably above priceToBeat in sniper window", () => {
    // 45 seconds remaining. BTC Spot = $85,550, priceToBeat = $85,450 (+ $100 drift)
    // Orderbook Up ask = 0.88, Down ask = 0.15
    const result = evaluateVarianceCollapse({
      currentSpot: 85550,
      priceToBeat: 85450,
      secondsRemaining: 45,
      upAsk: 0.88,
      upBid: 0.87,
      downAsk: 0.15,
      downBid: 0.14,
      takerFeeRate: 0.07,
      annualizedVol: 0.55, // 55% annualized BTC volatility
    });

    expect(result.inSniperWindow).toBe(true);
    expect(result.trueProbabilityUp).toBeGreaterThan(0.95);
    expect(result.expectedValueUp).toBeGreaterThan(0.04); // EV > +$0.04 per share
    expect(result.recommendedAction).toBe("BUY_UP");
  });

  it("should return HOLD_NO_EDGE when early in the slot (e.g. 250s remaining) due to high variance", () => {
    const result = evaluateVarianceCollapse({
      currentSpot: 85500,
      priceToBeat: 85480, // only +$20 drift with 250s left
      secondsRemaining: 250,
      upAsk: 0.53,
      upBid: 0.52,
      downAsk: 0.49,
      downBid: 0.48,
      takerFeeRate: 0.07,
    });

    expect(result.inSniperWindow).toBe(false);
    expect(result.recommendedAction).toBe("HOLD_NO_EDGE");
  });

  it("should identify high positive EV for DOWN when spot is below priceToBeat", () => {
    // 40 seconds remaining. BTC Spot = $85,350, priceToBeat = $85,450 (- $100 drift)
    const result = evaluateVarianceCollapse({
      currentSpot: 85350,
      priceToBeat: 85450,
      secondsRemaining: 40,
      upAsk: 0.15,
      upBid: 0.14,
      downAsk: 0.87,
      downBid: 0.86,
      takerFeeRate: 0.07,
      annualizedVol: 0.55,
    });

    expect(result.inSniperWindow).toBe(true);
    expect(result.trueProbabilityDown).toBeGreaterThan(0.95);
    expect(result.expectedValueDown).toBeGreaterThan(0.04);
    expect(result.recommendedAction).toBe("BUY_DOWN");
  });

  it("should reject trade inside the flash-wick danger zone (drift < buffer)", () => {
    // 30 seconds remaining, but drift is only +$12 (inside default $35 danger zone)
    const result = evaluateVarianceCollapse({
      currentSpot: 85462,
      priceToBeat: 85450, // only +$12 drift
      secondsRemaining: 30,
      upAsk: 0.88,
      upBid: 0.87,
      downAsk: 0.15,
      downBid: 0.14,
      takerFeeRate: 0.07,
      jumpSafetyBufferUsd: 35.0,
    });

    expect(result.recommendedAction).toBe("HOLD_NO_EDGE");
    expect(result.reason).toContain("flash-wick danger zone");
  });

  it("should trigger STOP_LOSS_EXIT when open position drifts back towards strike", () => {
    // We hold UP position bought at 0.85, but BTC reversed to only +$2 above strike
    const result = evaluateVarianceCollapse({
      currentSpot: 85452,
      priceToBeat: 85450,
      secondsRemaining: 25,
      upAsk: 0.65,
      upBid: 0.63,
      downAsk: 0.38,
      downBid: 0.36,
      currentPosition: { side: "UP", entryPrice: 0.85 },
    });

    expect(result.recommendedAction).toBe("STOP_LOSS_EXIT");
    expect(result.reason).toContain("Stop-loss triggered");
  });
});
