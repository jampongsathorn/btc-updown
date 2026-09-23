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
  strategy?: {
    zScore: number;
    trueProbabilityUp: number;
    trueProbabilityDown: number;
    inSniperWindow: boolean;
    expectedValueUp: number;
    expectedValueDown: number;
    netEdgeUpPct: number;
    netEdgeDownPct: number;
    recommendedAction: "BUY_UP" | "BUY_DOWN" | "HOLD_NO_EDGE" | "STOP_LOSS_EXIT";
    reason: string;
    priceToBeat?: number;
    currentSpot?: number;
  };
  paperWallet?: {
    balanceUsd: number;
    initialUsd: number;
    totalTrades: number;
    wins: number;
    losses: number;
    winRatePct: number;
    realizedPnlUsd: number;
    returnPct: number;
    activePositions?: any[];
    tradeHistory?: any[];
  };
}
