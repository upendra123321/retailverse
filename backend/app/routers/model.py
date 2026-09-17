"""Serves the 3D convenience store model to the frontend."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import MODEL_PATH

router = APIRouter(prefix="/api/model", tags=["model"])


@router.get("")
def get_model() -> FileResponse:
    """Return the convenience store GLB model file."""
    if not MODEL_PATH.exists():
        raise HTTPException(status_code=404, detail="Model file not found on server")
    return FileResponse(
        path=MODEL_PATH,
        media_type="model/gltf-binary",
        filename=MODEL_PATH.name,
    )
