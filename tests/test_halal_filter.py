"""Tests for the halal filter module."""

import pytest

from halal_trader.filters.halal_filter import HalalFilter, HalalVerdict


@pytest.fixture
def hf():
    return HalalFilter()


def test_clean_coin_passes(hf):
    v = hf.check("BTCUSDT", "USDT")
    assert v.is_allowed
    assert "no known haram" in v.reason


def test_blocked_lending_token(hf):
    v = hf.check("AAVEUSDT", "USDT")
    assert not v.is_allowed
    assert "blocked" in v.reason.lower()


def test_blocked_gambling_token(hf):
    v = hf.check("FUNUSDT", "USDT")
    assert not v.is_allowed


def test_interest_stablecoin(hf):
    v = hf.check("USDDUSDT", "USDT")
    assert not v.is_allowed
    assert "interest" in v.reason.lower()


def test_haram_keyword_in_tags(hf):
    v = hf.check("XYZUSDT", "USDT", tags=["casino", "gaming"])
    assert not v.is_allowed
    assert "casino" in v.reason


def test_manual_whitelist():
    hf = HalalFilter(extra_allowed={"SPECIAL"})
    v = hf.check("SPECIALUSDT", "USDT", tags=["casino"])
    assert v.is_allowed


def test_manual_blocklist():
    hf = HalalFilter(extra_blocked={"BADCOIN"})
    v = hf.check("BADCOINUSDT", "USDT")
    assert not v.is_allowed


def test_filter_symbols_list(hf):
    symbols = [
        {"symbol": "BTCUSDT", "status": "TRADING"},
        {"symbol": "ETHUSDT", "status": "TRADING"},
        {"symbol": "AAVEUSDT", "status": "TRADING"},
        {"symbol": "FUNUSDT", "status": "TRADING"},
    ]
    result = hf.filter_symbols(symbols, "USDT")
    names = [s["symbol"] for s in result]
    assert "BTCUSDT" in names
    assert "ETHUSDT" in names
    assert "AAVEUSDT" not in names
    assert "FUNUSDT" not in names
