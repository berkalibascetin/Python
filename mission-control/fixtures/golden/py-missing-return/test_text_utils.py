from text_utils import initials, normalize


def test_empty_name():
    assert normalize("") == ""


def test_normalize_trims_and_lowercases():
    assert normalize("  Ada Lovelace  ") == "ada lovelace"


def test_initials():
    assert initials("  Ada Lovelace ") == "AL"
