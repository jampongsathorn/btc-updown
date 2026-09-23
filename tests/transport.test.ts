import { describe, it, expect } from "vitest";
import { TransportNormalizer } from "../src/transport";

describe("Transport Normalizer", () => {
  it("should normalize raw CLOB book snapshot message", () => {
    const normalizer = new TransportNormalizer();
    const event = normalizer.parseRawMessage(JSON.stringify({
      event_type: "book",
      asset_id: "token-1",
      bids: [{ price: "0.50", size: "100" }],
      asks: [{ price: "0.51", size: "100" }]
    }));

    expect(event?.type).toBe("book");
    expect(event?.assetId).toBe("token-1");
    expect(event?.bids).toHaveLength(1);
    expect(event?.asks).toHaveLength(1);
  });

  it("should normalize raw price_change message", () => {
    const normalizer = new TransportNormalizer();
    const event = normalizer.parseRawMessage(JSON.stringify({
      event_type: "price_change",
      asset_id: "token-1",
      price_changes: [{ side: "BUY", price: "0.51", size: "100" }]
    }));

    expect(event?.type).toBe("price_change");
    expect(event?.assetId).toBe("token-1");
    expect(event?.priceChanges).toHaveLength(1);
  });

  it("should ignore pong or unrecognized messages cleanly", () => {
    const normalizer = new TransportNormalizer();
    expect(normalizer.parseRawMessage("PONG")).toBeNull();
    expect(normalizer.parseRawMessage("invalid json")).toBeNull();
  });
});
