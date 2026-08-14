from slicing import first_n, last_n


def test_first_n():
    assert first_n([1, 2, 3, 4, 5], 2) == [1, 2]


def test_last_n_returns_exactly_n_items():
    assert last_n([1, 2, 3, 4, 5], 2) == [4, 5]


def test_last_n_with_full_length():
    assert last_n([1, 2, 3], 3) == [1, 2, 3]
