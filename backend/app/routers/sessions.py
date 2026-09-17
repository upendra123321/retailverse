"""Session lifecycle + behavioral event ingestion for both real shoppers
(webcam gaze -> zone raycasting, done client-side) and AI persona agents.

This is the data backbone for every downstream analytics/comparison/insight
endpoint: dwell time, product interactions, navigation path, and purchases
all flow through here as typed, validated events tied to a session.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..schemas import (
    EventBatchRequest,
    EventBatchResponse,
    SessionCreateRequest,
    SessionEndResponse,
    SessionResponse,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionResponse)
def create_session(request: SessionCreateRequest) -> SessionResponse:
    if request.subject_type == "agent" and not request.persona_key:
        raise HTTPException(status_code=400, detail="persona_key is required for agent sessions")
    created = db.create_session(
        subject_type=request.subject_type,
        persona_key=request.persona_key,
        persona_label=request.persona_label,
        variant_id=request.variant_id,
        meta=request.meta,
    )
    return SessionResponse(**created)


@router.post("/{session_id}/events", response_model=EventBatchResponse)
def add_events(session_id: str, batch: EventBatchRequest) -> EventBatchResponse:
    if db.get_session_row(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    inserted = db.insert_events(session_id, [e.model_dump() for e in batch.events])
    return EventBatchResponse(inserted=inserted)


@router.post("/{session_id}/end", response_model=SessionEndResponse)
def finish_session(session_id: str) -> SessionEndResponse:
    if db.get_session_row(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    summary = db.end_session(session_id)
    return SessionEndResponse(session_id=session_id, ended_at=summary["ended_at"], summary=summary)


@router.get("")
def list_sessions(
    subject_type: Optional[str] = Query(default=None),
    persona_key: Optional[str] = Query(default=None),
    variant_id: Optional[str] = Query(default=None),
) -> dict:
    return {"sessions": db.list_sessions(subject_type=subject_type, persona_key=persona_key, variant_id=variant_id)}


@router.get("/{session_id}")
def get_session(session_id: str) -> dict:
    detail = db.get_session_detail(session_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return detail
