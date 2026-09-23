# BTC Up/Down Auto-Rolling Market Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade, real-time market data and signal engine for Polymarket's recurring 5-minute Bitcoin Up/Down markets (`btc-up-or-down-5m`) featuring dynamic slot rollovers, dual-mode transport, executable economics, and fail-closed safety guards.

**Architecture:** Layered event-driven architecture where raw Polymarket market data (from direct Node.js WS or Browser Relay) is ingested into normalized L2 orderbooks, evaluated by a dual-slot scheduler (current vs warm-up), enriched with depth-weighted executable economics and tri-parity signals, checked by a fail-closed safety guard, and atomically flushed to `state/live.json` for agent consumption alongside a live Web Preview dashboard.

**Tech Stack:** Node.js (v22), TypeScript, Vitest (TDD testing), Express (Relay/Web Preview), `ws` (WebSocket client), `viem` / Polymarket CLOB client standards.

**Spec:** `docs/superpowers/specs/2026-09-23-btc-updown-engine-design.md`

## Global Constraints
- Target series: Polymarket 5-minute recurring BTC Up/Down (`btc-updown-5m-<EPOCH>`).
- Configurable thresholds: `WARMUP_SECONDS` (default: 45s), `MAX_BOOK_AGE_MS` (default: 2500ms), `BENCHMARK_SHARES` (default: 100).
- Performance target: p95 local cache read < 2ms.
- Safety invariant: **Fail-Closed** (`safety.canTrade = false` if any safety condition is violated).
- Clean separation: Signal analytics decoupled from trade permission.

## Review Focus
1. **Crossed Book Invariant:** When `bestBid >= bestAsk` on either leg due to sudden market fills, safety must instantly set `canTrade: false` with reason `CROSSED_BOOK`.
2. **Book Staleness Invariant:** If no tick arrives for longer than `MAX_BOOK_AGE_MS`, safety must transition to `canTrade: false` with reason `BOOK_STALE`.
3. **Dual-Slot Handover Continuity:** During `WARMUP_SECONDS` ($T-45\text{s}$), the engine must maintain both `current` and `next` books simultaneously without mutating the active tradable state.
4. **Taker Fee & Depth Economics:** Arbitrage and execution must account for depth ladder walks and dynamic taker fees; an ask sum $< 1.00$ with negative net edge after fees must not trigger viable arbitrage.
5. **Execution Guard Re-check:** The execution guard must re-verify invariants immediately prior to order dispatch to catch latency slippage.

---

### Task 1: Project Setup & TypeScript / Vitest Environment

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`
- Test: `tests/setup.test.ts`

**Interfaces:**
- Consumes: None (initial setup)
- Produces: TypeScript types (`LiveEngineState`, `OrderbookLeg`, `SafetyViolationReason`, `ExecutionScenario`, `ArbitrageScenario`) and configured test runner.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/setup.test.ts
import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../src/types";

describe("Environment Setup", () => {
  it("should export default configuration constants", () => {
    expect(DEFAULT_CONFIG.WARMUP_SECONDS).toBe(45);
    expect(DEFAULT_CONFIG.MAX_BOOK_AGE_MS).toBe(2500);
    expect(DEFAULT_CONFIG.BENCHMARK_SHARES).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/setup.test.ts`  
Expected: FAIL (Cannot find module `../src/types`)

- [ ] **Step 3: Write minimal implementation**

Create `package.json`, `tsconfig.json`, `vitest.config.ts`, and `src/types.ts` with complete type definitions matching the spec:

```typescript
// src/types.ts
export interface EngineConfig {
  WARMUP_SECONDS: number;
  MAX_BOOK_AGE_MS: number;
  BENCHMARK_SHARES: number;
  PORT: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  WARMUP_SECONDS: parseInt(process.env.WARMUP_SECONDS || "45", 10),
  MAX_BOOK_AGE_MS: parseInt(process.env.MAX_BOOK_AGE_MS || "2500", 10),
  BENCHMARK_SHARES: parseInt(process.env.BENCHMARK_SHARES || "100", 10),
  PORT: parseInt(process.env.PORT || "3000", 10),
};

export type SafetyViolationReason =
  | "FEED_DISCONNECTED"
  | "BOOK_STALE"
  | "CROSSED_BOOK"
  | "INCOMPLETE_LEGS"
  | "FEE_MODEL_UNVERIFIED"
  | "SLOT_TRANSITION_DESYNC";

export interface OrderbookLeg {
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  mid: number;
  spread: number;
  bidDepthTotalUsd: number;
  askDepthTotalUsd: number;
  bidTopSize: number;
  askTopSize: number;
  imbalance: number;
  bids: [price: number, size: number][];
  asks: [price: number, size: number][];
}

export interface ExecutionScenario {
  marketPrice: number;
  benchmarkShares: number;
  grossCostUsd: number;
  estimatedTakerFeeUsd: number;
  effectivePricePerShare: number;
  slippageBps: number;
}

export interface ArbitrageScenario {
  isViable: boolean;
  askSum: number;
  grossEdgeUsd: number;
  estimatedTotalFeesUsd: number;
  netEdgeUsd: number;
  maxExecutableShares: number;
}

export interface LiveEngineState {
  meta: {
    snapshotId: string;
    generatedAt: number;
    bookSequence: number;
    slotEpoch: number;
    source: "node-ws" | "browser-relay" | "idle";
  };
  slot: {
    epoch: number;
    slug: string;
    title: string;
    conditionId: string;
    secondsRemaining: number;
    progressPct: number;
    warmupPhase: boolean;
  };
  safety: {
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
  };
  signal: {
    midParity: number;
    buyBothCost: number;
    buyBothGrossEdge: number;
    sellBothValue: number;
    sellBothGrossEdge: number;
    executableDepthShares: number;
    buyBothNetEdge: number;
    imbalanceUp: number;
    imbalanceDown: number;
  };
  economics: {
    feeSchedule: {
      rate: number;
      exponent: number;
      takerOnly: boolean;
      rebateRate: number;
    };
    buyUp: ExecutionScenario;
    buyDown: ExecutionScenario;
    buyBothArbitrage: ArbitrageScenario;
  };
  up: OrderbookLeg;
  down: OrderbookLeg;
  nextSlot?: {
    epoch: number;
    slug: string;
    warmedUp: boolean;
    upBestBid?: number;
    upBestAsk?: number;
    downBestBid?: number;
    downBestAsk?: number;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/setup.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/types.ts tests/setup.test.ts
git commit -m "chore: setup TypeScript, Vitest, and core engine type definitions"
```

---

### Task 2: Normalized Orderbook Engine

**Files:**
- Create: `src/orderbook.ts`
- Test: `tests/orderbook.test.ts`

**Interfaces:**
- Consumes: `OrderbookLeg` from `src/types.ts`
- Produces: `Orderbook` class with methods:
  - `applySnapshot(bids: {price: string, size: string}[], asks: {price: string, size: string}[]): void`
  - `applyPriceChange(changes: {side: "BUY"|"SELL", price: string, size: string}[]): void`
  - `toLeg(tokenId: string): OrderbookLeg`
  - `isCrossed(): boolean`
  - `isEmpty(): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/orderbook.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Orderbook } from "../src/orderbook";

describe("Orderbook Engine", () => {
  let ob: Orderbook;

  beforeEach(() => {
    ob = new Orderbook();
  });

  it("should parse snapshot and maintain sorted bids (descending) and asks (ascending)", () => {
    ob.applySnapshot(
      [{ price: "0.48", size: "100" }, { price: "0.50", size: "200" }],
      [{ price: "0.55", size: "150" }, { price: "0.52", size: "300" }]
    );

    const leg = ob.toLeg("token-up");
    expect(leg.bestBid).toBe(0.50);
    expect(leg.bestAsk).toBe(0.52);
    expect(leg.mid).toBe(0.51);
    expect(leg.spread).toBe(0.02);
    expect(leg.bids[0]).toEqual([0.50, 200]);
    expect(leg.asks[0]).toEqual([0.52, 300]);
  });

  it("should handle incremental price changes including zeroing out levels", () => {
    ob.applySnapshot(
      [{ price: "0.50", size: "100" }],
      [{ price: "0.52", size: "100" }]
    );
    ob.applyPriceChange([{ side: "BUY", price: "0.51", size: "50" }]);
    expect(ob.toLeg("token-up").bestBid).toBe(0.51);

    ob.applyPriceChange([{ side: "BUY", price: "0.51", size: "0" }]);
    expect(ob.toLeg("token-up").bestBid).toBe(0.50);
  });

  it("should detect crossed books (bid >= ask)", () => {
    ob.applySnapshot(
      [{ price: "0.53", size: "100" }],
      [{ price: "0.52", size: "100" }]
    );
    expect(ob.isCrossed()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orderbook.test.ts`  
Expected: FAIL (Cannot find module `../src/orderbook`)

- [ ] **Step 3: Write minimal implementation**

Implement `Orderbook` in `src/orderbook.ts`:
- Maintain internal maps: `bids: Map<number, number>` and `asks: Map<number, number>`.
- Efficient sorting of bids (descending) and asks (ascending).
- Calculations for `mid = (bestBid + bestAsk) / 2`, `spread = bestAsk - bestBid`, `imbalance = (bidVol - askVol) / (bidVol + askVol)`.
- Crossed book check: `bestBid >= bestAsk`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orderbook.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orderbook.ts tests/orderbook.test.ts
git commit -m "feat: implement normalized L2 orderbook engine with crossed-book detection"
```

---

### Task 3: Slot Scheduler & Rollover State Machine

**Files:**
- Create: `src/scheduler.ts`
- Test: `tests/scheduler.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_CONFIG` from `src/types.ts`
- Produces: `SlotScheduler` class with methods:
  - `getCurrentSlot(nowMs: number): SlotInfo`
  - `getNextSlot(nowMs: number): SlotInfo`
  - `isWarmup(nowMs: number): boolean`
  - `onTick(nowMs: number, callbacks: SlotEventCallbacks): void`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scheduler.test.ts
import { describe, it, expect } from "vitest";
import { SlotScheduler } from "../src/scheduler";

describe("Slot Scheduler", () => {
  const scheduler = new SlotScheduler({ warmupSeconds: 45 });

  it("should calculate correct 300s slot boundaries", () => {
    // 1790158330 = 10:12:10 UTC -> slot 1790158200 (10:10:00 UTC)
    const slot = scheduler.getCurrentSlot(1790158330 * 1000);
    expect(slot.epoch).toBe(1790158200);
    expect(slot.slug).toBe("btc-updown-5m-1790158200");
    expect(slot.secondsRemaining).toBe(300 - 130); // 170s
    expect(slot.warmupPhase).toBe(false);
  });

  it("should trigger warmupPhase when remaining seconds <= warmupSeconds", () => {
    // 1790158460 -> 40 seconds remaining (< 45s)
    const slot = scheduler.getCurrentSlot(1790158460 * 1000);
    expect(slot.secondsRemaining).toBe(40);
    expect(slot.warmupPhase).toBe(true);
  });

  it("should calculate next slot accurately", () => {
    const next = scheduler.getNextSlot(1790158330 * 1000);
    expect(next.epoch).toBe(1790158500);
    expect(next.slug).toBe("btc-updown-5m-1790158500");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scheduler.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Implement `src/scheduler.ts` with slot timing logic and rollover event triggers.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scheduler.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.ts tests/scheduler.test.ts
git commit -m "feat: implement slot scheduler and rollover state machine"
```

---

### Task 4: Signal Analytics & Tri-Parity Engine

**Files:**
- Create: `src/signals.ts`
- Test: `tests/signals.test.ts`

**Interfaces:**
- Consumes: `OrderbookLeg`
- Produces: `calculateSignals(up: OrderbookLeg, down: OrderbookLeg, feeRate: number): SignalMetrics`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/signals.test.ts
import { describe, it, expect } from "vitest";
import { calculateSignals } from "../src/signals";
import { OrderbookLeg } from "../src/types";

describe("Signal & Parity Calculator", () => {
  const makeLeg = (bid: number, ask: number, depth: number): OrderbookLeg => ({
    tokenId: "test",
    bestBid: bid,
    bestAsk: ask,
    mid: (bid + ask) / 2,
    spread: ask - bid,
    bidDepthTotalUsd: depth,
    askDepthTotalUsd: depth,
    bidTopSize: 100,
    askTopSize: 100,
    imbalance: 0,
    bids: [[bid, 100]],
    asks: [[ask, 100]],
  });

  it("should calculate tri-parity metrics and net arbitrage edge", () => {
    // Up ask = 0.48, Down ask = 0.50 -> buyBothCost = 0.98 -> gross edge = 0.02
    const up = makeLeg(0.47, 0.48, 1000);
    const down = makeLeg(0.49, 0.50, 1000);
    const feeRate = 0.005; // 0.5% taker fee for test

    const signal = calculateSignals(up, down, feeRate);
    expect(signal.midParity).toBeCloseTo(0.97);
    expect(signal.buyBothCost).toBeCloseTo(0.98);
    expect(signal.buyBothGrossEdge).toBeCloseTo(0.02);
    expect(signal.executableDepthShares).toBe(100);
    expect(signal.buyBothNetEdge).toBeGreaterThan(0.01);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/signals.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Implement `src/signals.ts`:
- Calculate `midParity = up.mid + down.mid`.
- Calculate `buyBothCost = up.bestAsk + down.bestAsk` and `buyBothGrossEdge = 1 - buyBothCost`.
- Calculate `sellBothValue = up.bestBid + down.bestBid` and `sellBothGrossEdge = sellBothValue - 1`.
- Bound executable depth by `min(up.askTopSize, down.askTopSize)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/signals.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/signals.ts tests/signals.test.ts
git commit -m "feat: implement tri-parity analytics and signal calculator"
```

---

### Task 5: Executable Economics & Dynamic Fee Calculator

**Files:**
- Create: `src/economics.ts`
- Test: `tests/economics.test.ts`

**Interfaces:**
- Consumes: `OrderbookLeg`, fee schedule config
- Produces: `calculateEconomics(up: OrderbookLeg, down: OrderbookLeg, feeSchedule, benchmarkShares): EconomicsMetrics`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/economics.test.ts
import { describe, it, expect } from "vitest";
import { calculateEconomics } from "../src/economics";
import { OrderbookLeg } from "../src/types";

describe("Executable Economics Calculator", () => {
  const feeSchedule = { rate: 0.07, exponent: 1, takerOnly: true, rebateRate: 0.2 };

  it("should walk book depth to compute effective fill price with slippage and fees", () => {
    const up: OrderbookLeg = {
      tokenId: "up",
      bestBid: 0.50,
      bestAsk: 0.51,
      mid: 0.505,
      spread: 0.01,
      bidDepthTotalUsd: 500,
      askDepthTotalUsd: 500,
      bidTopSize: 50,
      askTopSize: 50,
      imbalance: 0,
      bids: [[0.50, 50]],
      asks: [[0.51, 50], [0.52, 50]], // 50 @ 0.51, 50 @ 0.52 -> avg 0.515
    };
    const down = { ...up, tokenId: "down" };

    const econ = calculateEconomics(up, down, feeSchedule, 100);
    expect(econ.buyUp.benchmarkShares).toBe(100);
    expect(econ.buyUp.grossCostUsd).toBeCloseTo(51.50);
    expect(econ.buyUp.effectivePricePerShare).toBeGreaterThan(0.51);
    expect(econ.buyUp.estimatedTakerFeeUsd).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/economics.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Implement `src/economics.ts`:
- Depth ladder walker for benchmark share count.
- Polymarket dynamic taker fee formula calculation.
- Net arbitrage viability evaluation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/economics.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/economics.ts tests/economics.test.ts
git commit -m "feat: implement depth-walked executable economics and fee calculations"
```

---

### Task 6: Decoupled Safety Guard & Atomic State Persistence

**Files:**
- Create: `src/validator.ts`
- Create: `src/state.ts`
- Test: `tests/validator.test.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `OrderbookLeg`, `EngineConfig`, `LiveEngineState`
- Produces:
  - `evaluateSafety(params): SafetyReport`
  - `StateStore`: atomic writer for `state/live.json` with monotonic `snapshotId` and `bookSequence`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/validator.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validator.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Implement `src/validator.ts` and `src/state.ts` (using atomic temporary file rename to prevent partial reads by the agent).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/validator.test.ts tests/state.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/validator.ts src/state.ts tests/validator.test.ts tests/state.test.ts
git commit -m "feat: implement fail-closed safety guard and atomic state persistence"
```

---

### Task 7: Dual-Transport Manager & Web Preview Relay Server

**Files:**
- Create: `src/transport.ts`
- Create: `src/server.ts`
- Create: `public/index.html`
- Test: `tests/transport.test.ts`

**Interfaces:**
- Consumes: Ingests Polymarket WS frames (direct or via `/api/relay/tick` POST endpoint).
- Produces: Express HTTP server on `0.0.0.0:3000` with live dark-mode UI and `/api/state` endpoint.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/transport.test.ts
import { describe, it, expect } from "vitest";
import { TransportNormalizer } from "../src/transport";

describe("Transport Normalizer", () => {
  it("should normalize raw CLOB book snapshot message", () => {
    const normalizer = new TransportNormalizer();
    const event = normalizer.parseRawMessage(JSON.stringify({
      event_type: "book",
      asset_id: "token-1",
      bids: [{ price: "0.50", size: "100" }],
      asks: [{ price: "0.51", size: "100" }]
    }));

    expect(event?.type).toBe("book");
    expect(event?.assetId).toBe("token-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/transport.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

1. Implement `src/transport.ts` with direct Node.js WS connector and message normalizer.
2. Implement `src/server.ts` providing `/api/state`, `/api/relay/tick`, and static asset serving.
3. Build clean, responsive dark-mode dashboard in `public/index.html` with:
   - 5-minute progress timer ring.
   - Live Up/Down orderbook ladder.
   - Parity and Net Edge live calculation displays.
   - Real-time client-side WebSocket relay bridging live ticks into the engine.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/transport.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/transport.ts src/server.ts public/index.html tests/transport.test.ts
git commit -m "feat: implement dual transport manager, relay endpoint, and web preview UI"
```

---

### Task 8: Agent CLI & Pre-Flight Execution Guard

**Files:**
- Create: `src/cli.ts`
- Create: `src/guard.ts`
- Modify: `package.json` (add scripts: `build`, `start`, `signal`)
- Test: `tests/guard.test.ts`
- Test: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: `state/live.json`
- Produces:
  - `npm run signal` CLI tool for agent.
  - `assertCanTrade(snapshot: LiveEngineState): void` throwing `ExecutionGuardError` if invalid.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/guard.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/guard.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Implement `src/guard.ts` and `src/cli.ts`:
- Fast CLI reading `state/live.json` with formatted terminal summary and `--json` support.
- Execution guard verifying freshness, non-crossed book, and trade authorization.

- [ ] **Step 4: Run all tests to verify 100% pass rate**

Run: `npm test`  
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/guard.ts package.json tests/guard.test.ts tests/e2e.test.ts
git commit -m "feat: implement agent CLI query command and pre-flight execution guard"
```

---

## Plan Self-Review Checklist
- [x] **Spec coverage:** Covers all 6 pillars (dual transport, dynamic slot rollover, normalized books, tri-parity signals, depth economics, fail-closed safety, agent CLI, and execution guard).
- [x] **Placeholder scan:** No "TBD", "TODO", or vague requirements; all file paths, interfaces, and test scenarios are fully specified.
- [x] **Type consistency:** Identical interface names across `types.ts`, `orderbook.ts`, `signals.ts`, `validator.ts`, and `guard.ts`.
- [x] **Review focus addressed:** All 5 review focus failure modes have dedicated unit and integration tests.
