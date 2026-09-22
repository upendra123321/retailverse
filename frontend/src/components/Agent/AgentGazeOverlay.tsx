import type { AgentConfig, AgentFocus } from "./types";

interface Props {
  config: AgentConfig;
  focus: AgentFocus | null;
  isThinking: boolean;
  error: string | null;
  onStop: () => void;
}

export function AgentGazeOverlay({ config, focus, isThinking, error, onStop }: Props) {
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
        <p>{isThinking ? "Narrating…" : focus ? focus.reason : "Deterministic persona simulation running — narration optional."}</p>
        {error && (
          <p className="agent-hud-error">
            Narration unavailable (LLM unreachable) — persona movement continues normally.
          </p>
        )}
        <button onClick={onStop}>Stop Simulation</button>
      </div>
    </div>
  );
}
