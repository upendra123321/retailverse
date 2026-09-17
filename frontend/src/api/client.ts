import type { Coefficients } from "../components/EyeTracking/gazeMapping";
import type { AdZonesConfig, Persona, StoreLayout } from "../types/store";

export interface CalibrationProfilePayload {
  profile_id: string;
  coefficients: Coefficients;
  sample_count: number;
  screen_width: number;
  screen_height: number;
}

export async function saveCalibrationProfile(
  payload: CalibrationProfilePayload
): Promise<CalibrationProfilePayload> {
  const res = await fetch("/api/calibration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to save calibration profile: ${res.status}`);
  const data = await res.json();
  return data.profile;
}

export async function loadCalibrationProfile(
  profileId: string
): Promise<CalibrationProfilePayload | null> {
  const res = await fetch(`/api/calibration/${profileId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load calibration profile: ${res.status}`);
  return res.json();
}

export interface AgentGazeRequestPayload {
  persona_description: string;
  shopper_name: string;
  shopper_age: number;
  grid_rows: number;
  grid_cols: number;
  image_base64: string;
}

export interface AgentGazeResponsePayload {
  cells: { index: number; row: number; col: number; description: string }[];
  focus: { index: number; row: number; col: number; reason: string };
}

export async function runAgentGaze(
  payload: AgentGazeRequestPayload
): Promise<AgentGazeResponsePayload> {
  const res = await fetch("/api/agent/gaze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `Agent gaze request failed: ${res.status}`);
  }
  return res.json();
}

// --- Store layout / ad zones / personas -------------------------------------

export async function fetchStoreLayout(): Promise<StoreLayout> {
  const res = await fetch("/api/store/layout");
  if (!res.ok) throw new Error(`Failed to load store layout: ${res.status}`);
  return res.json();
}

export async function fetchAdZones(): Promise<AdZonesConfig> {
  const res = await fetch("/api/store/ad-zones");
  if (!res.ok) throw new Error(`Failed to load ad zones: ${res.status}`);
  return res.json();
}

export async function fetchPersonas(): Promise<Persona[]> {
  const res = await fetch("/api/personas");
  if (!res.ok) throw new Error(`Failed to load personas: ${res.status}`);
  const data = await res.json();
  return data.personas;
}

export async function savePersona(persona: Persona): Promise<Persona> {
  const res = await fetch("/api/personas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(persona),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `Failed to save persona: ${res.status}`);
  }
  return res.json();
}

// --- Sessions / behavioral events --------------------------------------------

export interface SessionCreatePayload {
  subject_type: "real" | "agent";
  persona_key?: string | null;
  persona_label?: string | null;
  variant_id?: string | null;
  meta?: Record<string, unknown>;
}

export interface SessionRecord {
  id: string;
  created_at: string;
  subject_type: "real" | "agent";
  persona_key: string | null;
  persona_label: string | null;
  variant_id: string | null;
  meta: Record<string, unknown>;
}

export async function createSession(payload: SessionCreatePayload): Promise<SessionRecord> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `Failed to create session: ${res.status}`);
  }
  return res.json();
}

export type BehaviorEventType =
  | "zone_dwell"
  | "product_interaction"
  | "purchase"
  | "navigation_sample"
  | "ad_view"
  | "agent_thought";

export interface BehaviorEvent {
  event_type: BehaviorEventType;
  ts_ms: number;
  zone_id?: string | null;
  product_key?: string | null;
  duration_ms?: number | null;
  payload?: Record<string, unknown>;
}

export async function sendEvents(sessionId: string, events: BehaviorEvent[]): Promise<{ inserted: number }> {
  if (events.length === 0) return { inserted: 0 };
  const res = await fetch(`/api/sessions/${sessionId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `Failed to send events: ${res.status}`);
  }
  return res.json();
}

export async function endSession(sessionId: string): Promise<{ session_id: string; ended_at: string; summary: unknown }> {
  const res = await fetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to end session: ${res.status}`);
  return res.json();
}

// --- Analytics ----------------------------------------------------------------

export async function fetchZoneStats(params: {
  subject_type?: string;
  persona_key?: string;
  variant_id?: string;
}): Promise<any> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => !!v) as [string, string][]);
  const res = await fetch(`/api/analytics/zones?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to load zone stats: ${res.status}`);
  return res.json();
}

export async function fetchCompare(params: { persona_key?: string; variant_id?: string }): Promise<any> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => !!v) as [string, string][]);
  const res = await fetch(`/api/analytics/compare?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to load comparison: ${res.status}`);
  return res.json();
}

export async function fetchInsights(params: {
  subject_type?: string;
  persona_key?: string;
  variant_id?: string;
}): Promise<any> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => !!v) as [string, string][]);
  const res = await fetch(`/api/analytics/insights?${qs.toString()}`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to generate insights: ${res.status}`);
  return res.json();
}
