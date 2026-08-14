def last_n(items, n):
    """Return the last n items of the list, in order."""
    return items[len(items) - n + 1 :]


def first_n(items, n):
    """Return the first n items of the list."""
    return items[:n]
