"""Structured, editable AI shopper persona library (backend/data/personas.json).

Personas are data, not code: this is what lets the team add/tune custom
personas (beyond the four in the challenge brief) without touching the
agent logic. Each persona's navigation_style/target_categories/attention
biases directly drive the agent's goal-directed movement and gaze weighting
(see frontend AgentSimulationController + useAgentSimulation).
"""
import json

from fastapi import APIRouter, HTTPException

from ..config import PERSONAS_PATH
from ..schemas import Persona, PersonaListResponse

router = APIRouter(prefix="/api/personas", tags=["personas"])


def _load() -> list[dict]:
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
    return PersonaListResponse(personas=[Persona.model_validate(p) for p in _load()])


@router.post("", response_model=Persona)
def upsert_persona(persona: Persona) -> Persona:
    """Create or replace a custom persona by persona_key."""
    personas = _load()
    personas = [p for p in personas if p.get("persona_key") != persona.persona_key]
    personas.append(persona.model_dump())
    _save(personas)
    return persona


@router.delete("/{persona_key}")
def delete_persona(persona_key: str) -> dict:
    personas = _load()
    remaining = [p for p in personas if p.get("persona_key") != persona_key]
    if len(remaining) == len(personas):
        raise HTTPException(status_code=404, detail="Persona not found")
    _save(remaining)
    return {"status": "deleted", "persona_key": persona_key}
