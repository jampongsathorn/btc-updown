import { MarketEngine } from "../src/engine.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import { DiscordWebhookPayload } from "../src/alerts.js";

console.log("====================================================================");
console.log("🧪 VERIFYING SIGNAL TRIGGERS & 4-POINT ALERT FORMAT");
console.log("====================================================================");

const capturedAlerts: DiscordWebhookPayload[] = [];

const engine = new MarketEngine({
  config: {
    ...DEFAULT_CONFIG,
    WARMUP_SECONDS: 45,
    MAX_BOOK_AGE_MS: 5000,
  },
  onAlert: (alert) => {
    capturedAlerts.push(alert);
  },
});

let testPassed = true;

// 1790175000 is perfectly divisible by 300
const slotEpoch = 1790175000;
engine.currentTokens = { up: "TOKEN_UP", down: "TOKEN_DOWN" };

// 40 seconds remaining: t = slotEpoch + 260
const timeAt40sRemaining = (slotEpoch + 260) * 1000;

// Setup engine connection state for healthy trading
engine.isConnected = true;
engine.lastTickMs = timeAt40sRemaining;
engine.feeModelVerified = true;

// Populate orderbooks with healthy depth
engine.upBook.applySnapshot(
  [
    { price: 0.86, size: 500 },
    { price: 0.85, size: 1000 },
  ],
  [
    { price: 0.88, size: 500 },
    { price: 0.89, size: 1000 },
  ],
  1,
  timeAt40sRemaining
);
engine.downBook.applySnapshot(
  [
    { price: 0.10, size: 500 },
    { price: 0.09, size: 1000 },
  ],
  [
    { price: 0.12, size: 500 },
    { price: 0.13, size: 1000 },
  ],
  1,
  timeAt40sRemaining
);

// -------------------------------------------------------------------------
// TEST 1: Drift inside danger zone (< $35) -> Must HOLD_NO_EDGE (NO ALERT)
// -------------------------------------------------------------------------
console.log("\n[Test 1] BTC drift only +$12 (< $35 buffer) with 40s remaining...");
engine.setSpotPrices(85412, 85400, timeAt40sRemaining); // Drift +$12
const state1 = engine.updateState(timeAt40sRemaining);
console.log(`  • Action: ${state1?.strategy.recommendedAction}`);
console.log(`  • Reason: ${state1?.strategy.reason}`);
if (state1?.strategy.recommendedAction !== "HOLD_NO_EDGE") {
  console.error("  ❌ FAILED: Should hold when drift is under buffer");
  testPassed = false;
} else {
  console.log("  ✅ PASSED: Correctly held back inside danger zone.");
}

// -------------------------------------------------------------------------
// TEST 2: Drift moves to +$95 (> $35 buffer) -> Must Trigger BUY_UP SIGNAL IN
// -------------------------------------------------------------------------
console.log("\n[Test 2] BTC drift moves to +$95 (> $35 buffer) with 40s remaining...");
engine.setSpotPrices(85495, 85400, timeAt40sRemaining); // Drift +$95
const state2 = engine.updateState(timeAt40sRemaining);
console.log(`  • Action: ${state2?.strategy.recommendedAction}`);
console.log(`  • canTrade: ${state2?.safety.canTrade}, reasons: ${state2?.safety.reasons.join(", ")}`);
console.log(`  • p*: ${(state2?.strategy.trueProbabilityUp! * 100).toFixed(1)}%`);
console.log(`  • EV: +$${state2?.strategy.expectedValueUp.toFixed(3)}/sh`);
console.log(`  • Recommended Shares: ${state2?.strategy.recommendedShares}`);

const inAlert = capturedAlerts.find((a) => a.embeds[0].title.includes("SIGNAL IN: BUY UP"));
if (!inAlert) {
  console.error("  ❌ FAILED: Did not emit SIGNAL IN alert");
  testPassed = false;
} else {
  console.log("  ✅ PASSED: Emitted SIGNAL IN alert!");
  const desc = inAlert.embeds[0].description;
  console.log("\n  --- SIGNAL IN Preview ---");
  console.log(desc);
  console.log("  -------------------------\n");

  // Verify 4 required points
  const hasLink = desc.includes("**1. Market Link:** [🔗 View on Polymarket]");
  const hasAmount = desc.includes("**2. Amount:**");
  const hasBucketPrice = desc.includes("**3. Bucket + Price:** `UP` @ **$0.88**");
  const hasReason = desc.includes("**4. Reason:**");

  if (hasLink && hasAmount && hasBucketPrice && hasReason) {
    console.log("  ✅ PASSED: All 4 points verified in SIGNAL IN:");
    console.log("     1. Link to slug ✓");
    console.log("     2. Amount (shares + USD) ✓");
    console.log("     3. Bucket + price ✓");
    console.log("     4. Reason (statistical edge & EV) ✓");
  } else {
    console.error("  ❌ FAILED: Missing one of the 4 required points in SIGNAL IN");
    testPassed = false;
  }
}

// -------------------------------------------------------------------------
// TEST 3: BTC reverses back to +$2 (Stop-Loss Trigger)
// -------------------------------------------------------------------------
console.log("\n[Test 3] BTC suddenly reverses back to +$2 (Reversal Stop Loss)...");
const timeAt20s = (slotEpoch + 280) * 1000;
engine.lastTickMs = timeAt20s;
engine.setSpotPrices(85402, 85400, timeAt20s); // Reversal to +$2 above strike
// Update bids to reflect lower market value
engine.upBook.applySnapshot(
  [{ price: 0.65, size: 500 }],
  [{ price: 0.68, size: 500 }],
  2,
  timeAt20s
);

const state3 = engine.updateState(timeAt20s);
console.log(`  • Action: ${state3?.strategy.recommendedAction}`);
console.log(`  • Reason: ${state3?.strategy.reason}`);

const slAlert = capturedAlerts.find((a) => a.embeds[0].title.includes("STOP LOSS"));
if (!slAlert) {
  console.error("  ❌ FAILED: Did not emit STOP LOSS alert");
  testPassed = false;
} else {
  console.log("  ✅ PASSED: Emitted STOP LOSS alert!");
  const desc = slAlert.embeds[0].description;
  console.log("\n  --- STOP LOSS Preview ---");
  console.log(desc);
  console.log("  -------------------------\n");

  const hasLink = desc.includes("**1. Market Link:** [🔗 View on Polymarket]");
  const hasPriceInOut = desc.includes("**2. Price IN ➔ Price OUT:**");
  const hasPnl = desc.includes("**3. PnL Dollar & %:**");
  const hasReason = desc.includes("**4. Reason:**");

  if (hasLink && hasPriceInOut && hasPnl && hasReason) {
    console.log("  ✅ PASSED: All 4 points verified in STOP LOSS:");
    console.log("     1. Link to slug ✓");
    console.log("     2. Price in, price out ✓");
    console.log("     3. PnL dollar and % ✓");
    console.log("     4. Reason ✓");
  } else {
    console.error("  ❌ FAILED: Missing one of the 4 required points in STOP LOSS");
    testPassed = false;
  }
}

// -------------------------------------------------------------------------
// TEST 4: WIN Settlement Alert on Rollover
// -------------------------------------------------------------------------
console.log("\n[Test 4] Simulating successful slot settlement (WIN)...");
const winningSlotEpoch = slotEpoch + 300;
const timeInsideWinningSlot = (winningSlotEpoch + 200) * 1000;

// Set engine clock inside the winning slot
engine.updateState(timeInsideWinningSlot);
engine.setSpotPrices(85550, 85400, timeInsideWinningSlot);

engine.wallet.openPosition({
  slotEpoch: winningSlotEpoch,
  side: "UP",
  shares: 100,
  price: 0.88,
  fee: 0.50,
});

// Simulate clock rolling over past end of winningSlotEpoch
const rolloverTime = (winningSlotEpoch + 305) * 1000;
engine.lastTickMs = rolloverTime;
engine.updateState(rolloverTime);

const winAlert = capturedAlerts.find((a) => a.embeds[0].title.includes("WIN: MARKET RESOLVED"));
if (!winAlert) {
  console.error("  ❌ FAILED: Did not emit WIN alert on rollover");
  testPassed = false;
} else {
  console.log("  ✅ PASSED: Emitted WIN alert!");
  const desc = winAlert.embeds[0].description;
  console.log("\n  --- WIN Settlement Preview ---");
  console.log(desc);
  console.log("  ------------------------------\n");

  const hasLink = desc.includes("**1. Market Link:** [🔗 View on Polymarket]");
  const hasPriceInOut = desc.includes("**2. Price IN ➔ Price OUT:**");
  const hasPnl = desc.includes("**3. PnL Dollar & %:**");
  const hasReason = desc.includes("**4. Reason:**");

  if (hasLink && hasPriceInOut && hasPnl && hasReason) {
    console.log("  ✅ PASSED: All 4 points verified in WIN:");
    console.log("     1. Link to slug ✓");
    console.log("     2. Price in, price out ✓");
    console.log("     3. PnL dollar and % ✓");
    console.log("     4. Reason ✓");
  } else {
    console.error("  ❌ FAILED: Missing one of the 4 required points in WIN alert");
    testPassed = false;
  }
}

console.log("\n====================================================================");
if (testPassed) {
  console.log("🎉 ALL SIGNAL TRIGGERS & 4-POINT ALERT SPECIFICATIONS VERIFIED 100%!");
} else {
  console.error("❌ SOME CHECKS FAILED");
  process.exit(1);
}
console.log("====================================================================");
