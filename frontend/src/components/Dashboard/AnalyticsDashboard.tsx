import { useEffect, useMemo, useState } from "react";
import {
  askAboutData,
  fetchAdZones,
  fetchCompare,
  fetchInsights,
  fetchPersonas,
  fetchStoreLayout,
  fetchZoneStats,
  runBatchSimulation,
  type AskDataResult,
  type BatchSimulateResult,
} from "../../api/client";
import type { AdZonesConfig, Persona, StoreLayout } from "../../types/store";
import { AttentionHeatmap, type PlottableZone } from "./AttentionHeatmap";

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
  const [storeLayout, setStoreLayout] = useState<StoreLayout | null>(null);
  const [adZones, setAdZones] = useState<AdZonesConfig | null>(null);
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

  // "Ask the data" - grounded LLM Q&A over the same computed stats as Insights.
  const [askQuestion, setAskQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskDataResult | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  // Population-scale batch simulation controls.
  const [simCount, setSimCount] = useState(100);
  const [simPersonaKeys, setSimPersonaKeys] = useState<Set<string>>(new Set());
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<BatchSimulateResult | null>(null);

  useEffect(() => {
    fetchPersonas()
      .then((list) => {
        setPersonas(list);
        setSimPersonaKeys(new Set(list.map((p) => p.persona_key))); // default: whole library selected
      })
      .catch(() => {});
    fetchStoreLayout().then(setStoreLayout).catch(() => {});
    fetchAdZones().then(setAdZones).catch(() => {});
  }, []);

  const plottableZones: PlottableZone[] = useMemo(() => {
    const fromStore: PlottableZone[] = (storeLayout?.zones ?? [])
      .filter((z) => z.type === "product" || z.type === "checkout")
      .map((z) => ({ zone_id: z.zone_id, display_name: z.display_name, type: z.type, center: z.center }));
    const fromAds: PlottableZone[] = (adZones?.ad_slots ?? []).flatMap((slot) =>
      slot.variants.map((v) => ({ zone_id: v.variant_id, display_name: v.label, type: "ad", center: v.position }))
    );
    return [...fromStore, ...fromAds];
  }, [storeLayout, adZones]);

  const toggleSimPersona = (key: string) => {
    setSimPersonaKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runSimulation = () => {
    setSimRunning(true);
    setErrorMsg(null);
    const useAll = simPersonaKeys.size === 0 || simPersonaKeys.size === personas.length;
    runBatchSimulation({
      count: simCount,
      persona_keys: useAll ? undefined : Array.from(simPersonaKeys),
      variant_id: variantId || undefined,
    })
      .then((result) => {
        setSimResult(result);
        refresh();
      })
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : "Batch simulation failed"))
      .finally(() => setSimRunning(false));
  };

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

  const submitAskQuestion = () => {
    if (!askQuestion.trim()) return;
    setAskLoading(true);
    setAskError(null);
    askAboutData({
      question: askQuestion.trim(),
      subject_type: subjectType || undefined,
      persona_key: personaKey || undefined,
      variant_id: variantId || undefined,
    })
      .then(setAskResult)
      .catch((err) => setAskError(err instanceof Error ? err.message : "Failed to get an answer"))
      .finally(() => setAskLoading(false));
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

        <div className="dashboard-simulate">
          <h3>Population-scale simulation</h3>
          <p className="dashboard-simulate-hint">
            Run many AI persona shoppers at once, headlessly (no 3D rendering) - a real statistical panel instead of one
            agent session at a time. Uses the same deterministic persona logic as the live 3D agent.
          </p>
          <div className="dashboard-simulate-controls">
            <label>
              Shoppers
              <input
                type="number"
                min={1}
                max={500}
                value={simCount}
                onChange={(e) => setSimCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              />
            </label>
            <div className="dashboard-simulate-personas">
              {personas.map((p) => (
                <label key={p.persona_key} className="dashboard-simulate-persona-chip">
                  <input type="checkbox" checked={simPersonaKeys.has(p.persona_key)} onChange={() => toggleSimPersona(p.persona_key)} />
                  {p.label}
                </label>
              ))}
              <span className="dashboard-simulate-persona-note">(evenly split across checked personas)</span>
            </div>
            <button onClick={runSimulation} disabled={simRunning}>
              {simRunning ? "Simulating..." : `Simulate ${simCount} shoppers`}
            </button>
          </div>
          {simResult && (
            <p className="dashboard-simulate-result">
              Created {simResult.created} session(s) in {simResult.elapsed_ms.toFixed(0)}ms ·{" "}
              {Object.entries(simResult.per_persona_counts)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ")}
            </p>
          )}
        </div>

        {errorMsg && <p className="dashboard-error">{errorMsg}</p>}
        <p className="dashboard-session-count">{sessionCount} session(s) match this filter.</p>

        {loading ? (
          <p>Loading...</p>
        ) : (
          <>
            {compare?.per_zone && plottableZones.length > 0 && (
              <>
                <h3>Attention heatmap (floor plan)</h3>
                <AttentionHeatmap zones={plottableZones} perZone={compare.per_zone} />
              </>
            )}

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

            <div className="dashboard-ask">
              <h3>Ask the data</h3>
              <p className="dashboard-simulate-hint">
                Ask a natural-language question - the LLM answers using ONLY the same computed numbers shown above
                (never raw database access), grounded and guardrailed exactly like the Insights report.
              </p>
              <div className="dashboard-ask-row">
                <input
                  value={askQuestion}
                  onChange={(e) => setAskQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitAskQuestion()}
                  placeholder="e.g. Which zone underperforms for this persona?"
                  maxLength={500}
                />
                <button onClick={submitAskQuestion} disabled={askLoading || !askQuestion.trim()}>
                  {askLoading ? "Thinking..." : "Ask"}
                </button>
              </div>
              {askError && <p className="dashboard-error">{askError}</p>}
              {askResult && (
                <div className="dashboard-ask-answer">
                  <p className="dashboard-insights-source">
                    Source: {askResult.generated_by === "llm" ? "LLM (grounded in stats above)" : "Deterministic heuristic fallback (LLM unavailable)"}
                    {askResult.question_flagged && " · your question was sanitized before being sent (see audit log)"}
                  </p>
                  <p className="dashboard-ask-answer-text">{askResult.answer}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
