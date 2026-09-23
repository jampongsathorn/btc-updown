import { DEFAULT_CONFIG, EngineConfig, LiveEngineState } from "./types.js";
import { Orderbook } from "./orderbook.js";
import { SlotScheduler, SlotInfo } from "./scheduler.js";
import { calculateSignals } from "./signals.js";
import { calculateEconomics, FeeSchedule } from "./economics.js";
import { evaluateSafety } from "./validator.js";
import { StateStore } from "./state.js";
import { NodeWsClient, NormalizedEvent } from "./transport.js";
import { evaluateVarianceCollapse, VarianceCollapseResult } from "./strategies/variance-collapse.js";
import { PaperWallet } from "./paper-wallet.js";

export interface EngineOptions {
  config?: EngineConfig;
  stateStore?: StateStore;
  autoConnectNodeWs?: boolean;
}

export class MarketEngine {
  public config: EngineConfig;
  public stateStore: StateStore;
  public scheduler: SlotScheduler;

  // Active current slot
  public currentSlot: SlotInfo;
  public upBook = new Orderbook();
  public downBook = new Orderbook();
  public currentTokens: { up: string; down: string } = { up: "", down: "" };

  // Next slot during warm-up
  public nextSlot: SlotInfo;
  public nextUpBook = new Orderbook();
  public nextDownBook = new Orderbook();
  public nextTokens: { up: string; down: string } = { up: "", down: "" };

  public wallet = new PaperWallet({ initialUsd: 1000 });
  public priceToBeat: number = 0;
  public currentSpot: number = 0;

  private feeSchedule: FeeSchedule = {
    rate: 0.07,
    exponent: 1,
    takerOnly: true,
    rebateRate: 0.2,
  };
  private feeModelVerified: boolean = true;
  private lastTickMs: number = 0;
  private nodeWs: NodeWsClient | null = null;
  private isConnected: boolean = false;
  private transportSource: "node-ws" | "browser-relay" | "idle" = "idle";
  private tickInterval: NodeJS.Timeout | null = null;

  constructor(options?: EngineOptions) {
    this.config = options?.config || DEFAULT_CONFIG;
    this.stateStore = options?.stateStore || new StateStore();
    this.scheduler = new SlotScheduler({ warmupSeconds: this.config.WARMUP_SECONDS });

    this.currentSlot = this.scheduler.getCurrentSlot();
    this.nextSlot = this.scheduler.getNextSlot();

    if (options?.autoConnectNodeWs !== false) {
      this.initNodeWs();
    }
  }

  private initNodeWs(): void {
    this.nodeWs = new NodeWsClient({
      onConnect: () => {
        this.isConnected = true;
        this.transportSource = "node-ws";
      },
      onDisconnect: () => {
        if (this.transportSource === "node-ws") {
          this.isConnected = false;
        }
      },
      onEvent: (event) => {
        this.handleNormalizedEvent(event, "node-ws");
      },
    });

    try {
      this.nodeWs.connect();
    } catch {}
  }

  public setTokenIds(current: { up: string; down: string }, next?: { up: string; down: string }): void {
    this.currentTokens = current;
    if (next) this.nextTokens = next;

    if (this.nodeWs) {
      const allTokens = [current.up, current.down, next?.up, next?.down].filter(Boolean) as string[];
      this.nodeWs.subscribe(allTokens);
    }
    this.updateState();
  }

  public handleNormalizedEvent(event: NormalizedEvent, source: "node-ws" | "browser-relay"): void {
    this.lastTickMs = Date.now();
    this.isConnected = true;
    this.transportSource = source;

    const assetId = event.assetId;

    let targetBook: Orderbook | null = null;
    if (assetId === this.currentTokens.up) targetBook = this.upBook;
    else if (assetId === this.currentTokens.down) targetBook = this.downBook;
    else if (assetId === this.nextTokens.up) targetBook = this.nextUpBook;
    else if (assetId === this.nextTokens.down) targetBook = this.nextDownBook;

    if (!targetBook) {
      // If token not mapped yet, map to up or down based on order of arrival
      if (!this.currentTokens.up) {
        this.currentTokens.up = assetId;
        targetBook = this.upBook;
      } else if (!this.currentTokens.down && assetId !== this.currentTokens.up) {
        this.currentTokens.down = assetId;
        targetBook = this.downBook;
      }
    }

    if (targetBook) {
      if (event.type === "book" && event.bids && event.asks) {
        targetBook.applySnapshot(event.bids, event.asks);
      } else if (event.type === "price_change" && event.priceChanges) {
        targetBook.applyPriceChange(event.priceChanges);
      }
    }

    this.updateState();
  }

  public setSpotPrices(spot: number, priceToBeat: number): void {
    this.currentSpot = spot;
    this.priceToBeat = priceToBeat;
    this.updateState();
  }

  public updateState(): LiveEngineState {
    const now = Date.now();
    this.currentSlot = this.scheduler.getCurrentSlot(now);
    this.nextSlot = this.scheduler.getNextSlot(now);

    this.scheduler.tick(now, {
      onWarmup: (next) => {
        this.nextSlot = next;
      },
      onRollover: (newCurrent) => {
        // Settle previous slot in paper wallet
        const prevEpoch = this.currentSlot.epoch;
        const winner = this.currentSpot >= this.priceToBeat ? "UP" : "DOWN";
        this.wallet.settleSlot(prevEpoch, winner);

        // Promote next to current
        this.currentSlot = newCurrent;
        this.currentTokens = this.nextTokens;
        this.upBook = this.nextUpBook;
        this.downBook = this.nextDownBook;

        // Reset next
        this.nextUpBook = new Orderbook();
        this.nextDownBook = new Orderbook();
        this.nextTokens = { up: "", down: "" };
        this.priceToBeat = 0;
      },
    });

    const upLeg = this.upBook.toLeg(this.currentTokens.up || "UP_TOKEN");
    const downLeg = this.downBook.toLeg(this.currentTokens.down || "DOWN_TOKEN");

    const signals = calculateSignals(upLeg, downLeg, this.feeSchedule.rate);
    const economics = calculateEconomics(upLeg, downLeg, this.feeSchedule, this.config.BENCHMARK_SHARES);

    const safety = evaluateSafety({
      nowMs: now,
      lastTickMs: this.lastTickMs,
      maxBookAgeMs: this.config.MAX_BOOK_AGE_MS,
      connected: this.isConnected,
      upCrossed: this.upBook.isCrossed(),
      downCrossed: this.downBook.isCrossed(),
      upEmpty: this.upBook.isEmpty(),
      downEmpty: this.downBook.isEmpty(),
      feeModelVerified: this.feeModelVerified,
    });

    // Evaluate Variance Collapse Quantitative Strategy
    const effectiveSpot = this.currentSpot || (this.priceToBeat ? this.priceToBeat * (1 + (upLeg.mid - 0.5) * 0.002) : 85000);
    const effectivePriceToBeat = this.priceToBeat || effectiveSpot;

    const strategyResult = evaluateVarianceCollapse({
      currentSpot: effectiveSpot,
      priceToBeat: effectivePriceToBeat,
      secondsRemaining: this.currentSlot.secondsRemaining,
      upAsk: upLeg.bestAsk,
      upBid: upLeg.bestBid,
      downAsk: downLeg.bestAsk,
      downBid: downLeg.bestBid,
      takerFeeRate: this.feeSchedule.rate,
    });

    // Auto Paper Execution when EV > threshold and in sniper window
    if (strategyResult.recommendedAction !== "HOLD_NO_EDGE" && safety.canTrade) {
      const activeForSlot = this.wallet.getStats().activePositions.some(p => p.slotEpoch === this.currentSlot.epoch);
      if (!activeForSlot) {
        if (strategyResult.recommendedAction === "BUY_UP" && upLeg.bestAsk > 0) {
          const shares = Math.min(50, upLeg.askTopSize || 50);
          const fee = this.feeSchedule.rate * upLeg.bestAsk * (1 - upLeg.bestAsk) * shares;
          this.wallet.openPosition({
            slotEpoch: this.currentSlot.epoch,
            side: "UP",
            shares,
            price: upLeg.bestAsk,
            fee,
          });
        } else if (strategyResult.recommendedAction === "BUY_DOWN" && downLeg.bestAsk > 0) {
          const shares = Math.min(50, downLeg.askTopSize || 50);
          const fee = this.feeSchedule.rate * downLeg.bestAsk * (1 - downLeg.bestAsk) * shares;
          this.wallet.openPosition({
            slotEpoch: this.currentSlot.epoch,
            side: "DOWN",
            shares,
            price: downLeg.bestAsk,
            fee,
          });
        }
      }
    }

    const liveState: LiveEngineState = {
      meta: {
        snapshotId: "",
        generatedAt: now,
        bookSequence: 0,
        slotEpoch: this.currentSlot.epoch,
        source: this.transportSource,
      },
      slot: {
        epoch: this.currentSlot.epoch,
        slug: this.currentSlot.slug,
        title: this.currentSlot.title,
        conditionId: `cond-${this.currentSlot.epoch}`,
        secondsRemaining: this.currentSlot.secondsRemaining,
        progressPct: this.currentSlot.progressPct,
        warmupPhase: this.currentSlot.warmupPhase,
      },
      safety,
      signal: signals,
      economics,
      up: upLeg,
      down: downLeg,
      nextSlot: {
        epoch: this.nextSlot.epoch,
        slug: this.nextSlot.slug,
        warmedUp: !this.nextUpBook.isEmpty() && !this.nextDownBook.isEmpty(),
      },
      strategy: {
        ...strategyResult,
        priceToBeat: this.priceToBeat,
        currentSpot: this.currentSpot,
      },
      paperWallet: this.wallet.getStats(),
    };

    this.stateStore.writeState(liveState);
    return liveState;
  }

  public start(intervalMs: number = 250): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      this.updateState();
    }, intervalMs);
  }

  public stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.nodeWs) this.nodeWs.close();
  }
}
