import { describe, it, expect } from "vitest";
import { formatEntryAlert, formatStopLossAlert, formatSettlementAlert } from "../src/alerts";

describe("Discord Alert Embed Formatter", () => {
  it("should format rich SIGNAL IN alert with (1) link, (2) amount, (3) bucket+price, (4) reason", () => {
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
    expect(payload.embeds[0].title).toContain("SIGNAL IN: BUY UP");
    expect(payload.embeds[0].color).toBe(0x10B981); // Emerald Green
    const desc = payload.embeds[0].description;
    expect(desc).toContain("**1. Market Link:** [🔗 View on Polymarket](https://polymarket.com/event/btc-updown-5m-1790170500)");
    expect(desc).toContain("**2. Amount:** **120 Shares** (~$98.40 USD)");
    expect(desc).toContain("**3. Bucket + Price:** `UP` @ **$0.82**");
    expect(desc).toContain("**4. Reason:**");
    expect(desc).toContain("95.4%");
  });

  it("should format rich STOP LOSS alert with (1) link, (2) price in/out, (3) pnl $ and %, (4) reason", () => {
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

    expect(payload.embeds[0].title).toContain("STOP LOSS: LIQUIDATED EARLY");
    expect(payload.embeds[0].color).toBe(0xFE8761); // Orange
    const desc = payload.embeds[0].description;
    expect(desc).toContain("**1. Market Link:** [🔗 View on Polymarket](https://polymarket.com/event/btc-updown-5m-1790170500)");
    expect(desc).toContain("**2. Price IN ➔ Price OUT:** IN **$0.85** ➔ OUT **$0.65**");
    expect(desc).toContain("**3. PnL Dollar & %:** **-$22.00 USD**");
    expect(desc).toContain("**4. Reason:** Spot reversed near strike");
  });

  it("should format rich WIN alert with (1) link, (2) price in/out, (3) pnl $ and %, (4) reason", () => {
    const payload = formatSettlementAlert({
      slotEpoch: 1790170500,
      slug: "btc-updown-5m-1790170500",
      won: true,
      side: "UP",
      entryPrice: 0.88,
      exitPrice: 1.00,
      finalPrice: 85490,
      strikePrice: 85400,
      netPnlUsd: 18.20,
      returnPct: 18.2,
      totalBankrollUsd: 1018.20,
      winRatePct: 96.0,
      wins: 12,
      losses: 0,
      reason: "Slot resolved UP (Chainlink TWAP $85,490.00 >= Strike $85,400.00) • 100% Payout redeemed at $1.00/share",
    });

    expect(payload.embeds[0].title).toContain("WIN: MARKET RESOLVED & SETTLED");
    expect(payload.embeds[0].color).toBe(0x22C55E); // Green
    const desc = payload.embeds[0].description;
    expect(desc).toContain("**1. Market Link:** [🔗 View on Polymarket](https://polymarket.com/event/btc-updown-5m-1790170500)");
    expect(desc).toContain("**2. Price IN ➔ Price OUT:** IN **$0.88** ➔ OUT **$1.00**");
    expect(desc).toContain("**3. PnL Dollar & %:** **+$18.20 USD** (**+18.2%**)");
    expect(desc).toContain("**4. Reason:** Slot resolved UP");
  });
});
