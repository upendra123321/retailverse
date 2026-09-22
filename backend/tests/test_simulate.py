"""Population-scale batch simulation: the headless engine that gives this
app a real panel size (see backend/app/simulation.py). Tests cover limits,
determinism of the event schema, and that runs are audit-logged."""


def test_batch_simulate_requires_personas(client):
    resp = client.post("/api/simulate/batch", json={"count": 5})
    assert resp.status_code == 400


def test_batch_simulate_creates_sessions(client, seeded_persona):
    resp = client.post("/api/simulate/batch", json={"count": 5, "persona_keys": [seeded_persona]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 5
    assert len(body["session_ids"]) == 5
    assert body["per_persona_counts"][seeded_persona] == 5

    # Every synthetic session must be independently queryable through the
    # exact same sessions API real shoppers use - not a special-cased path.
    detail = client.get(f"/api/sessions/{body['session_ids'][0]}").json()
    assert detail["subject_type"] == "agent"
    assert detail["meta"]["synthetic_batch"] is True
    assert len(detail["events"]) > 0


def test_batch_simulate_unknown_persona_key_rejected(client, seeded_persona):
    resp = client.post("/api/simulate/batch", json={"count": 1, "persona_keys": ["does_not_exist"]})
    assert resp.status_code == 400


def test_batch_simulate_count_over_limit_rejected(client, seeded_persona):
    resp = client.post("/api/simulate/batch", json={"count": 501, "persona_keys": [seeded_persona]})
    assert resp.status_code == 422


def test_batch_simulate_is_audit_logged(client, seeded_persona):
    client.post("/api/simulate/batch", json={"count": 3, "persona_keys": [seeded_persona]})
    entries = client.get("/api/audit/recent").json()["entries"]
    batch_entries = [e for e in entries if e["action"] == "batch_simulate"]
    assert batch_entries
    assert batch_entries[0]["detail"]["created"] == 3
