import { describe, it, expect } from "vitest";
import { evaluateSafety } from "../src/validator";

describe("Safety Guard (Fail-Closed)", () => {
  it("should fail closed if book is older than maxBookAgeMs", () => {
    const report = evaluateSafety({
      nowMs: 10000,
      lastTickMs: 7000, // 3000ms old > 2500ms
      maxBookAgeMs: 2500,
      connected: true,
      upCrossed: false,
      downCrossed: false,
      upEmpty: false,
      downEmpty: false,
      feeModelVerified: true,
    });

    expect(report.failClosed).toBe(true);
    expect(report.canTrade).toBe(false);
    expect(report.reasons).toContain("BOOK_STALE");
  });

  it("should fail closed if orderbook is crossed", () => {
    const report = evaluateSafety({
      nowMs: 10000,
      lastTickMs: 9900,
      maxBookAgeMs: 2500,
      connected: true,
      upCrossed: true,
      downCrossed: false,
      upEmpty: false,
      downEmpty: false,
      feeModelVerified: true,
    });

    expect(report.canTrade).toBe(false);
    expect(report.reasons).toContain("CROSSED_BOOK");
  });

  it("should permit trading when all safety invariants pass", () => {
    const report = evaluateSafety({
      nowMs: 10000,
      lastTickMs: 9900,
      maxBookAgeMs: 2500,
      connected: true,
      upCrossed: false,
      downCrossed: false,
      upEmpty: false,
      downEmpty: false,
      feeModelVerified: true,
    });

    expect(report.failClosed).toBe(false);
    expect(report.canTrade).toBe(true);
    expect(report.reasons).toHaveLength(0);
  });
});
