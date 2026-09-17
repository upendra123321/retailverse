"""Aggregated zone attention analytics, real-vs-synthetic benchmarking, and
automated insight report generation.

Responsible-AI note: the insight narrative is always grounded in numbers we
computed ourselves (passed verbatim into the LLM prompt) and we explicitly
report whether the narrative came from the LLM or a deterministic fallback
template, so nothing here can silently hallucinate a metric that wasn't
actually measured.
"""
from __future__ import annotations

import math
from typing import Optional

from fastapi import APIRouter, Query

from .. import db
from ..llm_gateway import LLMGatewayError, call_llm
from ..zone_catalog import zone_lookup

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _enrich_zones(zone_stats: list[dict]) -> list[dict]:
    lookup = zone_lookup()
    enriched = []
    for z in zone_stats:
        meta = lookup.get(z["zone_id"], {})
        enriched.append(
            {
                **z,
                "display_name": meta.get("display_name", z["zone_id"]),
                "type": meta.get("type", "unknown"),
                "category": meta.get("category", "unknown"),
            }
        )
    return enriched


@router.get("/zones")
def zone_stats(
    subject_type: Optional[str] = Query(default=None),
    persona_key: Optional[str] = Query(default=None),
    variant_id: Optional[str] = Query(default=None),
) -> dict:
    result = db.aggregate_zone_stats(subject_type=subject_type, persona_key=persona_key, variant_id=variant_id)
    result["zones"] = _enrich_zones(result["zones"])

    all_zone_ids = set(zone_lookup().keys())
    seen_zone_ids = {z["zone_id"] for z in result["zones"]}
    result["zones_with_zero_attention"] = sorted(all_zone_ids - seen_zone_ids)
    return result


def _normalized_vector(zone_stats_list: list[dict], zone_ids: list[str]) -> list[float]:
    by_id = {z["zone_id"]: z["total_dwell_ms"] for z in zone_stats_list}
    raw = [float(by_id.get(zid, 0)) for zid in zone_ids]
    total = sum(raw)
    if total <= 0:
        return [0.0] * len(raw)
    return [v / total for v in raw]


def _cosine_similarity(a: list[float], b: list[float]) -> Optional[float]:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return None
    return dot / (norm_a * norm_b)


def _pearson_correlation(a: list[float], b: list[float]) -> Optional[float]:
    n = len(a)
    if n < 2:
        return None
    mean_a, mean_b = sum(a) / n, sum(b) / n
    cov = sum((a[i] - mean_a) * (b[i] - mean_b) for i in range(n))
    var_a = sum((x - mean_a) ** 2 for x in a)
    var_b = sum((y - mean_b) ** 2 for y in b)
    denom = math.sqrt(var_a * var_b)
    if denom == 0:
        return None
    return cov / denom


def _top_n_overlap(a_stats: list[dict], b_stats: list[dict], n: int = 3) -> float:
    top_a = {z["zone_id"] for z in sorted(a_stats, key=lambda z: -z["total_dwell_ms"])[:n]}
    top_b = {z["zone_id"] for z in sorted(b_stats, key=lambda z: -z["total_dwell_ms"])[:n]}
    if not top_a and not top_b:
        return 1.0
    union = top_a | top_b
    if not union:
        return 1.0
    return len(top_a & top_b) / len(union)


@router.get("/compare")
def compare_real_vs_agent(
    persona_key: Optional[str] = Query(default=None),
    variant_id: Optional[str] = Query(default=None),
) -> dict:
    real = db.aggregate_zone_stats(subject_type="real", variant_id=variant_id)
    agent = db.aggregate_zone_stats(subject_type="agent", persona_key=persona_key, variant_id=variant_id)

    zone_ids = sorted({z["zone_id"] for z in real["zones"]} | {z["zone_id"] for z in agent["zones"]})
    real_vector = _normalized_vector(real["zones"], zone_ids)
    agent_vector = _normalized_vector(agent["zones"], zone_ids)

    lookup = zone_lookup()
    per_zone = [
        {
            "zone_id": zid,
            "display_name": lookup.get(zid, {}).get("display_name", zid),
            "real_share": real_vector[i],
            "agent_share": agent_vector[i],
            "abs_diff": abs(real_vector[i] - agent_vector[i]),
        }
        for i, zid in enumerate(zone_ids)
    ]
    per_zone.sort(key=lambda z: -z["abs_diff"])

    return {
        "persona_key": persona_key,
        "variant_id": variant_id,
        "real_session_count": real["session_count"],
        "agent_session_count": agent["session_count"],
        "sufficient_data": real["session_count"] > 0 and agent["session_count"] > 0,
        "cosine_similarity": _cosine_similarity(real_vector, agent_vector),
        "pearson_correlation": _pearson_correlation(real_vector, agent_vector),
        "top3_zone_overlap": _top_n_overlap(real["zones"], agent["zones"], n=3),
        "per_zone": per_zone,
    }


def _heuristic_insights(zones: list[dict], zero_attention: list[str], compare: Optional[dict]) -> str:
    """Deterministic, template-based fallback used whenever the LLM is
    unavailable/misconfigured/erroring, so the report is never blocked on an
    external dependency.
    """
    lines = ["## Automated Insights (heuristic fallback - no LLM call)"]
    if not zones:
        lines.append("No sessions recorded yet for this filter. Run some real or agent sessions first.")
        return "\n".join(lines)

    total_ms = sum(z["total_dwell_ms"] for z in zones) or 1
    lines.append("\n### Attention distribution")
    for z in zones[:8]:
        share = 100 * z["total_dwell_ms"] / total_ms
        lines.append(
            f"- **{z['display_name']}** ({z['type']}): {share:.1f}% of measured dwell time, "
            f"{z['visit_count']} visit(s) across {z['session_count']} session(s), "
            f"{z['interaction_count']} interaction(s), {z['purchase_count']} purchase(s)."
        )

    ad_zones = [z for z in zones if z["type"] == "ad"]
    if ad_zones:
        ad_share = 100 * sum(z["total_dwell_ms"] for z in ad_zones) / total_ms
        lines.append(f"\n### Ad attention\n- Ads captured {ad_share:.1f}% of total measured attention.")
    if zero_attention:
        lines.append(
            f"\n### Blind spots\n- {len(zero_attention)} zone(s) received **zero** recorded attention: "
            + ", ".join(zero_attention[:10])
            + (" ..." if len(zero_attention) > 10 else "")
        )

    if compare and compare.get("sufficient_data"):
        cos = compare.get("cosine_similarity")
        lines.append(
            "\n### Real vs. synthetic shopper validation\n"
            f"- Cosine similarity of attention distribution: {cos:.2f}" if cos is not None else
            "\n### Real vs. synthetic shopper validation\n- Not enough overlapping zones to compute similarity."
        )
    lines.append(
        "\n### Recommendation\n"
        "- Prioritize creative/placement investment in the top-attention zones above; "
        "relocate or redesign any ad/promotion sitting in a zero-attention blind spot."
    )
    return "\n".join(lines)


@router.post("/insights")
def generate_insights(
    subject_type: Optional[str] = Query(default=None),
    persona_key: Optional[str] = Query(default=None),
    variant_id: Optional[str] = Query(default=None),
) -> dict:
    stats = db.aggregate_zone_stats(subject_type=subject_type, persona_key=persona_key, variant_id=variant_id)
    zones = _enrich_zones(stats["zones"])
    all_zone_ids = set(zone_lookup().keys())
    zero_attention = sorted(all_zone_ids - {z["zone_id"] for z in zones})
    compare = None
    if subject_type != "real":
        compare = compare_real_vs_agent(persona_key=persona_key, variant_id=variant_id)

    heuristic = _heuristic_insights(zones, zero_attention, compare)

    prompt_lines = [
        "You are a retail analytics assistant. Using ONLY the numbers given below "
        "(do not invent any numbers not present here), write a concise business report "
        "(headline insight, 3-5 bullet findings, 2-3 concrete recommendations) about shopper "
        "attention in this virtual store experiment. Be specific and cite the numbers given.",
        "",
        "Zone attention data (total_dwell_ms, visits, interactions, purchases):",
    ]
    for z in zones:
        prompt_lines.append(
            f"- {z['display_name']} [{z['type']}/{z['category']}]: dwell={z['total_dwell_ms']}ms, "
            f"visits={z['visit_count']}, sessions={z['session_count']}, "
            f"interactions={z['interaction_count']}, purchases={z['purchase_count']}"
        )
    if zero_attention:
        prompt_lines.append(f"\nZones with ZERO recorded attention: {', '.join(zero_attention)}")
    if compare and compare.get("sufficient_data"):
        prompt_lines.append(
            f"\nReal-vs-AI-persona similarity: cosine={compare['cosine_similarity']}, "
            f"pearson={compare['pearson_correlation']}, top3_overlap={compare['top3_zone_overlap']}"
        )

    try:
        narrative = call_llm("\n".join(prompt_lines), system_prompt="Respond in markdown. Be concise and concrete.")
        generated_by = "llm"
    except LLMGatewayError:
        narrative = heuristic
        generated_by = "heuristic_fallback"

    return {
        "generated_by": generated_by,
        "narrative": narrative,
        "stats": {"zones": zones, "zones_with_zero_attention": zero_attention, "compare": compare},
    }
