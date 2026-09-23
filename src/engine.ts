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
import { RealizedVolatilityEstimator } from "./volatility.js";
import { calculateKellyFraction, calculateOrderSizeShares } from "./kelly.js";
import {
  formatEntryAlert,
  formatStopLossAlert,
  formatSettlementAlert,
  DiscordWebhookPayload
} from "./alerts.js";

export interface EngineOptions {
  config?: EngineConfig;
  stateStore?: StateStore;
  autoConnectNodeWs?: boolean;
  onAlert?: (payload: DiscordWebhookPayload) => void;
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
  private volatilityEstimator = new RealizedVolatilityEstimator();

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
  private onAlert?: (payload: DiscordWebhookPayload) => void;

  constructor(options?: EngineOptions) {
    this.config = options?.config || DEFAULT_CONFIG;
    this.stateStore = options?.stateStore || new StateStore();
    this.scheduler = new SlotScheduler({ warmupSeconds: this.config.WARMUP_SECONDS });
    this.onAlert = options?.onAlert;

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
    this.volatilityEstimator.recordPrice(spot);
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
        const prevActive = this.wallet.getStats().activePositions.find(p => p.slotEpoch === prevEpoch);
        const slotPnl = this.wallet.settleSlot(prevEpoch, winner);

        if (prevActive) {
          const stats = this.wallet.getStats();
          const invested = prevActive.shares * prevActive.price + prevActive.fee;
          const retPct = invested > 0 ? parseFloat(((slotPnl / invested) * 100).toFixed(1)) : 0;
          const alert = formatSettlementAlert({
            slotEpoch: prevEpoch,
            slug: this.currentSlot.slug,
            won: prevActive.side === winner,
            side: winner,
            finalPrice: this.currentSpot,
            strikePrice: this.priceToBeat,
            netPnlUsd: slotPnl,
            returnPct: retPct,
            totalBankrollUsd: stats.balanceUsd,
            winRatePct: stats.winRatePct,
            wins: stats.wins,
            losses: stats.losses,
          });
          this.onAlert?.(alert);
        }

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

    // Evaluate Variance Collapse Quantitative Strategy with Dynamic Realized Volatility
    const effectiveSpot = this.currentSpot || (this.priceToBeat ? this.priceToBeat * (1 + (upLeg.mid - 0.5) * 0.002) : 85000);
    const effectivePriceToBeat = this.priceToBeat || effectiveSpot;
    const dynamicVol = this.volatilityEstimator.getAnnualizedVol();

    const currentActivePos = this.wallet.getStats().activePositions.find(p => p.slotEpoch === this.currentSlot.epoch);

    const strategyResult = evaluateVarianceCollapse({
      currentSpot: effectiveSpot,
      priceToBeat: effectivePriceToBeat,
      secondsRemaining: this.currentSlot.secondsRemaining,
      upAsk: upLeg.bestAsk,
      upBid: upLeg.bestBid,
      downAsk: downLeg.bestAsk,
      downBid: downLeg.bestBid,
      annualizedVol: dynamicVol,
      takerFeeRate: this.feeSchedule.rate,
      currentPosition: currentActivePos ? { side: currentActivePos.side, entryPrice: currentActivePos.price } : undefined,
    });

    // Kelly Criterion Optimal Bet Sizing
    const targetAsk = strategyResult.recommendedAction === "BUY_UP" ? upLeg.bestAsk : downLeg.bestAsk;
    const winProb = strategyResult.recommendedAction === "BUY_UP" ? strategyResult.trueProbabilityUp : strategyResult.trueProbabilityDown;
    const kelly = calculateKellyFraction({
      winProbability: winProb,
      tokenAsk: targetAsk,
      takerFeeRate: this.feeSchedule.rate,
      stopLossPrice: targetAsk * 0.75, // exit early at ~25% loss floor
      fractionMultiplier: 0.25, // Quarter-Kelly
    });
    const orderSize = calculateOrderSizeShares({
      availableBankrollUsd: this.wallet.getStats().balanceUsd,
      tokenAsk: targetAsk,
      fraction: kelly.recommendedFraction > 0 ? kelly.recommendedFraction : 0.05,
      maxSingleTradeUsd: 150,
      minShares: 5,
    });

    strategyResult.realizedVol = dynamicVol;
    strategyResult.kellyFraction = kelly.recommendedFraction;
    strategyResult.recommendedShares = orderSize.shares;

    // Auto Paper Execution: Stop Loss Early Exit or Open Position
    if (strategyResult.recommendedAction === "STOP_LOSS_EXIT" && currentActivePos) {
      const exitBid = currentActivePos.side === "UP" ? upLeg.bestBid : downLeg.bestBid;
      const exitFee = this.feeSchedule.rate * exitBid * (1 - exitBid) * currentActivePos.shares;
      const invested = currentActivePos.shares * currentActivePos.price + currentActivePos.fee;
      const recovered = currentActivePos.shares * exitBid - exitFee;
      const lossCapped = invested - recovered;
      const savedPct = invested > 0 ? (recovered / invested) * 100 : 0;

      this.wallet.closeEarly(this.currentSlot.epoch, exitBid, exitFee, "STOP_LOSS");

      const alert = formatStopLossAlert({
        slotEpoch: this.currentSlot.epoch,
        slug: this.currentSlot.slug,
        side: currentActivePos.side,
        strikePrice: effectivePriceToBeat,
        currentSpot: effectiveSpot,
        entryPrice: currentActivePos.price,
        exitBidPrice: exitBid,
        shares: currentActivePos.shares,
        lossCappedUsd: parseFloat(lossCapped.toFixed(2)),
        capitalPreservedPct: parseFloat(savedPct.toFixed(1)),
        reason: strategyResult.reason,
      });
      this.onAlert?.(alert);
    } else if (strategyResult.recommendedAction !== "HOLD_NO_EDGE" && strategyResult.recommendedAction !== "STOP_LOSS_EXIT" && safety.canTrade) {
      if (!currentActivePos && orderSize.shares > 0) {
        if (strategyResult.recommendedAction === "BUY_UP" && upLeg.bestAsk > 0) {
          const shares = Math.min(orderSize.shares, upLeg.askTopSize || orderSize.shares);
          const fee = this.feeSchedule.rate * upLeg.bestAsk * (1 - upLeg.bestAsk) * shares;
          this.wallet.openPosition({
            slotEpoch: this.currentSlot.epoch,
            side: "UP",
            shares,
            price: upLeg.bestAsk,
            fee,
          });

          const alert = formatEntryAlert({
            slotEpoch: this.currentSlot.epoch,
            slug: this.currentSlot.slug,
            side: "UP",
            strikePrice: effectivePriceToBeat,
            spotPrice: effectiveSpot,
            trueProbability: strategyResult.trueProbabilityUp,
            expectedValueUsd: strategyResult.expectedValueUp,
            netRoiPct: strategyResult.netEdgeUpPct,
            entryPrice: upLeg.bestAsk,
            shares,
            totalCostUsd: parseFloat((shares * upLeg.bestAsk + fee).toFixed(2)),
            realizedVol: dynamicVol,
            secondsRemaining: this.currentSlot.secondsRemaining,
          });
          this.onAlert?.(alert);
        } else if (strategyResult.recommendedAction === "BUY_DOWN" && downLeg.bestAsk > 0) {
          const shares = Math.min(orderSize.shares, downLeg.askTopSize || orderSize.shares);
          const fee = this.feeSchedule.rate * downLeg.bestAsk * (1 - downLeg.bestAsk) * shares;
          this.wallet.openPosition({
            slotEpoch: this.currentSlot.epoch,
            side: "DOWN",
            shares,
            price: downLeg.bestAsk,
            fee,
          });

          const alert = formatEntryAlert({
            slotEpoch: this.currentSlot.epoch,
            slug: this.currentSlot.slug,
            side: "DOWN",
            strikePrice: effectivePriceToBeat,
            spotPrice: effectiveSpot,
            trueProbability: strategyResult.trueProbabilityDown,
            expectedValueUsd: strategyResult.expectedValueDown,
            netRoiPct: strategyResult.netEdgeDownPct,
            entryPrice: downLeg.bestAsk,
            shares,
            totalCostUsd: parseFloat((shares * downLeg.bestAsk + fee).toFixed(2)),
            realizedVol: dynamicVol,
            secondsRemaining: this.currentSlot.secondsRemaining,
          });
          this.onAlert?.(alert);
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
