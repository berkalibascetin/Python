MINIMUM_AGE = 18


def is_adult(age):
    """A person is an adult from their 18th birthday onward."""
    return age > MINIMUM_AGE


def can_vote(age, is_citizen):
    return is_adult(age) and is_citizen
