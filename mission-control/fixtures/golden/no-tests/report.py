"""A project with source but no test suite.

Negative control for verification: the system must report "no tests detected"
rather than claiming zero failures. "0 failed" and "nothing was checked" are
very different statements to show a user.
"""


def summarize(rows):
    return {"count": len(rows), "total": sum(row.get("amount", 0) for row in rows)}
