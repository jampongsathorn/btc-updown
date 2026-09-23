/**
 * FULL MONTH BACKTEST — REAL Coinbase 1-minute candles (Sept 1 – Sept 23, 2026)
 *
 * Unlike the earlier backtest-full-month.ts (which used a synthetic
 * GBM-simulated price path), this loads ~32,768 REAL 1-minute BTC-USD
 * candles fetched from Coinbase's public candles API and reconstructs
 * every real 5-minute slot from them.
 *
 * Uses the corrected, uncapped market-maker pricing model (lagged spot +
 * spread, no artificial ceiling) and Chainlink-style 60s TWAP settlement,
 * matching scripts/forward-test-out-of-sample.ts. Calls the REAL production
 * evaluateVarianceCollapse()/kelly functions - not a reimplementation.
 */
import fs from "fs";
import { evaluateVarianceCollapse, normalCdf } from "../src/strategies/variance-collapse.js";
import { calculateKellyFraction, calculateOrderSizeShares } from "../src/kelly.js";

type Candle = [number, number, number, number, number, number]; // time, low, high, open, close, volume

const candlesPath = process.argv[2] || "/private/tmp/claude-501/-Users-pongsathorn/746c0719-8924-442c-beaa-2e527833fc76/scratchpad/month_candles.json";
const raw: Candle[] = JSON.parse(fs.readFileSync(candlesPath, "utf-8"));
const sorted = [...raw].sort((a, b) => a[0] - b[0]);

interface RealSlot {
  epoch: number;
  strikeOpen: number;
  min3Spot: number;
  min4Spot: number;
  twapFinal: number;
  actualOutcome: "UP" | "DOWN";
}

const slots: RealSlot[] = [];
let skippedGaps = 0;

for (let i = 0; i + 5 <= sorted.length; i += 5) {
  const bucket = sorted.slice(i, i + 5);

  // Only use buckets that are actually contiguous, aligned 5-minute windows -
  // real feeds can have gaps; a gap here would silently corrupt the strike.
  const isAligned = bucket[0][0] % 300 === 0;
  const isContiguous = bucket[4][0] - bucket[0][0] === 240;
  if (!isAligned || !isContiguous) {
    skippedGaps++;
    continue;
  }

  const strikeOpen = bucket[0][3];
  const min3Spot = bucket[2][4];
  const min4Spot = bucket[3][4];
  const min5Avg = (bucket[4][1] + bucket[4][2] + bucket[4][3] + bucket[4][4]) / 4;
  const twapFinal = parseFloat(((min4Spot + min5Avg) / 2).toFixed(2));
  const actualOutcome: "UP" | "DOWN" = twapFinal >= strikeOpen ? "UP" : "DOWN";

  slots.push({ epoch: bucket[0][0], strikeOpen, min3Spot, min4Spot, twapFinal, actualOutcome });
}

let bankroll = 1000;
let peak = 1000;
let maxDrawdown = 0;
let totalTrades = 0;
let wins = 0;
let stopLosses = 0;
let fullLosses = 0;
let skippedNoEdge = 0;
let grossWins = 0;
let grossLosses = 0;

const dailyPnl = new Map<string, { trades: number; wins: number; pnl: number }>();

for (const slot of slots) {
  const dayKey = new Date(slot.epoch * 1000).toISOString().slice(0, 10);
  if (!dailyPnl.has(dayKey)) dailyPnl.set(dayKey, { trades: 0, wins: 0, pnl: 0 });
  const dayStat = dailyPnl.get(dayKey)!;

  const tauSec = 60;
  const tauYears = tauSec / (365.25 * 86400);
  const sigmaTau = 0.55 * Math.sqrt(tauYears);
  const mmLogReturn = Math.log(slot.min3Spot / slot.strikeOpen);
  const mmZ = mmLogReturn / sigmaTau;
  const mmProbUp = normalCdf(mmZ);
  const halfSpread = 0.015;
  const clamp = (p: number) => Math.min(0.99, Math.max(0.01, p));

  const mmAskUp = parseFloat(clamp(mmProbUp + halfSpread).toFixed(2));
  const mmAskDown = parseFloat(clamp((1 - mmProbUp) + halfSpread).toFixed(2));

  const strategy = evaluateVarianceCollapse({
    currentSpot: slot.min4Spot,
    priceToBeat: slot.strikeOpen,
    secondsRemaining: 60,
    upAsk: mmAskUp,
    upBid: parseFloat((mmAskUp - 0.03).toFixed(2)),
    downAsk: mmAskDown,
    downBid: parseFloat((mmAskDown - 0.03).toFixed(2)),
    minEvThreshold: 0.03,
    jumpSafetyBufferUsd: 35.0,
  });

  if (strategy.recommendedAction !== "BUY_UP" && strategy.recommendedAction !== "BUY_DOWN") {
    skippedNoEdge++;
    continue;
  }

  totalTrades++;
  dayStat.trades++;
  const isUpTrade = strategy.recommendedAction === "BUY_UP";
  const executedAsk = isUpTrade ? mmAskUp : mmAskDown;

  const kelly = calculateKellyFraction({
    winProbability: isUpTrade ? strategy.trueProbabilityUp : strategy.trueProbabilityDown,
    tokenAsk: executedAsk,
    takerFeeRate: 0.07,
    stopLossPrice: executedAsk * 0.75,
    fractionMultiplier: 0.25,
  });

  const orderSize = calculateOrderSizeShares({
    availableBankrollUsd: bankroll,
    tokenAsk: executedAsk,
    fraction: kelly.recommendedFraction > 0 ? kelly.recommendedFraction : 0.05,
    maxSingleTradeUsd: 150,
    minShares: 5,
  });

  const shares = orderSize.shares;
  if (shares <= 0) {
    totalTrades--;
    dayStat.trades--;
    skippedNoEdge++;
    continue;
  }

  const fee = 0.07 * executedAsk * (1 - executedAsk) * shares;
  const cost = shares * executedAsk + fee;
  const won = (isUpTrade && slot.actualOutcome === "UP") || (!isUpTrade && slot.actualOutcome === "DOWN");

  if (won) {
    wins++;
    dayStat.wins++;
    const pnl = shares * 1.0 - cost;
    bankroll += pnl;
    dayStat.pnl += pnl;
    grossWins += pnl;
  } else {
    const reversedTowardsStrike = (isUpTrade && slot.twapFinal < slot.strikeOpen) || (!isUpTrade && slot.twapFinal > slot.strikeOpen);
    if (reversedTowardsStrike) {
      stopLosses++;
      const exitBid = executedAsk * 0.75;
      const exitFee = 0.07 * exitBid * (1 - exitBid) * shares;
      const recovered = shares * exitBid - exitFee;
      const loss = cost - recovered;
      bankroll -= loss;
      dayStat.pnl -= loss;
      grossLosses += loss;
    } else {
      fullLosses++;
      bankroll -= cost;
      dayStat.pnl -= cost;
      grossLosses += cost;
    }
  }

  if (bankroll > peak) peak = bankroll;
  const dd = (peak - bankroll) / peak;
  if (dd > maxDrawdown) maxDrawdown = dd;
}

const netPnl = bankroll - 1000;
const returnPct = (netPnl / 1000) * 100;
const winRate = (wins + stopLosses + fullLosses) > 0 ? (wins / (wins + stopLosses + fullLosses)) * 100 : 0;
const profitFactor = grossLosses > 0 ? grossWins / grossLosses : (wins > 0 ? Infinity : 0);

console.log("\n" + "=".repeat(90));
console.log("  FULL MONTH BACKTEST — REAL Coinbase 1-min candles (Sept 1 - Sept 23, 2026)");
console.log("=".repeat(90));
console.log(`  Total raw candles loaded:     ${sorted.length}`);
console.log(`  Total 5-min slots reconstructed: ${slots.length}`);
console.log(`  Slots skipped (data gaps):    ${skippedGaps}`);
console.log("  " + "-".repeat(70));
console.log(`  Trades taken:                 ${totalTrades} (${((totalTrades / slots.length) * 100).toFixed(2)}% of slots)`);
console.log(`  Slots skipped (no edge):      ${skippedNoEdge} (${((skippedNoEdge / slots.length) * 100).toFixed(2)}%)`);
console.log(`  Wins:                         ${wins}`);
console.log(`  Stop-losses:                  ${stopLosses}`);
console.log(`  Full losses:                  ${fullLosses}`);
console.log(`  Win rate:                     ${winRate.toFixed(1)}%`);
console.log(`  Profit factor:                ${profitFactor === Infinity ? "inf (no losses)" : profitFactor.toFixed(2)}x`);
console.log(`  Max drawdown:                 ${(maxDrawdown * 100).toFixed(1)}%`);
console.log(`  Starting bankroll:            $1,000.00`);
console.log(`  Final bankroll:               $${bankroll.toFixed(2)}`);
console.log(`  Net PnL:                      ${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(2)}`);
console.log(`  Return:                       ${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)}%`);
console.log("  " + "-".repeat(70));
console.log("  Day-by-day:");
for (const [day, stat] of [...dailyPnl.entries()].sort()) {
  console.log(`    ${day}  trades=${stat.trades.toString().padStart(3)}  wins=${stat.wins.toString().padStart(3)}  pnl=${(stat.pnl >= 0 ? "+" : "")}$${stat.pnl.toFixed(2)}`);
}
console.log("=".repeat(90) + "\n");
