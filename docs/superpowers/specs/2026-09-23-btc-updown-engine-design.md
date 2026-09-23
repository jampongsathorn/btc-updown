# Specification: Auto-Rolling Market Engine & Real-Time Signal System for Polymarket 5m BTC Up/Down

**Date:** 2026-09-23  
**Status:** Approved for Implementation  
**Target:** Polymarket 5-minute recurring BTC Up/Down series (`btc-up-or-down-5m`)

---

## 1. Overview & Objectives

The goal is to provide an ultra-reliable, real-time market data and signal engine for autonomous trading agents operating on Polymarket's recurring 5-minute Bitcoin Up/Down markets (`btc-updown-5m-<EPOCH>`). 

The engine must solve four core challenges:
1. **Dynamic Slot Rollover:** Automatically discover, pre-warm, and transition between 5-minute market contracts with zero dropped ticks.
2. **Dual-Environment Transport:** Function identically in sandbox environments (via Browser WebSocket Relay) and production/local machines (via direct Node.js WebSocket).
3. **Executable Economics (Fees & Depth Slippage):** Compute net-of-fee, depth-weighted execution prices rather than naive mid/spread indicators.
4. **Fail-Closed Safety:** Guard the trading agent with comprehensive health checks (stale book detection, crossed books, disconnected feeds, unverified fee models).

---

## 2. Layered Architecture

```
                               ┌──────────────────────────────────────────────┐
                               │       Polymarket Public Infrastructure       │
                               │  • Gamma API (Market metadata, fees, tokens) │
                               │  • CLOB WebSocket (Live books, price_change) │
                               └──────────────────────┬───────────────────────┘
                                                      │
             ┌────────────────────────────────────────┴────────────────────────────────────────┐
             ▼ (Local / Production)                                                            ▼ (Sandbox Preview)
┌───────────────────────────────┐                                              ┌───────────────────────────────┐
│     Node.js Direct WS         │                                              │      Browser Relay Adapter    │
│  `wss://ws-subscriptions-...` │                                              │  Direct client-side WS in UI  │
│  Automatic 10s PING keepalive │                                              │  Pushes raw events via HTTP   │
└──────────────┬────────────────┘                                              └───────────────┬───────────────┘
               │                                                                               │
               └──────────────────────────────────────┬────────────────────────────────────────┘
                                                      │ Raw Event Stream
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │    1. Transport Normalizer  │
                                       │   Extracts book, tick, diff │
                                       └──────────────┬──────────────┘
                                                      │
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │    2. Orderbook Engine      │
                                       │   Maintains L2 Bids & Asks  │
                                       │   CURRENT slot + NEXT slot  │
                                       └──────────────┬──────────────┘
                                                      │
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │    3. Market Validation     │
                                       │   Crossed book check        │
                                       │   Staleness & heartbeat     │
                                       │   Incomplete legs check     │
                                       └──────────────┬──────────────┘
                                                      │ Validated Books
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │    4. Signals & Parity      │
                                       │   Mid Parity (Up + Down)    │
                                       │   Bid/Ask Depth Imbalance   │
                                       │   Micro-price & Spread      │
                                       └──────────────┬──────────────┘
                                                      │
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │   5. Executable Economics   │
                                       │   Dynamic Gamma fee model   │
                                       │   BuyBoth / SellBoth Edge   │
                                       │   Effective Net Price/Depth │
                                       └──────────────┬──────────────┘
                                                      │
                               ┌──────────────────────┴──────────────────────┐
                               ▼                                             ▼
                ┌─────────────────────────────┐               ┌─────────────────────────────┐
                │       State Publisher       │               │      Live Web Preview       │
                │  Writes `state/live.json`   │               │  `http://0.0.0.0:3000`      │
                │  Atomic file write on tick  │               │  Real-time orderbook, tick  │
                │  Exposes CLI: `npm run ...` │               │  chart, countdown, metrics  │
                └─────────────────────────────┘               └─────────────────────────────┘
```

---

## 3. Data Models & Schemas

### 3.1 Live Signal State Schema (`state/live.json`)

```typescript
export interface LiveEngineState {
  timestamp: number;                  // System epoch ms
  slot: {
    epoch: number;                    // Slot start epoch seconds (e.g. 1790158800)
    slug: string;                     // btc-updown-5m-1790158800
    title: string;
    conditionId: string;
    secondsRemaining: number;
    progressPct: number;
    warmupPhase: boolean;             // True if currently inside WARMUP_SECONDS
  };
  health: {
    connected: boolean;
    source: "node-ws" | "browser-relay" | "idle";
    bookAgeMs: number;
    lastSequence: number;
    currentReady: boolean;
    nextReady: boolean;
    crossedBook: boolean;
    stale: boolean;
    feeModelVerified: boolean;
    failClosed: boolean;              // True if ANY safety rule triggers NO_TRADE
    failClosedReasons: string[];
  };
  up: OrderbookLeg;
  down: OrderbookLeg;
  parity: {
    midParity: number;                // up.mid + down.mid
    buyBothCost: number;              // up.bestAsk + down.bestAsk
    buyBothGrossEdge: number;         // 1 - buyBothCost
    sellBothValue: number;            // up.bestBid + down.bestBid
    sellBothGrossEdge: number;        // sellBothValue - 1
    executableDepthShares: number;    // min(up.askDepthShares, down.askDepthShares)
  };
  economics: {
    feeSchedule: {
      rate: number;                   // e.g. 0.07 from Gamma
      exponent: number;               // e.g. 1
      takerOnly: boolean;
      rebateRate: number;             // e.g. 0.20
    };
    buyUp: ExecutionScenario;
    buyDown: ExecutionScenario;
    buyBothArbitrage: ArbitrageScenario;
  };
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
  imbalance: number;                 // (bidVol - askVol) / (bidVol + askVol)
  bids: [price: number, size: number][];
  asks: [price: number, size: number][];
}

export interface ExecutionScenario {
  marketPrice: number;
  benchmarkShares: number;           // e.g. 100 shares
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

### 4.1 Slot Scheduler & Rollover Engine (`src/scheduler.ts`)
- **Formula:** `slotEpoch = Math.floor(now / 300) * 300`.
- **Configurable Warm-up:** `WARMUP_SECONDS` defaults to `45` (configurable via `process.env.WARMUP_SECONDS`).
- **Rollover Lifecycle:**
  1. **Active Phase ($300\text{s} \dots 45\text{s}$ remaining):** Engine tracks active `current` market.
  2. **Warmup Phase ($45\text{s} \dots 0\text{s}$ remaining):**
     - Queries Gamma API for `slotEpoch + 300` metadata (`conditionId`, `clobTokenIds`, `feeSchedule`).
     - Issues dynamic WebSocket `subscribe` for the next Up and Down tokens.
     - Maintains dual in-memory orderbooks (`current` and `next`).
  3. **Boundary Execution ($T = 0$):**
     - Atomically promotes `next` $\rightarrow$ `current`.
     - Issues WebSocket `unsubscribe` for the expired slot tokens.
     - Schedules the next discovery cycle.

### 4.2 Orderbook & Transport Layer (`src/orderbook.ts`, `src/relay.ts`)
- **Single Source of Truth:** Regardless of whether messages arrive from direct Node WebSocket or Browser Relay, messages are parsed and routed into a unified `Orderbook` class.
- **L2 Book Maintenance:** Handles full snapshots (`book`), incremental price changes (`price_change`), and top-of-book updates (`best_bid_ask`).
- **Heartbeat Daemon:** Sends `"PING"` text frames every 10,000 ms; drops and reconnects if no message or `"PONG"` is received within 15,000 ms.

### 4.3 Validation & Safety Guard ("Fail-Closed") (`src/validator.ts`)
A trade signal is tagged `failClosed = true` (blocking agent trading) if any of the following occur:
1. `stale == true`: The most recent orderbook tick is older than `BOOK_STALENESS_THRESHOLD_MS` (default `2500ms`).
2. `crossedBook == true`: `bestBid >= bestAsk` on either leg.
3. `disconnected == true`: WebSocket transport is disconnected.
4. `incompleteLegs == true`: Either the Up or Down token has an empty orderbook.
5. `feeModelVerified == false`: Gamma fee schedule could not be fetched or verified against the contract rules.

### 4.4 Executable Economics Calculator (`src/economics.ts`)
- Parses authoritative `feeSchedule` from Gamma API:
  - If `feeSchedule.takerOnly` is true, maker limit orders incur 0% taker fee and accrue `rebateRate` (e.g. 20%).
  - Taker fees are calculated based on contract formula `rate * (price * (1 - price))^exponent` or linear rate depending on contract config.
- Computes depth-walked slippage: For a benchmark trade size (e.g. 50, 100 shares), it walks the ask book ladder to return real weighted average fill price + estimated fee.
- Arbitrage net edge: Deducts taker fees from gross parity edge:
  $$\text{Net Edge} = (1.00 - (\text{Ask}_{\text{Up}} + \text{Ask}_{\text{Down}})) - (\text{Fee}_{\text{Up}} + \text{Fee}_{\text{Down}})$$

---

## 5. User & Agent Interfaces

1. **Agent CLI (`npm run signal` / `node dist/cli.js signal`):**
   - Reads `state/live.json` directly from memory/disk in $<2\text{ms}$.
   - Supports `--json` flag for machine consumption and formatted terminal table for human viewing.
   - Prints clear `[TRADE READY]` or `[FAIL CLOSED: <REASONS>]` status.

2. **Web Preview Dashboard (`http://0.0.0.0:3000`):**
   - Clean, dark-mode terminal-aesthetic UI.
   - Visual 5-minute countdown progress ring.
   - Dual orderbook visualizer (Up vs Down with bid/ask depth bars).
   - Real-time tick stream and executable economics summary.
   - Browser relay connection indicator showing active data transport mode.

---

## 6. Implementation Plan & Milestones

1. **Package Setup & Project Structure:** Node.js, TypeScript, Vite/Express backend, ws, fast atomic writer.
2. **Orderbook & Normalizer Engine:** In-memory orderbook data structure, snapshot/delta apply, crossed-book detection.
3. **Gamma & CLOB Client:** Slot resolution, metadata fetcher, dual-mode WebSocket (Node + Browser Relay).
4. **Economics & Signal Calculator:** Tri-parity, depth slippage, fee schedule calculation, fail-closed validator.
5. **CLI & Web Dashboard:** Full UI preview on port 3000 and CLI agent commands.
6. **Integration Verification:** End-to-end tests verifying slot rollovers, book leveling, and signal accuracy.
