"""Application configuration and shared paths."""
from pathlib import Path

# backend/app/config.py -> repo root is two levels up
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MODEL_PATH = REPO_ROOT / "convenience_store.glb"
DATA_DIR = REPO_ROOT / "backend" / "data"
CALIBRATION_DIR = DATA_DIR / "calibration_profiles"
STORE_LAYOUT_PATH = DATA_DIR / "store_layout.json"
AD_ZONES_PATH = DATA_DIR / "ad_zones.json"
PERSONAS_PATH = DATA_DIR / "personas.json"
FRONTEND_DIST_DIR = REPO_ROOT / "frontend" / "dist"

CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)

FRONTEND_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
