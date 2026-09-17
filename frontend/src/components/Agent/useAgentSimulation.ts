import { useEffect, useRef, useState } from "react";
import { runAgentGaze } from "../../api/client";
import type { AgentConfig, AgentFocus, AgentGridCell } from "./types";

interface Params {
  config: AgentConfig | null;
  running: boolean;
  getCanvas: () => HTMLCanvasElement | null;
  /** Optional audit-trail hook: called with the LLM's reasoning whenever a
   * narration call succeeds, so it can be logged as an 'agent_thought' event
   * even though it does not drive the actual gaze/navigation simulation. */
  onThought?: (reason: string) => void;
}

/** Optional qualitative "narration" layer: periodically asks a vision LLM to
 * describe what's on screen and a judge LLM to guess where the shopper would
 * look, purely for HUD flavor text + an audit trail. This is NOT a hard
 * dependency - AgentSimulationController's deterministic persona-driven
 * gaze/navigation keeps working identically whether or not this succeeds,
 * which is why failures here only set a soft `error` string instead of
 * blocking anything.
 */
export function useAgentSimulation({ config, running, getCanvas, onThought }: Params) {
  const [focus, setFocus] = useState<AgentFocus | null>(null);
  const [cells, setCells] = useState<AgentGridCell[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!running || !config) return;
    let cancelled = false;

    async function tick() {
      if (busyRef.current) return;
      const canvas = getCanvas();
      if (!canvas) return;

      busyRef.current = true;
      setIsThinking(true);
      try {
        const imageBase64 = canvas.toDataURL("image/png");
        const result = await runAgentGaze({
          persona_description: config!.persona.description,
          shopper_name: config!.shopperName,
          shopper_age: config!.shopperAge,
          grid_rows: config!.gridRows,
          grid_cols: config!.gridCols,
          image_base64: imageBase64,
        });
        if (!cancelled) {
          setCells(result.cells);
          setFocus(result.focus);
          setError(null);
          onThought?.(result.focus.reason);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "LLM narration unavailable (simulation continues without it)");
        }
      } finally {
        busyRef.current = false;
        if (!cancelled) setIsThinking(false);
      }
    }

    void tick();
    const intervalId = window.setInterval(tick, Math.max(1, config.captureIntervalSeconds) * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [running, config, getCanvas, onThought]);

  useEffect(() => {
    if (!running) {
      setFocus(null);
      setCells([]);
      setError(null);
      setIsThinking(false);
    }
  }, [running]);

  return { focus, cells, isThinking, error };
}
