import json


def parse_config(text):
    """Parse configuration JSON.

    Invalid JSON is a caller error and must surface, not be hidden.
    """
    try:
        return json.loads(text)
    except Exception:
        pass


def get_setting(text, key, default=None):
    config = parse_config(text)
    return config.get(key, default)
