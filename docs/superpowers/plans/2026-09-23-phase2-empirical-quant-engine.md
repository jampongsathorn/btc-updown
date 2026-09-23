# Phase 2: Empirical Quantitative Engine Enhancement Plan

## Objective
Address real-world market imperfections (fat tails, sudden jumps, negative skewness, variable volatility, position sizing) through an institutional-grade quantitative framework:
1. **Dynamic High-Frequency Realized Volatility ($\sigma_{\text{hf}}$)**: Replace static volatility with a rolling micro-structure realized volatility estimator.
2. **Fractional Kelly Criterion Optimal Sizing**: Optimize trade allocation under asymmetric payoffs ($f^* = \frac{p \cdot b - q}{b}$) to maximize geometric growth while guaranteeing risk-of-ruin prevention.
3. **Historical Empirical Backtester**: Evaluate strategy on real closed Polymarket markets and real tick data.
4. **End-to-End UI & Execution Integration**: Expose dynamic volatility, Kelly bet sizes, and stop-loss markers in the dashboard and CLI.

## Tasks
- [ ] **Task 9: Dynamic Rolling Realized Volatility Estimator (`src/volatility.ts`)**
  - Implements rolling tick log-return variance and annualized realized volatility.
  - Tests: `tests/volatility.test.ts`.
- [ ] **Task 10: Fractional Kelly Criterion Position Sizer (`src/kelly.ts`)**
  - Implements fractional Kelly formula for binary asymmetric options with stop-loss recovery floor.
  - Tests: `tests/kelly.test.ts`.
- [ ] **Task 11: Real Historical Polymarket Ingestion & Backtesting Engine (`src/backtest.ts`)**
  - Replays real historical events and evaluates PnL, win rate, and stop-loss trigger frequency.
  - Tests: `tests/backtest.test.ts`.
- [ ] **Task 12: System Integration, Live Engine Wire-up, and UI Visualization**
  - Connect volatility and Kelly sizing into `src/engine.ts`, `src/types.ts`, `src/cli.ts`, and `public/index.html`.
  - Verify all unit and integration tests pass with 100% clean status.
