export interface Position {
  id: string;
  slotEpoch: number;
  side: "UP" | "DOWN";
  shares: number;
  price: number;
  fee: number;
  openedAt: number;
}

export interface PaperStats {
  balanceUsd: number;
  initialUsd: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  realizedPnlUsd: number;
  returnPct: number;
  activePositions: Position[];
  tradeHistory: Position[];
}

export class PaperWallet {
  private balanceUsd: number;
  private initialUsd: number;
  private positions: Position[] = [];
  private tradeHistory: Position[] = [];
  private totalTrades = 0;
  private wins = 0;
  private losses = 0;
  private realizedPnlUsd = 0;

  constructor(options?: { initialUsd?: number }) {
    this.initialUsd = options?.initialUsd ?? 1000;
    this.balanceUsd = this.initialUsd;
  }

  public openPosition(params: {
    slotEpoch: number;
    side: "UP" | "DOWN";
    shares: number;
    price: number;
    fee: number;
  }): Position | null {
    const totalCost = params.shares * params.price + params.fee;
    if (totalCost > this.balanceUsd) {
      return null; // insufficient funds
    }

    this.balanceUsd = parseFloat((this.balanceUsd - totalCost).toFixed(4));

    const position: Position = {
      id: `pos-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      slotEpoch: params.slotEpoch,
      side: params.side,
      shares: params.shares,
      price: params.price,
      fee: params.fee,
      openedAt: Date.now(),
    };

    this.positions.push(position);
    this.tradeHistory.push(position);
    this.totalTrades++;
    return position;
  }

  public settleSlot(slotEpoch: number, winningSide: "UP" | "DOWN"): number {
    const active = this.positions.filter((p) => p.slotEpoch === slotEpoch);
    if (active.length === 0) return 0;

    let slotPnl = 0;
    for (const pos of active) {
      const invested = pos.shares * pos.price + pos.fee;
      if (pos.side === winningSide) {
        const payout = pos.shares * 1.0;
        const profit = payout - invested;
        slotPnl += profit;
        this.balanceUsd += payout;
        this.wins++;
      } else {
        slotPnl -= invested;
        this.losses++;
      }
    }

    this.realizedPnlUsd = parseFloat((this.realizedPnlUsd + slotPnl).toFixed(4));
    this.positions = this.positions.filter((p) => p.slotEpoch !== slotEpoch);
    return slotPnl;
  }

  public getStats(): PaperStats {
    const returnPct = parseFloat((((this.balanceUsd - this.initialUsd) / this.initialUsd) * 100).toFixed(2));
    const winRatePct = this.totalTrades > 0 ? parseFloat(((this.wins / (this.wins + this.losses || 1)) * 100).toFixed(1)) : 0;

    return {
      balanceUsd: parseFloat(this.balanceUsd.toFixed(2)),
      initialUsd: this.initialUsd,
      totalTrades: this.totalTrades,
      wins: this.wins,
      losses: this.losses,
      winRatePct,
      realizedPnlUsd: parseFloat(this.realizedPnlUsd.toFixed(2)),
      returnPct,
      activePositions: [...this.positions],
      tradeHistory: [...this.tradeHistory],
    };
  }
}
