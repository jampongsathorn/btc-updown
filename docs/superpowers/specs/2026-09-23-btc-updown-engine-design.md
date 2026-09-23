# Specification: Auto-Rolling Market Engine & Real-Time Signal System for Polymarket 5m BTC Up/Down

**Date:** 2026-09-23  
**Status:** Approved for Implementation (v1.1 Refined)  
**Target:** Polymarket 5-minute recurring BTC Up/Down series (`btc-up-or-down-5m`)

---

## 1. Overview & Objectives

The goal is to provide an ultra-reliable, real-time market data and signal engine for autonomous trading agents operating on Polymarket's recurring 5-minute Bitcoin Up/Down markets (`btc-updown-5m-<EPOCH>`). 

The engine solves four core challenges:
1. **Dynamic Slot Rollover:** Automatically discover, pre-warm, and transition between 5-minute market contracts with zero dropped ticks.
2. **Dual-Environment Transport:** Function identically in sandbox environments (via Browser WebSocket Relay) and production/local machines (via direct Node.js WebSocket).
3. **Executable Economics (Fees & Depth Slippage):** Compute net-of-fee, depth-weighted execution prices rather than naive mid/spread indicators.
4. **Explicit Decoupling of Signals vs. Trade Permission (Fail-Closed Safety):** Cleanly separate opportunity detection (`signal`) from execution authorization (`safety` / `permissionToTrade`) so debugging and risk management are transparent.

---

## 2. Refined Layered Architecture

```
Transport (Node WS / Browser Relay)
   ↓
Normalized Orderbooks (L2 Bids/Asks)
   ↓
Current + Next Slot Manager (Dual-Slot Handover, WARMUP_SECONDS)
   ↓
Market / Fee Validation (Authoritative Gamma Fee Parsing)
   ↓
Executable Economics (Depth-walked slippage, Net Edge)
   ↓
Signal Analytics (Tri-Parity, Imbalance, Micro-Price)
   ↓
Safety Guard (Fail-closed check, MAX_BOOK_AGE_MS)
   ↓
Atomic Snapshot (`state/live.json` with snapshotId, bookSequence)
   ↓
Agent Decision Loop
   ↓
Execution Guard (Pre-flight invariant check immediately prior to order submission)
   ↓
Order Execution (ClobClient EIP-712 / L2 HMAC)
```

---

## 3. Data Models & Schemas

### 3.1 Live Signal State Schema (`state/live.json`)

```typescript
export interface LiveEngineState {
  meta: {
    snapshotId: string;               // Monotonic UUID / counter per write
    generatedAt: number;              // Unix epoch ms
    bookSequence: number;             // Total ticks processed
    slotEpoch: number;                // Primary slot start epoch seconds (e.g. 1790158800)
    source: "node-ws" | "browser-relay" | "idle";
  };
  slot: {
    epoch: number;
    slug: string;                     // btc-updown-5m-1790158800
    title: string;
    conditionId: string;
    secondsRemaining: number;
    progressPct: number;
    warmupPhase: boolean;             // True if within WARMUP_SECONDS of boundary
  };
  safety: {
    failClosed: boolean;              // True if any safety rule triggers NO_TRADE
    canTrade: boolean;                // Explicit permission: true only when failClosed === false
    reasons: SafetyViolationReason[]; // Detailed violation codes for clean debugging
    bookAgeMs: number;
    maxBookAgeMsConfig: number;       // Configured threshold (e.g., 2500ms)
    connected: boolean;
    crossedBook: boolean;
    stale: boolean;
    currentReady: boolean;
    nextReady: boolean;
    feeModelVerified: boolean;
  };
  signal: {
    midParity: number;                // up.mid + down.mid
    buyBothCost: number;              // up.bestAsk + down.bestAsk
    buyBothGrossEdge: number;         // 1 - buyBothCost
    sellBothValue: number;            // up.bestBid + down.bestBid
    sellBothGrossEdge: number;        // sellBothValue - 1
    executableDepthShares: number;    // min(up.askDepthShares, down.askDepthShares)
    buyBothNetEdge: number;           // grossEdge - totalTakerFees
    imbalanceUp: number;              // (bidVol - askVol) / (bidVol + askVol)
    imbalanceDown: number;
  };
  economics: {
    feeSchedule: {
      rate: number;                   // Dynamically fetched from Gamma (e.g., 0.07)
      exponent: number;
      takerOnly: boolean;
      rebateRate: number;             // e.g., 0.20 maker rebate
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
```

---

## 4. Key Subsystems & Specifications

### 4.1 Configurable Parameters
All thresholds are runtime-configurable (via environment variables or config object) rather than hardcoded:
- `WARMUP_SECONDS` (Default: `45`): Pre-discovery and dual-subscription window before slot boundary.
- `MAX_BOOK_AGE_MS` (Default: `2500`): Maximum milliseconds since last tick before the book is classified as stale.
- `BENCHMARK_SHARES` (Default: `100`): Reference size used for depth-walked slippage and fee calculations.
- `PORT` (Default: `3000`): Web preview and relay server port.

### 4.2 Slot Scheduler & Dual-Slot Manager (`src/scheduler.ts`)
- **Formula:** `slotEpoch = Math.floor(now / 300) * 300`.
- **Rollover Lifecycle:**
  1. **Active Phase ($300\text{s} \dots \text{WARMUP\_SECONDS}$ remaining):** Engine tracks active `current` market.
  2. **Warmup Phase ($\text{WARMUP\_SECONDS} \dots 0\text{s}$ remaining):**
     - Queries Gamma API for `slotEpoch + 300` metadata (`conditionId`, `clobTokenIds`, `feeSchedule`).
     - Issues dynamic WebSocket `subscribe` for the next Up and Down tokens.
     - Maintains dual in-memory orderbooks (`current` and `next`).
  3. **Boundary Execution ($T = 0$):**
     - Atomically promotes `next` $\rightarrow$ `current`.
     - Issues WebSocket `unsubscribe` for expired slot tokens.
     - Resets state sequence and updates primary `slotEpoch`.

### 4.3 Orderbook Normalizer & Transport Layer (`src/orderbook.ts`, `src/relay.ts`)
- **Single Source of Truth:** Direct Node.js WebSocket and Browser Relay pass raw frames to the same backend normalizer.
- **L2 Book Maintenance:** Full snapshot handling (`book`), delta updates (`price_change`), and top-of-book updates (`best_bid_ask`).
- **Heartbeat Daemon:** Sends `"PING"` every 10s; marks disconnected and triggers reconnect if no pong within 15s.

### 4.4 Decoupled Safety Guard & Pre-Flight Execution Guard (`src/validator.ts`)
- **Fail-Closed Rule:** Safety guard evaluates:
  1. `now - generatedAt > MAX_BOOK_AGE_MS` $\rightarrow$ `BOOK_STALE`
  2. `bestBid >= bestAsk` on either leg $\rightarrow$ `CROSSED_BOOK`
  3. `!connected` $\rightarrow$ `FEED_DISCONNECTED`
  4. Empty bids or asks on either leg $\rightarrow$ `INCOMPLETE_LEGS`
  5. Missing fee schedule from Gamma $\rightarrow$ `FEE_MODEL_UNVERIFIED`
- If any reason triggers:
  - `safety.failClosed = true`
  - `safety.canTrade = false`
- **Execution Guard:** Autonomous trading modules must call `assertCanTrade(snapshot)` immediately before submitting an order to confirm the book hasn't shifted or expired during deliberation.

### 4.5 Executable Economics Calculator (`src/economics.ts`)
- Dynamically parses the authoritative fee schedule from Gamma API.
- Walks the orderbook depth ladder for realistic average execution prices (slippage + fee).
- Computes `buyBothNetEdge`: Gross edge minus dynamic taker fees for both legs.

---

## 5. Performance Targets & User Interfaces

- **Performance Target:** Local cache read p95 < 2ms (correctness and freshness prioritized over pure micro-benchmark speed).
- **Agent CLI (`npm run signal`):** Outputs structured JSON or formatted terminal table with clear `[CAN_TRADE: true]` or `[CAN_TRADE: false (REASONS)]`.
- **Web Preview Dashboard (`http://0.0.0.0:3000`):**
  - Dark-mode terminal styling.
  - Visual 5-minute countdown ring with warmup indicator.
  - Live L2 depth bars for Up and Down legs.
  - Real-time economics, arbitrage edges, and safety status display.
