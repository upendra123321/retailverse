# Convenience Store Walkthrough + Eye Tracking

Navigate a 3D convenience store model in your browser with keyboard/mouse, while
your eye movements are tracked and overlaid live using MediaPipe. A FastAPI
backend serves the 3D model and stores calibration profiles; a React + Three.js
frontend renders the scene and runs eye tracking fully in the browser.

## Project structure

```
backend/                 FastAPI app
  app/
    main.py              App entry point, CORS, routers
    config.py             Paths (model file, calibration data dir)
    llm_gateway.py        Shared Azure LLM client for all agents
    schemas.py            Pydantic models for calibration profiles + agent gaze
    routers/
      model.py            GET /api/model -> serves convenience_store.glb
      calibration.py      GET/POST/DELETE /api/calibration -> saved profiles
      agent.py            POST /api/agent/gaze -> shopper agent gaze simulation
  data/calibration_profiles/   JSON calibration profiles (created at runtime)
  requirements.txt

frontend/                React + Vite + TypeScript app
  src/
    App.tsx               Top-level app: scene + HUD + calibration + gaze cursor + agent mode
    components/
      Scene/               Three.js store scene + first-person controls
      EyeTracking/          MediaPipe FaceLandmarker hook, calibration, gaze math
      HUD/                  On-screen instructions/status panel
      Agent/                Agent Mode: setup form, autonomous navigation, gaze overlay
    api/client.ts          Calls to the FastAPI calibration + agent endpoints

convenience_store.glb    The 3D model (served by the backend)
.venv/                   Python virtual environment (backend, created locally — not shared)
.env                     Local secrets (LLM API key) — created locally, never shared/committed
.env.example             Template for .env
```

## Prerequisites (macOS AND Windows)

- **Python 3.10+ (3.12 recommended)** — `python3 --version` (macOS/Linux) or `py --version` (Windows).
  Azure SDK deps (`azure-core`) require 3.10+; if you only have 3.9, install a newer
  Python first (macOS: `brew install python@3.12`; Windows: `winget install Python.Python.3.12`
  or python.org installer).
- **Node.js 18+** (v20/v22 verified) — `node --version`. Get it from
  [nodejs.org](https://nodejs.org) or `winget install OpenJS.NodeJS.LTS` on Windows.
- A webcam, and Chrome or Edge (recommended for MediaPipe WebGPU/WebGL support).

> ⚠️ **Do not copy someone else's `.env`, `.venv/`, or `frontend/node_modules/`
> folder between machines/OSes.** `.env` contains a private API key (never
> share/commit it). `.venv/` is Python-version- and OS-specific.
> `node_modules/` contains OS/CPU-architecture-specific native binaries
> (e.g. Rollup/esbuild) — copying it from a Mac to Windows (or Intel to Apple
> Silicon) fails with a cryptic `Cannot find module @rollup/rollup-<arch>`
> error. Everyone should run their own setup below.

## 1. Get the code

Unzip/copy this folder (or clone the repo) onto your machine, then open a
terminal in the project root (the folder containing this `README.md`).

## 2. One-command setup (macOS, Windows, Linux — identical)

A cross-platform Python script handles the venv, backend deps, `.env`, and
`npm install` for you, on any OS:

```bash
# macOS / Linux
python3 scripts/setup.py

# Windows (PowerShell or cmd)
py -3.12 scripts\setup.py
```

Then edit the generated `.env` and set `LITE_LLM_API_KEY` to a valid key (ask
a teammate — do not reuse a key you find committed anywhere, and never commit
your own `.env`). Everything except **Agent Mode** works fine without a real
key (Agent Mode also has a built-in offline heuristic fallback if the LLM call
fails — see [Agent Mode](#agent-mode-simulated-shopper) below).

<details>
<summary>What the setup script does / manual equivalent</summary>

1. Creates `./.venv` using whichever Python you invoked it with.
2. `pip install -r backend/requirements.txt` into that venv.
3. Copies `.env.example` → `.env` if missing.
4. `npm install` in `frontend/`.
5. Regenerates `backend/data/store_layout.json` from `convenience_store.glb`
   (product/zone catalog used for attention analytics — see
   [Store layout & attention zones](#store-layout--attention-zones)).

Re-run any time; every step is safe to repeat.
</details>

## 3. Launch the app (macOS, Windows, Linux — identical)

One command starts **both** the backend (port 8000) and frontend (port 5173)
together, with clearly-prefixed logs, and shuts both down on Ctrl+C:

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

## Shared LLM gateway

All agent LLM calls should use `backend.app.llm_gateway` rather than creating
their own Azure client. The gateway reads its configuration from `.env`
(see setup step 2 above), which must define:

```dotenv
LITE_LLM_ENDPOINT=https://llm-api-cis.azure-intlsd-np.nielsencsp.net/
LITE_LLM_API_KEY=Bearer_REPLACE_WITH_ROTATED_KEY
LITE_LLM_MODEL=hack-fest-gpt-5.6-luna
LITE_LLM_API_VERSION=2025-03-01-preview
```

An agent can make a simple call:

```python
from backend.app.llm_gateway import call_llm

answer = call_llm(
  "Summarize the shopper's journey.",
  system_prompt="You are a concise retail analytics agent.",
)
```

For multi-turn calls, use `complete_chat` with `LLMMessage` objects. The
gateway loads configuration lazily, applies the default model, adds the
authorization header, and raises `LLMGatewayError` without exposing secrets.

## Agent Mode (simulated shopper)

Agent Mode replaces manual keyboard/mouse navigation with an autonomous,
LLM-driven "digital twin" shopper that wanders the store and reports where it
is looking, based on a persona you describe.

1. Click **Agent Mode** in the HUD panel (this pauses your webcam eye tracking).
2. Fill in the setup form:
   - **Persona / backstory** — a paragraph describing who this shopper is and what they care about.
   - **Shopper name** and **Shopper age**.
   - **Capture interval (seconds)** — how often the agent re-evaluates its gaze.
   - **Grid size** — e.g. `4x4`, `5x5`, `8x8` (rows x cols, max 12x12 / 100 cells).
3. Click **Start Simulation**. The camera begins autonomously wandering the
   store (with basic obstacle avoidance), and a grid overlay appears.
4. Every capture interval, the app:
   1. Screenshots the current 3D view.
   2. Slices it into the configured grid of sub-images.
   3. Sends all sub-images in one request to the vision LLM ("Luna"), which
      returns a short description of each grid cell.
   4. Sends those descriptions plus the shopper persona to a second "judge"
      LLM call, which decides which cell the shopper would most likely be
      looking at right now, with a short reason.
   5. Highlights that cell and marks its center as the gaze focus point.
5. Click **Stop Simulation** at any time to return to manual navigation mode.

Both LLM calls run through the shared `backend.app.llm_gateway` client and
require the same `.env` configuration described above.

## 5. Using the app

1. **Allow camera access** when prompted — this powers the eye tracker (MediaPipe FaceLandmarker running locally in your browser via WebAssembly; no video is ever sent to the backend).
2. **Calibrate your eyes**: click "Calibrate Eyes" in the HUD panel.
   - A 3×3 grid of dots appears one at a time.
  - Sit centered about 50–70 cm from the webcam, keep your head still, and look directly at the highlighted (yellow) dot. Press `Space` to capture; the tracker waits briefly for your gaze to settle, then records a stable sample window.
   - Repeat for all 9 points. When done, calibration is fitted and saved to the backend (`backend/data/calibration_profiles/default.json`) so it's remembered next time.
   - Press `Esc` any time to cancel calibration.
3. **Navigate the store**: click anywhere on the 3D view to lock the mouse pointer, then:
   - `W`/`A`/`S`/`D` or arrow keys — move
   - Mouse — look around
   - `Esc` — release the mouse pointer
4. After calibrating, a red **gaze cursor** dot overlays the screen showing your estimated on-screen gaze in real time while you walk through the store. Recalibrate any time via the HUD button (e.g. if you move relative to the webcam).

## How the eye tracking works

- MediaPipe's `FaceLandmarker` (via `@mediapipe/tasks-vision`, loaded from its official CDN model/WASM assets) detects 478 face landmarks per frame, including refined iris centers.
- For each eye, the iris center is normalized against the eye-corner span to get a head-pose-tolerant 0–1 "look ratio" (x and y), then both eyes are averaged into one feature vector per frame.
- During calibration, feature vectors are smoothed, invalid frames are discarded, and the noisiest 15% of each point's samples are trimmed before averaging. A regularized affine least-squares regression (implemented from scratch, no ML library needed) fits two small models (X and Y) mapping features → normalized screen coordinates.
- The fitted coefficients are sent to the FastAPI backend and stored as a JSON profile, and reloaded automatically next time you open the app.

**Tips for best accuracy**: calibrate in the same lighting/seating position you'll use for navigating, keep your head reasonably still after calibrating, and recalibrate if you change position or lighting.

## Notes / limitations

- Movement uses a simple downward raycast to keep you at eye-height above the store floor; there is no wall-collision detection yet.
- Gaze estimation is a lightweight, calibration-based approximation (not sub-degree accurate); it's designed for a fun, responsive HUD cursor rather than pixel-perfect tracking.
- The Vite dev server is for local development only — do not expose it to the network as-is.
