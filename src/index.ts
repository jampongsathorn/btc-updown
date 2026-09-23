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
