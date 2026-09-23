"""Shared pytest fixtures.

Two critical ordering notes, both learned the hard way from this suite
hanging its first run against a real (unreachable, internal-network-only)
LLM endpoint for 15s per test:

1. APP_DATA_DIR must be set BEFORE `app.main` (and therefore app.config/
   app.db) is imported anywhere - config.py reads it at *import* time.

2. Every LITE_LLM_* env var must be cleared AFTER importing `app.main`, not
   before. `llm_gateway.py` calls `load_dotenv()` at import time, which
   repopulates those exact variables from a developer's real backend/.env
   (python-dotenv only skips variables that are already *set*, and popping
   them beforehand makes them "not set" again). Clearing them post-import
   means every test run deterministically exercises the heuristic-fallback/
   502 paths for LLM-backed endpoints, regardless of whatever real
   credentials happen to be sitting in backend/.env - tests must not depend
   on, or accidentally spend, a real LLM budget.
"""
import os
import shutil
import tempfile

_TEST_DATA_DIR = tempfile.mkdtemp(prefix="retailverse_test_")
os.environ["APP_DATA_DIR"] = _TEST_DATA_DIR

import atexit  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.main import app  # noqa: E402

for _key in ("LITE_LLM_ENDPOINT", "LITE_LLM_API_KEY", "LITE_LLM_MODEL", "LITE_LLM_API_VERSION", "lite_llm_endpoint", "api_key"):
    os.environ.pop(_key, None)

atexit.register(lambda: shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True))


@pytest.fixture()
def client():
    """A fresh DB *and* persona library per test function, isolated from
    real data and from other tests.

    The persona library (backend/data/personas.json under the temp
    APP_DATA_DIR) is a plain file, not a DB table, so it doesn't get the
    same automatic isolation the DB rows below get - a test that creates a
    persona and forgets to delete it silently leaks state into every test
    that runs afterward in the same session (this bit a real test once: see
    git history around test_persona_description_is_sanitized_at_save_time).
    Removing the file here, unconditionally, makes every test start from a
    guaranteed-empty library regardless of what earlier tests did or forgot
    to clean up.
    """
    from app.config import PERSONAS_PATH

    PERSONAS_PATH.unlink(missing_ok=True)
    db.init_db()
    with TestClient(app) as c:
        yield c
    # Wipe rows (not files - WAL mode keeps the file open) so tests don't
    # leak state into each other via the shared temp DB file.
    with db.get_conn() as conn:
        conn.execute("DELETE FROM events")
        conn.execute("DELETE FROM sessions")
        conn.execute("DELETE FROM audit_log")
    PERSONAS_PATH.unlink(missing_ok=True)


@pytest.fixture()
def seeded_persona(client):
    """Creates one valid custom persona via the real API and returns its key."""
    persona = {
        "persona_key": "test_mission_shopper",
        "label": "Test Mission Shopper",
        "description": "Walks straight to their list and checks out.",
        "navigation_style": "direct",
        "target_categories": ["cereal"],
        "preferred_product_keys": ["trix"],
        "patience_seconds": 60,
        "browse_probability": 0.1,
        "ad_attention_bias": 0.1,
        "price_sensitivity": "low",
        "purchase_likelihood": 0.9,
    }
    resp = client.post("/api/personas", json=persona)
    assert resp.status_code == 200, resp.text
    yield persona["persona_key"]
    client.delete(f"/api/personas/{persona['persona_key']}")
