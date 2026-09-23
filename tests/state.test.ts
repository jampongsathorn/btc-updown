import { describe, it, expect, afterEach } from "vitest";
import { StateStore } from "../src/state";
import { LiveEngineState } from "../src/types";
import fs from "fs";
import path from "path";

describe("Atomic State Persistence", () => {
  const testDir = path.join(process.cwd(), "state");
  const testFilePath = path.join(testDir, "test-live.json");

  afterEach(() => {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  });

  it("should write state atomically and increment snapshotId and sequence", () => {
    const store = new StateStore(testFilePath);
    const mockState = {
      meta: {
        snapshotId: "",
        generatedAt: 0,
        bookSequence: 0,
        slotEpoch: 1790158800,
        source: "node-ws",
      },
      slot: {
        epoch: 1790158800,
        slug: "btc-updown-5m-1790158800",
        title: "Test Slot",
        conditionId: "0x123",
        secondsRemaining: 150,
        progressPct: 50,
        warmupPhase: false,
      },
      safety: {
        failClosed: false,
        canTrade: true,
        reasons: [],
        bookAgeMs: 50,
        maxBookAgeMsConfig: 2500,
        connected: true,
        crossedBook: false,
        stale: false,
        currentReady: true,
        nextReady: false,
        feeModelVerified: true,
      },
      signal: {
        midParity: 1.0,
        buyBothCost: 1.0,
        buyBothGrossEdge: 0,
        sellBothValue: 1.0,
        sellBothGrossEdge: 0,
        executableDepthShares: 100,
        buyBothNetEdge: 0,
        imbalanceUp: 0,
        imbalanceDown: 0,
      },
      economics: {
        feeSchedule: { rate: 0.07, exponent: 1, takerOnly: true, rebateRate: 0.2 },
        buyUp: { marketPrice: 0.5, benchmarkShares: 100, grossCostUsd: 50, estimatedTakerFeeUsd: 3.5, effectivePricePerShare: 0.535, slippageBps: 0 },
        buyDown: { marketPrice: 0.5, benchmarkShares: 100, grossCostUsd: 50, estimatedTakerFeeUsd: 3.5, effectivePricePerShare: 0.535, slippageBps: 0 },
        buyBothArbitrage: { isViable: false, askSum: 1.0, grossEdgeUsd: 0, estimatedTotalFeesUsd: 7, netEdgeUsd: -7, maxExecutableShares: 100 },
      },
      up: { tokenId: "up", bestBid: 0.49, bestAsk: 0.51, mid: 0.5, spread: 0.02, bidDepthTotalUsd: 100, askDepthTotalUsd: 100, bidTopSize: 50, askTopSize: 50, imbalance: 0, bids: [], asks: [] },
      down: { tokenId: "down", bestBid: 0.49, bestAsk: 0.51, mid: 0.5, spread: 0.02, bidDepthTotalUsd: 100, askDepthTotalUsd: 100, bidTopSize: 50, askTopSize: 50, imbalance: 0, bids: [], asks: [] },
    } as unknown as LiveEngineState;

    store.writeState(mockState);

    expect(fs.existsSync(testFilePath)).toBe(true);
    const read = JSON.parse(fs.readFileSync(testFilePath, "utf8"));
    expect(read.meta.bookSequence).toBe(1);
    expect(read.meta.snapshotId).toBeDefined();
    expect(read.slot.epoch).toBe(1790158800);
  });
});
