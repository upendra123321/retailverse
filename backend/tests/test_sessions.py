"""Session lifecycle + event ingestion - the data backbone every analytics
endpoint depends on. These are the repeatable test cases referenced in the
"Outcome Accuracy & Evidence" evaluation dimension for this piece of the
pipeline.
"""


def test_create_real_session(client):
    resp = client.post("/api/sessions", json={"subject_type": "real", "meta": {"shopper_name": "Alex"}})
    assert resp.status_code == 200
    body = resp.json()
    assert body["subject_type"] == "real"
    assert body["id"]


def test_agent_session_requires_persona_key(client):
    resp = client.post("/api/sessions", json={"subject_type": "agent"})
    assert resp.status_code == 400


def test_event_ingestion_and_summary(client):
    session = client.post("/api/sessions", json={"subject_type": "real", "meta": {}}).json()
    events = {
        "events": [
            {"event_type": "zone_dwell", "ts_ms": 0, "zone_id": "cereal_shelf_1", "duration_ms": 4000},
            {
                "event_type": "product_interaction",
                "ts_ms": 1000,
                "zone_id": "cereal_shelf_1",
                "product_key": "trix",
                "payload": {"interaction_type": "view_detail"},
            },
            {
                "event_type": "purchase",
                "ts_ms": 2000,
                "zone_id": "cereal_shelf_1",
                "product_key": "trix",
                "payload": {"price": 4.49, "quantity": 1},
            },
        ]
    }
    resp = client.post(f"/api/sessions/{session['id']}/events", json=events)
    assert resp.status_code == 200
    assert resp.json()["inserted"] == 3

    end_resp = client.post(f"/api/sessions/{session['id']}/end")
    assert end_resp.status_code == 200
    summary = end_resp.json()["summary"]
    assert summary["total_dwell_ms"] == 4000
    assert summary["purchase_count"] == 1
    assert summary["purchase_total"] == 4.49


def test_events_for_missing_session_404(client):
    resp = client.post("/api/sessions/does-not-exist/events", json={"events": [{"event_type": "navigation_sample", "ts_ms": 0}]})
    assert resp.status_code == 404


def test_event_batch_over_limit_rejected(client):
    session = client.post("/api/sessions", json={"subject_type": "real", "meta": {}}).json()
    too_many = {"events": [{"event_type": "navigation_sample", "ts_ms": i} for i in range(501)]}
    resp = client.post(f"/api/sessions/{session['id']}/events", json=too_many)
    assert resp.status_code == 422  # Pydantic max_length=500 on EventBatchRequest.events


def test_get_session_detail_includes_events(client):
    session = client.post("/api/sessions", json={"subject_type": "real", "meta": {}}).json()
    client.post(
        f"/api/sessions/{session['id']}/events",
        json={"events": [{"event_type": "navigation_sample", "ts_ms": 10, "payload": {"position": [0, 0, 0]}}]},
    )
    detail = client.get(f"/api/sessions/{session['id']}").json()
    assert len(detail["events"]) == 1
    assert detail["events"][0]["event_type"] == "navigation_sample"
