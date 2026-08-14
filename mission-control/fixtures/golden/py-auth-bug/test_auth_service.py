from auth_service import authenticate, require_role


def test_valid_login_returns_user():
    assert authenticate("alice", "wonderland")["role"] == "admin"


def test_wrong_password_returns_none():
    assert authenticate("bob", "wrong") is None


def test_unknown_user_returns_none():
    # Regression: an unknown username must not raise, it must return None.
    assert authenticate("mallory", "whatever") is None


def test_require_role_is_false_for_unknown_user():
    assert require_role("mallory", "whatever", "admin") is False
