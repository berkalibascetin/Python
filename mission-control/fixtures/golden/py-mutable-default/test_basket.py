from basket import add_item, basket_size


def test_add_to_explicit_basket():
    assert add_item("apple", ["pear"]) == ["pear", "apple"]


def test_size():
    assert basket_size(["a", "b"]) == 2


def test_each_default_basket_is_independent():
    # A shared mutable default leaks state between unrelated calls.
    first = add_item("apple")
    second = add_item("pear")
    assert first == ["apple"]
    assert second == ["pear"]
