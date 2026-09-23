#!/usr/bin/env node
import { StateStore } from "./state.js";
import { assertCanTrade } from "./guard.js";

function formatSignal() {
  const isJson = process.argv.includes("--json");
  const store = new StateStore();
  const state = store.readState();

  if (!state) {
    if (isJson) {
      console.log(JSON.stringify({ error: "State not initialized yet" }));
    } else {
      console.log("\x1b[33m[!] Engine state not initialized yet. Start engine with: npm start\x1b[0m");
    }
    process.exit(1);
  }

  if (isJson) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  const s = state;
  const canTrade = s.safety.canTrade;
  const safetyColor = canTrade ? "\x1b[32m" : "\x1b[31m";
  const safetyText = canTrade ? "READY / APPROVED" : `FAIL CLOSED (${s.safety.reasons.join(", ")})`;

  const min = Math.floor(s.slot.secondsRemaining / 60);
  const sec = s.slot.secondsRemaining % 60;
  const timeFormatted = `${min}m ${sec < 10 ? "0" : ""}${sec}s`;

  console.log("\n\x1b[1m\x1b[36m============================================================\x1b[0m");
  console.log(`\x1b[1m  POLYMARKET 5M BTC UPDOWN SIGNAL — ${s.slot.slug}\x1b[0m`);
  console.log("\x1b[1m\x1b[36m============================================================\x1b[0m");
  console.log(`  Time Remaining:     \x1b[1m\x1b[33m${timeFormatted}\x1b[0m (${s.slot.progressPct}% elapsed)`);
  console.log(`  Warm-up Active:     ${s.slot.warmupPhase ? "\x1b[33mYES (Warming next slot)\x1b[0m" : "No"}`);
  console.log(`  Trade Permission:   ${safetyColor}\x1b[1m${safetyText}\x1b[0m`);
  console.log(`  Transport Feed:     ${s.meta.source} (Age: ${s.safety.bookAgeMs}ms, Max: ${s.safety.maxBookAgeMsConfig}ms)`);
  console.log("------------------------------------------------------------");
  console.log(`  \x1b[32mUP TOKEN:\x1b[0m   Bid: \x1b[1m$${s.up.bestBid.toFixed(2)}\x1b[0m (${s.up.bidTopSize}) | Ask: \x1b[1m$${s.up.bestAsk.toFixed(2)}\x1b[0m (${s.up.askTopSize}) | Mid: $${s.up.mid.toFixed(3)} | Spr: $${s.up.spread.toFixed(3)}`);
  console.log(`  \x1b[31mDOWN TOKEN:\x1b[0m Bid: \x1b[1m$${s.down.bestBid.toFixed(2)}\x1b[0m (${s.down.bidTopSize}) | Ask: \x1b[1m$${s.down.bestAsk.toFixed(2)}\x1b[0m (${s.down.askTopSize}) | Mid: $${s.down.mid.toFixed(3)} | Spr: $${s.down.spread.toFixed(3)}`);
  console.log("------------------------------------------------------------");
  console.log("  \x1b[1mTRI-PARITY & EXECUTABLE ECONOMICS:\x1b[0m");
  console.log(`  • Mid Parity (Up + Down):      $${s.signal.midParity.toFixed(4)}`);
  console.log(`  • Buy Both Cost (Ask Sum):     $${s.signal.buyBothCost.toFixed(4)}`);
  console.log(`  • Buy Both Gross Edge:         $${s.signal.buyBothGrossEdge.toFixed(4)}`);
  console.log(`  • Buy Both Net Edge:           \x1b[1m$${s.signal.buyBothNetEdge.toFixed(4)}\x1b[0m (after ${((s.economics.feeSchedule?.rate ?? 0.07) * 100).toFixed(1)}% taker fee)`);
  console.log(`  • Arbitrage Viable:            ${s.economics.buyBothArbitrage.isViable ? "\x1b[32m\x1b[1mYES (PROFITABLE)\x1b[0m" : "No"}`);
  console.log(`  • Executable Depth:            ${s.signal.executableDepthShares} shares`);
  console.log("\x1b[36m============================================================\x1b[0m\n");
}

formatSignal();
