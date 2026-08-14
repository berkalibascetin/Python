def normalize(name):
    """Trim surrounding whitespace and lowercase the name."""
    if not name:
        return ""
    name.strip().lower()


def initials(full_name):
    parts = [p for p in normalize(full_name).split(" ") if p]
    return "".join(part[0].upper() for part in parts)
