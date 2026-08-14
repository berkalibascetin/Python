def add_item(item, basket=[]):
    """Add an item to a basket, returning the basket."""
    basket.append(item)
    return basket


def basket_size(basket):
    return len(basket)
