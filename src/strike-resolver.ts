import { SlotInfo } from "./scheduler.js";

export interface StrikeResolution {
  strike: number;
  source: "candle-boundary" | "live-lock" | "polymarket-meta";
  confidence: number;
  resolvedAt: number;
}

export interface StrikeResolverOptions {
  fetchCandles?: (epoch: number) => Promise<any[]>;
}

/**
 * Resolves the immutable strike price for a slot from the Coinbase 1-minute
 * candle at the slot's exact epoch boundary (T0), instead of "whatever spot
 * price the engine happened to observe first" - which is wrong whenever the
 * process connects or restarts mid-slot (see pollSpotPrice() in index.ts,
 * which this replaces).
 *
 * Coinbase only returns CLOSED candles, so the T0 candle isn't available
 * until ~60-90s after the slot starts. That's fine here: trading only ever
 * happens in the sniper window (last 90s of a slot), long after the T0
 * candle has closed, so resolveStrike() returning null early in a slot just
 * means the engine correctly waits before permitting trades - it never
 * causes a missed trade.
 */
export class StrikeResolver {
  private cache = new Map<number, StrikeResolution>();
  private fetchCandlesFn: (epoch: number) => Promise<any[]>;

  constructor(options?: StrikeResolverOptions) {
    this.fetchCandlesFn = options?.fetchCandles || this.defaultFetchCandles;
  }

  private async defaultFetchCandles(epoch: number): Promise<any[]> {
    // Coinbase's candles endpoint silently returns [] (HTTP 200, no error) if
    // start/end carry sub-second precision - Date.toISOString() always emits
    // ".000Z", which made this fail 100% of the time (confirmed 2026-09-23 via
    // direct curl: identical request minus the ".000" returns real candles).
    const toSecondIso = (unixSec: number) => new Date(unixSec * 1000).toISOString().replace(".000Z", "Z");
    const isoStart = toSecondIso(epoch);
    const isoEnd = toSecondIso(epoch + 120);
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?start=${isoStart}&end=${isoEnd}&granularity=60`;

    // Confirmed 2026-09-23: intermittent bare "fetch failed" (a connection-level
    // failure, not an HTTP error status) happens occasionally even though a
    // tight 8-request burst moments later succeeded 8/8 - genuinely transient,
    // not a rate limit. One quick retry costs ~300ms and meaningfully improves
    // the odds of catching the T0 candle within resolveStrike's polling window,
    // versus waiting a full 5s for the next scheduled attempt.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Coinbase candle API error: ${res.statusText}`);
        return (await res.json()) as any[];
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    return []; // unreachable - satisfies the compiler
  }

  public async resolveStrike(epoch: number): Promise<StrikeResolution | null> {
    const cached = this.cache.get(epoch);
    if (cached) return cached;

    try {
      const candles = await this.fetchCandlesFn(epoch);
      if (!Array.isArray(candles) || candles.length === 0) {
        // Expected while the T0 candle hasn't closed yet (first ~60-90s of a
        // slot) - logged (not silent) because 2026-09-23 showed a live slot
        // getting [] for its ENTIRE ~220s window while a fresh standalone
        // call for the same epoch, seconds later, returned real data. That
        // gap needs visibility to tell "still warming up" from "stuck".
        console.log(`[strike-resolver] Empty candle response for epoch ${epoch} (T0 not closed yet, or stuck - see comment)`);
        return null;
      }

      // Coinbase candle format: [time, low, high, open, close, volume]
      const match = candles.find((c) => Math.abs(c[0] - epoch) < 60);
      if (!match || !(match[3] > 0)) {
        console.error(`[strike-resolver] Got ${candles.length} candle(s) for epoch ${epoch} but none matched the T0 boundary - unexpected, not just "not closed yet"`);
        return null;
      }

      const resolution: StrikeResolution = {
        strike: parseFloat(match[3]),
        source: "candle-boundary",
        confidence: 1.0,
        resolvedAt: Date.now(),
      };

      this.cache.set(epoch, resolution);
      return resolution;
    } catch (err: any) {
      // Distinguishing this from the "not closed yet" case above matters:
      // that one is expected and silent by design (see class doc comment),
      // but a real network/rate-limit failure here was previously
      // indistinguishable from it, making the 2026-09-23 intermittent
      // resolution failures impossible to diagnose from logs alone.
      console.error(`[strike-resolver] resolveStrike(${epoch}) failed: ${err?.message || err}`);
      return null;
    }
  }

  public async resolveForSlot(slot: SlotInfo): Promise<StrikeResolution | null> {
    return this.resolveStrike(slot.epoch);
  }

  /** Escape hatch for a manually-confirmed strike (e.g. operator override). Not auto-invoked. */
  public registerExternalStrike(epoch: number, strike: number, source: "polymarket-meta" | "live-lock"): void {
    if (strike > 0) {
      this.cache.set(epoch, {
        strike,
        source,
        confidence: source === "polymarket-meta" ? 1.0 : 0.95,
        resolvedAt: Date.now(),
      });
    }
  }

  public getCached(epoch: number): StrikeResolution | undefined {
    return this.cache.get(epoch);
  }

  /** Bound cache growth for a long-running process. */
  public pruneOlderThan(epoch: number): void {
    for (const key of this.cache.keys()) {
      if (key < epoch) this.cache.delete(key);
    }
  }
}
