from inventory import in_stock, restock


def test_restock_adds_to_existing():
    assert restock({"a": 2}, "a", 3) == {"a": 5}


def test_restock_creates_missing_sku():
    assert restock({}, "b", 1) == {"b": 1}


def test_restock_does_not_mutate_input():
    original = {"a": 1}
    restock(original, "a", 5)
    assert original == {"a": 1}


def test_in_stock():
    assert in_stock({"a": 1}, "a") is True
    assert in_stock({"a": 0}, "a") is False
