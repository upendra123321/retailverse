import { useEffect, useState } from "react";
import { fetchCompare, fetchInsights, fetchPersonas, fetchZoneStats } from "../../api/client";
import type { Persona } from "../../types/store";

interface Props {
  onClose: () => void;
}

interface ZoneStat {
  zone_id: string;
  display_name: string;
  type: string;
  category: string;
  total_dwell_ms: number;
  visit_count: number;
  session_count: number;
  interaction_count: number;
  purchase_count: number;
}

export function AnalyticsDashboard({ onClose }: Props) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [subjectType, setSubjectType] = useState<string>("");
  const [personaKey, setPersonaKey] = useState<string>("");
  const [variantId, setVariantId] = useState<string>("");

  const [zones, setZones] = useState<ZoneStat[]>([]);
  const [zeroAttention, setZeroAttention] = useState<string[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [compare, setCompare] = useState<any>(null);
  const [insights, setInsights] = useState<{ generated_by: string; narrative: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchPersonas().then(setPersonas).catch(() => {});
  }, []);

  const refresh = () => {
    setLoading(true);
    setErrorMsg(null);
    const params = {
      subject_type: subjectType || undefined,
      persona_key: personaKey || undefined,
      variant_id: variantId || undefined,
    };
    Promise.all([fetchZoneStats(params), fetchCompare({ persona_key: personaKey || undefined, variant_id: variantId || undefined })])
      .then(([zoneResp, compareResp]) => {
        setZones(zoneResp.zones);
        setZeroAttention(zoneResp.zones_with_zero_attention);
        setSessionCount(zoneResp.session_count);
        setCompare(compareResp);
      })
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : "Failed to load analytics"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, personaKey, variantId]);

  const generateInsights = () => {
    setInsightsLoading(true);
    fetchInsights({
      subject_type: subjectType || undefined,
      persona_key: personaKey || undefined,
      variant_id: variantId || undefined,
    })
      .then(setInsights)
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : "Failed to generate insights"))
      .finally(() => setInsightsLoading(false));
  };

  const maxDwell = Math.max(1, ...zones.map((z) => z.total_dwell_ms));

  return (
    <div className="dashboard-overlay">
      <div className="dashboard-panel">
        <div className="dashboard-header">
          <h2>Shopper Attention & Behavior Report</h2>
          <button onClick={onClose}>Close</button>
        </div>

        <div className="dashboard-filters">
          <label>
            Subject
            <select value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>
              <option value="">All (real + agent)</option>
              <option value="real">Real shoppers only</option>
              <option value="agent">AI personas only</option>
            </select>
          </label>
          <label>
            Persona
            <select value={personaKey} onChange={(e) => setPersonaKey(e.target.value)}>
              <option value="">Any persona</option>
              {personas.map((p) => (
                <option key={p.persona_key} value={p.persona_key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Variant
            <input value={variantId} onChange={(e) => setVariantId(e.target.value)} placeholder="e.g. variant_a_high_traffic" />
          </label>
          <button onClick={refresh}>Refresh</button>
        </div>

        {errorMsg && <p className="dashboard-error">{errorMsg}</p>}
        <p className="dashboard-session-count">{sessionCount} session(s) match this filter.</p>

        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            <h3>Attention by zone</h3>
            {zones.length === 0 ? (
              <p>No dwell data yet - run a real or agent session first.</p>
            ) : (
              <div className="zone-bar-chart">
                {zones.map((z) => (
                  <div key={z.zone_id} className="zone-bar-row">
                    <span className="zone-bar-label">
                      {z.display_name} <em>({z.type})</em>
                    </span>
                    <div className="zone-bar-track">
                      <div
                        className={`zone-bar-fill zone-bar-${z.type}`}
                        style={{ width: `${(100 * z.total_dwell_ms) / maxDwell}%` }}
                      />
                    </div>
                    <span className="zone-bar-value">
                      {(z.total_dwell_ms / 1000).toFixed(1)}s · {z.visit_count} visit(s) · {z.interaction_count} interaction(s) ·{" "}
                      {z.purchase_count} purchase(s)
                    </span>
                  </div>
                ))}
              </div>
            )}

            {zeroAttention.length > 0 && (
              <div className="dashboard-blind-spots">
                <h3>Zero-attention zones ("blind spots")</h3>
                <p>{zeroAttention.join(", ")}</p>
              </div>
            )}

            {compare && (
              <div className="dashboard-compare">
                <h3>Real vs. AI persona validation</h3>
                {compare.sufficient_data ? (
                  <ul>
                    <li>Real sessions: {compare.real_session_count} | Agent sessions: {compare.agent_session_count}</li>
                    <li>Cosine similarity of attention distribution: {compare.cosine_similarity?.toFixed(3)}</li>
                    <li>Pearson correlation: {compare.pearson_correlation?.toFixed(3) ?? "n/a"}</li>
                    <li>Top-3 zone overlap: {(compare.top3_zone_overlap * 100).toFixed(0)}%</li>
                  </ul>
                ) : (
                  <p>
                    Not enough data yet (need at least one real session and one agent session with the same filters) to
                    compute similarity.
                  </p>
                )}
              </div>
            )}

            <div className="dashboard-insights">
              <h3>Automated insights</h3>
              <button onClick={generateInsights} disabled={insightsLoading}>
                {insightsLoading ? "Generating..." : "Generate Insights Report"}
              </button>
              {insights && (
                <>
                  <p className="dashboard-insights-source">Source: {insights.generated_by === "llm" ? "LLM (grounded in stats below)" : "Deterministic heuristic fallback (LLM unavailable)"}</p>
                  <pre className="dashboard-insights-text">{insights.narrative}</pre>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
