# AI Persona Panels: Population-Scale Shopper Behavior Validation

A browser-based 3D convenience store where **real shoppers** (webcam gaze
tracking + keyboard navigation) and **AI shopper personas** (goal-directed
autonomous agents) run the *same* shopping journey, so their behavior can be
compared and benchmarked. Built for the NIQ "AI Persona Panels" hackathon
challenge.

- Real shopper: webcam-based gaze tracking (MediaPipe, runs fully client-side)
  + WASD navigation, product interactions, purchases.
- AI persona shopper: deterministic, persona-driven navigation and gaze
  simulation (Mission Shopper, Browser, Brand Loyalist, Switcher, or any
  custom persona you define) — an autonomous agent, not an LLM chat wrapper.
- Both subject types emit the **same event schema** (zone dwell, product
  interaction, purchase, navigation path, ad views) into one SQLite store.
- An analytics API/dashboard aggregates attention per zone, computes
  real-vs-synthetic similarity (cosine similarity, Pearson correlation,
  top-N zone overlap), and generates automated insight narratives.
- Supports A/B ad-placement variants so you can compare attention/engagement
  across store layouts.

## Quick start (TL;DR for teammates)

```bash
git clone https://github.com/upendra123321/retailverse.git
cd retailverse

# macOS / Linux
python3 scripts/setup.py && python3 scripts/dev.py

# Windows (PowerShell or cmd)
py -3.12 scripts\setup.py
py scripts\dev.py
```

Then open **http://localhost:5173**. That's it — one script installs
everything (backend venv, Python deps, frontend `npm install`, generates the
store's zone/product catalog from the GLB), the other launches both the
backend (`:8000`) and frontend (`:5173`) together. See
[Prerequisites](#prerequisites-macos-and-windows) below if `python3`/`py` or
`node` aren't installed yet, and [Setup](#2-one-command-setup-macos-windows-linux--identical)
for what to do about the `.env` file (only needed for optional LLM features —
everything else works without it).

## Architecture

```
┌─────────────────────────────── Browser (one HTTPS origin) ───────────────────────────────┐
│  React + Three.js (@react-three/fiber)                                                    │
│  ┌───────────────────────┐   ┌─────────────────────────┐   ┌───────────────────────────┐ │
│  │ Real-shopper mode      │   │ Agent (persona) mode     │   │ Analytics dashboard        │ │
│  │ - MediaPipe iris gaze  │   │ - personaNavigation.ts   │   │ - zone attention bars      │ │
│  │   (on-device, no video │   │   goal queue + dwell     │   │ - real vs. agent similarity│ │
│  │   leaves the browser)  │   │   time + glance bias     │   │ - LLM/heuristic insights   │ │
│  │ - WASD + mouse look    │   │ - state machine: seek →  │   │                            │ │
│  │ - crosshair raycast →  │   │   dwell → next target    │   │                            │ │
│  │   add-to-cart          │   │ - optional LLM narration │   │                            │ │
│  └──────────┬─────────────┘   └──────────┬───────────────┘   └──────────┬─────────────────┘ │
│             │ zone-dwell / interaction / purchase / navigation_sample events (batched)      │
└─────────────┼─────────────────────────────────────────────────────────────────────────────┘
              ▼
┌───────────────────────────────── FastAPI backend (:8000) ─────────────────────────────────┐
│ /api/store       store_layout.json + ad_zones.json (zones, product catalog, A/B variants) │
│ /api/personas    CRUD for persona library (personas.json)                                 │
│ /api/sessions    create / batched events / end  →  SQLite (sessions, events)              │
│ /api/analytics   zone stats, real-vs-agent compare (cosine/Pearson/top-N), insights        │
│ /api/agent/gaze  optional vision-LLM narration (Luna) — best-effort, hard-timeout,         │
│                  never blocks the deterministic simulation above                          │
│ /api/model       serves convenience_store.glb                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Project structure

```
backend/
  app/
    main.py              App entry, CORS (dev), routers, prod single-origin static serving
    config.py            Paths (model, data dir, store/ad-zone/persona JSON, frontend dist)
    db.py                 SQLite schema + session/event persistence + zone aggregation
    zone_catalog.py        Loads/merges store_layout.json + ad_zones.json into one lookup
    llm_gateway.py         Shared Azure LLM client, hard timeout + graceful fallback
    schemas.py              Pydantic models (sessions, events, personas, calibration, agent)
    routers/
      store.py              GET /api/store/layout, /api/store/ad-zones
      personas.py            GET/POST/DELETE /api/personas
      sessions.py            POST /api/sessions, .../events, .../end; GET listing/detail
      analytics.py           GET /api/analytics/zones, /compare; POST /api/analytics/insights
      agent.py                POST /api/agent/gaze (optional vision-LLM narration)
      calibration.py         GET/POST/DELETE eye-tracking calibration profiles
      model.py                GET /api/model -> convenience_store.glb
  data/
    store_layout.json        Curated zones extracted from the GLB (products/checkout/structural)
    ad_zones.json             A/B ad banner placements + creative variants
    personas.json              Editable persona library (the 4 archetypes + your custom ones)
    analytics.db                SQLite (created at runtime, gitignored)
  requirements.txt

frontend/
  src/
    App.tsx                    Top-level orchestration: mode switching, sessions, cart, dashboard
    api/client.ts               Typed fetch wrappers for every backend endpoint
    types/store.ts               Shared TS types (zones, ad variants, personas)
    session/
      useBehaviorSession.ts       Session lifecycle (create/batch-log/end), race-condition safe
      zoneLookup.ts                 Maps 3D mesh names -> analytics zone_id (GLB + dynamic ad meshes)
    components/
      Scene/                        Three.js store, raycasters (gaze zone + interaction crosshair),
                                     A/B ad banner rendering, navigation path sampler
      EyeTracking/                   MediaPipe FaceLandmarker hook, calibration UI, gaze regression
      Interaction/                   Shopping cart state + HUD
      Agent/                         Persona setup form, deterministic navigation engine,
                                     simulation controller, optional LLM narration overlay
      Dashboard/                     Analytics dashboard (zone attention, comparison, insights)
      HUD/                           Controls, mode/variant selectors, status

scripts/
  setup.py                    Cross-platform (macOS/Linux/Windows) one-time setup
  dev.py                       Cross-platform launcher for backend + frontend together
  extract_store_layout.py       Parses convenience_store.glb -> store_layout.json / ad_zones.json

convenience_store.glb         3D model (not generated by us — see challenge notes)
Dockerfile / render.yaml       Single-origin production build + Render one-click deploy
.env / .env.example            LLM gateway config (never commit .env)
```

## Prerequisites (macOS AND Windows)

- **Python 3.10+ (3.12 recommended)** — `python3 --version` (macOS/Linux) or `py --version` (Windows).
  Azure SDK deps (`azure-core`) require 3.10+; if you only have 3.9, install a newer
  Python first (macOS: `brew install python@3.12`; Windows: `winget install Python.Python.3.12`
  or python.org installer).
- **Node.js 18+** (v20/v22 verified) — `node --version`. Get it from
  [nodejs.org](https://nodejs.org) or `winget install OpenJS.NodeJS.LTS` on Windows.
- A webcam, and Chrome or Edge (recommended for MediaPipe WebGL support).

> ⚠️ **Do not copy someone else's `.env`, `.venv/`, or `frontend/node_modules/`
> folder between machines/OSes.** `.env` contains a private API key (never
> share/commit it). `.venv/` is Python-version- and OS-specific.
> `node_modules/` contains OS/CPU-architecture-specific native binaries
> (e.g. Rollup/esbuild) — copying it from a Mac to Windows (or Intel to Apple
> Silicon) fails with a cryptic `Cannot find module @rollup/rollup-<arch>`
> error. Everyone should run their own setup below.

## 1. Get the code

```bash
git clone https://github.com/upendra123321/retailverse.git
cd retailverse
```

(Or `git pull` if you already have it cloned.) Open a terminal in the project
root — the folder containing this `README.md` — for every command below.

## 2. One-command setup (macOS, Windows, Linux — identical)

```bash
# macOS / Linux
python3 scripts/setup.py

# Windows (PowerShell or cmd)
py -3.12 scripts\setup.py
```

Then edit the generated `.env` and set `LITE_LLM_API_KEY` to a valid key (ask
a teammate — do not reuse a key you find committed anywhere, and never commit
your own `.env`). Everything except the optional **LLM narration/insights**
features works fine without a real key — see
[Responsible AI: LLM failure handling](#llm-failure-handling--graceful-degradation).

<details>
<summary>What the setup script does / manual equivalent</summary>

1. Creates `./.venv` using whichever Python you invoked it with.
2. `pip install -r backend/requirements.txt` into that venv.
3. Copies `.env.example` → `.env` if missing.
4. `npm install` in `frontend/`.
5. Regenerates `backend/data/store_layout.json` from `convenience_store.glb`.

Re-run any time; every step is safe to repeat.
</details>

## 3. Launch the app (macOS, Windows, Linux — identical)

```bash
# macOS / Linux
python3 scripts/dev.py

# Windows
py scripts\dev.py
```

Then open **http://localhost:5173** in Chrome or Edge.

<details>
<summary>Running backend/frontend separately (manual equivalent)</summary>

**Terminal 1 — backend API:**

```bash
# macOS/Linux
.venv/bin/python -m uvicorn backend.app.main:app --reload --port 8000
# Windows
.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

**Terminal 2 — frontend dev server:**

```bash
cd frontend
npm run dev
```
</details>

## 4. Using the app (real shopper)

1. **Allow camera access** when prompted — MediaPipe FaceLandmarker runs
   entirely in-browser via WebAssembly; **no video frame is ever sent to the
   backend**, only the fitted calibration coefficients (2 small numeric
   models) and derived screen coordinates.
2. **Calibrate your eyes**: click "Calibrate Eyes" in the HUD. Look at each
   of the 9 dots and press `Space`; calibration is fitted and saved to
   `backend/data/calibration_profiles/default.json`.
3. **Navigate**: click the 3D view to lock the pointer, then `W`/`A`/`S`/`D`
   or arrow keys to move, mouse to look, `Esc` to release the pointer.
4. **Shop**: look at a product until the crosshair prompt appears, press `E`
   to inspect / add to cart, `C` to open the cart and checkout.
5. Pick an **ad variant** (A/B) from the HUD dropdown before you start, to
   test different banner placements.

Every dwell/interaction/purchase/navigation sample is logged to a session
tied to `subject_type = "real"` and the selected `variant_id`.

## 5. Using the app (AI persona shopper)

Click **Agent Mode** in the HUD, pick a persona from the library (Mission
Shopper, Browser, Brand Loyalist, Switcher) or define a custom one, choose an
ad variant, and click **Start Simulation**.

### How persona-driven navigation works (the differentiator)

This is **not** an LLM chat loop deciding every step — that would be slow,
non-repeatable, and hard to audit. Instead, `personaNavigation.ts` +
`AgentSimulationController.tsx` implement a small autonomous agent:

1. **Goal decomposition**: `buildTargetQueue()` turns a persona's
   `navigation_style` (`direct` / `explore` / `compare`), `target_categories`,
   and `preferred_product_keys` into an ordered queue of store zones to visit
   — e.g. a Mission Shopper's queue is just `[preferred product, checkout]`;
   a Switcher's queue interleaves every product in its target categories
   (comparison behavior) before checkout; a Browser rebuilds a
   near-endless queue across the whole store (`rebuildQueueForContinuousBrowsing`).
2. **Autonomous execution**: a `seeking → dwelling → next target` state
   machine steers the camera toward each queued zone (yaw-to-target with
   obstacle avoidance and ground snapping), no per-frame LLM call involved.
3. **Persona-weighted dwell & gaze**: `dwellDurationMs()` samples a
   persona-specific dwell time (with jitter, capped by `patience_seconds`);
   `maybePickGlanceZone()` periodically diverts the *simulated gaze point*
   (independent of camera heading, like a human glancing sideways) toward ads
   or nearby products, weighted by `ad_attention_bias` — this is the gaze
   simulation used to answer "did the AI persona look at our ad?"
4. **Purchase decision**: when the agent reaches checkout, each product zone
   it visited along the way is independently rolled against a
   price-adjusted probability (`purchaseProbability()` in
   `personaNavigation.ts`): `price_sensitivity: "low"` personas buy at their
   flat `purchase_likelihood` regardless of price; `"medium"`/`"high"`
   personas get that likelihood scaled down for above-(synthetic-)average-
   priced items and slightly up for below-average ones — a simple,
   explainable stand-in for real price elasticity that gives
   promotion/pricing experiments something to actually move. Purchases use
   the same synthetic price catalog (`data/productCatalog.ts`) a real
   shopper's cart uses, so real-vs-agent purchase data stays comparable.
5. **Tool/API selection**: the agent logs the exact same
   `zone_dwell` / `product_interaction` / `purchase` / `navigation_sample`
   events, through the exact same `/api/sessions/*` endpoints, as a real
   shopper — this is what makes real-vs-synthetic comparison apples-to-apples.

### Optional LLM narration layer

Separately, `useAgentSimulation.ts` periodically screenshots the 3D canvas,
sends grid slices to a vision LLM ("Luna") for scene description, then asks a
judge LLM which cell the persona would look at and why. This is **purely a
qualitative narration/audit-trail layer** (HUD flavor text + an
`agent_thought` event) — it never drives movement or the logged gaze/dwell
data, and if it times out or fails, the simulation continues identically. See
[LLM failure handling](#llm-failure-handling--graceful-degradation).

### Custom personas

Personas are structured JSON (`backend/data/personas.json`), editable via
`POST /api/personas` or the Agent Mode setup form's "custom persona" tab —
no code changes needed to add a new consumer segment:

```json
{
  "persona_key": "budget_hunter",
  "label": "Budget Hunter",
  "description": "Ignores brand entirely; beelines for the cheapest item in a category.",
  "navigation_style": "compare",
  "target_categories": ["breakfast"],
  "preferred_product_keys": [],
  "patience_seconds": 45,
  "browse_probability": 0.3,
  "ad_attention_bias": 0.2,
  "price_sensitivity": "high",
  "purchase_likelihood": 0.7
}
```

## 6. Analytics dashboard

Click **View Insights Report** in the HUD to open the dashboard
(`AnalyticsDashboard.tsx`), which calls:

- `GET /api/analytics/zones` — dwell time, visit/interaction/purchase counts
  per zone, filterable by subject type / persona / A-B variant; flags
  zero-attention zones (answers "did shoppers look somewhere we put no ad?").
- `GET /api/analytics/compare` — for a given persona + variant, computes
  **cosine similarity**, **Pearson correlation**, and **top-3 zone overlap**
  between the real-shopper attention distribution and the AI persona's —
  this is the "benchmark and quantify similarity" success criterion. Example
  from a live local test run (11 real sessions vs. 1 agent session):
  `cosine_similarity: 0.95`, `pearson_correlation: 0.999`, `top3_zone_overlap: 0.67`.
- `POST /api/analytics/insights` — an LLM-narrated summary of the above
  (branding/shelf-placement/ad-effectiveness recommendations), with a
  deterministic heuristic fallback (see below) when the LLM is unavailable —
  every insight is generated from the actual aggregated numbers passed into
  the prompt, never fabricated independent of the data. The response's
  `generated_by` field is always `"llm"` or `"heuristic_fallback"`, so the UI
  never misrepresents a fallback as model output.

## Store layout & attention zones

`scripts/extract_store_layout.py` parses `convenience_store.glb`, groups mesh
nodes into physical product instances, and applies a curated catalog to
produce meaningful zones (`backend/data/store_layout.json`): 8 product
shelves, 1 merged checkout counter, 6 structural zones. `mesh_node_names` on
each zone lets the frontend map a raycast hit straight back to a `zone_id`.
`backend/data/ad_zones.json` defines A/B ad banner placements/creatives
layered on top; `frontend/src/session/zoneLookup.ts` merges both into one
mesh-name → `zone_id` lookup used by every raycaster in the scene.

## How the eye tracking works

- MediaPipe's `FaceLandmarker` (via `@mediapipe/tasks-vision`, loaded from its
  official CDN model/WASM assets) detects 478 face landmarks per frame,
  including refined iris centers — entirely in the browser.
- For each eye, the iris center is normalized against the eye-corner span to
  get a head-pose-tolerant 0–1 "look ratio" (x, y); both eyes are averaged
  into one feature vector per frame.
- During calibration, feature vectors are smoothed, invalid frames discarded,
  and the noisiest 15% of each point's samples trimmed before averaging. A
  regularized affine least-squares regression (implemented from scratch, no
  ML library) fits two small models (X, Y) mapping features → normalized
  screen coordinates.
- The fitted coefficients are sent to the backend and stored as a JSON
  profile, reloaded automatically next time.
- In the 3D scene, `ZoneAttentionTracker.tsx` raycasts from the camera through
  the predicted screen-space gaze point every 200ms; a sustained hit on a
  zone's mesh accumulates dwell time, flushed as a `zone_dwell` event on zone
  change or session end.

**Tips for best accuracy**: calibrate in the same lighting/seating position
you'll navigate in, keep your head reasonably still after calibrating, and
recalibrate if you change position or lighting.

## Deployment

The app is built to run as **one process on one HTTPS origin** — this matters
because browsers refuse `getUserMedia` (webcam) on insecure/mixed-origin
contexts, so a "frontend on domain A, API on domain B" split would break real
gaze tracking on anything but `localhost`.

```bash
# 1. Build the frontend once:
cd frontend && npm run build && cd ..
# 2. Run the backend - it now also serves frontend/dist/ at "/":
.venv/bin/python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Open `http://<host>:8000/` — same origin serves the SPA, the GLB model, and
every `/api/*` route. (`FRONTEND_DIST_DIR` in `backend/app/config.py`; see
`main.py`'s static-file mount, a no-op until `frontend/dist` exists.)

### Recommended: Render.com (free, least setup)

A `Dockerfile` (multi-stage: builds the frontend, then a slim Python 3.12
runtime) and `render.yaml` blueprint are included.

1. Push this repo to GitHub (see [Getting this into git](#getting-this-into-git)).
2. In the [Render dashboard](https://dashboard.render.com), **New +** →
   **Blueprint**, point it at the repo — it reads `render.yaml` and builds
   the `Dockerfile` automatically.
3. Set the `LITE_LLM_*` env vars in the Render dashboard (marked `sync: false`
   in the blueprint so they're never committed).
4. You get a free `https://<name>.onrender.com` URL — HTTPS included, so
   webcam gaze tracking works out of the box.

**Free-tier caveats** (documented in `render.yaml`): no persistent disk, so
`backend/data/analytics.db` resets on every redeploy/restart; free services
also sleep after ~15 min idle (30–60s cold-start on the next request) — wake
it a minute before a live demo, or upgrade the instance for the actual slot.

### Alternative: your AWS account (bonus, same Dockerfile)

The same image deploys to **AWS App Runner** (point it at an ECR image or a
connected GitHub repo — closest to Render's zero-ops model, automatic HTTPS)
or **AWS Lightsail Containers**. Either gives you a scalable path beyond the
prototype using infrastructure NIQ already trusts. For persistence beyond a
demo, swap SQLite for **RDS Postgres** (the `db.py` module isolates all SQL
behind a handful of functions, so this is a contained change) and put the
GLB/static assets behind **CloudFront** for latency.

> **Known constraint, verified during this build**: the hackathon LLM gateway
> (`llm-api-cis.azure-intlsd-np.nielsencsp.net`) is only reachable from NIQ's
> internal network — it times out from the open internet. Deploying to Render
> *or* a generic AWS account behaves identically here: LLM narration/insights
> automatically fall back to the heuristic engine (see below) unless the host
> has VPN/network access into NIQ's corporate network. This does not block the
> core success criteria — attention tracking, persona navigation, and
> real-vs-synthetic comparison do not depend on the LLM at all.

### Getting this into git

This folder is now a local git repo (`git init` already run, `.env` and the
SQLite DB are gitignored). To push it to a remote for your team / for
Render's git-based deploy, either use GitHub directly, or ask this assistant
to run the `share`/`new-repo` skill to push a Cursor-hosted copy.

## Responsible AI & security

Mapped to the challenge's "Responsible AI and security" criterion (NIQ GenAI
guidance: protect data/credentials, least privilege, validate inputs/outputs,
audit trail, human approval for consequential actions):

- **Data minimization**: raw webcam video never leaves the browser. Only
  478-landmark-derived, calibration-fitted screen coordinates are used
  client-side; only aggregated behavioral events (zone id, timestamps,
  durations) are sent to the backend — no biometric imagery is ever
  persisted or transmitted.
- **Credential handling**: the LLM API key lives only in a local, gitignored
  `.env` (see `.env.example` for the required shape); the backend gateway
  (`llm_gateway.py`) reads it server-side only and never echoes it to the
  client or logs. Render/App Runner env vars are marked `sync: false` /
  configured out-of-band, never committed.
- **LLM failure handling & graceful degradation**: every LLM call
  (`llm_gateway.complete_chat`) runs through `run_with_timeout` on a
  `ThreadPoolExecutor` with a hard, configurable timeout (`LLM_TIMEOUT_SECONDS`,
  default 15s) — a hung/unreachable endpoint fails fast instead of freezing
  the UI. Both LLM-touching features have deterministic non-LLM fallbacks:
  - Agent narration: simulation/movement/gaze/dwell logging is 100%
    independent of the LLM (see [persona navigation](#how-persona-driven-navigation-works-the-differentiator));
    a failed narration call only sets a soft HUD `error` string.
  - Insights: `analytics.py`'s heuristic fallback derives the same style of
    recommendations directly from the aggregated zone/comparison numbers
    (top zone, zero-attention zones, similarity score) when the LLM is
    unreachable or misconfigured, and every response's `generated_by` field
    (`"llm"` or `"heuristic_fallback"`) records which one actually produced
    the text, so it's never silently misrepresented as model output.
- **Grounded, auditable outputs**: LLM insight narratives are generated *from*
  the computed aggregate statistics passed into the prompt (not free
  invention), and every agent "thought"/narration is logged as an
  `agent_thought` event alongside the deterministic events, giving a full
  session audit trail (`GET /api/sessions/{id}` returns every event).
- **Consequential actions**: the only "consequential" action in this
  prototype is a purchase decision, and it is always a deterministic,
  probability-driven function of persona config (`purchase_likelihood`,
  `price_sensitivity`) — never an autonomous LLM tool call — keeping a human
  (the persona designer) in control of the policy that decides it.
- **Least privilege**: the backend only exposes read access to store/persona
  config and write access scoped to session/event data; there is no
  file-system or shell access reachable from any API route.

## Known limitations & roadmap

- Price elasticity is a simple linear stand-in (`purchaseProbability()`)
  around one reference price, not a learned/calibrated demand curve — good
  enough to make persona-vs-persona pricing comparisons directional, not to
  forecast real revenue.
- Movement uses a simple downward raycast to keep the camera at eye-height;
  no wall-collision detection yet.
- Gaze estimation is a lightweight, calibration-based approximation (not
  sub-degree accurate) — appropriate for zone-level attention analytics, not
  clinical eye-tracking.
- SQLite is intentional for hackathon-scale, zero-setup persistence; the
  roadmap to production is Postgres (RDS) with the same `db.py` interface.
- Only one store model/layout today; the A/B system already supports
  multiple ad-banner variants — extending it to swap shelf/product placement
  entirely is the natural next step for full planogram testing.
- **Roadmap beyond the prototype**: this pipeline (real sessions + persona
  sessions → same event schema → same comparison metrics) is designed to
  plug into NIQ's existing Brand Lift and CPS measurement frameworks as an
  additional, much faster/cheaper input signal — run a persona panel first to
  pre-screen packaging/shelf/media variants in hours instead of the weeks a
  physical test store takes, then validate the most promising variants with a
  smaller real-shopper panel instead of a full physical study.
