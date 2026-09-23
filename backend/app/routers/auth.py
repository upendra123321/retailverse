"""Shared-passcode authentication for a hosted demo URL with no user
accounts. See security.py's "1b. Simple shared-passcode authentication"
section for the token/cookie mechanics and SECURITY.md's "Authorization
model" for why this scope (one team-wide passcode, not per-user login) is
the deliberate, disclosed choice for this hackathon prototype.

This router itself must NEVER be behind require_auth (obviously - you can't
log in to an endpoint that requires you to already be logged in), so it's
mounted in main.py without the auth dependency, unlike every other router.
"""
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import db
from ..security import (
    AUTH_COOKIE_NAME,
    actor_ref,
    auth_enabled,
    check_access_code,
    clear_session_cookie,
    rate_limit,
    set_session_cookie,
    verify_session_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# A short shared passcode is inherently guessable given enough attempts -
# this is the one endpoint in the app where the rate limit's job is brute
# -force resistance, not cost control. Keyed by client IP like every other
# limiter (see security._client_key).
_login_rate_limit = rate_limit("auth_login", max_calls=10, window_seconds=300)


class LoginRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=256)


@router.get("/status")
def auth_status(request: Request) -> dict:
    """Public, unauthenticated: tells the frontend whether to even show a
    login screen (auth_required=False for local dev / unconfigured hosts,
    matching this app's existing "no accounts needed" default), and whether
    the current cookie (if any) is still valid."""
    cookie = request.cookies.get(AUTH_COOKIE_NAME)
    return {
        "auth_required": auth_enabled(),
        "authenticated": (not auth_enabled()) or verify_session_token(cookie),
    }


@router.post("/login", dependencies=[_login_rate_limit])
def login(payload: LoginRequest, request: Request, response: Response) -> dict:
    if not auth_enabled():
        # Nothing to check in against - treat as already-authenticated so a
        # misconfigured/empty-passcode deployment doesn't lock everyone out.
        return {"status": "ok"}
    if not check_access_code(payload.code):
        db.record_audit(action="auth_login", actor_ref=actor_ref(request), result="failed", detail={})
        raise HTTPException(status_code=401, detail="Incorrect passcode")
    set_session_cookie(response, request)
    db.record_audit(action="auth_login", actor_ref=actor_ref(request), result="ok", detail={})
    return {"status": "ok"}


@router.post("/logout")
def logout(response: Response) -> dict:
    clear_session_cookie(response)
    return {"status": "ok"}
