#!/usr/bin/env node
import fs from "fs";
import path from "path";
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
  if (s.strategy) {
    const strat = s.strategy;
    const actionColor = strat.recommendedAction === "HOLD_NO_EDGE" ? "\x1b[33m" : "\x1b[32m";
    console.log("  \x1b[1mQUANTITATIVE STRATEGY (VARIANCE COLLAPSE SNIPER):\x1b[0m");
    console.log(`  • Model Prob (p*):             Up: ${(strat.trueProbabilityUp * 100).toFixed(1)}% | Down: ${(strat.trueProbabilityDown * 100).toFixed(1)}% (Z: ${strat.zScore})`);
    console.log(`  • Expected Value (EV):         Up: \x1b[1m+$${strat.expectedValueUp.toFixed(3)}\x1b[0m | Down: \x1b[1m+$${strat.expectedValueDown.toFixed(3)}\x1b[0m`);
    console.log(`  • Action Decision:             ${actionColor}\x1b[1m[${strat.recommendedAction}]\x1b[0m — ${strat.reason}`);
    console.log("------------------------------------------------------------");
  }

  if (s.paperWallet) {
    const w = s.paperWallet;
    const pnlColor = w.realizedPnlUsd >= 0 ? "\x1b[32m" : "\x1b[31m";
    console.log("  \x1b[1mPAPER TRADING SIMULATION PERFORMANCE:\x1b[0m");
    console.log(`  • Virtual Balance:             $${w.balanceUsd.toFixed(2)} USD (Initial: $${w.initialUsd.toFixed(2)})`);
    console.log(`  • Realized PnL:                ${pnlColor}\x1b[1m$${w.realizedPnlUsd.toFixed(2)} (${w.returnPct >= 0 ? "+" : ""}${w.returnPct}%)\x1b[0m`);
    console.log(`  • Trades Record:               Total: ${w.totalTrades} | Win-Rate: \x1b[1m${w.winRatePct}%\x1b[0m (${w.wins}W - ${w.losses}L)`);
    console.log("------------------------------------------------------------");
  }

  console.log("  \x1b[1mTRI-PARITY & EXECUTABLE ECONOMICS:\x1b[0m");
  console.log(`  • Mid Parity (Up + Down):      $${s.signal.midParity.toFixed(4)}`);
  console.log(`  • Buy Both Cost (Ask Sum):     $${s.signal.buyBothCost.toFixed(4)}`);
  console.log(`  • Buy Both Gross Edge:         $${s.signal.buyBothGrossEdge.toFixed(4)}`);
  console.log(`  • Buy Both Net Edge:           \x1b[1m$${s.signal.buyBothNetEdge.toFixed(4)}\x1b[0m (after ${((s.economics.feeSchedule?.rate ?? 0.07) * 100).toFixed(1)}% taker fee)`);
  console.log(`  • Arbitrage Viable:            ${s.economics.buyBothArbitrage.isViable ? "\x1b[32m\x1b[1mYES (PROFITABLE)\x1b[0m" : "No"}`);
  console.log(`  • Executable Depth:            ${s.signal.executableDepthShares} shares`);
  console.log("\x1b[36m============================================================\x1b[0m\n");
}

function showLog() {
  const isJson = process.argv.includes("--json");
  const logDir = path.join(process.cwd(), "recordings");
  if (!fs.existsSync(logDir)) {
    console.log("No flight logs recorded yet.");
    return;
  }
  const files = fs.readdirSync(logDir).filter(f => f.startsWith("flight-log-") && f.endsWith(".json")).sort().reverse();
  if (files.length === 0) {
    console.log("No flight logs recorded yet.");
    return;
  }

  const latestFile = path.join(logDir, files[0]);
  const content = JSON.parse(fs.readFileSync(latestFile, "utf8"));
  if (isJson) {
    console.log(JSON.stringify(content, null, 2));
    return;
  }

  const s = content.summary;
  console.log("\n\x1b[1m\x1b[35m============================================================\x1b[0m");
  console.log(`\x1b[1m  MARKET FLIGHT RECORDER SUMMARY — ${s.slug}\x1b[0m`);
  console.log("\x1b[1m\x1b[35m============================================================\x1b[0m");
  console.log(`  Window:             ${s.startedAt} -> ${s.finishedAt}`);
  console.log(`  Total Ticks:        ${s.totalTicks} data points`);
  console.log(`  Up Mid Range:       $${s.upMidMin.toFixed(3)} -> $${s.upMidMax.toFixed(3)} (Delta: $${s.upMidRange.toFixed(3)})`);
  console.log(`  Down Mid Range:     $${s.downMidMin.toFixed(3)} -> $${s.downMidMax.toFixed(3)}`);
  console.log(`  Average Spread:     Up: $${s.avgSpreadUp.toFixed(3)} | Down: $${s.avgSpreadDown.toFixed(3)}`);
  console.log(`  Mid Parity (Avg):   $${s.avgMidParity.toFixed(4)} (Min: $${s.minMidParity.toFixed(4)}, Max: $${s.maxMidParity.toFixed(4)})`);
  console.log(`  Lowest Ask Sum:     $${s.minBuyBothCost.toFixed(4)}`);
  console.log(`  Max Net Arb Edge:   $${s.maxNetEdge.toFixed(4)}`);
  console.log(`  Arb Opportunities:  ${s.arbOpportunityTicks} ticks (${s.arbOpportunityPct}%)`);
  console.log("\x1b[35m============================================================\x1b[0m\n");
}

if (process.argv.includes("log")) {
  showLog();
} else {
  formatSignal();
}
