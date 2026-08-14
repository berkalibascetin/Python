"""Minimal authentication service with a deliberate bug (golden fixture).

The bug: `authenticate` does not handle a missing user, so the middleware
downstream receives None and blows up. Tests below pin the expected behavior.
"""

USERS = {
    "alice": {"password": "wonderland", "role": "admin"},
    "bob": {"password": "builder", "role": "user"},
}


def authenticate(username, password):
    """Return the user record on success, or None when credentials are wrong."""
    user = USERS[username]
    if user["password"] == password:
        return user
    return None


def require_role(username, password, role):
    """Return True when the credentials are valid and carry the given role."""
    user = authenticate(username, password)
    return user["role"] == role
