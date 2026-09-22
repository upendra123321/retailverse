"""Real-vs-synthetic comparison + automated insights, including the
deterministic heuristic fallback (Responsible AI requirement: the app must
keep working, and clearly say so, when the LLM is unavailable - see
conftest.py, which deliberately clears LLM credentials for every test)."""


def _make_session_with_dwell(client, subject_type, zone_id="checkout_counter", ms=5000, persona_key=None):
    payload = {"subject_type": subject_type, "meta": {}}
    if persona_key:
        payload["persona_key"] = persona_key
    session = client.post("/api/sessions", json=payload).json()
    client.post(
        f"/api/sessions/{session['id']}/events",
        json={"events": [{"event_type": "zone_dwell", "ts_ms": 0, "zone_id": zone_id, "duration_ms": ms}]},
    )
    client.post(f"/api/sessions/{session['id']}/end")
    return session["id"]


def test_zone_stats_empty_when_no_sessions(client):
    resp = client.get("/api/analytics/zones")
    assert resp.status_code == 200
    assert resp.json()["zones"] == []


def test_zone_stats_aggregates_dwell(client):
    _make_session_with_dwell(client, "real", zone_id="checkout_counter", ms=3000)
    resp = client.get("/api/analytics/zones", params={"subject_type": "real"})
    zones = resp.json()["zones"]
    assert any(z["zone_id"] == "checkout_counter" and z["total_dwell_ms"] == 3000 for z in zones)


def test_compare_reports_insufficient_data_with_only_one_side(client):
    _make_session_with_dwell(client, "real")
    resp = client.get("/api/analytics/compare").json()
    assert resp["sufficient_data"] is False
    assert resp["real_session_count"] >= 1
    assert resp["agent_session_count"] == 0


def test_insights_falls_back_to_heuristic_without_llm_credentials(client):
    _make_session_with_dwell(client, "real")
    resp = client.post("/api/analytics/insights", params={"subject_type": "real"})
    assert resp.status_code == 200
    body = resp.json()
    # This is the core Responsible-AI guarantee: no LLM configured -> the
    # app still returns a usable report, and says exactly where it came from.
    assert body["generated_by"] == "heuristic_fallback"
    assert "heuristic fallback" in body["narrative"].lower()


def test_insights_are_audit_logged_with_source(client):
    _make_session_with_dwell(client, "real")
    client.post("/api/analytics/insights", params={"subject_type": "real"})
    entries = client.get("/api/audit/recent").json()["entries"]
    insight_entries = [e for e in entries if e["action"] == "generate_insights"]
    assert insight_entries
    assert insight_entries[0]["result"] == "heuristic_fallback"
