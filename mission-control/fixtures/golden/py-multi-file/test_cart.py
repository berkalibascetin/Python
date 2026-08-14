from cart import cart_count, cart_total


def test_cart_count():
    assert cart_count([100, 250]) == 2


def test_total_keeps_two_decimals():
    # The failure surfaces here, but the defect lives in formatter.py.
    assert cart_total([1000, 250]) == "$12.50"


def test_whole_amount_still_has_cents():
    assert cart_total([500]) == "$5.00"
