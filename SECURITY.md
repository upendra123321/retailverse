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
| Rate limiting on cost/abuse-sensitive endpoints | `backend/app/security.py` (`RateLimiter`, `rate_limit()`), wired into `routers/agent.py`, `routers/analytics.py`, `routers/simulate.py`, `routers/personas.py` | Per-client-IP sliding window. `/api/agent/gaze` and `/api/analytics/insights` hit a shared, budgeted LLM credential — an unauthenticated public URL with no throttling is a direct abuse/cost vector, so these (plus batch simulation and persona writes) each get an independent call budget and return `429` + `Retry-After` when exceeded. |
| Security response headers | `backend/app/security.py` (`SecurityHeadersMiddleware`) | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy` that scopes camera access to `self` only and explicitly denies microphone/geolocation — deliberate, since this app's core feature is same-origin webcam gaze tracking and nothing else should get that permission. |
| CORS restricted, not wildcard | `backend/app/main.py` | Dev origins are an explicit allowlist (`localhost:5173`); in production the frontend is served from the same origin as the API (see "Single-origin deployment" in `README.md`), so CORS is effectively moot rather than opened up. |
| No SQL injection surface | `backend/app/db.py` | Every query uses parameterized `?` placeholders — string-built SQL never includes request-derived values. |
| Authorization model (deliberately scoped, not full auth) | `SECURITY.md` (this doc) | This is a **hackathon prototype with no user accounts**, and end users are *intended* to create their own custom personas without a login (a core requested feature — see `AgentSetupForm.tsx`). We chose not to bolt on fake "auth" for its own sake. Instead, the actual risk (anyone spending the shared LLM credential, or spamming DB writes) is mitigated with rate limiting + audit logging above. **Path to production:** add real user accounts + per-user API keys before any multi-tenant deployment; the `rate_limit()`/`record_audit()` call sites are already exactly where a `Depends(current_user)` check would go. |

## 2. Protection of sensitive data & credentials

- **No secrets in git.** `LITE_LLM_API_KEY` and friends live in `backend/.env` (gitignored — see `.gitignore`), loaded via `python-dotenv`. `.env.example` ships with placeholders only. `git log -p -- '*.env'` has no matches.
- **No raw biometric data leaves the browser.** Real-shopper gaze tracking (webcam → iris landmarks → screen coordinates) runs entirely client-side (`frontend/src/components/EyeTracking/`). Only the small calibration *regression coefficients* (a handful of floats) are ever persisted, never a video frame or image of the user's face — see `backend/app/routers/calibration.py`.
- **What *does* leave the browser to a third-party LLM:** cropped screenshots of the *synthetic 3D store scene* for Agent-Mode narration (`routers/agent.py`), and aggregated, already-anonymous zone statistics for insight generation (`routers/analytics.py`). Neither contains any real person's image, location, or PII.
- **HTTPS-only in production**, enforced structurally rather than by convention: the single-origin deployment (`Dockerfile`, `render.yaml`) means the browser's own `getUserMedia` camera API will simply refuse to run over a non-HTTPS/mixed-origin connection — see "Deployment" in `README.md`.
- **LLM credential never reaches the browser.** All LLM calls are server-side only (`backend/app/llm_gateway.py`); the frontend never sees `LITE_LLM_API_KEY`.

## 3. Input & output validation, including malicious/unexpected inputs

- **Malformed binary input:** `/api/agent/gaze` accepts a base64 image; invalid base64 or an undecodable image returns a clean `400`, not a stack trace or a hang (`routers/agent.py::_decode_image`, tested in `backend/tests/test_security.py::test_agent_gaze_rejects_malformed_image`).
- **Oversized/adversarial requests:** grid size is capped at `MAX_GRID_CELLS = 100` (`schemas.py`), image dimensions are clamped to `MAX_IMAGE_DIMENSION = 1280px` server-side regardless of what's uploaded, and event batches are capped at 500 per call.
- **LLM output is never trusted blindly.** Every LLM response that drives *any* downstream logic is strictly parsed and range-checked: the judge LLM's chosen grid-cell `index` must be one of the indices actually offered, or the code silently substitutes a safe default and labels it as a fallback (`routers/agent.py::_judge_focus`). A hallucinated or malformed LLM response can never widen its blast radius past "the cosmetic narration text was a bit off."
- **Prompt-injection mitigation:** `persona_description` is end-user-authored free text that gets embedded in an LLM prompt. `backend/app/security.py::sanitize_free_text()` detects and redacts common instruction-override phrasing ("ignore previous instructions", `<system>` tags, code-fence breakouts) before it reaches the model, and every detection is written to the audit trail (`action: prompt_injection_pattern_detected`). This is explicitly a **secondary** control — the primary one is the output-validation bullet above, since even a successful injection can only ever pick a grid-cell index.
- **Automated evidence:** `backend/tests/test_security.py` and `test_sessions.py` exercise all of the above as repeatable, passing test cases (see §6).

## 4. Awareness of security threats & mitigation

| Threat | Mitigation |
|---|---|
| Shared LLM credential abused/drained by a public URL | Per-IP rate limiting on every LLM-backed endpoint (§1) |
| Prompt injection via free-text persona descriptions | Pattern-based sanitization + strict output validation (§3) |
| Denial-of-service via large/repeated batch simulation | `MAX_BATCH_SIMULATION_COUNT = 500` server-side cap + dedicated rate limit bucket |
| LLM endpoint unreachable/hung, blocking the whole app | Hard `ThreadPoolExecutor` timeout (`llm_gateway.run_with_timeout`, default 15s) on every LLM call, with a deterministic heuristic fallback for insights — this exact failure mode was caught live while building the test suite (see commit history) and is now covered by `test_insights_falls_back_to_heuristic_without_llm_credentials` |
| Clickjacking / unscoped camera access if embedded elsewhere | `X-Frame-Options: DENY` + scoped `Permissions-Policy` (§1) |
| SQL injection | Parameterized queries everywhere (§1) |
| Untracked destructive action on the shared persona library | Every persona create/replace/delete is audit-logged with a hashed actor reference (§5) |

## 5. Audit trail

`backend/app/db.py::audit_log` records every consequential action with a
timestamp, a **hashed** (never raw) caller reference, and a structured
detail payload:

- Persona create / replace / delete
- Batch simulation runs (requested count, personas used, elapsed time)
- Insight generation (which filter, and — critically — `llm` vs
  `heuristic_fallback` as the actual source)
- Agent-mode gaze calls (success / vision-error / judge-error, latency)
- Detected prompt-injection attempts

It's exposed read-only at `GET /api/audit/recent` (`routers/audit.py`) so
evaluators can watch it happen live rather than trusting a log file no one
can see. `actor_ref` is `sha256(client_ip)[:12]` — enough to distinguish
"one caller hammering an endpoint" from "many distinct callers" without
storing a real IP anywhere.

## 6. Responsible AI & human oversight for consequential actions

- **Every AI-generated output is explicitly labeled with its real source.** `generate_insights()` returns `generated_by: "llm" | "heuristic_fallback"` — never silently presented as one or the other (`routers/analytics.py`).
- **Grounded, not hallucinated.** The LLM insight prompt is instructed to use *only* the numbers computed and passed in by our own code ("do not invent any numbers not present here"); the model narrates measured data, it doesn't generate new metrics.
- **Human-in-the-loop by design, not by accident.** Insight generation is an explicit, user-triggered button click in the dashboard — never automatic/background. Agent-mode LLM narration is cosmetic HUD flavor text only; it structurally cannot alter navigation, gaze events logged for analytics, or purchase decisions (`routers/agent.py`'s module docstring walks through why).
- **Uncertainty is surfaced, not hidden.** `compare_real_vs_agent()` returns `sufficient_data: false` rather than a misleading similarity score when either side has zero sessions; the heuristic fallback template says outright *"no LLM call"* rather than pretending to be AI-generated.
- **Least privilege for the LLM gateway.** The LLM credential/gateway (`llm_gateway.py`) has no access to the database, the session/event pipeline, or navigation logic — it only ever receives a prompt and returns text. It structurally cannot take a "consequential action" even if fully compromised or manipulated via prompt injection.
- **Synthetic data is always labeled as synthetic.** Every batch-simulated session is tagged `meta.synthetic_batch: true` and uses `subject_type: "agent"` — there's no code path where a synthetic shopper's data could be mistaken for a real one downstream.

## 7. Running the evidence yourself

```bash
cd backend
pip install -r requirements-dev.txt
pytest -v
# 32 passed in <1s (as of this writing) - see backend/tests/
```

Covers: session lifecycle & validation, persona CRUD & audit logging,
batch-simulation limits & audit logging, real-vs-synthetic comparison &
insight fallback behavior, rate limiting, security headers, prompt-
injection sanitization, and malformed/oversized input rejection.

## 8. Known gaps (disclosed, not hidden)

- Rate limiting and the audit log are in-memory/single-process — fine for
  this deployment shape (one Docker container), but the first thing to
  swap for a multi-instance production deployment (Redis-backed limiter,
  DB-backed or shipped-to-a-log-pipeline audit trail).
- There is no user-account system; persona create/delete is available to
  any caller by design (see §1's authorization rationale table).
- We have not cross-checked this document against the actual internal NIQ
  GenAI Guidelines Word doc (no access from this environment) — see the
  note at the top of this file.
