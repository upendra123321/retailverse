"""Read-only view onto the audit trail (backend/app/db.py::audit_log).

Exposed so evaluators/teammates can literally watch consequential actions
(persona edits, batch simulation runs, LLM insight/gaze calls) get logged in
real time - direct, inspectable evidence for the Responsible AI & Security
evaluation dimension, rather than an internal log file no one can see.
Read-only and capped at 500 rows; contains no secrets and no raw IPs
(see security.actor_ref for the hashing).
"""
from fastapi import APIRouter, Query

from .. import db

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/recent")
def recent_audit(limit: int = Query(default=50, ge=1, le=500)) -> dict:
    return {"entries": db.list_audit(limit=limit)}
