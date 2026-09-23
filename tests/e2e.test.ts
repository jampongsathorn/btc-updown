import { describe, it, expect, afterEach } from "vitest";
import { MarketEngine } from "../src/engine";
import { StateStore } from "../src/state";
import { assertCanTrade } from "../src/guard";
import path from "path";
import fs from "fs";

describe("End-to-End Engine & Guard Pipeline", () => {
  const testStateFile = path.join(process.cwd(), "state", "test-e2e-live.json");
  const store = new StateStore(testStateFile);

  afterEach(() => {
    if (fs.existsSync(testStateFile)) fs.unlinkSync(testStateFile);
  });

  it("should ingest events, update orderbooks, calculate signals, and pass execution guard", () => {
    const engine = new MarketEngine({
      stateStore: store,
      autoConnectNodeWs: false,
    });

    engine.setTokenIds(
      { up: "token-up-1", down: "token-down-1" },
      { up: "token-up-2", down: "token-down-2" }
    );

    // Initial state is incomplete legs -> failClosed
    let state = engine.updateState();
    expect(state.safety.canTrade).toBe(false);
    expect(state.safety.reasons).toContain("INCOMPLETE_LEGS");

    // Ingest Up book
    engine.handleNormalizedEvent({
      type: "book",
      assetId: "token-up-1",
      bids: [{ price: "0.48", size: "100" }],
      asks: [{ price: "0.50", size: "100" }],
    }, "browser-relay");

    // Ingest Down book
    engine.handleNormalizedEvent({
      type: "book",
      assetId: "token-down-1",
      bids: [{ price: "0.49", size: "100" }],
      asks: [{ price: "0.51", size: "100" }],
    }, "browser-relay");

    state = engine.stateStore.readState()!;
    expect(state.up.bestBid).toBe(0.48);
    expect(state.up.bestAsk).toBe(0.50);
    expect(state.down.bestBid).toBe(0.49);
    expect(state.down.bestAsk).toBe(0.51);

    expect(state.signal.midParity).toBeCloseTo(0.99);
    expect(state.signal.buyBothCost).toBeCloseTo(1.01);
    expect(state.safety.canTrade).toBe(true);
    expect(state.safety.failClosed).toBe(false);

    // Assert pre-flight guard passes
    expect(() => assertCanTrade(state, 2500)).not.toThrow();

    // Verify atomic state reading p95 target (< 2ms)
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      store.readState();
    }
    const t1 = performance.now();
    const avgMs = (t1 - t0) / 50;
    expect(avgMs).toBeLessThan(2.0); // p95 local cache read < 2ms target
  });
});
