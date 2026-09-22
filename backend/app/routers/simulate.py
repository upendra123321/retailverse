"""Population-scale batch simulation: run many AI persona shoppers at once,
headlessly (no browser/3D rendering), so the real-vs-synthetic comparison in
/api/analytics/compare has statistically meaningful sample sizes instead of
one agent session at a time. See `backend/app/simulation.py` for the
persona decision logic (a Python port of the frontend's deterministic
navigation/gaze/purchase rules - not an LLM call, so this is fast, free, and
fully repeatable/auditable).
"""
from fastapi import APIRouter, HTTPException, Request

from .. import db, simulation
from ..schemas import BatchSimulateRequest, BatchSimulateResponse
from ..security import actor_ref, rate_limit
from .personas import load_personas

router = APIRouter(prefix="/api/simulate", tags=["simulate"])

# Batch simulation is cheap (pure Python, no LLM) but is a genuine write-
# amplification/DoS vector - up to MAX_BATCH_SIMULATION_COUNT (500) DB rows
# per call - so it gets its own budget, independent of the LLM-backed
# endpoints below.
_batch_rate_limit = rate_limit("simulate_batch", max_calls=20, window_seconds=300)


@router.post("/batch", response_model=BatchSimulateResponse, dependencies=[_batch_rate_limit])
def simulate_batch(request: BatchSimulateRequest, http_request: Request) -> BatchSimulateResponse:
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
    db.record_audit(
        action="batch_simulate",
        actor_ref=actor_ref(http_request),
        result="ok",
        detail={
            "requested_count": request.count,
            "created": result["created"],
            "persona_keys": request.persona_keys,
            "variant_id": request.variant_id,
            "elapsed_ms": result["elapsed_ms"],
        },
    )
    return BatchSimulateResponse(**result)
