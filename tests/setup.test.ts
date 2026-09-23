import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../src/types";

describe("Environment Setup", () => {
  it("should export default configuration constants", () => {
    expect(DEFAULT_CONFIG.WARMUP_SECONDS).toBe(45);
    expect(DEFAULT_CONFIG.MAX_BOOK_AGE_MS).toBe(2500);
    expect(DEFAULT_CONFIG.BENCHMARK_SHARES).toBe(100);
  });
});
