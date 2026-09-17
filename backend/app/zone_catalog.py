"""Loads + merges the two zone metadata sources (product/shelf zones derived
from the GLB, and hand-placed virtual ad banner variants) into one lookup used
by analytics, insights, and the agent judge prompt.
"""
from __future__ import annotations

import json
from functools import lru_cache

from .config import AD_ZONES_PATH, STORE_LAYOUT_PATH


@lru_cache(maxsize=1)
def load_store_layout() -> dict:
    if not STORE_LAYOUT_PATH.exists():
        return {"zones": [], "store_bounds": {}}
    return json.loads(STORE_LAYOUT_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_ad_zone_variants() -> list[dict]:
    """Flatten ad_zones.json into one record per variant, each usable as a
    zone_id (the variant_id) for event logging/analytics, since only one
    variant per slot is ever visible in a given session.
    """
    if not AD_ZONES_PATH.exists():
        return []
    data = json.loads(AD_ZONES_PATH.read_text(encoding="utf-8"))
    flattened = []
    for slot in data.get("ad_slots", []):
        for variant in slot.get("variants", []):
            flattened.append(
                {
                    "zone_id": variant["variant_id"],
                    "slot_id": slot["slot_id"],
                    "type": "ad",
                    "category": "ad",
                    "display_name": variant.get("label", variant["variant_id"]),
                    "position": variant.get("position"),
                    "size": slot.get("size"),
                }
            )
    return flattened


def zone_lookup() -> dict[str, dict]:
    lookup: dict[str, dict] = {}
    for zone in load_store_layout().get("zones", []):
        lookup[zone["zone_id"]] = zone
    for ad_zone in load_ad_zone_variants():
        lookup[ad_zone["zone_id"]] = ad_zone
    return lookup


def attention_relevant_zone_ids() -> set[str]:
    """Zone ids worth measuring shopper attention against (excludes generic
    structural geometry like shelving frames/floor/signage placeholders).
    """
    relevant_types = {"product", "checkout", "ad"}
    return {
        zone_id
        for zone_id, meta in zone_lookup().items()
        if meta.get("type") in relevant_types
    }


def clear_cache() -> None:
    load_store_layout.cache_clear()
    load_ad_zone_variants.cache_clear()
