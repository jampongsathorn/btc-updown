import { describe, it, expect } from "vitest";
import { assertCanTrade, ExecutionGuardError } from "../src/guard";
import { LiveEngineState } from "../src/types";

describe("Pre-Flight Execution Guard", () => {
  it("should throw ExecutionGuardError if state.safety.canTrade is false", () => {
    const mockState = {
      meta: { generatedAt: Date.now() },
      safety: { canTrade: false, reasons: ["BOOK_STALE"] }
    } as unknown as LiveEngineState;

    expect(() => assertCanTrade(mockState)).toThrow(ExecutionGuardError);
  });

  it("should throw if snapshot is too old at moment of execution", () => {
    const mockState = {
      meta: { generatedAt: Date.now() - 5000 },
      safety: { canTrade: true, reasons: [] }
    } as unknown as LiveEngineState;

    expect(() => assertCanTrade(mockState, 2500)).toThrow(/Execution guard violation: STALE_AT_EXECUTION/);
  });

  it("should succeed without error if snapshot passes all pre-flight invariants", () => {
    const mockState = {
      meta: { generatedAt: Date.now() - 100 },
      safety: { canTrade: true, reasons: [] },
      up: { bestBid: 0.50, bestAsk: 0.51 },
      down: { bestBid: 0.49, bestAsk: 0.50 },
    } as unknown as LiveEngineState;

    expect(() => assertCanTrade(mockState, 2500)).not.toThrow();
  });
});
