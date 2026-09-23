import { ClobClient, Side, Chain, AssetType } from "@polymarket/clob-client";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

/**
 * Real-money order execution against Polymarket's CLOB, using the official
 * @polymarket/clob-client (verified on npm: maintainers are @polymarket.com
 * addresses, repo github.com/Polymarket/clob-client).
 *
 * SAFETY: this module never reads, generates, or stores a private key itself.
 * It only reads PRIVATE_KEY from the process environment at call time, which
 * the OPERATOR must set on their own machine/server. If it is not set,
 * every method here throws immediately instead of silently doing nothing -
 * a missing key must never be mistaken for "trading is just paused".
 *
 * This module is NOT wired into the engine's automatic decision loop by
 * default. It only activates if the operator explicitly sets
 * LIVE_TRADING_ENABLED=true (see engine.ts). Until then, the bot's existing
 * PaperWallet behavior is completely unchanged.
 */

const CLOB_HOST = process.env.CLOB_HOST || "https://clob.polymarket.com";
const CHAIN_ID = Chain.POLYGON;

export interface LiveOrderResult {
  success: boolean;
  orderId?: string;
  raw?: any;
  error?: string;
}

export class LiveTrader {
  private client: ClobClient | null = null;
  private initPromise: Promise<void> | null = null;

  private requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) {
      throw new Error(
        `[live-trader] Missing required environment variable ${name}. ` +
        `Live trading requires the OPERATOR to set this on the server themselves - ` +
        `it is never read, generated, or stored by application code.`
      );
    }
    return v;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.client) return;
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const privateKey = this.requireEnv("PRIVATE_KEY") as `0x${string}`;
    const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS; // optional: proxy/funder wallet

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: http(),
    });

    // L1: sign with the wallet to derive L2 (HMAC) API credentials.
    const bootstrapClient = new ClobClient(CLOB_HOST, CHAIN_ID, walletClient as any);
    const creds = await bootstrapClient.createOrDeriveApiKey();

    // L2: real client used for all order placement, signed per-request with the derived creds.
    this.client = new ClobClient(
      CLOB_HOST,
      CHAIN_ID,
      walletClient as any,
      creds,
      undefined,
      funderAddress
    );

    console.log(`[live-trader] Initialized for address ${account.address}${funderAddress ? ` (funder ${funderAddress})` : ""}`);
  }

  /**
   * Places a real market BUY order for a fixed USD amount on the given token.
   * usdAmount is in dollars (e.g. 10 = spend $10 buying shares at market).
   */
  public async placeMarketBuy(tokenId: string, usdAmount: number): Promise<LiveOrderResult> {
    try {
      await this.ensureInitialized();
      const order = await this.client!.createMarketOrder({
        tokenID: tokenId,
        amount: usdAmount,
        side: Side.BUY,
      });
      const result = await this.client!.postOrder(order);
      return { success: true, orderId: result?.orderID, raw: result };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Places a real market SELL order for a fixed number of shares on the given token.
   * shares is a share count (not dollars) - see UserMarketOrder.amount in the
   * clob-client types: "SELL orders: Shares to sell".
   */
  public async placeMarketSell(tokenId: string, shares: number): Promise<LiveOrderResult> {
    try {
      await this.ensureInitialized();
      const order = await this.client!.createMarketOrder({
        tokenID: tokenId,
        amount: shares,
        side: Side.SELL,
      });
      const result = await this.client!.postOrder(order);
      return { success: true, orderId: result?.orderID, raw: result };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Sells the entire held balance of a token. Used for exits (stop-loss and
   * slot-end auto-exit) since the exact filled share count from the earlier
   * buy isn't tracked locally - this asks the CLOB for the real balance
   * instead of relying on an estimate.
   */
  public async sellAllShares(tokenId: string): Promise<LiveOrderResult> {
    try {
      await this.ensureInitialized();
      const balanceResp = await this.client!.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: tokenId,
      });
      const shares = parseFloat(balanceResp.balance) / 1_000_000;
      if (!(shares > 0)) {
        return { success: true, error: "no shares held, nothing to sell" };
      }
      return this.placeMarketSell(tokenId, shares);
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }
}

// Lazy singleton - constructing this does nothing until a method is called,
// so importing this module never requires PRIVATE_KEY to be set.
export const liveTrader = new LiveTrader();

export function isLiveTradingEnabled(): boolean {
  return process.env.LIVE_TRADING_ENABLED === "true";
}
