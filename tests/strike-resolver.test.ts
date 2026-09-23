import { describe, it, expect, vi } from "vitest";
import { StrikeResolver } from "../src/strike-resolver.js";
import { evaluateVarianceCollapse } from "../src/strategies/variance-collapse.js";

describe("StrikeResolver", () => {
  it("resolves the exact open price from Coinbase 1-minute candle at epoch T0", async () => {
    const mockFetcher = vi.fn().mockResolvedValue([
      [1790185200, 84000, 84050, 84009.25, 84030, 12.5],
    ]);
    const resolver = new StrikeResolver({ fetchCandles: mockFetcher });
    const result = await resolver.resolveStrike(1790185200);

    expect(result?.strike).toBe(84009.25);
    expect(result?.source).toBe("candle-boundary");
    expect(result?.confidence).toBe(1.0);
  });

  it("handles mid-slot connection by querying epoch candle regardless of secondsRemaining", async () => {
    const mockFetcher = vi.fn().mockResolvedValue([
      [1790185200, 84000, 84050, 84009.25, 84030, 12.5],
    ]);
    const resolver = new StrikeResolver({ fetchCandles: mockFetcher });
    const result = await resolver.resolveForSlot({
      epoch: 1790185200,
      slug: "btc-updown-5m-1790185200",
      secondsRemaining: 45, // mid-slot (255s elapsed)
      progressPct: 85,
      warmupPhase: false,
      title: "BTC Up or Down 5m",
    });

    expect(result?.strike).toBe(84009.25);
    expect(mockFetcher).toHaveBeenCalledWith(1790185200);
  });

  it("returns null when candle data is unavailable to trigger fail-closed safety", async () => {
    const mockFetcher = vi.fn().mockRejectedValue(new Error("Network timeout"));
    const resolver = new StrikeResolver({ fetchCandles: mockFetcher });
    const result = await resolver.resolveStrike(1790185200);

    expect(result).toBeNull();
  });

  it("returns null when the candle response is empty (T0 candle not yet closed)", async () => {
    const mockFetcher = vi.fn().mockResolvedValue([]);
    const resolver = new StrikeResolver({ fetchCandles: mockFetcher });
    const result = await resolver.resolveStrike(1790185200);

    expect(result).toBeNull();
  });

  it("caches a resolved strike and does not refetch for the same epoch", async () => {
    const mockFetcher = vi.fn().mockResolvedValue([
      [1790185200, 84000, 84050, 84009.25, 84030, 12.5],
    ]);
    const resolver = new StrikeResolver({ fetchCandles: mockFetcher });

    await resolver.resolveStrike(1790185200);
    await resolver.resolveStrike(1790185200);

    expect(mockFetcher).toHaveBeenCalledTimes(1);
  });

  it("registerExternalStrike lets an operator override bypass the fetcher", async () => {
    const mockFetcher = vi.fn().mockRejectedValue(new Error("should not be called"));
    const resolver = new StrikeResolver({ fetchCandles: mockFetcher });

    resolver.registerExternalStrike(1790185200, 84009.25, "live-lock");
    const result = await resolver.resolveStrike(1790185200);

    expect(result?.strike).toBe(84009.25);
    expect(result?.source).toBe("live-lock");
    expect(result?.confidence).toBe(0.95);
    expect(mockFetcher).not.toHaveBeenCalled();
  });

  it("reproduces the observed btc-updown-5m-1790185200 mid-slot-reconnect bug and confirms the fix against the real production strategy function", () => {
    // Real numbers from the live incident: engine connected mid-slot and
    // locked the wrong strike (a spot price observed ~2 minutes into the
    // slot) instead of the true T0 boundary open price StrikeResolver would
    // have returned. secondsRemaining=46 puts this squarely in the sniper
    // window where a wrong sign on delta actually changes recommendedAction.
    const currentSpot = 84183.68;
    const wrongStrike = 84202.87; // mid-slot spot mistakenly used as priceToBeat (the bug)
    const correctStrike = 84009.25; // real Coinbase T0 boundary candle open (StrikeResolver)
    const secondsRemaining = 46;

    const buggy = evaluateVarianceCollapse({
      currentSpot,
      priceToBeat: wrongStrike,
      secondsRemaining,
      upAsk: 0.9, upBid: 0.88, downAsk: 0.1, downBid: 0.08,
      jumpSafetyBufferUsd: 35.0,
    });

    const fixed = evaluateVarianceCollapse({
      currentSpot,
      priceToBeat: correctStrike,
      secondsRemaining,
      upAsk: 0.9, upBid: 0.88, downAsk: 0.1, downBid: 0.08,
      jumpSafetyBufferUsd: 35.0,
    });

    // With the wrong strike, spot looks like it's BELOW strike (negative
    // delta) - this is the bug: it suppresses UP probability even though
    // BTC is actually trading well above the real slot-open price.
    expect(buggy.zScore).toBeLessThan(0);
    expect(buggy.trueProbabilityUp).toBeLessThan(0.5);

    // With the correct T0 strike, the same spot is decisively ABOVE strike,
    // matching what the real Polymarket order book was pricing (80-95%+ UP).
    expect(fixed.zScore).toBeGreaterThan(2.0);
    expect(fixed.trueProbabilityUp).toBeGreaterThan(0.9);
  });

  it("requests Coinbase candles without sub-second precision in start/end (confirmed 2026-09-23: Coinbase silently returns [] when ISO timestamps carry '.000Z')", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [[1790185200, 84000, 84050, 84009.25, 84030, 12.5]],
    } as Response);

    const resolver = new StrikeResolver(); // no fetchCandles override - exercises the real URL builder
    await resolver.resolveStrike(1790185200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchSpy.mock.calls[0][0] as string;
    expect(requestedUrl).not.toMatch(/\.\d+Z/); // no fractional seconds anywhere in the URL
    expect(requestedUrl).toContain("start=2026-09-23T17:40:00Z");
    expect(requestedUrl).toContain("end=2026-09-23T17:45:00Z"); // 300s window - see the window-width regression test below

    fetchSpy.mockRestore();
  });

  it("requests at least a 300s window, not the old 120s one (confirmed 2026-09-23 via direct curl: Coinbase deterministically returns [] for an exactly-120s span at a given start, but 180s+ from the SAME start returns real candles)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [[1790185200, 84000, 84050, 84009.25, 84030, 12.5]],
    } as Response);

    const resolver = new StrikeResolver();
    await resolver.resolveStrike(1790185200);

    const requestedUrl = fetchSpy.mock.calls[0][0] as string;
    const start = new URL(requestedUrl).searchParams.get("start")!;
    const end = new URL(requestedUrl).searchParams.get("end")!;
    const spanSeconds = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
    expect(spanSeconds).toBeGreaterThanOrEqual(180);

    fetchSpy.mockRestore();
  });

  it("cache-busts every request with a unique query param (confirmed 2026-09-23: Cloudflare in front of Coinbase's API caches GET responses for max-age=300s, keyed by the exact URL - a live slot's identical every-5s poll got the SAME stale [] back for most of its ~300s life)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [[1790185200, 84000, 84050, 84009.25, 84030, 12.5]],
    } as Response);

    const resolver = new StrikeResolver();
    await resolver.resolveStrike(1790185200);
    // Second call for a DIFFERENT epoch, just to get a second real request
    // through defaultFetchCandles (resolveStrike caches per-epoch, so a
    // second call for the SAME epoch wouldn't hit fetch again at all).
    await resolver.resolveStrike(1790185500);

    const urlA = new URL(fetchSpy.mock.calls[0][0] as string);
    const urlB = new URL(fetchSpy.mock.calls[1][0] as string);
    expect(urlA.searchParams.get("_cb")).toBeTruthy();
    expect(urlA.searchParams.get("_cb")).not.toBe(urlB.searchParams.get("_cb"));

    fetchSpy.mockRestore();
  });

  it("retries once on a transient fetch failure before giving up (confirmed 2026-09-23: intermittent bare 'fetch failed' on an otherwise-healthy connection)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [[1790185200, 84000, 84050, 84009.25, 84030, 12.5]],
      } as Response);

    const resolver = new StrikeResolver(); // real fetch path, not the injected mock
    const result = await resolver.resolveStrike(1790185200);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result?.strike).toBe(84009.25);

    fetchSpy.mockRestore();
  });

  it("pruneOlderThan evicts stale epochs but keeps current/future ones", async () => {
    const mockFetcher = vi.fn().mockResolvedValue([
      [1790185200, 84000, 84050, 84009.25, 84030, 12.5],
    ]);
    const resolver = new StrikeResolver({ fetchCandles: mockFetcher });
    await resolver.resolveStrike(1790185200);
    resolver.registerExternalStrike(1790185500, 84100, "live-lock");

    resolver.pruneOlderThan(1790185500);

    expect(resolver.getCached(1790185200)).toBeUndefined();
    expect(resolver.getCached(1790185500)).toBeDefined();
  });
});
