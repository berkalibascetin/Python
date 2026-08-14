from formatter import format_price


def cart_total(line_items):
    """Sum the line items (in cents) and format the total."""
    return format_price(sum(line_items))


def cart_count(line_items):
    return len(line_items)
