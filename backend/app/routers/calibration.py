"""Persists and retrieves eye-tracking calibration profiles."""
import json
import re

from fastapi import APIRouter, HTTPException

from ..config import CALIBRATION_DIR
from ..schemas import CalibrationProfile, CalibrationSaveResponse

router = APIRouter(prefix="/api/calibration", tags=["calibration"])

# Only allow safe filename characters to prevent path traversal.
_SAFE_PROFILE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _profile_path(profile_id: str):
    if not _SAFE_PROFILE_ID.match(profile_id):
        raise HTTPException(status_code=400, detail="Invalid profile id")
    return CALIBRATION_DIR / f"{profile_id}.json"


@router.get("/{profile_id}", response_model=CalibrationProfile)
def get_calibration(profile_id: str) -> CalibrationProfile:
    path = _profile_path(profile_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Calibration profile not found")
    return CalibrationProfile.model_validate(json.loads(path.read_text(encoding="utf-8")))


@router.post("", response_model=CalibrationSaveResponse)
def save_calibration(profile: CalibrationProfile) -> CalibrationSaveResponse:
    path = _profile_path(profile.profile_id)
    path.write_text(profile.model_dump_json(indent=2), encoding="utf-8")
    return CalibrationSaveResponse(status="saved", profile=profile)


@router.delete("/{profile_id}")
def delete_calibration(profile_id: str) -> dict:
    path = _profile_path(profile_id)
    if path.exists():
        path.unlink()
    return {"status": "deleted", "profile_id": profile_id}
