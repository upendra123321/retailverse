import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AgentConfig } from "./types";
import type { AdZonesConfig, Persona } from "../../types/store";
import { fetchAdZones, fetchPersonas, savePersona, suggestPersonaFields } from "../../api/client";

const GRID_PATTERN = /^(\d{1,2})x(\d{1,2})$/i;

const BLANK_CUSTOM: Persona = {
  persona_key: "",
  label: "",
  description: "",
  navigation_style: "explore",
  target_categories: [],
  preferred_product_keys: [],
  patience_seconds: 45,
  browse_probability: 0.5,
  ad_attention_bias: 0.4,
  price_sensitivity: "medium",
  purchase_likelihood: 0.5,
};

interface Props {
  onStart: (config: AgentConfig) => void;
  onCancel: () => void;
}

export function AgentSetupForm({ onStart, onCancel }: Props) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [adZones, setAdZones] = useState<AdZonesConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<"library" | "custom">("library");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [custom, setCustom] = useState<Persona>(BLANK_CUSTOM);
  const [savingCustom, setSavingCustom] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  const [shopperName, setShopperName] = useState("");
  const [shopperAge, setShopperAge] = useState(30);
  const [variantId, setVariantId] = useState("");
  const [captureIntervalSeconds, setCaptureIntervalSeconds] = useState(6);
  const [gridSize, setGridSize] = useState("4x4");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPersonas(), fetchAdZones()])
      .then(([p, ad]) => {
        setPersonas(p);
        if (p.length > 0) setSelectedKey(p[0].persona_key);
        setAdZones(ad);
        const firstVariant = ad.ad_slots[0]?.variants[0]?.variant_id;
        if (firstVariant) setVariantId(firstVariant);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load persona/store data"));
  }, []);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.persona_key === selectedKey) ?? null,
    [personas, selectedKey]
  );

  async function handleSuggestFields() {
    if (!custom.description.trim() || custom.description.trim().length < 5) {
      setSuggestNote("Write a bit more of a backstory first (at least 5 characters).");
      return;
    }
    setSuggesting(true);
    setSuggestNote(null);
    try {
      const suggestion = await suggestPersonaFields(custom.description.trim());
      setCustom((prev) => ({
        ...prev,
        navigation_style: suggestion.navigation_style,
        target_categories: suggestion.target_categories,
        patience_seconds: suggestion.patience_seconds,
        browse_probability: suggestion.browse_probability,
        ad_attention_bias: suggestion.ad_attention_bias,
        price_sensitivity: suggestion.price_sensitivity,
        purchase_likelihood: suggestion.purchase_likelihood,
      }));
      setSuggestNote(
        suggestion.generated_by === "llm"
          ? "✨ Fields suggested by LLM - review and adjust before saving."
          : "Fields suggested by a heuristic fallback (LLM unavailable) - review and adjust before saving."
      );
    } catch (err) {
      setSuggestNote(err instanceof Error ? err.message : "Failed to suggest fields");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const match = GRID_PATTERN.exec(gridSize.trim());
    if (!match) {
      setFormError('Grid size must look like "4x4" or "5x5".');
      return;
    }
    const gridRows = Number(match[1]);
    const gridCols = Number(match[2]);
    if (gridRows < 2 || gridCols < 2 || gridRows > 12 || gridCols > 12 || gridRows * gridCols > 100) {
      setFormError("Grid dimensions must each be 2-12 and total <= 100 cells.");
      return;
    }
    if (!shopperName.trim()) {
      setFormError("Shopper name is required.");
      return;
    }

    let persona: Persona | null = null;
    if (mode === "library") {
      persona = selectedPersona;
      if (!persona) {
        setFormError("Choose a persona from the library.");
        return;
      }
    } else {
      if (!custom.persona_key.trim() || !custom.label.trim() || !custom.description.trim()) {
        setFormError("Custom persona needs a key, label, and description.");
        return;
      }
      setSavingCustom(true);
      try {
        persona = await savePersona({
          ...custom,
          persona_key: custom.persona_key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        });
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Failed to save custom persona");
        setSavingCustom(false);
        return;
      }
      setSavingCustom(false);
    }

    setFormError(null);
    onStart({
      persona,
      shopperName: shopperName.trim(),
      shopperAge,
      variantId,
      captureIntervalSeconds: Math.max(1, captureIntervalSeconds),
      gridRows,
      gridCols,
    });
  }

  return (
    <div className="agent-setup-overlay">
      <form className="agent-setup-panel" onSubmit={handleSubmit}>
        <h2>Agent Mode — AI Shopper Persona Setup</h2>
        {loadError && <p className="agent-setup-error">{loadError}</p>}

        <div className="agent-setup-tabs">
          <button type="button" className={mode === "library" ? "active" : ""} onClick={() => setMode("library")}>
            Choose Persona
          </button>
          <button type="button" className={mode === "custom" ? "active" : ""} onClick={() => setMode("custom")}>
            Create Custom Persona
          </button>
        </div>

        {mode === "library" ? (
          <>
            <label>
              Persona
              <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
                {personas.map((p) => (
                  <option key={p.persona_key} value={p.persona_key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedPersona && (
              <div className="agent-persona-preview">
                <p>{selectedPersona.description}</p>
                <p className="agent-persona-meta">
                  navigation: <strong>{selectedPersona.navigation_style}</strong> · patience:{" "}
                  <strong>{selectedPersona.patience_seconds}s</strong> · ad attention:{" "}
                  <strong>{Math.round(selectedPersona.ad_attention_bias * 100)}%</strong> · purchase likelihood:{" "}
                  <strong>{Math.round(selectedPersona.purchase_likelihood * 100)}%</strong>
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="agent-setup-row">
              <label>
                Persona key
                <input
                  value={custom.persona_key}
                  onChange={(e) => setCustom({ ...custom, persona_key: e.target.value })}
                  placeholder="deal_hunter"
                  required
                />
              </label>
              <label>
                Label
                <input
                  value={custom.label}
                  onChange={(e) => setCustom({ ...custom, label: e.target.value })}
                  placeholder="Deal Hunter"
                  required
                />
              </label>
            </div>
            <label>
              Description / backstory
              <textarea
                value={custom.description}
                onChange={(e) => setCustom({ ...custom, description: e.target.value })}
                rows={3}
                placeholder="e.g. Only buys what's on promotion, checks every shelf-talker and banner before deciding."
                required
              />
            </label>
            <div className="agent-setup-suggest-row">
              <button type="button" onClick={handleSuggestFields} disabled={suggesting}>
                {suggesting ? "Thinking..." : "✨ Suggest fields from description"}
              </button>
              {suggestNote && <span className="agent-setup-suggest-note">{suggestNote}</span>}
            </div>
            <div className="agent-setup-row">
              <label>
                Navigation style
                <select
                  value={custom.navigation_style}
                  onChange={(e) => setCustom({ ...custom, navigation_style: e.target.value as Persona["navigation_style"] })}
                >
                  <option value="direct">direct (beeline to target, then leave)</option>
                  <option value="explore">explore (wander broadly)</option>
                  <option value="compare">compare (bounce between similar products)</option>
                </select>
              </label>
              <label>
                Price sensitivity
                <select
                  value={custom.price_sensitivity}
                  onChange={(e) => setCustom({ ...custom, price_sensitivity: e.target.value as Persona["price_sensitivity"] })}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
            </div>
            <div className="agent-setup-row">
              <label>
                Target categories (comma-separated, e.g. breakfast)
                <input
                  value={custom.target_categories.join(", ")}
                  onChange={(e) =>
                    setCustom({ ...custom, target_categories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                  }
                />
              </label>
              <label>
                Preferred products (comma-separated product_key)
                <input
                  value={custom.preferred_product_keys.join(", ")}
                  onChange={(e) =>
                    setCustom({ ...custom, preferred_product_keys: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                  }
                />
              </label>
            </div>
            <div className="agent-setup-row">
              <label>
                Patience (seconds)
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={custom.patience_seconds}
                  onChange={(e) => setCustom({ ...custom, patience_seconds: Number(e.target.value) })}
                />
              </label>
              <label>
                Browse probability (0-1)
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={custom.browse_probability}
                  onChange={(e) => setCustom({ ...custom, browse_probability: Number(e.target.value) })}
                />
              </label>
              <label>
                Ad attention bias (0-1)
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={custom.ad_attention_bias}
                  onChange={(e) => setCustom({ ...custom, ad_attention_bias: Number(e.target.value) })}
                />
              </label>
              <label>
                Purchase likelihood (0-1)
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={custom.purchase_likelihood}
                  onChange={(e) => setCustom({ ...custom, purchase_likelihood: Number(e.target.value) })}
                />
              </label>
            </div>
            <p className="agent-setup-hint">Saved personas are added to the library (backend/data/personas.json) for your whole team to reuse.</p>
          </>
        )}

        <div className="agent-setup-row">
          <label>
            Shopper name
            <input value={shopperName} onChange={(e) => setShopperName(e.target.value)} required />
          </label>
          <label>
            Shopper age
            <input type="number" min={1} max={120} value={shopperAge} onChange={(e) => setShopperAge(Number(e.target.value))} required />
          </label>
        </div>

        <label>
          A/B ad placement variant
          <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            {adZones?.ad_slots.flatMap((slot) =>
              slot.variants.map((v) => (
                <option key={v.variant_id} value={v.variant_id}>
                  {v.label}
                </option>
              ))
            )}
          </select>
        </label>

        <div className="agent-setup-row">
          <label>
            LLM narration interval (seconds)
            <input
              type="number"
              min={1}
              max={120}
              value={captureIntervalSeconds}
              onChange={(e) => setCaptureIntervalSeconds(Number(e.target.value))}
              required
            />
          </label>
          <label>
            Grid size (for LLM narration only)
            <input value={gridSize} onChange={(e) => setGridSize(e.target.value)} placeholder="4x4" required />
          </label>
        </div>
        <p className="agent-setup-hint">
          Movement and gaze are driven deterministically by the persona above (no LLM dependency). The grid/LLM
          settings only affect an optional narration overlay describing what the agent "notices" - if no API key is
          configured it will simply show a fallback message.
        </p>

        {formError && <p className="agent-setup-error">{formError}</p>}

        <div className="agent-setup-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={savingCustom}>
            {savingCustom ? "Saving persona..." : "Start Simulation"}
          </button>
        </div>
      </form>
    </div>
  );
}
