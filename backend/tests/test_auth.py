"""Shared-passcode authentication (backend/app/security.py "1b"): off by
default, and once APP_ACCESS_CODE is set, gates every protected router
behind a signed session cookie issued by a correct login.
"""
import importlib

import pytest


@pytest.fixture()
def auth_configured(monkeypatch):
    """Enables auth for the duration of one test by setting the env vars
    require_auth/auth_enabled read live (no caching), then restores the
    disabled default afterwards so this doesn't leak into other tests."""
    monkeypatch.setenv("APP_ACCESS_CODE", "letmein123")
    monkeypatch.setenv("APP_SECRET_KEY", "test-signing-key-not-for-prod")
    yield


def test_auth_disabled_by_default(client):
    """No APP_ACCESS_CODE configured (the conftest/CI default) -> status
    reports auth_required=False and every protected route works with zero
    cookie, exactly like before this feature existed."""
    resp = client.get("/api/auth/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["auth_required"] is False
    assert body["authenticated"] is True

    # A protected route (personas) works with no cookie at all.
    assert client.get("/api/personas").status_code == 200


def test_protected_route_rejects_missing_cookie_when_enabled(client, auth_configured):
    resp = client.get("/api/personas")
    assert resp.status_code == 401


def test_protected_route_rejects_bad_cookie_when_enabled(client, auth_configured):
    client.cookies.set("rv_session", "garbage.notasignature")
    resp = client.get("/api/personas")
    assert resp.status_code == 401


def test_login_with_wrong_code_is_rejected(client, auth_configured):
    resp = client.post("/api/auth/login", json={"code": "wrong-code"})
    assert resp.status_code == 401


def test_login_with_correct_code_grants_access(client, auth_configured):
    login_resp = client.post("/api/auth/login", json={"code": "letmein123"})
    assert login_resp.status_code == 200
    assert "rv_session" in login_resp.cookies

    status_resp = client.get("/api/auth/status")
    assert status_resp.json() == {"auth_required": True, "authenticated": True}

    # The session cookie set by login now unlocks every protected router.
    assert client.get("/api/personas").status_code == 200
    assert client.get("/api/audit/recent").status_code == 200


def test_logout_revokes_access(client, auth_configured):
    client.post("/api/auth/login", json={"code": "letmein123"})
    assert client.get("/api/personas").status_code == 200

    client.post("/api/auth/logout")
    resp = client.get("/api/personas")
    assert resp.status_code == 401


def test_tampered_session_token_is_rejected(client, auth_configured):
    from app.security import create_session_token

    real_token = create_session_token()
    payload, _, signature = real_token.rpartition(".")
    tampered = f"{payload}9." + signature  # mutate the claimed expiry, keep the old signature
    client.cookies.set("rv_session", tampered)
    resp = client.get("/api/personas")
    assert resp.status_code == 401


def test_expired_session_token_is_rejected(monkeypatch, client, auth_configured):
    import app.security as security

    monkeypatch.setattr(security.time, "time", lambda: 1_000_000.0)
    token = security.create_session_token()  # expires at 1_000_000 + 24h

    monkeypatch.setattr(security.time, "time", lambda: 1_000_000.0 + 25 * 60 * 60)
    client.cookies.set("rv_session", token)
    resp = client.get("/api/personas")
    assert resp.status_code == 401


def test_login_endpoint_is_rate_limited(client, auth_configured):
    for _ in range(10):
        client.post("/api/auth/login", json={"code": "wrong-code"})
    resp = client.post("/api/auth/login", json={"code": "wrong-code"})
    assert resp.status_code == 429
