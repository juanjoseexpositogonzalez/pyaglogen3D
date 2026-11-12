"""The OAuth callback hands the tokens over in the URL fragment (#249).

A fragment is never sent to a server, so the tokens stop appearing in access logs on
the way and in the `Referer` of any third-party resource loaded before the redirect.
The query string keeps only what is not a secret: the login redirect's `?error=`.

The second half of this issue was already closed in the callback page - the provider's
`error` is encoded before it reaches login - and this file covers the first.
"""

from typing import Any

from django.contrib.auth import get_user_model

User = get_user_model()


def test_the_callback_redirects_with_the_tokens_in_the_fragment(
    api_client: Any, db: Any
) -> None:
    """`?access=…` reaches servers and history; `#access=…` never leaves the browser."""
    user = User.objects.create_user(email="oauth-fragment@example.com", password="x")
    api_client.force_authenticate(user=user)

    response = api_client.get("/api/v1/auth/oauth-callback/")

    assert response.status_code == 302
    location = response["Location"]
    assert "/auth/oauth-callback#" in location, location
    assert "?" not in location, (
        "the tokens must not travel in a query string: it is sent to the server, kept "
        f"in access logs and leaks through `Referer` ({location})"
    )
    fragment = location.split("#", 1)[1]
    assert "access=" in fragment, location
    assert "refresh=" in fragment, location


def test_an_unauthenticated_callback_still_names_its_error_in_the_query(
    api_client: Any, db: Any
) -> None:
    """`error` is not a secret and the login page reads it from the query."""
    response = api_client.get("/api/v1/auth/oauth-callback/")

    assert response.status_code == 302
    assert response["Location"].endswith("/auth/login?error=oauth_failed")
