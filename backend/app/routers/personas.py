"""Structured, editable AI shopper persona library (backend/data/personas.json).

Personas are data, not code: this is what lets the team add/tune custom
personas (beyond the four in the challenge brief) without touching the
agent logic. Each persona's navigation_style/target_categories/attention
biases directly drive the agent's goal-directed movement and gaze weighting
(see frontend AgentSimulationController + useAgentSimulation).
"""
import json

from fastapi import APIRouter, HTTPException, Request

from .. import db
from ..config import PERSONAS_PATH
from ..schemas import Persona, PersonaListResponse
from ..security import actor_ref, rate_limit

router = APIRouter(prefix="/api/personas", tags=["personas"])

# Persona create/delete edit a shared library every future agent session
# reads from, so - unlike read-only GET - they're rate-limited and
# audit-logged as consequential/administrative actions, even though (per
# this app's UX decision, see AgentSetupForm.tsx) any end user can create
# their own custom persona without a login.
_mutation_rate_limit = rate_limit("personas_write", max_calls=30, window_seconds=300)


def load_personas() -> list[dict]:
    """Public loader reused by the batch simulation engine (simulation.py) so
    both the CRUD API and headless population-scale simulation always read
    the same persona library, with no duplicated parsing logic."""
    if not PERSONAS_PATH.exists():
        return []
    data = json.loads(PERSONAS_PATH.read_text(encoding="utf-8"))
    return data.get("personas", [])


def _save(personas: list[dict]) -> None:
    payload = {
        "_comment": (
            "Structured, editable AI shopper persona library. Drives both agent "
            "navigation and gaze weighting. Edit here or via POST /api/personas."
        ),
        "personas": personas,
    }
    PERSONAS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


@router.get("", response_model=PersonaListResponse)
def list_personas() -> PersonaListResponse:
    return PersonaListResponse(personas=[Persona.model_validate(p) for p in load_personas()])


@router.post("", response_model=Persona, dependencies=[_mutation_rate_limit])
def upsert_persona(persona: Persona, request: Request) -> Persona:
    """Create or replace a custom persona by persona_key."""
    personas = load_personas()
    is_replace = any(p.get("persona_key") == persona.persona_key for p in personas)
    personas = [p for p in personas if p.get("persona_key") != persona.persona_key]
    personas.append(persona.model_dump())
    _save(personas)
    db.record_audit(
        action="persona_replace" if is_replace else "persona_create",
        actor_ref=actor_ref(request),
        result="ok",
        detail={"persona_key": persona.persona_key, "label": persona.label},
    )
    return persona


@router.delete("/{persona_key}", dependencies=[_mutation_rate_limit])
def delete_persona(persona_key: str, request: Request) -> dict:
    personas = load_personas()
    remaining = [p for p in personas if p.get("persona_key") != persona_key]
    if len(remaining) == len(personas):
        db.record_audit(
            action="persona_delete", actor_ref=actor_ref(request), result="not_found",
            detail={"persona_key": persona_key},
        )
        raise HTTPException(status_code=404, detail="Persona not found")
    _save(remaining)
    db.record_audit(
        action="persona_delete", actor_ref=actor_ref(request), result="ok", detail={"persona_key": persona_key}
    )
    return {"status": "deleted", "persona_key": persona_key}
