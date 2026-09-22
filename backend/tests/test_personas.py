"""Persona CRUD: input validation + the audit trail written on every
create/replace/delete (Responsible AI & Security evaluation dimension)."""


VALID_PERSONA = {
    "persona_key": "test_browser",
    "label": "Test Browser",
    "description": "Wanders the whole store, easily distracted by ads.",
    "navigation_style": "explore",
    "target_categories": [],
    "preferred_product_keys": [],
    "patience_seconds": 120,
    "browse_probability": 0.8,
    "ad_attention_bias": 0.6,
    "price_sensitivity": "medium",
    "purchase_likelihood": 0.3,
}


def test_create_and_list_persona(client):
    resp = client.post("/api/personas", json=VALID_PERSONA)
    assert resp.status_code == 200

    listed = client.get("/api/personas").json()["personas"]
    assert any(p["persona_key"] == "test_browser" for p in listed)


def test_invalid_persona_key_pattern_rejected(client):
    bad = {**VALID_PERSONA, "persona_key": "Not Valid Key!"}
    resp = client.post("/api/personas", json=bad)
    assert resp.status_code == 422


def test_out_of_range_probability_rejected(client):
    bad = {**VALID_PERSONA, "browse_probability": 1.5}
    resp = client.post("/api/personas", json=bad)
    assert resp.status_code == 422


def test_delete_persona_then_404_on_missing(client):
    client.post("/api/personas", json=VALID_PERSONA)
    ok = client.delete(f"/api/personas/{VALID_PERSONA['persona_key']}")
    assert ok.status_code == 200

    missing = client.delete(f"/api/personas/{VALID_PERSONA['persona_key']}")
    assert missing.status_code == 404


def test_persona_mutations_are_audit_logged(client):
    client.post("/api/personas", json=VALID_PERSONA)
    client.delete(f"/api/personas/{VALID_PERSONA['persona_key']}")

    entries = client.get("/api/audit/recent", params={"limit": 20}).json()["entries"]
    actions = [e["action"] for e in entries]
    assert "persona_create" in actions
    assert "persona_delete" in actions
    # Audit entries must never contain a raw IP - actor_ref is a hash.
    for e in entries:
        assert len(e["actor_ref"]) == 12
        assert "." not in e["actor_ref"]  # not a dotted IPv4 address leaking through
