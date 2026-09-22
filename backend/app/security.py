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
  3. sanitize_free_text - a lightweight prompt-injection guard for the one
                       place end users type free text that gets forwarded
                       into an LLM prompt (persona_description in Agent
                       Mode). The *real* safety net is that every LLM call
                       downstream of this text has its output strictly
                       schema/range-validated (see routers/agent.py -
                       judge output index must be one of the offered grid
                       cells or it's discarded) - this sanitizer is a second,
                       defense-in-depth layer that flags/strips common
                       instruction-override phrasing before it ever reaches
                       the model, and records the attempt to the audit log.
"""
from __future__ import annotations

import hashlib
import re
import threading
import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import Depends, HTTPException, Request
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

    return Depends(_dependency)


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


def sanitize_free_text(text: str, *, max_length: int = 4000) -> tuple[str, bool]:
    """Best-effort prompt-injection mitigation for free text that gets
    embedded into an LLM prompt (currently: persona_description in Agent
    Mode). Returns (cleaned_text, was_flagged).

    This is deliberately a *secondary* control. The primary defense is that
    every downstream LLM call here only ever returns a small, strictly
    validated value (a grid-cell index that must be in a known set - see
    _judge_focus in routers/agent.py); even a fully successful injection
    can't do anything more damaging than pick the "wrong" cell, which the
    caller already treats as just cosmetic narration.
    """
    cleaned = text[:max_length]
    flagged = False
    for pattern in _SUSPICIOUS_PATTERNS:
        if pattern.search(cleaned):
            flagged = True
            cleaned = pattern.sub("[redacted]", cleaned)
    return cleaned, flagged
