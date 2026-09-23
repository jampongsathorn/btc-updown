# Live (real-money) trading setup

This bot ships defaulting to **paper trading only**. Real order execution
(`src/live-trader.ts`) exists but is off unless you explicitly turn it on
yourself, on your own server, with your own wallet key.

Nothing in this codebase reads, generates, stores, or transmits your private
key anywhere except directly to `viem`'s local signer, in your own process.

## Before you turn this on

Everything gathered in this project's `research-data/` (9 months of real
Coinbase price data cross-checked against real Polymarket resolutions) shows:

- The current strategy has historically predicted direction correctly ~96-97%
  of the time in 8 of the last 9 months.
- The most recent month dropped to ~86% for a reason that is **not yet
  understood** (ruled out: higher volatility, more reversals near expiry).
- Only a handful of real paper trades have been confirmed end-to-end so far.
- The dollar-PnL backtest numbers still rely on a simulated market-maker
  pricing model, not real historical Polymarket order book data.

None of that means "don't ever go live" - it means: know what you're
turning on, and consider waiting for the "why did last month dip" question
to have an answer first.

## Setup steps

1. **Fund a wallet on Polygon** with USDC (for trading) and a small amount of
   MATIC/POL (for gas, if not using the gasless relayer).
2. **Get your wallet's private key** - from your own wallet software. Never
   paste it into a chat with an AI agent, never commit it to git, never put
   it in a file that gets synced anywhere public.
3. On the server that runs this bot, set environment variables (e.g. in a
   `.env` file that is in `.gitignore`, or directly in the process manager's
   env config - **not** in any file that gets committed):

   ```bash
   PRIVATE_KEY=0x...                        # your wallet's private key
   POLYMARKET_FUNDER_ADDRESS=0x...          # optional: proxy/funder wallet address, if you use one
   LIVE_TRADING_ENABLED=true                # the master switch - omit or set to anything else to stay paper-only
   ```
4. Restart the bot (`pm2 restart btc-sniper` or equivalent). Watch the logs:
   ```
   [live-trader] Initialized for address 0x...
   ```
   confirms it picked up your key correctly (no key material is ever logged).
5. When a real BUY_UP/BUY_DOWN signal fires, you'll see either:
   ```
   [live-trader] BUY_UP order placed: <orderId>
   ```
   or, if anything is misconfigured:
   ```
   [live-trader] BUY_UP order failed: <error message>
   ```
   A failed live order does **not** roll back the paper-wallet trade - they
   are two independent, parallel records right now. If you rely on this for
   real money, check `pm2 logs btc-sniper` regularly, not just the dashboard.

## Turning it back off

Unset `LIVE_TRADING_ENABLED` (or set it to anything other than the literal
string `"true"`) and restart. The bot immediately goes back to paper-only -
no other state changes.
