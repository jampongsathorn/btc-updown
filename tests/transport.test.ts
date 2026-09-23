import { describe, it, expect } from "vitest";
import { TransportNormalizer } from "../src/transport";

describe("Transport Normalizer", () => {
  it("should normalize raw CLOB book snapshot message", () => {
    const normalizer = new TransportNormalizer();
    const events = normalizer.parseRawMessage(JSON.stringify({
      event_type: "book",
      asset_id: "token-1",
      bids: [{ price: "0.50", size: "100" }],
      asks: [{ price: "0.51", size: "100" }]
    }));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("book");
    expect(events[0].assetId).toBe("token-1");
    expect(events[0].bids).toHaveLength(1);
    expect(events[0].asks).toHaveLength(1);
  });

  it("should normalize raw price_change message", () => {
    const normalizer = new TransportNormalizer();
    const events = normalizer.parseRawMessage(JSON.stringify({
      event_type: "price_change",
      asset_id: "token-1",
      price_changes: [{ side: "BUY", price: "0.51", size: "100" }]
    }));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("price_change");
    expect(events[0].assetId).toBe("token-1");
    expect(events[0].priceChanges).toHaveLength(1);
  });

  it("should ignore pong or unrecognized messages cleanly (returns [], not null)", () => {
    const normalizer = new TransportNormalizer();
    expect(normalizer.parseRawMessage("PONG")).toEqual([]);
    expect(normalizer.parseRawMessage("invalid json")).toEqual([]);
  });

  it("splits an array-wrapped multi-asset book snapshot into one event per asset (confirmed 2026-09-23: Polymarket's initial subscribe-time snapshot arrives as a JSON array, one object per subscribed asset - not a single object)", () => {
    const normalizer = new TransportNormalizer();
    const raw = JSON.stringify([
      { event_type: "book", asset_id: "up-token", bids: [{ price: "0.60", size: "10" }], asks: [] },
      { event_type: "book", asset_id: "down-token", bids: [], asks: [{ price: "0.41", size: "20" }] },
    ]);

    const events = normalizer.parseRawMessage(raw);

    expect(events).toHaveLength(2);
    expect(events.find(e => e.assetId === "up-token")?.bids).toHaveLength(1);
    expect(events.find(e => e.assetId === "down-token")?.asks).toHaveLength(1);
  });

  it("splits a batched price_change message (no top-level asset_id) into one event per asset via each entry's own asset_id (confirmed 2026-09-23 via a real captured message: a single price_change frame moves both the UP and DOWN token together, with the asset_id living on each price_changes[] entry, not the message)", () => {
    const normalizer = new TransportNormalizer();
    const raw = JSON.stringify({
      event_type: "price_change",
      market: "0xabc",
      price_changes: [
        { asset_id: "down-token", price: "0.01", size: "9856.37", side: "BUY" },
        { asset_id: "up-token", price: "0.99", size: "9856.37", side: "SELL" },
      ],
      timestamp: "1790200220523",
    });

    const events = normalizer.parseRawMessage(raw);

    expect(events).toHaveLength(2);
    const upEvent = events.find(e => e.assetId === "up-token");
    const downEvent = events.find(e => e.assetId === "down-token");
    expect(upEvent?.priceChanges).toEqual([{ side: "SELL", price: "0.99", size: "9856.37" }]);
    expect(downEvent?.priceChanges).toEqual([{ side: "BUY", price: "0.01", size: "9856.37" }]);
  });
});
