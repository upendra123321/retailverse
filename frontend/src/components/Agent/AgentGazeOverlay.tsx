import type { Phase } from "./AgentSimulationController";
import type { AgentConfig, AgentFocus } from "./types";

interface Props {
  config: AgentConfig;
  focus: AgentFocus | null;
  isThinking: boolean;
  error: string | null;
  /** Navigation phase from AgentSimulationController. "finished" means the
   * persona reached checkout and has no more goals - expected/by-design for
   * Mission Shopper / Brand Loyalist / Switcher personas, which stop moving
   * once done (only the "explore" Browser persona loops forever). Shown
   * explicitly so a completed run isn't mistaken for a frozen/broken one. */
  phase?: Phase;
  onStop: () => void;
}

export function AgentGazeOverlay({ config, focus, isThinking, error, phase, onStop }: Props) {
  const cellCount = config.gridRows * config.gridCols;

  return (
    <div className="agent-overlay">
      <div
        className="agent-grid"
        style={{
          gridTemplateRows: `repeat(${config.gridRows}, 1fr)`,
          gridTemplateColumns: `repeat(${config.gridCols}, 1fr)`,
        }}
      >
        {Array.from({ length: cellCount }, (_, i) => (
          <div key={i} className="agent-grid-cell" />
        ))}
      </div>

      {focus && (
        <div
          className="agent-focus-box"
          style={{
            left: `${(focus.col / config.gridCols) * 100}%`,
            top: `${(focus.row / config.gridRows) * 100}%`,
            width: `${(1 / config.gridCols) * 100}%`,
            height: `${(1 / config.gridRows) * 100}%`,
          }}
        >
          <span className="agent-focus-dot" />
        </div>
      )}

      <div className="agent-hud-panel">
        <strong>
          Agent Mode — {config.persona.label} ({config.shopperName}, {config.shopperAge})
        </strong>
        <p className="agent-hud-substrong">
          navigation: {config.persona.navigation_style} · variant: {config.variantId}
        </p>
        {phase === "finished" ? (
          <p className="agent-hud-done">
            ✅ Simulation complete — {config.persona.label} finished its shopping trip and checked out (or gave up
            browsing). This is expected for goal-directed personas; only the Browser persona loops continuously.
          </p>
        ) : (
          <p>{isThinking ? "Narrating…" : focus ? focus.reason : "Deterministic persona simulation running — narration optional."}</p>
        )}
        {error && phase !== "finished" && (
          <p className="agent-hud-error">
            Narration unavailable ({error.includes("429") || error.toLowerCase().includes("rate limit") ? "rate limited" : "LLM unreachable"}) — persona movement continues normally.
          </p>
        )}
        <button onClick={onStop}>Stop Simulation</button>
      </div>
    </div>
  );
}
