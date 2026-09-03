"""Tests for the self-learning model."""

import json
import math

import pytest

from halal_trader.learning.model import (
    TradePredictor,
    record_trade,
    TRADE_LOG,
    FEATURE_COLS,
    MODEL_MIN_SAMPLES,
)


@pytest.fixture(autouse=True)
def clean_log(tmp_path, monkeypatch):
    log_file = tmp_path / "trade_log.json"
    monkeypatch.setattr("halal_trader.learning.model.TRADE_LOG", log_file)
    yield log_file


def _make_features(score=0.5, hour=12):
    return {
        "tech_score": score,
        "rsi": 50.0,
        "macd_diff": 0.001,
        "ema_diff": 0.01,
        "adx": 30.0,
        "bb_pct": 0.5,
        "sentiment": 0.1,
        "volume_change_pct": 5.0,
        "hour_sin": math.sin(2 * math.pi * hour / 24),
        "hour_cos": math.cos(2 * math.pi * hour / 24),
    }


def test_record_trade(clean_log):
    record_trade(_make_features(), 2.5)
    data = json.loads(clean_log.read_text())
    assert len(data) == 1
    assert data[0]["label"] == 1


def test_train_insufficient(clean_log):
    for _ in range(10):
        record_trade(_make_features(), 1.0)
    predictor = TradePredictor()
    assert not predictor.train()


def test_train_sufficient(clean_log):
    for i in range(MODEL_MIN_SAMPLES):
        profit = 2.0 if i % 2 == 0 else -1.0
        record_trade(_make_features(score=0.8 if profit > 0 else 0.2), profit)
    predictor = TradePredictor()
    assert predictor.train()
    assert predictor.is_ready
    prob = predictor.predict_proba(_make_features(score=0.8))
    assert 0.0 <= prob <= 1.0


def test_build_feature_vector():
    p = TradePredictor()
    fv = p.build_feature_vector(0.5, 50, 0.001, 0.01, 30, 0.5, 0.1, 5.0, 12)
    for col in FEATURE_COLS:
        assert col in fv
