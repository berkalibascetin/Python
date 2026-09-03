"""Self-learning feedback loop.

After each trade closes (stop-loss, take-profit, or manual), we record the
pre-trade feature vector and the outcome.  A lightweight gradient-boosted
classifier is retrained periodically so the bot improves over time.

Features per trade:
    - composite technical score
    - RSI, MACD-diff, EMA-diff, ADX, BB-%b
    - sentiment polarity
    - 24 h volume change %
    - hour of day (cyclical sin/cos)

Label:  1 = profitable trade, 0 = losing trade.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import cross_val_score

from halal_trader.utils.config import DATA_DIR
from halal_trader.utils.logger import get_logger

log = get_logger(__name__)

TRADE_LOG = DATA_DIR / "trade_log.json"
MODEL_MIN_SAMPLES = 30


def _load_trade_log() -> list[dict]:
    if TRADE_LOG.exists():
        with open(TRADE_LOG) as f:
            return json.load(f)
    return []


def _save_trade_log(records: list[dict]) -> None:
    with open(TRADE_LOG, "w") as f:
        json.dump(records, f, indent=2)


def record_trade(features: dict, profit_pct: float) -> None:
    """Append a closed trade to the log."""
    entry = {**features, "profit_pct": profit_pct, "label": int(profit_pct > 0)}
    records = _load_trade_log()
    records.append(entry)
    _save_trade_log(records)
    log.info("Trade recorded (profit=%.2f%%, total=%d)", profit_pct, len(records))


FEATURE_COLS = [
    "tech_score", "rsi", "macd_diff", "ema_diff", "adx", "bb_pct",
    "sentiment", "volume_change_pct", "hour_sin", "hour_cos",
]


class TradePredictor:
    """Gradient-boosted classifier that learns from past trades."""

    def __init__(self) -> None:
        self.clf: GradientBoostingClassifier | None = None
        self._accuracy: float = 0.0

    @property
    def is_ready(self) -> bool:
        return self.clf is not None

    @property
    def accuracy(self) -> float:
        return self._accuracy

    def train(self) -> bool:
        records = _load_trade_log()
        if len(records) < MODEL_MIN_SAMPLES:
            log.info(
                "Not enough trades to train (%d/%d)",
                len(records), MODEL_MIN_SAMPLES,
            )
            return False

        df = pd.DataFrame(records)
        missing = [c for c in FEATURE_COLS if c not in df.columns]
        if missing:
            log.warning("Missing feature columns: %s", missing)
            return False

        X = df[FEATURE_COLS].fillna(0).values
        y = df["label"].values

        clf = GradientBoostingClassifier(
            n_estimators=100, max_depth=3, learning_rate=0.1, random_state=42,
        )
        scores = cross_val_score(clf, X, y, cv=min(5, len(y)), scoring="accuracy")
        self._accuracy = float(scores.mean())

        clf.fit(X, y)
        self.clf = clf
        log.info(
            "Model trained on %d trades, CV accuracy=%.2f%%",
            len(records), self._accuracy * 100,
        )
        return True

    def predict_proba(self, features: dict) -> float:
        """Return P(profitable) for a candidate trade. 0.5 if model not ready."""
        if not self.is_ready:
            return 0.5
        row = np.array([[features.get(c, 0) for c in FEATURE_COLS]])
        return float(self.clf.predict_proba(row)[0, 1])

    def build_feature_vector(
        self,
        tech_score: float,
        rsi: float,
        macd_diff: float,
        ema_diff: float,
        adx: float,
        bb_pct: float,
        sentiment: float,
        volume_change_pct: float,
        hour: int,
    ) -> dict:
        import math
        return {
            "tech_score": tech_score,
            "rsi": rsi,
            "macd_diff": macd_diff,
            "ema_diff": ema_diff,
            "adx": adx,
            "bb_pct": bb_pct,
            "sentiment": sentiment,
            "volume_change_pct": volume_change_pct,
            "hour_sin": math.sin(2 * math.pi * hour / 24),
            "hour_cos": math.cos(2 * math.pi * hour / 24),
        }
