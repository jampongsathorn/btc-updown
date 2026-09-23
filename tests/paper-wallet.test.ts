import { describe, it, expect, beforeEach } from "vitest";
import { PaperWallet } from "../src/paper-wallet";

describe("Paper Trading Simulation Wallet", () => {
  let wallet: PaperWallet;

  beforeEach(() => {
    wallet = new PaperWallet({ initialUsd: 1000 });
  });

  it("should initialize with initial balance and zero trades", () => {
    const stats = wallet.getStats();
    expect(stats.balanceUsd).toBe(1000);
    expect(stats.totalTrades).toBe(0);
    expect(stats.realizedPnlUsd).toBe(0);
  });

  it("should deduct cost on trade and credit $1.00 per share on win", () => {
    // Buy 100 shares of UP at 0.88 with 0.007 fee per share ($88.00 cost + $0.70 fee = $88.70)
    wallet.openPosition({
      slotEpoch: 1790163900,
      side: "UP",
      shares: 100,
      price: 0.88,
      fee: 0.70,
    });

    expect(wallet.getStats().balanceUsd).toBeCloseTo(1000 - 88.70);
    expect(wallet.getStats().activePositions).toHaveLength(1);

    // Slot settles: UP wins!
    // Payout = 100 * $1.00 = $100.00
    // Net profit = $100.00 - $88.70 = +$11.30
    wallet.settleSlot(1790163900, "UP");

    const stats = wallet.getStats();
    expect(stats.balanceUsd).toBeCloseTo(1000 + 11.30);
    expect(stats.realizedPnlUsd).toBeCloseTo(11.30);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(0);
    expect(stats.winRatePct).toBe(100);
  });

  it("should record loss when outcome does not match position", () => {
    wallet.openPosition({
      slotEpoch: 1790163900,
      side: "UP",
      shares: 50,
      price: 0.88,
      fee: 0.35,
    });

    // Slot settles: DOWN wins!
    wallet.settleSlot(1790163900, "DOWN");

    const stats = wallet.getStats();
    expect(stats.losses).toBe(1);
    expect(stats.realizedPnlUsd).toBeCloseTo(-(50 * 0.88 + 0.35));
    expect(stats.winRatePct).toBe(0);
  });
});
