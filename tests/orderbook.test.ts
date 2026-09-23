import { describe, it, expect, beforeEach } from "vitest";
import { Orderbook } from "../src/orderbook";

describe("Orderbook Engine", () => {
  let ob: Orderbook;

  beforeEach(() => {
    ob = new Orderbook();
  });

  it("should parse snapshot and maintain sorted bids (descending) and asks (ascending)", () => {
    ob.applySnapshot(
      [{ price: "0.48", size: "100" }, { price: "0.50", size: "200" }],
      [{ price: "0.55", size: "150" }, { price: "0.52", size: "300" }]
    );

    const leg = ob.toLeg("token-up");
    expect(leg.bestBid).toBe(0.50);
    expect(leg.bestAsk).toBe(0.52);
    expect(leg.mid).toBe(0.51);
    expect(leg.spread).toBe(0.02);
    expect(leg.bids[0]).toEqual([0.50, 200]);
    expect(leg.asks[0]).toEqual([0.52, 300]);
  });

  it("should handle incremental price changes including zeroing out levels", () => {
    ob.applySnapshot(
      [{ price: "0.50", size: "100" }],
      [{ price: "0.52", size: "100" }]
    );
    ob.applyPriceChange([{ side: "BUY", price: "0.51", size: "50" }]);
    expect(ob.toLeg("token-up").bestBid).toBe(0.51);

    ob.applyPriceChange([{ side: "BUY", price: "0.51", size: "0" }]);
    expect(ob.toLeg("token-up").bestBid).toBe(0.50);
  });

  it("should detect crossed books (bid >= ask)", () => {
    ob.applySnapshot(
      [{ price: "0.53", size: "100" }],
      [{ price: "0.52", size: "100" }]
    );
    expect(ob.isCrossed()).toBe(true);
  });

  it("should report isEmpty when no bids or asks exist", () => {
    expect(ob.isEmpty()).toBe(true);
    ob.applySnapshot([{ price: "0.50", size: "10" }], []);
    expect(ob.isEmpty()).toBe(false);
  });
});
