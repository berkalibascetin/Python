"""Binance spot-only exchange client. No margin, no futures, no leverage."""

from __future__ import annotations

import time
from typing import Any

import pandas as pd
from binance.client import Client
from binance.exceptions import BinanceAPIException

from halal_trader.utils.config import Config
from halal_trader.utils.logger import get_logger

log = get_logger(__name__)


class Exchange:
    """Thin wrapper around Binance spot API with paper-trading fallback."""

    def __init__(self, config: Config):
        self.config = config
        self._paper_balance: dict[str, float] = {config.quote_currency: 10_000.0}
        self._paper_orders: list[dict] = []

        self.client: Client | None = None
        try:
            if config.api_key and config.api_secret:
                self.client = Client(config.api_key, config.api_secret)
                log.info("Binance client initialised (mode=%s)", config.trade_mode)
            else:
                self.client = Client("", "")
                log.info("Binance client initialised without credentials (public data only)")
        except Exception as exc:
            log.warning("Could not connect to Binance API: %s", exc)
            log.info("Running in offline/paper mode — live market data unavailable")

    # ------------------------------------------------------------------
    # Market data (always works, even without API keys)
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self.client is not None

    def get_all_spot_symbols(self) -> list[dict[str, Any]]:
        if not self.is_connected:
            log.warning("No Binance connection — returning empty symbol list")
            return []
        info = self.client.get_exchange_info()
        return [
            s for s in info["symbols"]
            if s["status"] == "TRADING"
            and s["quoteAsset"] == self.config.quote_currency
            and s["isSpotTradingAllowed"]
        ]

    def get_klines(
        self, symbol: str, interval: str = "1h", limit: int = 200
    ) -> pd.DataFrame:
        if not self.is_connected:
            raise ConnectionError("Binance API not available")
        raw = self.client.get_klines(symbol=symbol, interval=interval, limit=limit)
        df = pd.DataFrame(raw, columns=[
            "open_time", "open", "high", "low", "close", "volume",
            "close_time", "quote_volume", "trades",
            "taker_buy_base", "taker_buy_quote", "ignore",
        ])
        for col in ("open", "high", "low", "close", "volume", "quote_volume"):
            df[col] = df[col].astype(float)
        df["open_time"] = pd.to_datetime(df["open_time"], unit="ms")
        return df

    def get_price(self, symbol: str) -> float:
        if not self.is_connected:
            raise ConnectionError("Binance API not available")
        return float(self.client.get_symbol_ticker(symbol=symbol)["price"])

    def get_24h_stats(self, symbol: str) -> dict:
        if not self.is_connected:
            raise ConnectionError("Binance API not available")
        return self.client.get_ticker(symbol=symbol)

    # ------------------------------------------------------------------
    # Order execution (spot only)
    # ------------------------------------------------------------------

    def buy(self, symbol: str, quote_amount: float) -> dict:
        if self.config.is_paper:
            return self._paper_buy(symbol, quote_amount)
        return self._live_market_buy(symbol, quote_amount)

    def sell(self, symbol: str, quantity: float) -> dict:
        if self.config.is_paper:
            return self._paper_sell(symbol, quantity)
        return self._live_market_sell(symbol, quantity)

    # ------------------------------------------------------------------
    # Paper trading
    # ------------------------------------------------------------------

    def _paper_buy(self, symbol: str, quote_amount: float) -> dict:
        price = self.get_price(symbol)
        qty = quote_amount / price
        base = symbol.replace(self.config.quote_currency, "")

        self._paper_balance[self.config.quote_currency] = (
            self._paper_balance.get(self.config.quote_currency, 0) - quote_amount
        )
        self._paper_balance[base] = self._paper_balance.get(base, 0) + qty

        order = {
            "symbol": symbol, "side": "BUY", "type": "MARKET",
            "price": price, "qty": qty, "quote_qty": quote_amount,
            "ts": time.time(), "paper": True,
        }
        self._paper_orders.append(order)
        log.info("[PAPER] BUY %s  qty=%.6f  price=%.4f", symbol, qty, price)
        return order

    def _paper_sell(self, symbol: str, quantity: float) -> dict:
        price = self.get_price(symbol)
        base = symbol.replace(self.config.quote_currency, "")
        quote_amount = quantity * price

        self._paper_balance[base] = self._paper_balance.get(base, 0) - quantity
        self._paper_balance[self.config.quote_currency] = (
            self._paper_balance.get(self.config.quote_currency, 0) + quote_amount
        )

        order = {
            "symbol": symbol, "side": "SELL", "type": "MARKET",
            "price": price, "qty": quantity, "quote_qty": quote_amount,
            "ts": time.time(), "paper": True,
        }
        self._paper_orders.append(order)
        log.info("[PAPER] SELL %s  qty=%.6f  price=%.4f", symbol, quantity, price)
        return order

    # ------------------------------------------------------------------
    # Live trading (spot market orders only)
    # ------------------------------------------------------------------

    def _live_market_buy(self, symbol: str, quote_amount: float) -> dict:
        try:
            order = self.client.order_market_buy(
                symbol=symbol, quoteOrderQty=f"{quote_amount:.2f}"
            )
            log.info("[LIVE] BUY %s  quoteQty=%.2f", symbol, quote_amount)
            return order
        except BinanceAPIException as exc:
            log.error("Buy failed for %s: %s", symbol, exc)
            raise

    def _live_market_sell(self, symbol: str, quantity: float) -> dict:
        try:
            order = self.client.order_market_sell(
                symbol=symbol, quantity=f"{quantity:.8f}"
            )
            log.info("[LIVE] SELL %s  qty=%.8f", symbol, quantity)
            return order
        except BinanceAPIException as exc:
            log.error("Sell failed for %s: %s", symbol, exc)
            raise

    def get_balance(self, asset: str) -> float:
        if self.config.is_paper:
            return self._paper_balance.get(asset, 0.0)
        info = self.client.get_asset_balance(asset=asset)
        return float(info["free"]) if info else 0.0
