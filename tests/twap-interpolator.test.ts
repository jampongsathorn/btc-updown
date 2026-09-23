import { describe, it, expect } from "vitest";
import { ChainlinkTwapPredictor } from "../src/twap-interpolator";

describe("Chainlink 60s TWAP vs Spot Interpolator", () => {
  it("should calculate exact cumulative TWAP when inside the 60s measurement window", () => {
    const predictor = new ChainlinkTwapPredictor({
      slotEpoch: 1790170500,
      twapWindowSeconds: 60,
    });

    // Feed spot ticks in the final 60 seconds (t = 240s to 300s)
    predictor.recordSpotTick(85400, 240);
    predictor.recordSpotTick(85450, 255);
    predictor.recordSpotTick(85500, 270);

    const est = predictor.estimateFinalTwap(85500, 270, 0.55);
    // At t=270, half the TWAP window is already locked in!
    expect(est.lockedInFraction).toBeCloseTo(0.50, 1);
    expect(est.expectedTwap).toBeGreaterThan(85400);
    expect(est.expectedTwap).toBeLessThanOrEqual(85550);
    expect(est.twapStdDev).toBeLessThan(predictor.getSpotStdDev(30, 85500, 0.55));
  });

  it("should prove cubic variance collapse for TWAP vs linear for spot", () => {
    const predictor = new ChainlinkTwapPredictor({
      slotEpoch: 1790170500,
      twapWindowSeconds: 60,
    });

    // Spot variance over remaining tau is sigma * sqrt(tau)
    // TWAP variance over remaining tau is (tau/60) * sigma * sqrt(tau/3)
    const tau = 20; // 20s remaining out of 60s
    const spotSd = predictor.getSpotStdDev(tau, 85000, 0.55);
    const twapSd = predictor.getRemainingTwapStdDev(tau, 85000, 0.55);

    // TWAP standard deviation must be strictly lower than spot standard deviation
    expect(twapSd).toBeLessThan(spotSd * 0.40);
  });
});
