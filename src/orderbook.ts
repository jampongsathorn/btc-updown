import { OrderbookLeg } from "./types.js";

export interface BookLevel {
  price: string;
  size: string;
}

export interface PriceChange {
  side: "BUY" | "SELL";
  price: string;
  size: string;
}

export class Orderbook {
  private bids: Map<number, number> = new Map();
  private asks: Map<number, number> = new Map();

  public applySnapshot(bids: BookLevel[], asks: BookLevel[]): void {
    this.bids.clear();
    this.asks.clear();

    for (const b of bids) {
      const p = parseFloat(b.price);
      const s = parseFloat(b.size);
      if (s > 0) this.bids.set(p, s);
    }

    for (const a of asks) {
      const p = parseFloat(a.price);
      const s = parseFloat(a.size);
      if (s > 0) this.asks.set(p, s);
    }
  }

  public applyPriceChange(changes: PriceChange[]): void {
    for (const ch of changes) {
      const p = parseFloat(ch.price);
      const s = parseFloat(ch.size);

      if (ch.side === "BUY") {
        if (s <= 0) {
          this.bids.delete(p);
        } else {
          this.bids.set(p, s);
        }
      } else if (ch.side === "SELL") {
        if (s <= 0) {
          this.asks.delete(p);
        } else {
          this.asks.set(p, s);
        }
      }
    }
  }

  public getSortedBids(): [number, number][] {
    return Array.from(this.bids.entries()).sort((a, b) => b[0] - a[0]);
  }

  public getSortedAsks(): [number, number][] {
    return Array.from(this.asks.entries()).sort((a, b) => a[0] - b[0]);
  }

  public isCrossed(): boolean {
    const sortedBids = this.getSortedBids();
    const sortedAsks = this.getSortedAsks();
    if (sortedBids.length === 0 || sortedAsks.length === 0) return false;
    return sortedBids[0][0] >= sortedAsks[0][0];
  }

  public isEmpty(): boolean {
    return this.bids.size === 0 && this.asks.size === 0;
  }

  public toLeg(tokenId: string): OrderbookLeg {
    const sortedBids = this.getSortedBids();
    const sortedAsks = this.getSortedAsks();

    const bestBid = sortedBids.length > 0 ? sortedBids[0][0] : 0;
    const bestAsk = sortedAsks.length > 0 ? sortedAsks[0][0] : 0;
    const bidTopSize = sortedBids.length > 0 ? sortedBids[0][1] : 0;
    const askTopSize = sortedAsks.length > 0 ? sortedAsks[0][1] : 0;

    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : (bestBid || bestAsk);
    const spread = bestBid > 0 && bestAsk > 0 ? parseFloat((bestAsk - bestBid).toFixed(4)) : 0;

    let bidDepthTotalUsd = 0;
    for (const [p, s] of sortedBids) {
      bidDepthTotalUsd += p * s;
    }

    let askDepthTotalUsd = 0;
    for (const [p, s] of sortedAsks) {
      askDepthTotalUsd += p * s;
    }

    const totalVolume = bidTopSize + askTopSize;
    const imbalance = totalVolume > 0 ? parseFloat(((bidTopSize - askTopSize) / totalVolume).toFixed(4)) : 0;

    return {
      tokenId,
      bestBid,
      bestAsk,
      mid: parseFloat(mid.toFixed(4)),
      spread,
      bidDepthTotalUsd: parseFloat(bidDepthTotalUsd.toFixed(2)),
      askDepthTotalUsd: parseFloat(askDepthTotalUsd.toFixed(2)),
      bidTopSize,
      askTopSize,
      imbalance,
      bids: sortedBids,
      asks: sortedAsks,
    };
  }
}
