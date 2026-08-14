import pytest

from config_loader import get_setting, parse_config


def test_valid_config():
    assert parse_config('{"debug": true}') == {"debug": True}


def test_setting_lookup():
    assert get_setting('{"port": 8080}', "port") == 8080


def test_invalid_json_raises():
    # Swallowing the error hides real misconfiguration from the caller.
    with pytest.raises(ValueError):
        parse_config("{not json")
