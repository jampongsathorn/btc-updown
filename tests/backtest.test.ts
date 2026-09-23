import { describe, it, expect } from "vitest";
import { runHistoricalBacktest, HistoricalRound } from "../src/backtest";

describe("Historical Backtesting Engine", () => {
  it("should process historical rounds and compute metrics", () => {
    const mockRounds: HistoricalRound[] = [
      {
        slug: "btc-updown-5m-1",
        startPrice: 65000,
        endPrice: 65120, // UP wins
        actualOutcome: "UP",
        ticks: [
          // t=240 (60s remaining), spot has drifted +$90 above strike
          { secondsRemaining: 60, spot: 65090, upAsk: 0.86, upBid: 0.84, downAsk: 0.16, downBid: 0.14 }
        ]
      },
      {
        slug: "btc-updown-5m-2",
        startPrice: 65100,
        endPrice: 64980, // DOWN wins
        actualOutcome: "DOWN",
        ticks: [
          // t=250 (50s remaining), spot has drifted -$80 below strike
          { secondsRemaining: 50, spot: 65020, upAsk: 0.16, upBid: 0.14, downAsk: 0.86, downBid: 0.84 }
        ]
      },
      {
        slug: "btc-updown-5m-3",
        startPrice: 65000,
        endPrice: 65005, // Chop / no edge
        actualOutcome: "UP",
        ticks: [
          // t=240, spot only +$5 (inside flash-wick danger zone) -> Should be skipped!
          { secondsRemaining: 60, spot: 65005, upAsk: 0.55, upBid: 0.53, downAsk: 0.47, downBid: 0.45 }
        ]
      }
    ];

    const result = runHistoricalBacktest({
      rounds: mockRounds,
      initialCapitalUsd: 1000,
      fixedTradeUsd: 100,
    });

    expect(result.totalRounds).toBe(3);
    expect(result.tradedRounds).toBe(2);
    expect(result.skippedRounds).toBe(1);
    expect(result.wins).toBe(2);
    expect(result.losses).toBe(0);
    expect(result.winRatePct).toBe(100);
    expect(result.realizedPnlUsd).toBeGreaterThan(0);
  });
});
