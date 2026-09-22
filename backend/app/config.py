"""Application configuration and shared paths."""
import os
from pathlib import Path

# backend/app/config.py -> repo root is two levels up
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MODEL_PATH = REPO_ROOT / "convenience_store.glb"

# STATIC_DATA_DIR holds read-only reference data checked into the repo
# (store_layout.json, ad_zones.json) - the same "source", never generated or
# mutated by any endpoint, in every environment including tests. This is
# deliberately NOT affected by APP_DATA_DIR below.
STATIC_DATA_DIR = REPO_ROOT / "backend" / "data"
STORE_LAYOUT_PATH = STATIC_DATA_DIR / "store_layout.json"
AD_ZONES_PATH = STATIC_DATA_DIR / "ad_zones.json"

# DATA_DIR holds mutable runtime state (analytics.db, calibration profiles,
# the editable persona library). APP_DATA_DIR override exists so the test
# suite (backend/tests/conftest.py) can point all of THIS at a throwaway
# temp directory instead of the real backend/data/analytics.db - tests must
# never read or mutate real behavioral data or the real persona library.
DATA_DIR = Path(os.getenv("APP_DATA_DIR")) if os.getenv("APP_DATA_DIR") else STATIC_DATA_DIR
CALIBRATION_DIR = DATA_DIR / "calibration_profiles"
PERSONAS_PATH = DATA_DIR / "personas.json"
FRONTEND_DIST_DIR = REPO_ROOT / "frontend" / "dist"

CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)

FRONTEND_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
