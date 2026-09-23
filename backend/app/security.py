"""Cross-cutting security controls shared by every router.

This module intentionally implements a small, dependency-free set of
controls sized for a hackathon-scale single-process deployment rather than
pulling in a full auth/observability stack:

  1. RateLimiter    - per-client-IP sliding-window throttling for endpoints
                       that either cost real money (LLM calls) or are
                       write-heavy (batch simulation, persona mutation).
                       A public demo URL with no login has no other way to
                       bound abuse of a shared, budgeted LLM credential.
  2. Security headers - standard defense-in-depth response headers, plus a
                       Permissions-Policy that explicitly scopes camera
                       access to same-origin only (this app's core feature
                       is webcam-based gaze tracking, so this is the one
                       header worth getting exactly right rather than
                       leaving default-open).
  3. sanitize_free_text - a lightweight prompt-injection AND PII guard for
                       every place end users type free text that gets
                       forwarded into an LLM prompt or stored in the shared
                       persona library (persona_description, and the new
                       /api/analytics/ask question). The *real* safety net
                       is that every LLM call downstream of this text has
                       its output strictly schema/range-validated (see
                       routers/agent.py - judge output index must be one of
                       the offered grid cells or it's discarded) - this
                       sanitizer is a second, defense-in-depth layer that
                       flags/redacts common instruction-override phrasing
                       *and* accidental PII (emails, phone numbers, card-like
                       numbers, SSN-like numbers) before it ever reaches the
                       model or gets written to disk, and records every
                       detection to the audit log.
  4. Shared-passcode auth - a deliberately simple gate (see require_auth
                       below) for a hosted demo URL with no user accounts:
                       one team-wide passcode, a signed session cookie, no
                       password database. Off by default (local dev) and
                       only activates once APP_ACCESS_CODE is set (e.g. on
                       the Render deployment) - see "Authorization model" in
                       SECURITY.md for why this is the right scope for a
                       hackathon prototype, and the documented upgrade path
                       to real per-user accounts.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import Cookie, Depends, HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp


# ---------------------------------------------------------------------------
# 1. Rate limiting
# ---------------------------------------------------------------------------


class RateLimiter:
    """Thread-safe, in-memory sliding-window rate limiter.

    In-memory (not Redis/DB-backed) is a deliberate, disclosed trade-off:
    it resets on process restart and doesn't share state across multiple
    backend instances. For this app's actual deployment shape (one Docker
    container, one process, Render free tier / a single AWS instance) that
    trade-off is fine and keeps the control dependency-free; it's called out
    explicitly in SECURITY.md as the first thing to swap for a multi-instance
    production deployment.
    """

    def __init__(self, max_calls: int, window_seconds: float) -> None:
        self.max_calls = max_calls
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> tuple[bool, float]:
        """Returns (allowed, retry_after_seconds)."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            cutoff = now - self.window_seconds
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= self.max_calls:
                retry_after = self.window_seconds - (now - hits[0])
                return False, max(0.0, retry_after)
            hits.append(now)
            return True, 0.0


def _client_key(request: Request) -> str:
    # Respect a trusted reverse-proxy header (Render/most PaaS set this) so
    # rate limits key on the real client, not the proxy's own IP.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def actor_ref(request: Request) -> str:
    """A short, non-reversible reference to the caller for the audit trail -
    intentionally NOT the raw IP, so the audit log itself stays privacy-
    minimal while still letting evaluators distinguish "one caller hammering
    an endpoint" from "many distinct callers"."""
    raw = _client_key(request)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def rate_limit(bucket: str, max_calls: int, window_seconds: float) -> Callable:
    """FastAPI dependency factory: `Depends(rate_limit("insights", 30, 300))`.

    A fresh RateLimiter is created per (bucket, max_calls, window_seconds)
    call site and closed over, so each protected endpoint gets its own
    independent budget.
    """
    limiter = RateLimiter(max_calls=max_calls, window_seconds=window_seconds)

    def _dependency(request: Request) -> None:
        key = f"{bucket}:{_client_key(request)}"
        allowed, retry_after = limiter.allow(key)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded for '{bucket}'. Retry in {retry_after:.0f}s.",
                headers={"Retry-After": str(int(retry_after) + 1)},
            )

    # Exposed (rather than left as a bare closure cell) so tests can assert
    # against the *actual* configured budget for a given endpoint - e.g.
    # "does this limiter survive the frontend's real polling cadence?" -
    # instead of only unit-testing the RateLimiter class in the abstract.
    _dependency.limiter = limiter  # type: ignore[attr-defined]
    _dependency.bucket = bucket  # type: ignore[attr-defined]

    return Depends(_dependency)


# ---------------------------------------------------------------------------
# 1b. Simple shared-passcode authentication
# ---------------------------------------------------------------------------

AUTH_COOKIE_NAME = "rv_session"
_SESSION_LIFETIME_SECONDS = 24 * 60 * 60  # 24h - long enough to survive a demo day, short enough to matter

# A random, per-process fallback signing key so tokens are still tamper-proof
# even if the operator never sets APP_SECRET_KEY explicitly - the trade-off
# (documented in SECURITY.md) is that every process restart invalidates all
# existing sessions, which is fine for this app's deployment shape (one
# Docker container that only restarts on redeploy, not per-request).
_FALLBACK_SECRET = secrets.token_bytes(32)


def _secret_key() -> bytes:
    configured = os.getenv("APP_SECRET_KEY")
    return configured.encode("utf-8") if configured else _FALLBACK_SECRET


def auth_enabled() -> bool:
    """Auth only activates once an operator explicitly sets a passcode (e.g.
    in the Render dashboard) - local/dev usage with no env var configured
    stays exactly as frictionless as before this feature existed."""
    return bool(os.getenv("APP_ACCESS_CODE"))


def _sign(payload: str) -> str:
    return hmac.new(_secret_key(), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session_token() -> str:
    """A small signed-not-encrypted token: `<expiry_epoch>.<hmac>`. No
    external JWT library needed - this app only ever needs one claim
    (expiry), and unlike RateLimiter state, a session token must survive
    being handed to the browser, so it's a signed string, not memory."""
    expires_at = int(time.time()) + _SESSION_LIFETIME_SECONDS
    payload = str(expires_at)
    return f"{payload}.{_sign(payload)}"


def verify_session_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    payload, _, signature = token.rpartition(".")
    if not hmac.compare_digest(_sign(payload), signature):
        return False
    try:
        expires_at = int(payload)
    except ValueError:
        return False
    return time.time() < expires_at


def check_access_code(code: str) -> bool:
    expected = os.getenv("APP_ACCESS_CODE", "")
    # Constant-time compare so response timing can't leak how many leading
    # characters of a guess were correct.
    return bool(expected) and hmac.compare_digest(code, expected)


def set_session_cookie(response: Response, request: Request) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=create_session_token(),
        max_age=_SESSION_LIFETIME_SECONDS,
        httponly=True,
        samesite="lax",
        # Secure requires HTTPS; Render/any real deployment terminates TLS in
        # front of the app, but local http://localhost dev must still work.
        secure=request.url.scheme == "https",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")


def require_auth(request: Request, rv_session: str | None = Cookie(default=None)) -> None:
    """FastAPI dependency: `app.include_router(x, dependencies=[Depends(require_auth)])`.

    A no-op (always passes) unless APP_ACCESS_CODE is configured - see
    auth_enabled(). This keeps every existing test and local-dev workflow
    unchanged by default, while giving a hosted demo URL a real gate once an
    operator opts in.
    """
    if not auth_enabled():
        return
    if not verify_session_token(rv_session):
        raise HTTPException(status_code=401, detail="Authentication required")


# ---------------------------------------------------------------------------
# 2. Security response headers
# ---------------------------------------------------------------------------


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds standard defense-in-depth headers to every response.

    Not a substitute for TLS/HSTS at the load-balancer level (Render/most
    PaaS terminate TLS in front of the app), but cheap, real mitigation
    against clickjacking, MIME-sniffing, and unscoped camera/mic access
    from an embedding page.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        # camera=(self) is required - this app's core feature is same-origin
        # webcam gaze tracking; everything else stays denied-by-default.
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
        response.headers.setdefault("X-Content-Security-Note", "see SECURITY.md")
        return response


def install_security_middleware(app: ASGIApp) -> None:
    app.add_middleware(SecurityHeadersMiddleware)


# ---------------------------------------------------------------------------
# 3. Prompt-injection guard for user-authored free text sent to an LLM
# ---------------------------------------------------------------------------

_SUSPICIOUS_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"ignore (all|any|the) (previous|prior|above) instructions",
        r"disregard (the )?(system|previous) prompt",
        r"you are now",
        r"new instructions?:",
        r"reveal (your|the) (system prompt|instructions)",
        r"act as (if )?(you|an?) ",
        r"</?system>",
        r"```",
    ]
]

# PII patterns: this app has no legitimate reason to ever store or forward a
# real email/phone/card/SSN-shaped number (persona descriptions are
# fictional shopper backstories, and analytics questions are about
# aggregate zone stats) - so any match is redacted unconditionally rather
# than judged for intent, unlike the prompt-injection patterns above.
_PII_PATTERNS = [
    ("email", re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+")),
    ("credit_card", re.compile(r"(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}(?!\d)")),
    ("ssn", re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")),
    # Phone last (loosest pattern) so it never eats digits that already
    # matched (and got redacted by) the tighter card/SSN patterns above.
    ("phone", re.compile(r"(?<!\d)(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")),
]


def sanitize_free_text(text: str, *, max_length: int = 4000) -> tuple[str, bool, list[str]]:
    """Best-effort prompt-injection AND PII mitigation for free text that
    gets embedded into an LLM prompt or persisted to the shared persona
    library (persona_description, /api/analytics/ask questions). Returns
    (cleaned_text, was_flagged, reasons) where reasons is e.g.
    ["prompt_injection", "pii_email"] - kept granular so the audit log can
    distinguish "someone tried to jailbreak the judge" from "someone pasted
    their email by accident", which warrant very different follow-up.

    This is deliberately a *secondary* control for prompt injection. The
    primary defense is that every downstream LLM call here only ever
    returns a small, strictly validated value (a grid-cell index that must
    be in a known set - see _judge_focus in routers/agent.py); even a fully
    successful injection can't do anything more damaging than pick the
    "wrong" cell, which the caller already treats as just cosmetic
    narration. For PII, this sanitizer *is* the primary control - there is
    no legitimate reason for this app to ever store or transmit real PII.
    """
    cleaned = text[:max_length]
    reasons: list[str] = []
    for pattern in _SUSPICIOUS_PATTERNS:
        if pattern.search(cleaned):
            reasons.append("prompt_injection")
            cleaned = pattern.sub("[redacted]", cleaned)
    for name, pattern in _PII_PATTERNS:
        if pattern.search(cleaned):
            reasons.append(f"pii_{name}")
            cleaned = pattern.sub("[redacted]", cleaned)
    return cleaned, bool(reasons), sorted(set(reasons))


_LEAK_MARKERS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"as an ai language model",
        r"my (system )?instructions (are|were)",
        r"i (was|am) instructed to",
        r"here is the system prompt",
    ]
]


def looks_like_prompt_leak(text: str) -> bool:
    """Output-side guardrail: a coarse heuristic check on text an LLM
    *generated* (not typed by a user) for signs it broke character/leaked
    its instructions instead of answering the actual question. Used by
    /api/analytics/insights and /api/analytics/ask to fall back to the
    deterministic heuristic report rather than show a compromised response -
    complements (does not replace) the strict schema validation already
    used for the agent_gaze judge output.
    """
    return any(pattern.search(text) for pattern in _LEAK_MARKERS)
