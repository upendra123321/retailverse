"""Headless, population-scale AI shopper simulation.

This is a deliberate Python re-implementation of the exact same decision
rules as `frontend/src/components/Agent/personaNavigation.ts` (goal queue by
navigation_style, persona-weighted dwell time, peripheral glance bias,
price-sensitivity-adjusted purchase probability) - see that file's docstrings
for the reasoning behind each rule.

Why a separate headless engine instead of driving the browser N times: the
actual *decision* logic never needed the 3D renderer - only mapping a real
human's gaze to a zone needs raycasting. For a synthetic persona we already
know deterministically which zone it's "looking at" at each step, so a
population of shoppers can be simulated in pure Python, in milliseconds per
shopper, with no browser/GPU/webcam involved at all. This is what makes
"population-scale" (the challenge's own name) an actual, demoable capability
instead of one agent at a time in the 3D view.

Every simulated shopper still produces the exact same event schema
(zone_dwell / product_interaction / purchase / navigation_sample) through the
exact same `db.insert_events` used by real and single-agent sessions, so it
is fully comparable in the analytics/comparison endpoints - not a separate,
special-cased data path.
"""
from __future__ import annotations

import random
import time
from typing import Any, Optional

from . import db
from .zone_catalog import load_ad_zone_variants, load_store_layout

# Kept in sync with frontend/src/data/productCatalog.ts by convention (both
# are small, hand-maintained "synthetic retail price" catalogs for the demo -
# not derived from any real pricing source). Using the same numbers here
# means batch-simulated agent purchases are $-comparable to real/manual-agent
# purchases in the analytics dashboard.
PRODUCT_PRICES: dict[str, float] = {
    "trix": 4.49,
    "luckycharm": 4.79,
    "luckycharm_1": 5.49,
    "rice crisps": 4.29,
    "crispix": 4.99,
    "cerial meal": 3.99,
    "Oatmeal": 3.49,
    "Oatmeal_#1": 5.99,
    "Tuna can": 1.29,
    "tuna can large": 2.49,
}
DEFAULT_PRICE = 2.99
REFERENCE_PRICE = 4.0  # see purchase_probability() - matches personaNavigation.ts


def price_for(product_key: Optional[str]) -> float:
    if product_key and product_key in PRODUCT_PRICES:
        return PRODUCT_PRICES[product_key]
    return DEFAULT_PRICE


def purchase_probability(persona: dict, price: float) -> float:
    """Mirrors personaNavigation.ts's purchaseProbability(): price-insensitive
    personas buy at their flat purchase_likelihood; price-sensitive personas
    get that scaled down for above-(synthetic-)average-priced items."""
    likelihood = float(persona["purchase_likelihood"])
    sensitivity = persona.get("price_sensitivity", "medium")
    if sensitivity == "low":
        return likelihood
    weight = 0.6 if sensitivity == "high" else 0.3
    price_delta_ratio = (price - REFERENCE_PRICE) / REFERENCE_PRICE
    multiplier = 1 - weight * price_delta_ratio
    return min(1.0, max(0.05, likelihood * multiplier))


def _product_zones(zones: list[dict]) -> list[dict]:
    return [z for z in zones if z.get("type") == "product"]


def build_target_queue(persona: dict, zones: list[dict]) -> list[dict]:
    """Python port of buildTargetQueue() in personaNavigation.ts - see that
    file for the full per-navigation_style rationale."""
    product_zones = _product_zones(zones)
    checkout = next((z for z in zones if z.get("zone_id") == "checkout_counter"), None)

    preferred_keys = persona.get("preferred_product_keys") or []
    by_preferred = [z for k in preferred_keys for z in product_zones if z.get("product_key") == k]
    target_categories = set(persona.get("target_categories") or [])
    by_category = [z for z in product_zones if z.get("category") in target_categories and z not in by_preferred]

    style = persona.get("navigation_style", "explore")
    if style == "direct":
        queue = by_preferred or (by_category[:1] if by_category else product_zones[:1])
    elif style == "compare":
        pool = by_category if len(by_category) >= 2 else product_zones[: min(3, len(product_zones))]
        queue = pool + pool  # revisit each once, simulating back-and-forth comparison
    else:  # explore
        queue = list(product_zones)
        random.shuffle(queue)

    if not queue:
        queue = product_zones[:1]
    if checkout and style != "explore":
        queue = queue + [checkout]
    return queue


def dwell_duration_ms(persona: dict, target_count: int) -> float:
    base = (float(persona["patience_seconds"]) * 1000) / max(1, target_count)
    jitter = 0.6 + random.random() * 0.8
    return min(20000.0, max(2500.0, base * jitter))


def maybe_pick_glance_zone(persona: dict, zones: list[dict], primary_target_id: Optional[str]) -> Optional[dict]:
    ad_zones = [z for z in zones if z.get("type") == "ad"]
    if ad_zones and random.random() < float(persona.get("ad_attention_bias", 0)) * 0.35:
        return random.choice(ad_zones)
    if random.random() < float(persona.get("browse_probability", 0)) * 0.3:
        candidates = [z for z in zones if z.get("type") == "product" and z.get("zone_id") != primary_target_id]
        if candidates:
            return random.choice(candidates)
    return None


TRANSIT_MS_RANGE = (1200, 3500)  # simulated walking time between targets, for a plausible total session length


def simulate_session(persona: dict, zones: list[dict], variant_id: Optional[str]) -> tuple[list[dict], dict]:
    """Runs one synthetic shopper journey end-to-end and returns
    (events, stats) ready for db.insert_events()."""
    queue = build_target_queue(persona, zones)
    events: list[dict] = []
    cursor_ms = 0
    visited_products: list[dict] = []
    purchases: list[dict] = []

    for target in queue:
        cursor_ms += random.randint(*TRANSIT_MS_RANGE)
        zone_id = target.get("zone_id")
        center = target.get("center") or target.get("position")

        # Arrival + a mid-dwell navigation sample so path-trail/heatmap
        # visualizations have real (x, z) points to plot, exactly like a real
        # shopper's periodic NavigationSampler ticks.
        if center:
            events.append({"ts_ms": cursor_ms, "event_type": "navigation_sample", "payload": {"position": center, "yaw": 0}})

        dwell_ms = int(dwell_duration_ms(persona, len(queue)))
        events.append(
            {"ts_ms": cursor_ms, "event_type": "zone_dwell", "zone_id": zone_id, "duration_ms": dwell_ms, "payload": {}}
        )

        if target.get("type") == "product":
            visited_products.append(target)
            events.append(
                {
                    "ts_ms": cursor_ms + dwell_ms // 2,
                    "event_type": "product_interaction",
                    "zone_id": zone_id,
                    "product_key": target.get("product_key"),
                    "payload": {"interaction_type": "view_detail"},
                }
            )
        elif zone_id == "checkout_counter":
            for visited in visited_products:
                product_key = visited.get("product_key")
                if not product_key:
                    continue
                price = price_for(product_key)
                probability = purchase_probability(persona, price)
                if random.random() < probability:
                    purchase = {
                        "ts_ms": cursor_ms + dwell_ms // 2,
                        "event_type": "purchase",
                        "zone_id": visited.get("zone_id"),
                        "product_key": product_key,
                        "payload": {"price": price, "quantity": 1, "decided_by": "batch_simulation"},
                    }
                    events.append(purchase)
                    purchases.append(purchase)

        # Peripheral glance: a short secondary zone_dwell elsewhere, mirroring
        # maybePickGlanceZone()'s "eyes dart without turning the head" model.
        glance = maybe_pick_glance_zone(persona, zones, zone_id)
        if glance:
            glance_ms = int(min(dwell_ms * 0.4, 3000))
            events.append(
                {
                    "ts_ms": cursor_ms + max(200, dwell_ms // 4),
                    "event_type": "zone_dwell",
                    "zone_id": glance.get("zone_id"),
                    "duration_ms": glance_ms,
                    "payload": {"glance": True},
                }
            )
            if glance.get("type") == "ad":
                events.append(
                    {
                        "ts_ms": cursor_ms + max(200, dwell_ms // 4),
                        "event_type": "ad_view",
                        "zone_id": glance.get("zone_id"),
                        "duration_ms": glance_ms,
                        "payload": {},
                    }
                )

        cursor_ms += dwell_ms

    events.sort(key=lambda e: e["ts_ms"])
    stats = {
        "total_ms": cursor_ms,
        "zones_visited": len(queue),
        "products_visited": len(visited_products),
        "purchase_count": len(purchases),
        "purchase_total": round(sum(p["payload"]["price"] for p in purchases), 2),
    }
    return events, stats


def _select_persona(personas: list[dict], persona_keys: Optional[list[str]], index: int) -> dict:
    pool = personas
    if persona_keys:
        pool = [p for p in personas if p["persona_key"] in persona_keys] or personas
    # Round-robin rather than random choice, so a requested population is
    # evenly distributed across the selected archetypes (a real omnibus
    # panel is usually recruited to hit quotas per segment, not pure chance).
    return pool[index % len(pool)]


def run_batch(
    *,
    count: int,
    persona_keys: Optional[list[str]],
    variant_id: Optional[str],
    personas: list[dict],
) -> dict:
    if not personas:
        raise ValueError("No personas available to simulate")

    zones = list(load_store_layout().get("zones", []))
    for ad in load_ad_zone_variants():
        if variant_id is None or ad["zone_id"] == variant_id:
            zones.append(ad)

    started = time.perf_counter()
    per_persona_counts: dict[str, int] = {}
    per_persona_purchases: dict[str, int] = {}
    session_ids: list[str] = []

    for i in range(count):
        persona = _select_persona(personas, persona_keys, i)
        events, stats = simulate_session(persona, zones, variant_id)

        session = db.create_session(
            subject_type="agent",
            persona_key=persona["persona_key"],
            persona_label=persona["label"],
            variant_id=variant_id,
            meta={"synthetic_batch": True, "batch_index": i},
        )
        db.insert_events(session["id"], events)
        db.end_session(session["id"])

        session_ids.append(session["id"])
        per_persona_counts[persona["persona_key"]] = per_persona_counts.get(persona["persona_key"], 0) + 1
        if stats["purchase_count"] > 0:
            per_persona_purchases[persona["persona_key"]] = per_persona_purchases.get(persona["persona_key"], 0) + 1

    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    return {
        "created": len(session_ids),
        "session_ids": session_ids,
        "per_persona_counts": per_persona_counts,
        "per_persona_purchase_sessions": per_persona_purchases,
        "elapsed_ms": elapsed_ms,
    }
