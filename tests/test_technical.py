"""Tests for the technical analysis module."""

import numpy as np
import pandas as pd
import pytest

from halal_trader.analysis.technical import analyse, Signal


def _make_df(prices: list[float], n: int = 200) -> pd.DataFrame:
    if len(prices) < n:
        prices = prices * (n // len(prices) + 1)
    prices = prices[:n]
    return pd.DataFrame({
        "open": prices,
        "high": [p * 1.01 for p in prices],
        "low": [p * 0.99 for p in prices],
        "close": prices,
        "volume": [1000.0] * n,
        "quote_volume": [p * 1000 for p in prices],
    })


def test_bullish_trend():
    prices = list(np.linspace(100, 200, 200))
    df = _make_df(prices)
    sig = analyse(df, "TESTUSDT")
    assert isinstance(sig, Signal)
    assert sig.score > 0
    assert sig.trend == "bullish"


def test_bearish_trend():
    prices = list(np.linspace(200, 100, 200))
    df = _make_df(prices)
    sig = analyse(df, "TESTUSDT")
    assert sig.score < 0
    assert sig.trend == "bearish"


def test_insufficient_data():
    df = _make_df([100.0] * 10, n=10)
    sig = analyse(df, "TESTUSDT")
    assert sig.score == 0.0
    assert "insufficient" in sig.reasons[0]


def test_signal_has_reasons():
    df = _make_df(list(np.linspace(100, 150, 200)))
    sig = analyse(df, "TESTUSDT")
    assert len(sig.reasons) > 0
