# Phase 3: Discord Webhook & In/Out/PnL Alert System Plan

## Objective
Connect the Discord webhook (`https://discord.com/api/webhooks/1552315113535578144/AuLKFz6d6-pRMPk78UYkKL5BmTJuU6zdZDqdwI8GtBgtwJOX2vWfZ9WQtqhBRSNnhk_7`), build institutional-grade In / Out / PnL rich Discord embed alerts, integrate an animated real-time alert feed into the Web Dashboard, and validate with the live 5-minute market.

## Tasks
- [ ] **Task 13: Alert Formatter & Discord Embed Engine (`src/alerts.ts`)**
  - Formats rich Discord embeds:
    - **IN (Entry)**: Side (`BUY_UP` / `BUY_DOWN`), Strike, Spot, Delta, Probability $p^*$, EV, Kelly bet size, shares.
    - **OUT (Stop-Loss / Early Exit)**: Exit price, trigger reason, capital preserved %, loss capped.
    - **PNL (Resolution)**: Outcome (`WIN` / `LOSS`), Net PnL ($ and %), updated bankroll, cumulative win rate.
  - Tests: `tests/alerts.test.ts`.
- [ ] **Task 14: Dual-Channel Dispatcher & Express API (`src/server.ts`, `src/engine.ts`)**
  - Expose `/api/alerts/pending` and `/api/alerts/ack` for robust relay.
  - Test server endpoints.
- [ ] **Task 15: Best-in-Class UI Alerts in Web Dashboard (`public/index.html`)**
  - Live Alert Banner & Notification Toasts with pulsing glow (80/20/10 theme colors).
  - Browser-side webhook dispatch relay for resilient delivery.
- [ ] **Task 16: Live Market Validation & Verification**
  - Validate on active/next 5-minute market.
  - Verify all 46+ tests pass cleanly.
