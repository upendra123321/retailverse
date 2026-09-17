"""Serves derived store metadata: the product/zone catalog (extracted offline
from convenience_store.glb by scripts/extract_store_layout.py) and the
hand-placed virtual ad banner slots (backend/data/ad_zones.json).
"""
import json

from fastapi import APIRouter, HTTPException

from ..config import AD_ZONES_PATH, STORE_LAYOUT_PATH

router = APIRouter(prefix="/api/store", tags=["store"])


@router.get("/layout")
def get_store_layout() -> dict:
    if not STORE_LAYOUT_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="store_layout.json not found - run `python scripts/extract_store_layout.py` first.",
        )
    return json.loads(STORE_LAYOUT_PATH.read_text(encoding="utf-8"))


@router.get("/ad-zones")
def get_ad_zones() -> dict:
    if not AD_ZONES_PATH.exists():
        raise HTTPException(status_code=404, detail="ad_zones.json not found")
    return json.loads(AD_ZONES_PATH.read_text(encoding="utf-8"))
