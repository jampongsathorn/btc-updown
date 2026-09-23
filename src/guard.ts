import { LiveEngineState } from "./types.js";

export class ExecutionGuardError extends Error {
  constructor(public code: string, message: string) {
    super(`Execution guard violation: ${code} - ${message}`);
    this.name = "ExecutionGuardError";
  }
}

export function assertCanTrade(state: LiveEngineState, maxAgeMs: number = 2500): void {
  if (!state.safety.canTrade || state.safety.failClosed) {
    throw new ExecutionGuardError(
      "CANNOT_TRADE",
      state.safety.reasons.join(", ") || "Safety guard rejected trade"
    );
  }

  const age = Date.now() - state.meta.generatedAt;
  if (age > maxAgeMs) {
    throw new ExecutionGuardError(
      "STALE_AT_EXECUTION",
      `Snapshot age is ${age}ms, exceeds max allowable ${maxAgeMs}ms`
    );
  }

  if (state.up && state.up.bestBid >= state.up.bestAsk && state.up.bestAsk > 0) {
    throw new ExecutionGuardError("UP_BOOK_CROSSED", `Up book crossed: ${state.up.bestBid} >= ${state.up.bestAsk}`);
  }

  if (state.down && state.down.bestBid >= state.down.bestAsk && state.down.bestAsk > 0) {
    throw new ExecutionGuardError("DOWN_BOOK_CROSSED", `Down book crossed: ${state.down.bestBid} >= ${state.down.bestAsk}`);
  }
}
