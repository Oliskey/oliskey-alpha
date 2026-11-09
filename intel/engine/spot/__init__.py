"""Oliskey AI Spot: long-only BTC/USDT and ETH/USDT spot research engine (Phase 1 of docs/spot/SPEC.md).

Modules:
  data       load and validate candles (Binance, or the static-klines mirror of Binance spot)
  market     Market Intelligence: regime, trend, volatility percentile, uncertainty (may say UNKNOWN)
  strategies the four starter strategies as declarative specs + long-only signal rules
  backtest   cost-aware, stop-first, next-bar-open backtest; walk-forward; bootstrap; promotion gates

Nothing here places orders. The backend's Risk Manager (backend/src/spot/risk.js) is the only path to an order.
"""
