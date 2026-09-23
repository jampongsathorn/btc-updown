import { SafetyViolationReason } from "./types.js";

export interface SafetyParams {
  nowMs: number;
  lastTickMs: number;
  maxBookAgeMs: number;
  connected: boolean;
  upCrossed: boolean;
  downCrossed: boolean;
  upEmpty: boolean;
  downEmpty: boolean;
  feeModelVerified: boolean;
}

export interface SafetyReport {
  failClosed: boolean;
  canTrade: boolean;
  reasons: SafetyViolationReason[];
  bookAgeMs: number;
  maxBookAgeMsConfig: number;
  connected: boolean;
  crossedBook: boolean;
  stale: boolean;
  currentReady: boolean;
  nextReady: boolean;
  feeModelVerified: boolean;
}

export function evaluateSafety(params: SafetyParams): SafetyReport {
  const reasons: SafetyViolationReason[] = [];
  const bookAgeMs = Math.max(0, params.nowMs - params.lastTickMs);

  const stale = bookAgeMs > params.maxBookAgeMs;
  if (stale) reasons.push("BOOK_STALE");

  if (!params.connected) reasons.push("FEED_DISCONNECTED");

  const crossedBook = params.upCrossed || params.downCrossed;
  if (crossedBook) reasons.push("CROSSED_BOOK");

  const incompleteLegs = params.upEmpty || params.downEmpty;
  if (incompleteLegs) reasons.push("INCOMPLETE_LEGS");

  if (!params.feeModelVerified) reasons.push("FEE_MODEL_UNVERIFIED");

  const failClosed = reasons.length > 0;
  const canTrade = !failClosed;

  return {
    failClosed,
    canTrade,
    reasons,
    bookAgeMs,
    maxBookAgeMsConfig: params.maxBookAgeMs,
    connected: params.connected,
    crossedBook,
    stale,
    currentReady: !incompleteLegs && !crossedBook,
    nextReady: false,
    feeModelVerified: params.feeModelVerified,
  };
}
