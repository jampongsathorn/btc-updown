import { describe, it, expect, afterEach } from "vitest";
import { MarketEngine } from "../src/engine";
import { StateStore } from "../src/state";
import path from "path";
import fs from "fs";

// Reproduces the 2026-09-23 incident: a live BUY_DOWN was sized off the paper
// wallet's fake $1000 bankroll ($53.99 order) while the real wallet held ~$15.
// Confirms order sizing now uses the real balance (via setLiveBalanceUsd)
// whenever live trading is on, instead of ignoring it.
describe("Live order sizing uses the real wallet balance, not the paper bankroll", () => {
  const testStateFile = path.join(process.cwd(), "state", "test-engine-live-sizing.json");
  const store = new StateStore(testStateFile);
  const originalEnv = process.env.LIVE_TRADING_ENABLED;

  afterEach(() => {
    if (fs.existsSync(testStateFile)) fs.unlinkSync(testStateFile);
    process.env.LIVE_TRADING_ENABLED = originalEnv;
  });

  function buildTickedEngine(): MarketEngine {
    const engine = new MarketEngine({ stateStore: store, autoConnectNodeWs: false });
    engine.setTokenIds({ up: "token-up-1", down: "token-down-1" }, { up: "token-up-2", down: "token-down-2" });
    engine.setStrikePrice(85000, engine.currentSlot.epoch, "candle-boundary");
    engine.handleNormalizedEvent({
      type: "book", assetId: "token-up-1",
      bids: [{ price: "0.48", size: "100" }], asks: [{ price: "0.50", size: "100" }],
    }, "browser-relay");
    engine.handleNormalizedEvent({
      type: "book", assetId: "token-down-1",
      bids: [{ price: "0.49", size: "100" }], asks: [{ price: "0.51", size: "100" }],
    }, "browser-relay");
    return engine;
  }

  it("paper wallet ($1000 default) sizes a normal order when live trading is off", () => {
    process.env.LIVE_TRADING_ENABLED = "false";
    const engine = buildTickedEngine();
    const state = engine.updateState();
    expect(state.strategy?.recommendedShares).toBeGreaterThan(0);
  });

  it("live trading on but real balance not fetched yet sizes off the paper wallet, same as off (never a live order on unknown balance)", () => {
    process.env.LIVE_TRADING_ENABLED = "true";
    const engine = buildTickedEngine();
    // setLiveBalanceUsd() deliberately NOT called - simulates the startup
    // window before the first refreshLiveBalance() in index.ts completes.
    const state = engine.updateState();
    expect(state.strategy?.recommendedShares).toBeGreaterThan(0); // paper-sized, so a real order never fires on the fake number - see liveTradingSizingReady gate in engine.ts
  });

  it("live trading on with a real $15 balance sizes off $15, not $1000 - and correctly abstains (0 shares) rather than repeating the $53.99-against-$15 incident", () => {
    process.env.LIVE_TRADING_ENABLED = "true";
    const engine = buildTickedEngine();
    engine.setLiveBalanceUsd(15);
    const state = engine.updateState();
    expect(state.strategy?.recommendedShares).toBe(0);
  });
});
