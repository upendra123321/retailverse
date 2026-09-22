"""Population-scale batch simulation: run many AI persona shoppers at once,
headlessly (no browser/3D rendering), so the real-vs-synthetic comparison in
/api/analytics/compare has statistically meaningful sample sizes instead of
one agent session at a time. See `backend/app/simulation.py` for the
persona decision logic (a Python port of the frontend's deterministic
navigation/gaze/purchase rules - not an LLM call, so this is fast, free, and
fully repeatable/auditable).
"""
from fastapi import APIRouter, HTTPException

from .. import simulation
from ..schemas import BatchSimulateRequest, BatchSimulateResponse
from .personas import load_personas

router = APIRouter(prefix="/api/simulate", tags=["simulate"])


@router.post("/batch", response_model=BatchSimulateResponse)
def simulate_batch(request: BatchSimulateRequest) -> BatchSimulateResponse:
    personas = load_personas()
    if not personas:
        raise HTTPException(status_code=400, detail="No personas defined - add at least one via /api/personas first")

    if request.persona_keys:
        known_keys = {p["persona_key"] for p in personas}
        unknown = set(request.persona_keys) - known_keys
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown persona_key(s): {sorted(unknown)}")

    result = simulation.run_batch(
        count=request.count,
        persona_keys=request.persona_keys,
        variant_id=request.variant_id,
        personas=personas,
    )
    return BatchSimulateResponse(**result)
