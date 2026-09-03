"""Main bot orchestrator — scans, filters, analyses, and trades."""

from __future__ import annotations

import datetime as dt
import time

import ta as ta_lib

from halal_trader.analysis.sentiment import analyse_sentiment
from halal_trader.analysis.technical import analyse as analyse_technical
from halal_trader.core.exchange import Exchange
from halal_trader.core.portfolio import Portfolio
from halal_trader.filters.halal_filter import HalalFilter
from halal_trader.learning.model import TradePredictor, record_trade
from halal_trader.utils.config import Config
from halal_trader.utils.logger import get_logger

log = get_logger(__name__)

BUY_THRESHOLD = 0.25
ML_MIN_PROBA = 0.45


class HalalBot:
    def __init__(self, config: Config | None = None):
        self.config = config or Config()
        self.exchange = Exchange(self.config)
        self.portfolio = Portfolio(self.config)
        self.halal = HalalFilter()
        self.predictor = TradePredictor()
        self.predictor.train()

    # ------------------------------------------------------------------
    # Full scan cycle
    # ------------------------------------------------------------------

    def scan_and_trade(self) -> dict:
        """One full scan → filter → analyse → trade cycle. Returns summary."""
        log.info("=== Scan cycle started ===")
        summary: dict = {"scanned": 0, "filtered": 0, "signals": 0,
                         "buys": 0, "sells": 0, "errors": 0}

        # 1. Check exits on open positions first
        self._check_exits(summary)

        # 2. Get all tradeable symbols, apply halal filter
        all_symbols = self.exchange.get_all_spot_symbols()
        summary["scanned"] = len(all_symbols)

        halal_symbols = self.halal.filter_symbols(all_symbols, self.config.quote_currency)
        summary["filtered"] = len(halal_symbols)

        if not self.portfolio.can_open(self._total_balance()):
            log.info("Max positions reached, skipping new entries")
            return summary

        # 3. Rank candidates
        candidates = self._rank_candidates(halal_symbols)
        summary["signals"] = len(candidates)

        # 4. Open positions on top candidates
        for cand in candidates:
            if not self.portfolio.can_open(self._total_balance()):
                break
            if cand["symbol"] in self.portfolio.positions:
                continue
            self._open(cand, summary)

        log.info("=== Scan complete: %s ===", summary)
        return summary

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _total_balance(self) -> float:
        return self.exchange.get_balance(self.config.quote_currency)

    def _check_exits(self, summary: dict) -> None:
        for sym in list(self.portfolio.positions):
            try:
                price = self.exchange.get_price(sym)
                exit_reason = self.portfolio.check_exit(sym, price)
                if exit_reason:
                    self._close(sym, price, exit_reason, summary)
            except Exception as exc:
                log.warning("Exit check failed for %s: %s", sym, exc)
                summary["errors"] += 1

    def _close(self, symbol: str, price: float, reason: str, summary: dict) -> None:
        pos = self.portfolio.positions.get(symbol)
        if not pos:
            return
        self.exchange.sell(symbol, pos.quantity)
        pnl = (price - pos.entry_price) / pos.entry_price * 100
        record_trade(pos.features, pnl)
        self.portfolio.close_position(symbol)
        summary["sells"] += 1
        log.info("Closed %s (%s) PnL=%.2f%%", symbol, reason, pnl)

    def _rank_candidates(self, symbols: list[dict]) -> list[dict]:
        candidates = []
        for sym_info in symbols:
            sym = sym_info["symbol"]
            try:
                df = self.exchange.get_klines(sym, interval="1h", limit=200)
                sig = analyse_technical(df, sym)
                if sig.score < BUY_THRESHOLD:
                    continue

                sent = analyse_sentiment(sym)
                hour = dt.datetime.utcnow().hour

                close = df["close"]
                high = df["high"]
                low = df["low"]
                volume = df["volume"]

                rsi = ta_lib.momentum.RSIIndicator(close).rsi().iloc[-1]
                macd_diff = ta_lib.trend.MACD(close).macd_diff().iloc[-1]
                ema9 = ta_lib.trend.ema_indicator(close, 9).iloc[-1]
                ema21 = ta_lib.trend.ema_indicator(close, 21).iloc[-1]
                ema_diff = (ema9 - ema21) / close.iloc[-1]
                adx = ta_lib.trend.ADXIndicator(high, low, close).adx().iloc[-1]
                bb_pct = ta_lib.volatility.BollingerBands(close).bollinger_pband().iloc[-1]
                vol_chg = (volume.tail(24).mean() / volume.mean() - 1) * 100

                features = self.predictor.build_feature_vector(
                    sig.score, rsi, macd_diff, ema_diff, adx, bb_pct,
                    sent.polarity, vol_chg, hour,
                )
                ml_prob = self.predictor.predict_proba(features)

                if ml_prob < ML_MIN_PROBA:
                    continue

                candidates.append({
                    "symbol": sym,
                    "score": sig.score,
                    "ml_prob": ml_prob,
                    "sentiment": sent.polarity,
                    "price": sig.price,
                    "features": features,
                    "reasons": sig.reasons,
                })
            except Exception as exc:
                log.debug("Skipping %s: %s", sym, exc)
                continue

        candidates.sort(key=lambda c: c["score"] * (0.5 + c["ml_prob"]), reverse=True)
        return candidates[:5]

    def _open(self, cand: dict, summary: dict) -> None:
        sym = cand["symbol"]
        balance = self._total_balance()
        size = self.portfolio.position_size(balance)
        if size < 10:
            return

        order = self.exchange.buy(sym, size)
        price = order.get("price") or cand["price"]
        qty = order.get("qty", size / price)

        self.portfolio.open_position(
            sym, float(price), float(qty), size, features=cand["features"],
        )
        summary["buys"] += 1
        log.info(
            "BUY %s score=%.2f ml=%.2f sent=%.2f | %s",
            sym, cand["score"], cand["ml_prob"], cand["sentiment"],
            "; ".join(cand["reasons"][:3]),
        )
