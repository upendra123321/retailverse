"""FastAPI application entry point."""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .config import FRONTEND_DEV_ORIGINS, FRONTEND_DIST_DIR
from .routers import agent, analytics, audit, auth, calibration, model, personas, sessions, simulate, store
from .security import install_security_middleware, require_auth

app = FastAPI(
    title="Convenience Store Walkthrough API",
    description="Serves the 3D store model, eye-tracking calibration profiles, "
    "AI persona simulation, and shopper behavior analytics.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_DEV_ORIGINS,
    # True (rather than the prior False) so the auth session cookie survives
    # a direct cross-origin dev request (frontend on :5173 hitting the API
    # on :8000 without going through Vite's proxy). Safe because
    # allow_origins is an explicit allowlist, never "*" - the two can't be
    # combined per the CORS spec anyway.
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)
# Defense-in-depth response headers (X-Frame-Options, camera-scoped
# Permissions-Policy, etc.) - see security.py for rationale per header.
install_security_middleware(app)


@app.on_event("startup")
def on_startup() -> None:
    db.init_db()


# auth itself is never behind require_auth (see routers/auth.py docstring);
# every other router is, but require_auth is a no-op unless an operator has
# set APP_ACCESS_CODE (see security.auth_enabled) - so this is a zero-effect
# change for local dev / any deployment that hasn't opted in.
app.include_router(auth.router)
_protected = Depends(require_auth)
app.include_router(model.router, dependencies=[_protected])
app.include_router(calibration.router, dependencies=[_protected])
app.include_router(agent.router, dependencies=[_protected])
app.include_router(store.router, dependencies=[_protected])
app.include_router(personas.router, dependencies=[_protected])
app.include_router(sessions.router, dependencies=[_protected])
app.include_router(analytics.router, dependencies=[_protected])
app.include_router(simulate.router, dependencies=[_protected])
app.include_router(audit.router, dependencies=[_protected])


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# --- Single-origin production hosting -----------------------------------
# When a built frontend (frontend/dist, produced by `npm run build`) is
# present, serve it from the same FastAPI process/port as the API. This
# avoids CORS entirely in production and — critically for this app — means
# the whole thing is reachable over one HTTPS origin, which browsers require
# for webcam access (getUserMedia refuses insecure/mixed-origin contexts).
# In local dev, Vite serves the frontend on :5173 and proxies /api to :8000
# instead, so this block is a no-op until you run `npm run build`.
if FRONTEND_DIST_DIR.exists():
    assets_dir = FRONTEND_DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str) -> FileResponse:
        # Serve real static files (favicon, model, etc.) directly if present;
        # otherwise fall back to index.html so client-side routing works.
        candidate = FRONTEND_DIST_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST_DIR / "index.html")
