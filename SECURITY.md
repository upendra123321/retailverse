# Security & Responsible AI

This document maps RetailVerse's actual, implemented controls to the
Hackfest 2026 "Cybersecurity + AI Guardrails" requirements. Every claim
below points at a real file/line and a real, passing test — nothing here is
aspirational copy.

> **Note on the NIQ GenAI Guidelines reference doc:** the brief links an
> internal NIQ Word document we don't have direct access to from this
> environment. The practices below follow standard, widely-recognized
> responsible-AI principles (data minimization, transparency about
> AI-vs-fallback outputs, human oversight, grounded/non-hallucinated
> outputs, least privilege). **Action item before final submission:** have
> someone with access to the actual NIQ document do a 10-minute diff
> against this file and note any gaps.

---

## 1. Secure coding practices & authentication/authorization

| Control | Where | Notes |
|---|---|---|
| Input validation on every request body | `backend/app/schemas.py` | Every field is length-, range-, or pattern-bounded (e.g. `persona_key` must match `^[a-z0-9_]+$`, `browse_probability` is `0..1`, event batches capped at 500). Pydantic rejects anything outside this with a `422` before a handler ever runs. |
| Rate limiting on cost/abuse-sensitive endpoints | `backend/app/security.py` (`RateLimiter`, `rate_limit()`), wired into `routers/agent.py`, `routers/analytics.py`, `routers/simulate.py`, `routers/personas.py` | Per-client-IP sliding window. `/api/agent/gaze` and `/api/analytics/insights` hit a shared, budgeted LLM credential — an unauthenticated public URL with no throttling is a direct abuse/cost vector, so these (plus batch simulation and persona writes) each get an independent call budget and return `429` + `Retry-After` when exceeded. **Sizing is call-pattern-specific, not one-size-fits-all**: `/api/analytics/insights`, `/api/simulate/batch`, and persona writes are one-off, user-triggered actions and get a tight budget (e.g. 20-30 calls / 5 min); `/api/agent/gaze` is polled continuously for the entire duration of a live Agent Mode run (every `captureIntervalSeconds`, default 6s, down to 1s), so it needs a budget sized to sustain indefinite polling instead (100 calls / 60s) — an earlier, too-tight budget on this endpoint caused a real regression (agent runs would start getting `429`s ~2 minutes in), fixed and pinned by `backend/tests/test_security.py::test_agent_gaze_budget_sustains_default_frontend_polling_interval`. |
| Security response headers | `backend/app/security.py` (`SecurityHeadersMiddleware`) | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy` that scopes camera access to `self` only and explicitly denies microphone/geolocation — deliberate, since this app's core feature is same-origin webcam gaze tracking and nothing else should get that permission. |
| CORS restricted, not wildcard | `backend/app/main.py` | Dev origins are an explicit allowlist (`localhost:5173`); in production the frontend is served from the same origin as the API (see "Single-origin deployment" in `README.md`), so CORS is effectively moot rather than opened up. |
| No SQL injection surface | `backend/app/db.py` | Every query uses parameterized `?` placeholders — string-built SQL never includes request-derived values. |
| Simple shared-passcode authentication (opt-in) | `backend/app/security.py` (§1b), `backend/app/routers/auth.py`, `frontend/src/components/Auth/AuthGate.tsx` | This is a **hackathon prototype with no per-user accounts** by design — end users are *intended* to create their own custom personas without a login (a core requested feature — see `AgentSetupForm.tsx`). What was missing was a way to put a single door on a *hosted demo URL* without building a full user system. `require_auth()` is a FastAPI dependency wired onto every router except `/api/auth/*` itself (`main.py`); it checks an HMAC-SHA256-signed, httpOnly session cookie (`<expiry_epoch>.<hmac>`, `hmac.compare_digest` for constant-time comparison, no JWT library needed). **Opt-in, not opt-out**: `auth_enabled()` returns `False` unless the operator explicitly sets `APP_ACCESS_CODE` — so local dev / grading stays zero-friction, and the gate only turns on once someone deliberately configures a passcode for a public URL (e.g. the Render deployment). `POST /api/auth/login` is itself rate-limited (10 calls / 5 min per IP) to blunt passcode brute-forcing. Session secret (`APP_SECRET_KEY`) is a Render `generateValue: true` secret in `render.yaml`, or a random in-memory fallback for local dev (sessions just don't survive a backend restart, and that's fine at this stage). **Path to full multi-tenant production:** swap the single shared passcode for real per-user accounts; `require_auth()` and its call sites are already exactly where a `Depends(current_user)` check would go. |

## 2. Protection of sensitive data & credentials

- **No secrets in git.** `LITE_LLM_API_KEY` and friends live in `backend/.env` (gitignored — see `.gitignore`), loaded via `python-dotenv`. `.env.example` ships with placeholders only. `git log -p -- '*.env'` has no matches.
- **No raw biometric data leaves the browser.** Real-shopper gaze tracking (webcam → iris landmarks → screen coordinates) runs entirely client-side (`frontend/src/components/EyeTracking/`). Only the small calibration *regression coefficients* (a handful of floats) are ever persisted, never a video frame or image of the user's face — see `backend/app/routers/calibration.py`.
- **What *does* leave the browser to a third-party LLM:** cropped screenshots of the *synthetic 3D store scene* for Agent-Mode narration (`routers/agent.py`), and aggregated, already-anonymous zone statistics for insight generation (`routers/analytics.py`). Neither contains any real person's image, location, or PII.
- **HTTPS-only in production**, enforced structurally rather than by convention: the single-origin deployment (`Dockerfile`, `render.yaml`) means the browser's own `getUserMedia` camera API will simply refuse to run over a non-HTTPS/mixed-origin connection — see "Deployment" in `README.md`.
- **LLM credential never reaches the browser.** All LLM calls are server-side only (`backend/app/llm_gateway.py`); the frontend never sees `LITE_LLM_API_KEY`.
- **Session cookie hygiene.** The auth cookie (`rv_session`) is `httpOnly` (unreadable to any frontend JS, including an XSS payload), `SameSite=Lax`, and `Secure` whenever the request itself was HTTPS — see `set_session_cookie()` in `security.py`. CORS `allow_credentials=True` is scoped to the explicit dev-origin allowlist in `main.py`, never a wildcard, so the cookie can't be silently replayed from an arbitrary third-party origin.

## 3. Input & output validation, including malicious/unexpected inputs

- **Malformed binary input:** `/api/agent/gaze` accepts a base64 image; invalid base64 or an undecodable image returns a clean `400`, not a stack trace or a hang (`routers/agent.py::_decode_image`, tested in `backend/tests/test_security.py::test_agent_gaze_rejects_malformed_image`).
- **Oversized/adversarial requests:** grid size is capped at `MAX_GRID_CELLS = 100` (`schemas.py`), image dimensions are clamped to `MAX_IMAGE_DIMENSION = 1280px` server-side regardless of what's uploaded, event batches are capped at 500 per call, and every free-text field a user can submit into an LLM-adjacent path (persona description, ask-the-data question) has an explicit `max_length`; list fields (`target_categories`, `preferred_product_keys`) are bounded both per-item (`Annotated[str, Field(max_length=64)]`) and by list length (`Field(max_length=20)`) so a request can't smuggle in an enormous array to inflate prompt size or memory.
- **LLM output is never trusted blindly.** Every LLM response that drives *any* downstream logic is strictly parsed and range-checked before use — this pattern is applied consistently across all four LLM-backed features:
  - Agent-mode narration: the judge LLM's chosen grid-cell `index` must be one of the indices actually offered, or the code silently substitutes a safe default and labels it as a fallback (`routers/agent.py::_judge_focus`).
  - Persona auto-suggest (`POST /api/personas/suggest`): `navigation_style` must be one of `direct|explore|compare` or it falls back to a safe default; `price_sensitivity` must be `low|medium|high`; `target_categories` is filtered against the store's *real* known categories (`zone_catalog.py::known_product_categories()`) and capped at 5 — the model cannot invent a category that doesn't exist in the store; every numeric field (`patience_seconds`, `browse_probability`, `ad_attention_bias`, `purchase_likelihood`) is clamped into its valid range via `_clamped_float()`. A hallucinated or malformed LLM response can never produce an invalid or out-of-catalog persona.
  - "Ask the data" (`POST /api/analytics/ask`) and insights (`POST /api/analytics/insights`): the model only ever receives pre-computed, already-aggregated numbers as context (never raw DB/SQL access — a "RAG-lite" pattern that eliminates query-injection risk entirely), and its output is screened for prompt-leak markers (see next bullet) before being returned.
  - A hallucinated or malformed LLM response can never widen its blast radius past "the cosmetic output was a bit off" or a documented, deterministic fallback.
- **Prompt-injection mitigation (input side):** `persona_description` (both at agent-narration time and now at persona-save time in `routers/personas.py::upsert_persona()`) and the free-text "ask the data" question are end-user-authored text that gets embedded in an LLM prompt. `backend/app/security.py::sanitize_free_text()` detects and redacts common instruction-override phrasing ("ignore previous instructions", `<system>` tags, code-fence breakouts) *and* common PII patterns (email, credit-card-shaped numbers, SSN-shaped numbers, phone numbers) before anything reaches the model or gets persisted, returning `(cleaned_text, was_flagged, reasons)`; every detection is written to the audit trail (`action: free_text_sanitized`, with the specific `reasons`). This is explicitly a **secondary/defense-in-depth** control — the primary one is the output-validation bullet above.
- **Prompt-leak mitigation (output side):** `backend/app/security.py::looks_like_prompt_leak()` screens every LLM response used in "ask the data" and insights for markers that suggest the model is reciting its own system prompt or persona instead of answering ("as an ai language model", "my (system )?instructions (are|were)", etc.). A match discards the LLM output, falls back to the deterministic heuristic answer, and logs `action: llm_output_guardrail_triggered` — so a successful "print your instructions" style attack degrades to a boring canned answer instead of leaking anything.
- **Automated evidence:** `backend/tests/test_security.py`, `test_personas.py`, `test_analytics.py`, and `test_auth.py` exercise all of the above as repeatable, passing test cases (see §6).

## 4. Awareness of security threats & mitigation

| Threat | Mitigation |
|---|---|
| Shared LLM credential abused/drained by a public URL | Per-IP rate limiting on every LLM-backed endpoint (§1), now including the two new ones (`analytics_ask`, `personas_suggest`) |
| Passcode brute-forcing on a hosted demo URL | `POST /api/auth/login` is rate-limited (10 calls / 5 min per IP), HMAC-signed cookie tokens can't be forged without `APP_SECRET_KEY`, comparison is constant-time (`hmac.compare_digest`) (§1) |
| Prompt injection via free-text persona descriptions or "ask the data" questions | Pattern-based input sanitization + strict output validation + output-side prompt-leak screening (§3) |
| PII pasted into a free-text field ending up in an LLM prompt, a log, or the persisted persona library | `sanitize_free_text()` redacts email/credit-card/SSN/phone-shaped substrings before the text reaches the model *or* gets saved — applied both at agent-call time and at persona-save time (§3) |
| LLM reciting its own system prompt / leaking instructions back to the user | `looks_like_prompt_leak()` screens every LLM output used in "ask the data" and insights; a match discards the output and falls back to the heuristic answer (§3) |
| Denial-of-service via large/repeated batch simulation | `MAX_BATCH_SIMULATION_COUNT = 500` server-side cap + dedicated rate limit bucket |
| Denial-of-service via oversized list fields (e.g. thousands of fake target categories) | Pydantic `Field(max_length=...)` on both list length and per-item string length (`schemas.py::Persona`) (§3) |
| LLM endpoint unreachable/hung, blocking the whole app | Hard `ThreadPoolExecutor` timeout (`llm_gateway.run_with_timeout`, default 15s) on every LLM call, with a deterministic heuristic fallback for insights, "ask the data", and persona-suggest — this exact failure mode was caught live while building the test suite (see commit history) and is now covered by dedicated fallback tests for each of the three features |
| Clickjacking / unscoped camera access if embedded elsewhere | `X-Frame-Options: DENY` + scoped `Permissions-Policy` (§1) |
| SQL injection | Parameterized queries everywhere (§1) |
| Untracked destructive action on the shared persona library | Every persona create/replace/delete is audit-logged with a hashed actor reference (§5) |
| Unauthenticated access to a publicly-hosted demo URL | Opt-in shared-passcode gate (§1) — off by default for local dev/grading, on the moment `APP_ACCESS_CODE` is set |

## 5. Audit trail

`backend/app/db.py::audit_log` records every consequential action with a
timestamp, a **hashed** (never raw) caller reference, and a structured
detail payload:

- Persona create / replace / delete (including automatic sanitization of a
  description at save time, if it was flagged)
- Batch simulation runs (requested count, personas used, elapsed time)
- Insight generation (which filter, and — critically — `llm` vs
  `heuristic_fallback` as the actual source)
- "Ask the data" queries (`action: analytics_ask`) and persona field
  auto-suggestions (`action: personas_suggest`) — same `llm` vs
  `heuristic_fallback` labeling as insights
- Agent-mode gaze calls (success / vision-error / judge-error, latency)
- Detected prompt-injection / PII patterns in free text (`action:
  free_text_sanitized`, with the specific `reasons`)
- Detected prompt-leak markers in an LLM response (`action:
  llm_output_guardrail_triggered`)

It's exposed read-only at `GET /api/audit/recent` (`routers/audit.py`) so
evaluators can watch it happen live rather than trusting a log file no one
can see. `actor_ref` is `sha256(client_ip)[:12]` — enough to distinguish
"one caller hammering an endpoint" from "many distinct callers" without
storing a real IP anywhere.

## 6. Responsible AI & human oversight for consequential actions

- **Every AI-generated output is explicitly labeled with its real source.** `generate_insights()`, `POST /api/analytics/ask`, and `POST /api/personas/suggest` all return `generated_by: "llm" | "heuristic_fallback"` — never silently presented as one or the other (`routers/analytics.py`, `routers/personas.py`).
- **Grounded, not hallucinated.** The LLM insight and "ask the data" prompts are instructed to use *only* the numbers computed and passed in by our own code ("do not invent any numbers not present here"); the model narrates/answers from measured data, it doesn't generate new metrics or query the database itself. Persona auto-suggest similarly only ever returns fields drawn from the store's real catalog (see §3).
- **Human-in-the-loop by design, not by accident.** Insight generation, "ask the data", and persona auto-suggest are each an explicit, user-triggered button click — never automatic/background — and every suggested/generated field is presented for the human to review/edit before it's saved or acted on (the persona-suggest UI literally labels itself "review and adjust before saving"). Agent-mode LLM narration is cosmetic HUD flavor text only; it structurally cannot alter navigation, gaze events logged for analytics, or purchase decisions (`routers/agent.py`'s module docstring walks through why).
- **Uncertainty is surfaced, not hidden.** `compare_real_vs_agent()` returns `sufficient_data: false` rather than a misleading similarity score when either side has zero sessions; the heuristic fallback template says outright *"no LLM call"* rather than pretending to be AI-generated.
- **Least privilege for the LLM gateway.** The LLM credential/gateway (`llm_gateway.py`) has no access to the database, the session/event pipeline, or navigation logic — it only ever receives a prompt and returns text. It structurally cannot take a "consequential action" even if fully compromised or manipulated via prompt injection.
- **Synthetic data is always labeled as synthetic.** Every batch-simulated session is tagged `meta.synthetic_batch: true` and uses `subject_type: "agent"` — there's no code path where a synthetic shopper's data could be mistaken for a real one downstream.

## 7. Running the evidence yourself

```bash
cd backend
pip install -r requirements-dev.txt
pytest -v
# 61 passed in ~1.5s (as of this writing) - see backend/tests/
```

Covers: session lifecycle & validation, persona CRUD & audit logging,
batch-simulation limits & audit logging, real-vs-synthetic comparison &
insight fallback behavior, rate limiting, security headers, prompt-
injection/PII sanitization, prompt-leak output screening, malformed/oversized
input rejection, the full shared-passcode auth flow (`test_auth.py` — disabled
by default, missing/bad/tampered/expired cookie rejection, correct/incorrect
login, logout revocation, login rate limiting), and the two new LLM-backed
endpoints' fallback/guardrail/audit behavior (`test_analytics.py::test_ask_*`,
`test_personas.py::test_suggest_*`).

## 8. Known gaps (disclosed, not hidden)

- Rate limiting and the audit log are in-memory/single-process — fine for
  this deployment shape (one Docker container), but the first thing to
  swap for a multi-instance production deployment (Redis-backed limiter,
  DB-backed or shipped-to-a-log-pipeline audit trail).
- There is no per-user account system, by design — the auth layer is a
  single shared passcode intended to gate a *hosted demo URL*, not to
  distinguish between individual users. Persona create/delete is available
  to anyone who has passed that gate (or to everyone, if the operator never
  configured `APP_ACCESS_CODE`) — see §1's authorization rationale table.
- The auth session secret falls back to an in-memory random value if
  `APP_SECRET_KEY` isn't set, which means every backend restart invalidates
  all existing sessions (users just get prompted to re-enter the passcode —
  not a security issue, just a UX note). Render's blueprint sets a real
  persistent `APP_SECRET_KEY` via `generateValue: true` to avoid this.
- PII/prompt-leak detection is regex-pattern-based, not a full NLP
  classifier — it catches the common, expected cases (and is covered by
  tests for each), but a sufficiently obfuscated PII string or a novel
  leak-phrasing could slip through. This is documented as defense-in-depth
  on top of the primary controls (output schema/range validation, grounded
  prompts, least-privilege LLM gateway), not the only line of defense.
- We have not cross-checked this document against the actual internal NIQ
  GenAI Guidelines Word doc (no access from this environment) — see the
  note at the top of this file.
