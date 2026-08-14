def restock(counts, sku, amount):
    """Return a new counts mapping with `amount` added to `sku`."""
    updated = dict(counts)
    updated[sku] = updated.get(sku, 0) + amount
    return updated


def in_stock(counts, sku):
    return counts.get(sku, 0) > 0
