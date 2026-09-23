import { describe, it, expect } from "vitest";
import { formatEntryAlert, formatStopLossAlert, formatSettlementAlert } from "../src/alerts";

describe("Discord Alert Embed Formatter", () => {
  it("should format rich IN (Entry) alert with full quantitative metrics", () => {
    const payload = formatEntryAlert({
      slotEpoch: 1790170500,
      slug: "btc-updown-5m-1790170500",
      side: "UP",
      strikePrice: 85400,
      spotPrice: 85475.50,
      trueProbability: 0.954,
      expectedValueUsd: 0.082,
      netRoiPct: 10.4,
      entryPrice: 0.82,
      shares: 120,
      totalCostUsd: 98.40,
      realizedVol: 0.52,
      secondsRemaining: 45,
    });

    expect(payload.embeds).toBeDefined();
    expect(payload.embeds[0].title).toContain("ENTRY SIGNAL: BUY UP");
    expect(payload.embeds[0].color).toBe(0x10B981); // Emerald Green
    const desc = payload.embeds[0].description;
    expect(desc).toContain("85,475.50");
    expect(desc).toContain("95.4%");
    expect(desc).toContain("+$0.082");
  });

  it("should format rich OUT (Stop-Loss) alert with capital preservation", () => {
    const payload = formatStopLossAlert({
      slotEpoch: 1790170500,
      slug: "btc-updown-5m-1790170500",
      side: "UP",
      strikePrice: 85400,
      currentSpot: 85403,
      entryPrice: 0.85,
      exitBidPrice: 0.65,
      shares: 100,
      lossCappedUsd: 22.00,
      capitalPreservedPct: 74.1,
      reason: "Spot reversed near strike ($Delta: +$3.0)",
    });

    expect(payload.embeds[0].title).toContain("STOP-LOSS EXIT");
    expect(payload.embeds[0].color).toBe(0xFE8761); // Orange
    expect(payload.embeds[0].description).toContain("74.1%");
    expect(payload.embeds[0].description).toContain("$22.00");
  });

  it("should format rich PNL (Settlement) alert with win/loss details", () => {
    const payload = formatSettlementAlert({
      slotEpoch: 1790170500,
      slug: "btc-updown-5m-1790170500",
      won: true,
      side: "UP",
      finalPrice: 85490,
      strikePrice: 85400,
      netPnlUsd: 18.20,
      returnPct: 18.2,
      totalBankrollUsd: 1018.20,
      winRatePct: 96.0,
      wins: 12,
      losses: 0,
    });

    expect(payload.embeds[0].title).toContain("MARKET SETTLED: WIN");
    expect(payload.embeds[0].color).toBe(0x3B82F6); // Blue
    expect(payload.embeds[0].description).toContain("+$18.20");
    expect(payload.embeds[0].description).toContain("96.0%");
  });
});
