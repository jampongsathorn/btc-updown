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
    };

    // Save JSON flight log
    const jsonPath = path.join(this.outputDir, `flight-log-${epoch}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({ summary, ticks }, null, 2), "utf8");

    // Save CSV
    const csvPath = path.join(this.outputDir, `flight-log-${epoch}.csv`);
    const csvHeader = "timestamp,elapsedSec,remSec,upBid,upAsk,upMid,upSpread,downBid,downAsk,downMid,downSpread,midParity,buyBothCost,buyBothNetEdge,arbViable\n";
    const csvRows = ticks.map(t =>
      `${t.timestamp},${t.elapsedSec},${t.remSec},${t.upBid},${t.upAsk},${t.upMid},${t.upSpread},${t.downBid},${t.downAsk},${t.downMid},${t.downSpread},${t.midParity},${t.buyBothCost},${t.buyBothNetEdge},${t.arbViable}`
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
