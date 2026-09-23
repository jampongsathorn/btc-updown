import { describe, it, expect, afterEach } from "vitest";
import { MarketRecorder } from "../src/recorder";
import { LiveEngineState } from "../src/types";
import path from "path";
import fs from "fs";

describe("Market Flight Recorder", () => {
  const testDir = path.join(process.cwd(), "recordings");
  const testEpoch = 1790169999;
  const testJsonPath = path.join(testDir, `flight-log-${testEpoch}.json`);

  afterEach(() => {
    if (fs.existsSync(testJsonPath)) fs.unlinkSync(testJsonPath);
  });

  it("should record ticks and generate statistical summary on slot completion", () => {
    const recorder = new MarketRecorder({ outputDir: testDir });

    const mockState = (epoch: number, elapsed: number, upMid: number, downMid: number, netEdge: number): LiveEngineState => ({
      meta: { snapshotId: "test", generatedAt: Date.now(), bookSequence: 1, slotEpoch: epoch, source: "node-ws" },
      slot: { epoch, slug: `btc-updown-5m-${epoch}`, title: "Test", conditionId: "c1", secondsRemaining: 300 - elapsed, progressPct: (elapsed / 300) * 100, warmupPhase: false },
      safety: { failClosed: false, canTrade: true, reasons: [], bookAgeMs: 10, maxBookAgeMsConfig: 2500, connected: true, crossedBook: false, stale: false, currentReady: true, nextReady: false, feeModelVerified: true },
      signal: { midParity: upMid + downMid, buyBothCost: (upMid + 0.01) + (downMid + 0.01), buyBothGrossEdge: 0.02, sellBothValue: 0.98, sellBothGrossEdge: -0.02, executableDepthShares: 100, buyBothNetEdge: netEdge, imbalanceUp: 0, imbalanceDown: 0 },
      economics: {
        feeSchedule: { rate: 0.07, exponent: 1, takerOnly: true, rebateRate: 0.2 },
        buyUp: { marketPrice: upMid + 0.01, benchmarkShares: 100, grossCostUsd: 50, estimatedTakerFeeUsd: 3.5, effectivePricePerShare: 0.535, slippageBps: 0 },
        buyDown: { marketPrice: downMid + 0.01, benchmarkShares: 100, grossCostUsd: 50, estimatedTakerFeeUsd: 3.5, effectivePricePerShare: 0.535, slippageBps: 0 },
        buyBothArbitrage: { isViable: netEdge > 0, askSum: (upMid + 0.01) + (downMid + 0.01), grossEdgeUsd: 2, estimatedTotalFeesUsd: 1, netEdgeUsd: netEdge * 100, maxExecutableShares: 100 },
      },
      up: { tokenId: "up", bestBid: upMid - 0.01, bestAsk: upMid + 0.01, mid: upMid, spread: 0.02, bidDepthTotalUsd: 100, askDepthTotalUsd: 100, bidTopSize: 50, askTopSize: 50, imbalance: 0, bids: [], asks: [] },
      down: { tokenId: "down", bestBid: downMid - 0.01, bestAsk: downMid + 0.01, mid: downMid, spread: 0.02, bidDepthTotalUsd: 100, askDepthTotalUsd: 100, bidTopSize: 50, askTopSize: 50, imbalance: 0, bids: [], asks: [] },
    });

    // Record 3 ticks in testEpoch
    recorder.recordTick(mockState(testEpoch, 10, 0.50, 0.50, -0.05));
    recorder.recordTick(mockState(testEpoch, 20, 0.45, 0.52, 0.01));
    recorder.recordTick(mockState(testEpoch, 30, 0.60, 0.40, -0.02));

    // Rollover to new epoch
    const summary = recorder.finalizeSlot(testEpoch);
    expect(summary).toBeDefined();
    expect(summary?.totalTicks).toBe(3);
    expect(summary?.upMidMin).toBe(0.45);
    expect(summary?.upMidMax).toBe(0.60);
    expect(summary?.maxNetEdge).toBe(0.01);
    expect(summary?.arbOpportunityTicks).toBe(1);

    expect(fs.existsSync(testJsonPath)).toBe(true);
  });
});
