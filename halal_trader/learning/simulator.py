"""Market simulator for offline ML training.

Generates realistic OHLCV price series with various market regimes
(uptrend, downtrend, sideways, volatile), runs the technical analysis
engine on each, simulates trade entry/exit, and feeds results into
the learning model.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

import numpy as np
import pandas as pd
import ta as ta_lib

from halal_trader.analysis.technical import analyse as analyse_technical
from halal_trader.learning.model import TradePredictor, record_trade, _load_trade_log
from halal_trader.utils.logger import get_logger

log = get_logger(__name__)


@dataclass
class SimConfig:
    num_symbols: int = 50
    candles_per_symbol: int = 300
    stop_loss_pct: float = 3.0
    take_profit_pct: float = 8.0
    entry_threshold: float = 0.20
    max_hold_candles: int = 72
    rounds: int = 3


def generate_ohlcv(
    n: int = 300,
    regime: str = "random",
    base_price: float = 100.0,
    volatility: float = 0.02,
) -> pd.DataFrame:
    """Generate synthetic OHLCV data for a given market regime."""
    if regime == "random":
        regime = random.choice(["uptrend", "downtrend", "sideways", "volatile", "pump_dump"])

    prices = [base_price]
    volumes = []

    for i in range(1, n):
        if regime == "uptrend":
            drift = volatility * 0.3
            noise = np.random.normal(drift, volatility)
        elif regime == "downtrend":
            drift = -volatility * 0.3
            noise = np.random.normal(drift, volatility)
        elif regime == "sideways":
            noise = np.random.normal(0, volatility * 0.5)
        elif regime == "volatile":
            noise = np.random.normal(0, volatility * 2.5)
        elif regime == "pump_dump":
            mid = n // 2
            if i < mid:
                noise = np.random.normal(volatility * 0.5, volatility)
            else:
                noise = np.random.normal(-volatility * 0.6, volatility * 1.2)
        else:
            noise = np.random.normal(0, volatility)

        new_price = prices[-1] * (1 + noise)
        prices.append(max(new_price, 0.01))
        volumes.append(abs(np.random.normal(1000, 300)) * (1 + abs(noise) * 10))

    volumes.insert(0, 1000.0)

    closes = np.array(prices)
    highs = closes * (1 + np.abs(np.random.normal(0, volatility * 0.5, n)))
    lows = closes * (1 - np.abs(np.random.normal(0, volatility * 0.5, n)))
    opens = np.roll(closes, 1)
    opens[0] = closes[0]

    return pd.DataFrame({
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": volumes,
        "quote_volume": closes * volumes,
    })


def _extract_indicators(df: pd.DataFrame) -> dict | None:
    """Extract raw indicator values from a DataFrame at the last candle."""
    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]

    if len(df) < 50:
        return None

    try:
        rsi = ta_lib.momentum.RSIIndicator(close, window=14).rsi().iloc[-1]
        macd_diff = ta_lib.trend.MACD(close).macd_diff().iloc[-1]
        ema9 = ta_lib.trend.ema_indicator(close, window=9).iloc[-1]
        ema21 = ta_lib.trend.ema_indicator(close, window=21).iloc[-1]
        ema_diff = (ema9 - ema21) / close.iloc[-1]
        adx = ta_lib.trend.ADXIndicator(high, low, close, window=14).adx().iloc[-1]
        bb_pct = ta_lib.volatility.BollingerBands(close).bollinger_pband().iloc[-1]
        vol_chg = (volume.tail(24).mean() / volume.mean() - 1) * 100 if volume.mean() > 0 else 0

        if any(np.isnan(v) for v in [rsi, macd_diff, ema_diff, adx, bb_pct]):
            return None

        return {
            "rsi": float(rsi),
            "macd_diff": float(macd_diff),
            "ema_diff": float(ema_diff),
            "adx": float(adx),
            "bb_pct": float(bb_pct),
            "vol_chg": float(vol_chg),
        }
    except Exception:
        return None


def simulate_trade(
    df: pd.DataFrame,
    entry_idx: int,
    stop_loss_pct: float,
    take_profit_pct: float,
    max_hold: int,
) -> float | None:
    """Simulate a trade from entry_idx forward. Return profit % or None if can't trade."""
    if entry_idx >= len(df) - 2:
        return None

    entry_price = df["close"].iloc[entry_idx]
    sl = entry_price * (1 - stop_loss_pct / 100)
    tp = entry_price * (1 + take_profit_pct / 100)

    for j in range(entry_idx + 1, min(entry_idx + max_hold, len(df))):
        low = df["low"].iloc[j]
        high = df["high"].iloc[j]
        close = df["close"].iloc[j]

        if low <= sl:
            return -stop_loss_pct
        if high >= tp:
            return take_profit_pct

    exit_price = df["close"].iloc[min(entry_idx + max_hold, len(df) - 1)]
    return (exit_price - entry_price) / entry_price * 100


def run_simulation(config: SimConfig | None = None) -> dict:
    """Run a full training simulation and return statistics."""
    cfg = config or SimConfig()
    predictor = TradePredictor()

    stats = {
        "total_trades": 0,
        "profitable": 0,
        "losing": 0,
        "total_pnl_pct": 0.0,
        "rounds_completed": 0,
        "model_accuracy": 0.0,
    }

    regimes = ["uptrend", "downtrend", "sideways", "volatile", "pump_dump"]

    for round_num in range(1, cfg.rounds + 1):
        log.info("=== Simülasyon Turu %d/%d ===", round_num, cfg.rounds)
        round_trades = 0
        round_pnl = 0.0

        for sym_i in range(cfg.num_symbols):
            regime = random.choice(regimes)
            base_price = random.uniform(0.5, 50000)
            volatility = random.uniform(0.01, 0.04)

            df = generate_ohlcv(
                n=cfg.candles_per_symbol,
                regime=regime,
                base_price=base_price,
                volatility=volatility,
            )

            window_size = 100
            step = 20
            for start in range(0, len(df) - window_size - 1, step):
                window = df.iloc[start:start + window_size].reset_index(drop=True)
                sig = analyse_technical(window, f"SIM{sym_i}")

                if sig.score < cfg.entry_threshold:
                    continue

                indicators = _extract_indicators(window)
                if indicators is None:
                    continue

                sentiment = random.uniform(-0.3, 0.3)
                hour = random.randint(0, 23)

                features = predictor.build_feature_vector(
                    tech_score=sig.score,
                    rsi=indicators["rsi"],
                    macd_diff=indicators["macd_diff"],
                    ema_diff=indicators["ema_diff"],
                    adx=indicators["adx"],
                    bb_pct=indicators["bb_pct"],
                    sentiment=sentiment,
                    volume_change_pct=indicators["vol_chg"],
                    hour=hour,
                )

                if predictor.is_ready:
                    prob = predictor.predict_proba(features)
                    if prob < 0.45:
                        continue

                entry_in_full = start + window_size - 1
                profit = simulate_trade(
                    df, entry_in_full,
                    cfg.stop_loss_pct, cfg.take_profit_pct, cfg.max_hold_candles,
                )
                if profit is None:
                    continue

                record_trade(features, profit)
                round_trades += 1
                round_pnl += profit
                stats["total_trades"] += 1
                if profit > 0:
                    stats["profitable"] += 1
                else:
                    stats["losing"] += 1
                stats["total_pnl_pct"] += profit

        trained = predictor.train()
        stats["rounds_completed"] = round_num

        win_rate = stats["profitable"] / max(stats["total_trades"], 1) * 100
        log.info(
            "Tur %d: %d trade, PnL=%.1f%%, Toplam=%d trade, Win=%.1f%%, Model=%s",
            round_num, round_trades, round_pnl, stats["total_trades"],
            win_rate, f"accuracy={predictor.accuracy:.1%}" if trained else "eğitiliyor...",
        )

    if predictor.is_ready:
        stats["model_accuracy"] = predictor.accuracy

    total = stats["total_trades"]
    win_rate = stats["profitable"] / max(total, 1) * 100
    avg_pnl = stats["total_pnl_pct"] / max(total, 1)
    log.info("=" * 60)
    log.info("SİMÜLASYON TAMAMLANDI")
    log.info("  Toplam trade: %d", total)
    log.info("  Kazanan: %d (%.1f%%)", stats["profitable"], win_rate)
    log.info("  Kaybeden: %d", stats["losing"])
    log.info("  Ortalama PnL: %.2f%%", avg_pnl)
    log.info("  ML Model Accuracy: %.1f%%", stats["model_accuracy"] * 100)
    log.info("=" * 60)

    return stats
