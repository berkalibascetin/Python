"""Tests for the market simulator."""

import json

import pytest

from halal_trader.learning.simulator import (
    generate_ohlcv,
    simulate_trade,
    run_simulation,
    SimConfig,
)
from halal_trader.learning.model import TRADE_LOG


@pytest.fixture(autouse=True)
def clean_log(tmp_path, monkeypatch):
    log_file = tmp_path / "trade_log.json"
    monkeypatch.setattr("halal_trader.learning.model.TRADE_LOG", log_file)
    yield log_file


def test_generate_ohlcv_shape():
    df = generate_ohlcv(200, regime="uptrend")
    assert len(df) == 200
    assert all(c in df.columns for c in ["open", "high", "low", "close", "volume"])


def test_generate_ohlcv_regimes():
    for regime in ["uptrend", "downtrend", "sideways", "volatile", "pump_dump"]:
        df = generate_ohlcv(100, regime=regime)
        assert len(df) == 100
        assert (df["close"] > 0).all()


def test_simulate_trade_stop_loss():
    df = generate_ohlcv(200, regime="downtrend", base_price=100, volatility=0.05)
    result = simulate_trade(df, 50, stop_loss_pct=3.0, take_profit_pct=8.0, max_hold=50)
    assert result is not None


def test_simulate_trade_edge():
    df = generate_ohlcv(100, regime="sideways")
    result = simulate_trade(df, 99, stop_loss_pct=3.0, take_profit_pct=8.0, max_hold=10)
    assert result is None


def test_run_simulation_small(clean_log):
    stats = run_simulation(SimConfig(
        num_symbols=15,
        candles_per_symbol=200,
        rounds=1,
    ))
    assert stats["total_trades"] > 0
    assert stats["rounds_completed"] == 1
    data = json.loads(clean_log.read_text())
    assert len(data) == stats["total_trades"]


def test_run_simulation_trains_model(clean_log):
    stats = run_simulation(SimConfig(
        num_symbols=30,
        candles_per_symbol=300,
        rounds=2,
    ))
    assert stats["total_trades"] >= 30
    assert stats["model_accuracy"] > 0
