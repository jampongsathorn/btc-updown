import { MarketEngine } from "./engine.js";
import { createServer, ServerOptions } from "./server.js";
import { MarketRecorder } from "./recorder.js";
import { DEFAULT_CONFIG } from "./types.js";

let emitAlertCallback: ((payload: any) => void) | undefined;

const engine = new MarketEngine({
  config: DEFAULT_CONFIG,
  onAlert: (payload) => {
    emitAlertCallback?.(payload);
  },
});
const recorder = new MarketRecorder();

// Hook state updates to flight recorder
setInterval(() => {
  const state = engine.updateState();
  if (state) recorder.recordTick(state);
}, 250);

const serverOptions: ServerOptions = {
  port: DEFAULT_CONFIG.PORT,
  stateStore: engine.stateStore,
  onRelayEvent: (event: any) => {
    engine.handleNormalizedEvent(event, "browser-relay");
  },
  getActiveTokens: () => ({
    current: [engine.currentTokens.up, engine.currentTokens.down].filter(Boolean),
    next: [engine.nextTokens.up, engine.nextTokens.down].filter(Boolean),
  }),
  setTokenIds: (current: any, next: any) => {
    engine.setTokenIds(current, next);
  },
  setSpotPrices: (spot: number, priceToBeat?: number) => {
    engine.setSpotPrices(spot, priceToBeat || spot);
  },
  getLatestFlightSummary: () => recorder.getLatestSummary(),
};

const app = createServer(serverOptions);
emitAlertCallback = serverOptions.emitAlert;

// --- Server-side data feeds (headless VPS has no browser to relay data,
// so both token discovery and BTC spot price must be sourced here directly
// instead of relying on public/index.html's client-side JS, which only runs
// when someone has that page open in a live browser tab). ---

const registeredSlugs = new Set<string>();

async function fetchClobTokenIds(slug: string): Promise<{ up: string; down: string } | null> {
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`);
    if (!res.ok) return null;
    const events = await res.json() as any[];
    const market = events?.[0]?.markets?.[0];
    if (!market?.clobTokenIds) return null;
    const ids: string[] = JSON.parse(market.clobTokenIds);
    if (ids.length < 2) return null;
    return { up: ids[0], down: ids[1] };
  } catch {
    return null;
  }
}

async function syncTokens(): Promise<void> {
  const currentSlug = engine.currentSlot.slug;
  const nextSlug = engine.nextSlot.slug;

  if (currentSlug && !registeredSlugs.has(currentSlug)) {
    const current = await fetchClobTokenIds(currentSlug);
    if (current) {
      registeredSlugs.add(currentSlug);
      let next: { up: string; down: string } | undefined;
      if (nextSlug) next = (await fetchClobTokenIds(nextSlug)) || undefined;
      engine.setTokenIds(current, next);
      console.log(`[sync] registered tokens for ${currentSlug}${next ? ` + warm ${nextSlug}` : ""}`);
    }
  } else if (nextSlug && !registeredSlugs.has(nextSlug)) {
    const next = await fetchClobTokenIds(nextSlug);
    if (next) {
      registeredSlugs.add(nextSlug);
      engine.setTokenIds(engine.currentTokens, next);
      console.log(`[sync] warmed next-slot tokens for ${nextSlug}`);
    }
  }

  // Keep the set from growing unbounded across a long-running process
  if (registeredSlugs.size > 20) {
    const [oldest] = registeredSlugs;
    registeredSlugs.delete(oldest);
  }
}

let priceToBeatForEpoch: number | null = null;
let priceToBeatEpoch: number | null = null;

async function pollSpotPrice(): Promise<void> {
  try {
    const res = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker");
    if (!res.ok) return;
    const data = await res.json() as { price: string };
    const spot = parseFloat(data.price);
    if (!(spot > 0)) return;

    const epoch = engine.currentSlot.epoch;
    if (priceToBeatEpoch !== epoch) {
      priceToBeatEpoch = epoch;
      priceToBeatForEpoch = spot; // lock in strike at first observed price of this slot
    }

    engine.setSpotPrices(spot, priceToBeatForEpoch ?? spot);
  } catch {
    // transient network error - next poll will retry
  }
}

setInterval(syncTokens, 15_000);
setInterval(pollSpotPrice, 3_000);
syncTokens();
pollSpotPrice();

app.listen(DEFAULT_CONFIG.PORT, "0.0.0.0", () => {
  console.log(`\n\x1b[32m[✓] Polymarket BTC UpDown 5m Engine running on http://0.0.0.0:${DEFAULT_CONFIG.PORT}\x1b[0m`);
  console.log(`\x1b[36m[i] Active slot: ${engine.currentSlot.slug} (${engine.currentSlot.secondsRemaining}s remaining)\x1b[0m`);
  console.log(`\x1b[35m[i] Market Flight Recorder active -> saving to ./recordings/\x1b[0m`);
  console.log(`\x1b[33m[i] Run "npm run signal" to inspect real-time agent signals\x1b[0m\n`);
});

process.on("SIGINT", () => {
  engine.stop();
  process.exit(0);
});
