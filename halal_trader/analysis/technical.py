"""Technical analysis signal engine.

Uses the `ta` library to compute indicators on OHLCV data and emit a
composite score in [-1.0, +1.0]  (negative = bearish, positive = bullish).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import ta

from halal_trader.utils.logger import get_logger

log = get_logger(__name__)


@dataclass
class Signal:
    symbol: str
    score: float          # -1 … +1
    trend: str            # "bullish" | "bearish" | "neutral"
    reasons: list[str]
    price: float
    volume_24h: float


def analyse(df: pd.DataFrame, symbol: str = "") -> Signal:
    """Return a composite signal from multiple indicator families."""
    if len(df) < 50:
        return Signal(symbol, 0.0, "neutral", ["insufficient data"], 0.0, 0.0)

    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]
    reasons: list[str] = []
    scores: list[float] = []

    # --- Trend: EMA crossover ---
    ema_short = ta.trend.ema_indicator(close, window=9)
    ema_long = ta.trend.ema_indicator(close, window=21)
    ema_diff = (ema_short.iloc[-1] - ema_long.iloc[-1]) / close.iloc[-1]
    if ema_diff > 0.005:
        scores.append(1.0)
        reasons.append(f"EMA9 > EMA21 (+{ema_diff:.4f})")
    elif ema_diff < -0.005:
        scores.append(-1.0)
        reasons.append(f"EMA9 < EMA21 ({ema_diff:.4f})")
    else:
        scores.append(0.0)

    # --- Trend: MACD ---
    macd = ta.trend.MACD(close)
    macd_diff = macd.macd_diff().iloc[-1]
    if macd_diff > 0:
        scores.append(0.8)
        reasons.append("MACD histogram positive")
    else:
        scores.append(-0.8)
        reasons.append("MACD histogram negative")

    # --- Momentum: RSI ---
    rsi = ta.momentum.RSIIndicator(close, window=14).rsi().iloc[-1]
    if rsi < 30:
        scores.append(1.0)
        reasons.append(f"RSI oversold ({rsi:.1f})")
    elif rsi > 70:
        scores.append(-1.0)
        reasons.append(f"RSI overbought ({rsi:.1f})")
    else:
        scores.append(0.2 if rsi < 50 else -0.2)

    # --- Volatility: Bollinger Bands ---
    bb = ta.volatility.BollingerBands(close, window=20, window_dev=2)
    bb_pct = bb.bollinger_pband().iloc[-1]
    if bb_pct < 0.05:
        scores.append(0.7)
        reasons.append("Price near lower Bollinger Band")
    elif bb_pct > 0.95:
        scores.append(-0.7)
        reasons.append("Price near upper Bollinger Band")
    else:
        scores.append(0.0)

    # --- Volume: OBV trend ---
    obv = ta.volume.OnBalanceVolumeIndicator(close, volume).on_balance_volume()
    obv_ema = ta.trend.ema_indicator(obv, window=10)
    if obv.iloc[-1] > obv_ema.iloc[-1]:
        scores.append(0.5)
        reasons.append("OBV above its EMA (buying pressure)")
    else:
        scores.append(-0.5)
        reasons.append("OBV below its EMA (selling pressure)")

    # --- ADX: trend strength filter ---
    adx_val = ta.trend.ADXIndicator(high, low, close, window=14).adx().iloc[-1]
    strength_mult = 1.0 if adx_val > 25 else 0.5
    if adx_val < 20:
        reasons.append(f"Weak trend (ADX={adx_val:.1f}), signals discounted")

    composite = float(np.clip(np.mean(scores) * strength_mult, -1.0, 1.0))
    trend = "bullish" if composite > 0.15 else ("bearish" if composite < -0.15 else "neutral")

    return Signal(
        symbol=symbol,
        score=composite,
        trend=trend,
        reasons=reasons,
        price=float(close.iloc[-1]),
        volume_24h=float(volume.tail(24).sum()),
    )
