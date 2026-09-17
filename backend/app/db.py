"""SQLite persistence for shopper sessions + behavioral events.

Design notes (why one generic `events` table):
  A single wide table keyed by `event_type` (zone_dwell / product_interaction /
  purchase / navigation_sample / ad_view) covers every behavioral signal the
  challenge asks for (dwell time, product interactions, navigation path,
  purchases) without a proliferation of near-identical tables, and keeps
  aggregation queries (SUM(duration_ms) GROUP BY zone_id) simple for the
  analytics endpoints. Free-form extras live in `payload_json`.

SQLite is intentionally used (per project decision) instead of an external
DB: zero setup/credentials on either macOS or Windows, single portable file,
good enough for hackathon-scale concurrent writers (FastAPI + a couple of
browser tabs).
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from .config import DATA_DIR

DB_PATH = DATA_DIR / "analytics.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    ended_at TEXT,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('real', 'agent')),
    persona_key TEXT,
    persona_label TEXT,
    variant_id TEXT,
    meta_json TEXT NOT NULL DEFAULT '{}',
    summary_json TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts_ms INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'zone_dwell', 'product_interaction', 'purchase',
            'navigation_sample', 'ad_view', 'agent_thought'
        )
    ),
    zone_id TEXT,
    product_key TEXT,
    duration_ms INTEGER,
    payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_zone ON events(zone_id);
CREATE INDEX IF NOT EXISTS idx_sessions_variant ON sessions(variant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(subject_type, persona_key);
"""


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_session(
    *,
    subject_type: str,
    persona_key: Optional[str],
    persona_label: Optional[str],
    variant_id: Optional[str],
    meta: dict[str, Any],
) -> dict:
    session_id = str(uuid.uuid4())
    created_at = now_iso()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO sessions (id, created_at, subject_type, persona_key, persona_label, variant_id, meta_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (session_id, created_at, subject_type, persona_key, persona_label, variant_id, json.dumps(meta)),
        )
    return {
        "id": session_id,
        "created_at": created_at,
        "subject_type": subject_type,
        "persona_key": persona_key,
        "persona_label": persona_label,
        "variant_id": variant_id,
        "meta": meta,
    }


def get_session_row(session_id: str) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()


def insert_events(session_id: str, events: list[dict[str, Any]]) -> int:
    if not events:
        return 0
    rows = [
        (
            session_id,
            int(e["ts_ms"]),
            e["event_type"],
            e.get("zone_id"),
            e.get("product_key"),
            e.get("duration_ms"),
            json.dumps(e.get("payload") or {}),
        )
        for e in events
    ]
    with get_conn() as conn:
        conn.executemany(
            """INSERT INTO events (session_id, ts_ms, event_type, zone_id, product_key, duration_ms, payload_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
    return len(rows)


def compute_session_summary(session_id: str) -> dict:
    with get_conn() as conn:
        session = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if session is None:
            raise KeyError(session_id)

        dwell_rows = conn.execute(
            """SELECT zone_id, SUM(duration_ms) AS total_ms, COUNT(*) AS visits
               FROM events WHERE session_id = ? AND event_type = 'zone_dwell' AND zone_id IS NOT NULL
               GROUP BY zone_id ORDER BY total_ms DESC""",
            (session_id,),
        ).fetchall()
        interaction_rows = conn.execute(
            """SELECT zone_id, product_key, COUNT(*) AS count, payload_json
               FROM events WHERE session_id = ? AND event_type = 'product_interaction'""",
            (session_id,),
        ).fetchall()
        purchase_rows = conn.execute(
            """SELECT payload_json FROM events WHERE session_id = ? AND event_type = 'purchase'""",
            (session_id,),
        ).fetchall()
        nav_count = conn.execute(
            "SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND event_type = 'navigation_sample'",
            (session_id,),
        ).fetchone()["n"]
        ad_rows = conn.execute(
            """SELECT zone_id, SUM(duration_ms) AS total_ms FROM events
               WHERE session_id = ? AND event_type = 'ad_view' AND zone_id IS NOT NULL
               GROUP BY zone_id""",
            (session_id,),
        ).fetchall()

    total_dwell_ms = sum(r["total_ms"] or 0 for r in dwell_rows)
    zone_dwell = [
        {"zone_id": r["zone_id"], "total_ms": r["total_ms"] or 0, "visits": r["visits"]} for r in dwell_rows
    ]
    purchases = [json.loads(r["payload_json"]) for r in purchase_rows]
    purchase_total = sum(float(p.get("price", 0) or 0) for p in purchases)

    summary = {
        "session_id": session_id,
        "subject_type": session["subject_type"],
        "persona_key": session["persona_key"],
        "variant_id": session["variant_id"],
        "total_dwell_ms": total_dwell_ms,
        "zone_dwell": zone_dwell,
        "top_zones": zone_dwell[:5],
        "interaction_count": len(interaction_rows),
        "interactions": [
            {"zone_id": r["zone_id"], "product_key": r["product_key"], "count": r["count"]}
            for r in interaction_rows
        ],
        "purchase_count": len(purchases),
        "purchase_total": purchase_total,
        "purchases": purchases,
        "navigation_sample_count": nav_count,
        "ad_view_ms": {r["zone_id"]: (r["total_ms"] or 0) for r in ad_rows},
    }
    return summary


def end_session(session_id: str) -> dict:
    summary = compute_session_summary(session_id)
    ended_at = now_iso()
    with get_conn() as conn:
        conn.execute(
            "UPDATE sessions SET ended_at = ?, summary_json = ? WHERE id = ?",
            (ended_at, json.dumps(summary), session_id),
        )
    summary["ended_at"] = ended_at
    return summary


def list_sessions(
    *, subject_type: Optional[str] = None, persona_key: Optional[str] = None, variant_id: Optional[str] = None
) -> list[dict]:
    clauses, params = [], []
    if subject_type:
        clauses.append("subject_type = ?")
        params.append(subject_type)
    if persona_key:
        clauses.append("persona_key = ?")
        params.append(persona_key)
    if variant_id:
        clauses.append("variant_id = ?")
        params.append(variant_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM sessions {where} ORDER BY created_at DESC LIMIT 200", params
        ).fetchall()
    return [_session_row_to_dict(r) for r in rows]


def _session_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "ended_at": row["ended_at"],
        "subject_type": row["subject_type"],
        "persona_key": row["persona_key"],
        "persona_label": row["persona_label"],
        "variant_id": row["variant_id"],
        "meta": json.loads(row["meta_json"] or "{}"),
        "summary": json.loads(row["summary_json"]) if row["summary_json"] else None,
    }


def get_session_detail(session_id: str) -> Optional[dict]:
    with get_conn() as conn:
        session = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if session is None:
            return None
        events = conn.execute(
            "SELECT * FROM events WHERE session_id = ? ORDER BY ts_ms ASC", (session_id,)
        ).fetchall()
    result = _session_row_to_dict(session)
    result["events"] = [
        {
            "id": e["id"],
            "ts_ms": e["ts_ms"],
            "event_type": e["event_type"],
            "zone_id": e["zone_id"],
            "product_key": e["product_key"],
            "duration_ms": e["duration_ms"],
            "payload": json.loads(e["payload_json"] or "{}"),
        }
        for e in events
    ]
    return result


def aggregate_zone_stats(
    *, subject_type: Optional[str] = None, persona_key: Optional[str] = None, variant_id: Optional[str] = None
) -> dict:
    """Aggregate dwell time / interactions per zone across every matching session."""
    clauses, params = [], []
    if subject_type:
        clauses.append("s.subject_type = ?")
        params.append(subject_type)
    if persona_key:
        clauses.append("s.persona_key = ?")
        params.append(persona_key)
    if variant_id:
        clauses.append("s.variant_id = ?")
        params.append(variant_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with get_conn() as conn:
        session_count = conn.execute(f"SELECT COUNT(*) AS n FROM sessions s {where}", params).fetchone()["n"]
        dwell_rows = conn.execute(
            f"""SELECT e.zone_id AS zone_id, SUM(e.duration_ms) AS total_ms, COUNT(*) AS visits,
                       COUNT(DISTINCT e.session_id) AS session_count
                FROM events e JOIN sessions s ON e.session_id = s.id
                {where}{' AND' if where else 'WHERE'} e.event_type = 'zone_dwell' AND e.zone_id IS NOT NULL
                GROUP BY e.zone_id ORDER BY total_ms DESC""",
            params,
        ).fetchall()
        interaction_rows = conn.execute(
            f"""SELECT e.zone_id AS zone_id, COUNT(*) AS count
                FROM events e JOIN sessions s ON e.session_id = s.id
                {where}{' AND' if where else 'WHERE'} e.event_type = 'product_interaction' AND e.zone_id IS NOT NULL
                GROUP BY e.zone_id""",
            params,
        ).fetchall()
        purchase_rows = conn.execute(
            f"""SELECT e.zone_id AS zone_id, COUNT(*) AS count
                FROM events e JOIN sessions s ON e.session_id = s.id
                {where}{' AND' if where else 'WHERE'} e.event_type = 'purchase' AND e.zone_id IS NOT NULL
                GROUP BY e.zone_id""",
            params,
        ).fetchall()

    interactions_by_zone = {r["zone_id"]: r["count"] for r in interaction_rows}
    purchases_by_zone = {r["zone_id"]: r["count"] for r in purchase_rows}

    zones = []
    for r in dwell_rows:
        zones.append(
            {
                "zone_id": r["zone_id"],
                "total_dwell_ms": r["total_ms"] or 0,
                "visit_count": r["visits"],
                "session_count": r["session_count"],
                "interaction_count": interactions_by_zone.get(r["zone_id"], 0),
                "purchase_count": purchases_by_zone.get(r["zone_id"], 0),
            }
        )

    return {"session_count": session_count, "zones": zones}
