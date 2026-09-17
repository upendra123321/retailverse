import type { Persona } from "../../types/store";

export interface AgentConfig {
  persona: Persona;
  shopperName: string;
  shopperAge: number;
  variantId: string;
  /** Vision-LLM "flavor" narration cadence - purely for the HUD reason text
   * and audit log; the actual gaze/navigation simulation is deterministic
   * and does not depend on this succeeding (see AgentSimulationController). */
  captureIntervalSeconds: number;
  gridRows: number;
  gridCols: number;
}

export interface AgentGridCell {
  index: number;
  row: number;
  col: number;
  description: string;
}

export interface AgentFocus {
  index: number;
  row: number;
  col: number;
  reason: string;
}
