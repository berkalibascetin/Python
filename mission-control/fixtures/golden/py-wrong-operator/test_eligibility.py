from eligibility import can_vote, is_adult


def test_clearly_adult():
    assert is_adult(30) is True


def test_clearly_minor():
    assert is_adult(12) is False


def test_exactly_eighteen_is_adult():
    assert is_adult(18) is True


def test_eighteen_year_old_citizen_can_vote():
    assert can_vote(18, True) is True
