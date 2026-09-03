"""Tests for the portfolio manager."""

import json

import pytest

from halal_trader.core.portfolio import Portfolio, POSITIONS_FILE
from halal_trader.utils.config import Config


@pytest.fixture(autouse=True)
def clean_positions(tmp_path, monkeypatch):
    pf = tmp_path / "positions.json"
    monkeypatch.setattr("halal_trader.core.portfolio.POSITIONS_FILE", pf)
    yield pf


@pytest.fixture
def portfolio():
    return Portfolio(Config())


def test_open_and_close(portfolio):
    portfolio.open_position("BTCUSDT", 50000.0, 0.01, 500.0)
    assert "BTCUSDT" in portfolio.positions

    pos = portfolio.close_position("BTCUSDT")
    assert pos is not None
    assert "BTCUSDT" not in portfolio.positions


def test_stop_loss(portfolio):
    portfolio.open_position("ETHUSDT", 3000.0, 1.0, 3000.0)
    assert portfolio.check_exit("ETHUSDT", 2900.0) == "stop_loss"


def test_take_profit(portfolio):
    portfolio.open_position("ETHUSDT", 3000.0, 1.0, 3000.0)
    assert portfolio.check_exit("ETHUSDT", 3300.0) == "take_profit"


def test_no_exit(portfolio):
    portfolio.open_position("ETHUSDT", 3000.0, 1.0, 3000.0)
    assert portfolio.check_exit("ETHUSDT", 3050.0) is None


def test_max_positions(portfolio):
    for i in range(portfolio.config.max_total_positions):
        portfolio.open_position(f"SYM{i}USDT", 100.0, 1.0, 100.0)
    assert not portfolio.can_open(10000)


def test_position_size(portfolio):
    size = portfolio.position_size(10000.0)
    assert size == pytest.approx(500.0)
