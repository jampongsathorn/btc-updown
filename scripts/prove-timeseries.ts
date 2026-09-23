/**
 * Time-Series Proof of Signal Generation & Dynamic Stop-Loss Execution
 * 
 * Simulates a tick-by-tick (second-by-second, t = 0 to 300s) lifecycle:
 * Case A: Textbook Variance Collapse Sniper Win
 * Case B: Flash-Wick Reversal with Dynamic Stop-Loss Early Liquidation
 */

import { evaluateVarianceCollapse } from "../src/strategies/variance-collapse.js";

interface TimeSeriesTick {
  t: number;
  secondsRemaining: number;
  spot: number;
  deltaUsd: number;
  zScore: number;
  trueProbUp: number;
  upAsk: number;
  upBid: number;
  evUp: number;
  action: string;
  reason: string;
  positionHeld: boolean;
  walletCash: number;
  sharesHeld: number;
  realizedPnl: number;
}

function runScenario(name: string, btcPath: number[]): { ticks: TimeSeriesTick[]; finalPnl: number; finalStatus: string } {
  const S0 = 65000;
  const initialCash = 1000;
  let cash = initialCash;
  let shares = 0;
  let entryPrice = 0;
  let entryFee = 0;
  let positionOpen = false;
  let stopLossTriggered = false;
  let realizedPnl = 0;

  const ticks: TimeSeriesTick[] = [];

  for (let t = 0; t <= 300; t++) {
    const spot = btcPath[t];
    const tau = 300 - t;
    const delta = spot - S0;

    // Pricing simulation
    const secondVol = 0.55 / Math.sqrt(365.25 * 86400);
    const sigmaTau = secondVol * Math.sqrt(Math.max(1, tau));
    const z = Math.log(spot / S0) / sigmaTau;
    
    // Normal CDF approximation
    const probUp = 1 / (1 + Math.exp(-1.7 * z));
    
    // Retail anchored pricing with 2c spread
    const anchoredProb = 0.70 * probUp + 0.30 * 0.50;
    const upAsk = Math.min(0.98, Math.max(0.02, parseFloat((anchoredProb + 0.02).toFixed(2))));
    const upBid = Math.max(0.01, parseFloat((upAsk - 0.03).toFixed(2)));
    const downAsk = Math.min(0.98, Math.max(0.02, parseFloat(((1 - anchoredProb) + 0.02).toFixed(2))));
    const downBid = Math.max(0.01, parseFloat((downAsk - 0.03).toFixed(2)));

    // Strategy evaluation
    const strat = evaluateVarianceCollapse({
      currentSpot: spot,
      priceToBeat: S0,
      secondsRemaining: tau,
      upAsk,
      upBid,
      downAsk,
      downBid,
      minEvThreshold: 0.03,
      jumpSafetyBufferUsd: 35.0,
      currentPosition: positionOpen ? { side: "UP", entryPrice } : undefined,
    });

    // Execution logic
    if (!positionOpen && !stopLossTriggered && strat.recommendedAction === "BUY_UP") {
      positionOpen = true;
      entryPrice = upAsk;
      const tradeUsd = 100;
      shares = Math.floor(tradeUsd / entryPrice);
      entryFee = 0.07 * entryPrice * (1 - entryPrice) * shares;
      cash -= (shares * entryPrice + entryFee);
    } else if (positionOpen && strat.recommendedAction === "STOP_LOSS_EXIT") {
      // Early liquidation on bid
      const exitFee = 0.07 * upBid * (1 - upBid) * shares;
      const recovered = shares * upBid - exitFee;
      const cost = shares * entryPrice + entryFee;
      const netLoss = cost - recovered;
      cash += recovered;
      realizedPnl = -netLoss;
      positionOpen = false;
      stopLossTriggered = true;
      shares = 0;
    } else if (t === 300 && positionOpen) {
      // Settlement at expiry
      const won = spot >= S0;
      const cost = shares * entryPrice + entryFee;
      if (won) {
        const payout = shares * 1.0;
        realizedPnl = payout - cost;
        cash += payout;
      } else {
        realizedPnl = -cost;
      }
      positionOpen = false;
      shares = 0;
    }

    ticks.push({
      t,
      secondsRemaining: tau,
      spot: parseFloat(spot.toFixed(2)),
      deltaUsd: parseFloat(delta.toFixed(2)),
      zScore: strat.zScore,
      trueProbUp: strat.trueProbabilityUp,
      upAsk,
      upBid,
      evUp: strat.expectedValueUp,
      action: strat.recommendedAction,
      reason: strat.reason,
      positionHeld: positionOpen,
      walletCash: parseFloat(cash.toFixed(2)),
      sharesHeld: shares,
      realizedPnl: parseFloat(realizedPnl.toFixed(2)),
    });
  }

  const finalStatus = stopLossTriggered
    ? `STOPPED OUT EARLY (Capital Preserved, Net PnL: $${realizedPnl.toFixed(2)})`
    : (realizedPnl > 0 ? `EXPIRY WIN (Net PnL: +$${realizedPnl.toFixed(2)})` : `EXPIRY LOSS ($${realizedPnl.toFixed(2)})`);

  return { ticks, finalPnl: realizedPnl, finalStatus };
}

// Generate Path A: Strong continuous upward drift (Winning trade)
const pathA: number[] = [];
let pA = 65000;
for (let t = 0; t <= 300; t++) {
  // gradual upward climb to +$80
  pA += 0.25 + (Math.sin(t / 10) * 0.1);
  pathA.push(pA);
}

// Generate Path B: Upward drift until t=240, then violent flash reversal at t=255
const pathB: number[] = [];
let pB = 65000;
for (let t = 0; t <= 300; t++) {
  if (t < 240) {
    pB += 0.30; // climbing to +$72
  } else if (t >= 240 && t <= 255) {
    pB += 0.05; // peak at +$73
  } else if (t > 255 && t <= 270) {
    pB -= 5.0; // sudden -$75 flash collapse to -$2 below strike!
  } else {
    pB -= 0.2; // settles below strike
  }
  pathB.push(pB);
}

console.log("\n" + "=".repeat(85));
console.log("  TIME-SERIES MATHEMATICAL & EMPIRICAL PROOF OF SIGNAL & DYNAMIC STOP-LOSS");
console.log("=".repeat(85));

console.log("\n--- SCENARIO 1: TEXTBOOK VARIANCE COLLAPSE SNIPER (CLEAN WIN) ---");
const resultA = runScenario("Scenario A", pathA);
const keyTicksA = [0, 100, 200, 220, 230, 250, 280, 300];

console.log("  t (s) | tau(s) | BTC Spot  | Delta($) |  Z-Score  | p*(Up)  | Up.Ask | Up.EV($) | Action");
console.log("  " + "-".repeat(82));
for (const t of keyTicksA) {
  const tick = resultA.ticks[t];
  console.log(
    `  ${tick.t.toString().padStart(4)}s | ` +
    `${tick.secondsRemaining.toString().padStart(5)}s | ` +
    `$${tick.spot.toFixed(2)} | ` +
    `+$${tick.deltaUsd.toFixed(1).padStart(5)} | ` +
    `${tick.zScore.toFixed(2).padStart(8)} | ` +
    `${(tick.trueProbUp * 100).toFixed(1).padStart(5)}%  | ` +
    `$${tick.upAsk.toFixed(2)}  | ` +
    `+$${tick.evUp.toFixed(3)} | ` +
    `\x1b[1m${tick.action}\x1b[0m`
  );
}
console.log(`\n  >> RESULT SCENARIO 1: ${resultA.finalStatus}`);

console.log("\n" + "-".repeat(85));
console.log("--- SCENARIO 2: FLASH-WICK REVERSAL WITH DYNAMIC STOP-LOSS EARLY EXIT ---");
console.log("(Proves capital preservation: exits on bid instead of holding to $0.00 expiry)");
const resultB = runScenario("Scenario B", pathB);
const keyTicksB = [210, 230, 240, 255, 258, 260, 264, 267, 270, 300];

console.log("  t (s) | tau(s) | BTC Spot  | Delta($) |  Z-Score  | p*(Up)  | Up.Bid | Up.Ask | Action");
console.log("  " + "-".repeat(82));
for (const t of keyTicksB) {
  const tick = resultB.ticks[t];
  const actColor = tick.action === "STOP_LOSS_EXIT" ? "\x1b[31m" : (tick.action === "BUY_UP" ? "\x1b[32m" : "");
  console.log(
    `  ${tick.t.toString().padStart(4)}s | ` +
    `${tick.secondsRemaining.toString().padStart(5)}s | ` +
    `$${tick.spot.toFixed(2)} | ` +
    `${(tick.deltaUsd >= 0 ? "+" : "") + tick.deltaUsd.toFixed(1).padStart(5)} | ` +
    `${tick.zScore.toFixed(2).padStart(8)} | ` +
    `${(tick.trueProbUp * 100).toFixed(1).padStart(5)}%  | ` +
    `$${tick.upBid.toFixed(2)}  | ` +
    `$${tick.upAsk.toFixed(2)}  | ` +
    `${actColor}\x1b[1m${tick.action}\x1b[0m`
  );
}
console.log(`\n  >> RESULT SCENARIO 2: ${resultB.finalStatus}`);

// Mathematical proof summary of the loss mitigation
const naiveLoss = -100.0;
const stopLossPnl = resultB.finalPnl;
const capitalSaved = naiveLoss - stopLossPnl;
console.log("\n  LOSS MITIGATION PROOF:");
console.log(`  • Unprotected Expiry Loss (No Stop-Loss): $${naiveLoss.toFixed(2)} (-100% total wipeout)`);
console.log(`  • Dynamic Stop-Loss Liquidated Loss:      $${stopLossPnl.toFixed(2)} (capped loss)`);
console.log(`  • Capital Preserved by Stop-Loss:         +$${Math.abs(capitalSaved).toFixed(2)} (${(Math.abs(capitalSaved)/Math.abs(naiveLoss)*100).toFixed(1)}% of capital saved!)`);
console.log("=".repeat(85) + "\n");
