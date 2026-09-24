import fs from "fs";
import path from "path";
import { LiveEngineState } from "./types.js";

export interface TickRecord {
  timestamp: number;
  epoch: number;
  elapsedSec: number;
  remSec: number;
  upBid: number;
  upAsk: number;
  upMid: number;
  upSpread: number;
  downBid: number;
  downAsk: number;
  downMid: number;
  downSpread: number;
  midParity: number;
  buyBothCost: number;
  buyBothGrossEdge: number;
  buyBothNetEdge: number;
  arbViable: boolean;
  // Directional strategy fields (variance-collapse) - added so signal
  // frequency/near-misses can be analyzed from history instead of only
  // ever knowing "0 trades happened" with no visibility into how close
  // the strategy got.
  recommendedAction: string;
  inSniperWindow: boolean;
  zScore: number;
  trueProbabilityUp: number;
  netEdgeUpPct: number;
  netEdgeDownPct: number;
  expectedValueUp: number;
  expectedValueDown: number;
  recommendedShares: number;
}

export interface SlotSummary {
  epoch: number;
  slug: string;
  totalTicks: number;
  upMidMin: number;
  upMidMax: number;
  upMidRange: number;
  downMidMin: number;
  downMidMax: number;
  avgSpreadUp: number;
  avgSpreadDown: number;
  minMidParity: number;
  maxMidParity: number;
  avgMidParity: number;
  minBuyBothCost: number;
  maxNetEdge: number;
  arbOpportunityTicks: number;
  arbOpportunityPct: number;
  startedAt: string;
  finishedAt: string;
  // Directional signal stats for this slot.
  sniperWindowTicks: number;
  signalTicks: number; // ticks where recommendedAction was BUY_UP or BUY_DOWN
  finalAction: string; // recommendedAction on the last recorded tick
  maxNetEdgeUpPct: number; // peak edge seen, even if it never crossed the entry threshold
  maxNetEdgeDownPct: number;
  peakZScoreAbs: number;
}

export class MarketRecorder {
  private outputDir: string;
  private activeEpoch: number = 0;
  private currentTicks: TickRecord[] = [];
  private lastRecordedSec: number = -1;

  constructor(options?: { outputDir?: string }) {
    this.outputDir = options?.outputDir || path.join(process.cwd(), "recordings");
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  public recordTick(state: LiveEngineState): void {
    if (!state || !state.slot || !state.up || !state.down) return;
    if (state.up.bestAsk === 0 && state.down.bestAsk === 0) return; // skip empty initial book

    const epoch = state.slot.epoch;
    const elapsedSec = 300 - state.slot.secondsRemaining;

    // Detect slot change
    if (this.activeEpoch !== 0 && this.activeEpoch !== epoch) {
      this.finalizeSlot(this.activeEpoch);
      this.activeEpoch = epoch;
      this.currentTicks = [];
      this.lastRecordedSec = -1;
    } else if (this.activeEpoch === 0) {
      this.activeEpoch = epoch;
    }

    // Record at most once per second to prevent bloated files
    if (elapsedSec === this.lastRecordedSec) return;
    this.lastRecordedSec = elapsedSec;

    const record: TickRecord = {
      timestamp: state.meta.generatedAt || Date.now(),
      epoch,
      elapsedSec,
      remSec: state.slot.secondsRemaining,
      upBid: state.up.bestBid,
      upAsk: state.up.bestAsk,
      upMid: state.up.mid,
      upSpread: state.up.spread,
      downBid: state.down.bestBid,
      downAsk: state.down.bestAsk,
      downMid: state.down.mid,
      downSpread: state.down.spread,
      midParity: state.signal.midParity,
      buyBothCost: state.signal.buyBothCost,
      buyBothGrossEdge: state.signal.buyBothGrossEdge,
      buyBothNetEdge: state.signal.buyBothNetEdge,
      arbViable: state.economics.buyBothArbitrage.isViable,
      recommendedAction: state.strategy?.recommendedAction ?? "HOLD_NO_EDGE",
      inSniperWindow: state.strategy?.inSniperWindow ?? false,
      zScore: state.strategy?.zScore ?? 0,
      trueProbabilityUp: state.strategy?.trueProbabilityUp ?? 0.5,
      netEdgeUpPct: state.strategy?.netEdgeUpPct ?? 0,
      netEdgeDownPct: state.strategy?.netEdgeDownPct ?? 0,
      expectedValueUp: state.strategy?.expectedValueUp ?? 0,
      expectedValueDown: state.strategy?.expectedValueDown ?? 0,
      recommendedShares: state.strategy?.recommendedShares ?? 0,
    };

    this.currentTicks.push(record);
  }

  public finalizeSlot(epoch: number): SlotSummary | null {
    if (this.currentTicks.length === 0) return null;

    const ticks = this.currentTicks;
    const upMids = ticks.map(t => t.upMid);
    const downMids = ticks.map(t => t.downMid);
    const parities = ticks.map(t => t.midParity);
    const spreadsUp = ticks.map(t => t.upSpread);
    const spreadsDown = ticks.map(t => t.downSpread);
    const netEdges = ticks.map(t => t.buyBothNetEdge);
    const costs = ticks.map(t => t.buyBothCost);
    const arbTicks = ticks.filter(t => t.arbViable).length;
    const sniperWindowTicks = ticks.filter(t => t.inSniperWindow).length;
    const signalTicks = ticks.filter(t => t.recommendedAction === "BUY_UP" || t.recommendedAction === "BUY_DOWN").length;

    const upMidMin = Math.min(...upMids);
    const upMidMax = Math.max(...upMids);

    const summary: SlotSummary = {
      epoch,
      slug: `btc-updown-5m-${epoch}`,
      totalTicks: ticks.length,
      upMidMin,
      upMidMax,
      upMidRange: parseFloat((upMidMax - upMidMin).toFixed(4)),
      downMidMin: Math.min(...downMids),
      downMidMax: Math.max(...downMids),
      avgSpreadUp: parseFloat((spreadsUp.reduce((a, b) => a + b, 0) / ticks.length).toFixed(4)),
      avgSpreadDown: parseFloat((spreadsDown.reduce((a, b) => a + b, 0) / ticks.length).toFixed(4)),
      minMidParity: Math.min(...parities),
      maxMidParity: Math.max(...parities),
      avgMidParity: parseFloat((parities.reduce((a, b) => a + b, 0) / ticks.length).toFixed(4)),
      minBuyBothCost: Math.min(...costs),
      maxNetEdge: Math.max(...netEdges),
      arbOpportunityTicks: arbTicks,
      arbOpportunityPct: parseFloat(((arbTicks / ticks.length) * 100).toFixed(1)),
      startedAt: new Date(ticks[0].timestamp).toISOString(),
      finishedAt: new Date(ticks[ticks.length - 1].timestamp).toISOString(),
      sniperWindowTicks,
      signalTicks,
      finalAction: ticks[ticks.length - 1].recommendedAction,
      maxNetEdgeUpPct: parseFloat(Math.max(...ticks.map(t => t.netEdgeUpPct)).toFixed(2)),
      maxNetEdgeDownPct: parseFloat(Math.max(...ticks.map(t => t.netEdgeDownPct)).toFixed(2)),
      peakZScoreAbs: parseFloat(Math.max(...ticks.map(t => Math.abs(t.zScore))).toFixed(3)),
    };

    // Save JSON flight log
    const jsonPath = path.join(this.outputDir, `flight-log-${epoch}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, ticks }, null, 2), "utf8");

    // Save CSV
    const csvPath = path.join(this.outputDir, `flight-log-${epoch}.csv`);
    const csvHeader = "timestamp,elapsedSec,remSec,upBid,upAsk,upMid,upSpread,downBid,downAsk,downMid,downSpread,midParity,buyBothCost,buyBothNetEdge,arbViable,recommendedAction,inSniperWindow,zScore,trueProbabilityUp,netEdgeUpPct,netEdgeDownPct,recommendedShares\n";
    const csvRows = ticks.map(t =>
      `${t.timestamp},${t.elapsedSec},${t.remSec},${t.upBid},${t.upAsk},${t.upMid},${t.upSpread},${t.downBid},${t.downAsk},${t.downMid},${t.downSpread},${t.midParity},${t.buyBothCost},${t.buyBothNetEdge},${t.arbViable},${t.recommendedAction},${t.inSniperWindow},${t.zScore},${t.trueProbabilityUp},${t.netEdgeUpPct},${t.netEdgeDownPct},${t.recommendedShares}`
    ).join("\n");
    fs.writeFileSync(csvPath, csvHeader + csvRows, "utf8");

    return summary;
  }

  public getLatestSummary(): SlotSummary | null {
    try {
      const files = fs.readdirSync(this.outputDir)
        .filter(f => f.startsWith("flight-log-") && f.endsWith(".json"))
        .sort().reverse();
      if (files.length === 0) return null;
      const data = JSON.parse(fs.readFileSync(path.join(this.outputDir, files[0]), "utf8"));
      return data.summary || null;
    } catch {
      return null;
    }
  }
}
