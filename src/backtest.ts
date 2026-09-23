import { evaluateVarianceCollapse } from "./strategies/variance-collapse.js";

export interface HistoricalTick {
  secondsRemaining: number;
  spot: number;
  upAsk: number;
  upBid: number;
  downAsk: number;
  downBid: number;
}

export interface HistoricalRound {
  slug: string;
  startPrice: number;
  endPrice: number;
  actualOutcome: "UP" | "DOWN";
  ticks: HistoricalTick[];
}

export interface BacktestOptions {
  rounds: HistoricalRound[];
  initialCapitalUsd?: number;
  fixedTradeUsd?: number;
  minEvThreshold?: number;
  jumpSafetyBufferUsd?: number;
  takerFeeRate?: number;
}

export interface BacktestSummary {
  totalRounds: number;
  tradedRounds: number;
  skippedRounds: number;
  wins: number;
  losses: number;
  stoppedOut: number;
  winRatePct: number;
  realizedPnlUsd: number;
  returnPct: number;
  profitFactor: number;
  maxDrawdownPct: number;
}

export function runHistoricalBacktest(options: BacktestOptions): BacktestSummary {
  const {
    rounds,
    initialCapitalUsd = 1000,
    fixedTradeUsd = 100,
    minEvThreshold = 0.03,
    jumpSafetyBufferUsd = 35.0,
    takerFeeRate = 0.07,
  } = options;

  let balance = initialCapitalUsd;
  let peak = initialCapitalUsd;
  let maxDrawdown = 0;

  let wins = 0;
  let losses = 0;
  let stoppedOut = 0;
  let grossWins = 0;
  let grossLosses = 0;

  let tradedRounds = 0;
  let skippedRounds = 0;

  for (const round of rounds) {
    let positionOpened = false;
    let chosenSide: "UP" | "DOWN" | null = null;
    let entryPrice = 0;
    let shares = 0;
    let costBasis = 0;

    // Scan through ticks to see if sniper strategy enters
    for (let i = 0; i < round.ticks.length; i++) {
      const tick = round.ticks[i];

      if (!positionOpened) {
        const signal = evaluateVarianceCollapse({
          currentSpot: tick.spot,
          priceToBeat: round.startPrice,
          secondsRemaining: tick.secondsRemaining,
          upAsk: tick.upAsk,
          upBid: tick.upBid,
          downAsk: tick.downAsk,
          downBid: tick.downBid,
          minEvThreshold,
          jumpSafetyBufferUsd,
          takerFeeRate,
        });

        if (signal.recommendedAction === "BUY_UP" || signal.recommendedAction === "BUY_DOWN") {
          positionOpened = true;
          tradedRounds++;
          chosenSide = signal.recommendedAction === "BUY_UP" ? "UP" : "DOWN";
          entryPrice = chosenSide === "UP" ? tick.upAsk : tick.downAsk;
          shares = fixedTradeUsd / entryPrice;
          const fee = takerFeeRate * entryPrice * (1 - entryPrice) * shares;
          costBasis = fixedTradeUsd + fee;
        }
      } else {
        // Position is open: check subsequent ticks for dynamic stop-loss
        const stopCheck = evaluateVarianceCollapse({
          currentSpot: tick.spot,
          priceToBeat: round.startPrice,
          secondsRemaining: tick.secondsRemaining,
          upAsk: tick.upAsk,
          upBid: tick.upBid,
          downAsk: tick.downAsk,
          downBid: tick.downBid,
          currentPosition: { side: chosenSide!, entryPrice },
        });

        if (stopCheck.recommendedAction === "STOP_LOSS_EXIT") {
          // Liquidate early on available bid
          stoppedOut++;
          const exitBid = chosenSide === "UP" ? tick.upBid : tick.downBid;
          const exitFee = takerFeeRate * exitBid * (1 - exitBid) * shares;
          const recovered = shares * exitBid - exitFee;
          const netLoss = costBasis - recovered;

          balance -= netLoss;
          grossLosses += netLoss;
          losses++;
          positionOpened = false;
          chosenSide = null;
          break;
        }
      }
    }

    if (!positionOpened && !chosenSide) {
      if (round.ticks.length > 0 && tradedRounds === 0) {
        skippedRounds++;
      } else if (costBasis === 0) {
        skippedRounds++;
      }
    } else if (positionOpened && chosenSide) {
      // Held to expiration: settle based on actualOutcome
      const won = chosenSide === round.actualOutcome;
      if (won) {
        const payout = shares * 1.0;
        const profit = payout - costBasis;
        balance += profit;
        grossWins += profit;
        wins++;
      } else {
        balance -= costBasis;
        grossLosses += costBasis;
        losses++;
      }
    }

    if (balance > peak) peak = balance;
    const dd = (peak - balance) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const realizedPnlUsd = parseFloat((balance - initialCapitalUsd).toFixed(2));
  const returnPct = parseFloat(((realizedPnlUsd / initialCapitalUsd) * 100).toFixed(2));
  const winRatePct = (wins + losses) > 0 ? parseFloat(((wins / (wins + losses)) * 100).toFixed(1)) : 0;
  const profitFactor = grossLosses > 0 ? parseFloat((grossWins / grossLosses).toFixed(2)) : (wins > 0 ? 99.0 : 0);

  return {
    totalRounds: rounds.length,
    tradedRounds,
    skippedRounds,
    wins,
    losses,
    stoppedOut,
    winRatePct,
    realizedPnlUsd,
    returnPct,
    profitFactor,
    maxDrawdownPct: parseFloat((maxDrawdown * 100).toFixed(1)),
  };
}
