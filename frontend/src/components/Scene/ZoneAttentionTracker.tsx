import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ZoneLookup } from "../../session/zoneLookup";

const SAMPLE_INTERVAL_MS = 200; // throttle raycasts - dwell precision doesn't need per-frame sampling

export interface GazeScreenPoint {
  /** Normalized 0..1 viewport coordinates. */
  x: number;
  y: number;
  /** Provenance of this gaze estimate, logged with every dwell event for auditability. */
  source: "calibrated_gaze" | "camera_center_fallback" | "agent_llm_judge" | "agent_heuristic";
}

interface Props {
  lookup: ZoneLookup | null;
  getScreenPoint: () => GazeScreenPoint | null;
  enabled: boolean;
  /** enteredAtMs/nowMs are raw performance.now() timestamps - the caller converts to session-relative ms. */
  onDwell: (zoneId: string, enteredAtMs: number, durationMs: number, source: GazeScreenPoint["source"]) => void;
}

/** Lives inside <Canvas>. Raycasts from the camera through the current gaze
 * point every SAMPLE_INTERVAL_MS, resolves the hit mesh to a zone via
 * `lookup`, and reports a completed dwell event whenever the looked-at zone
 * changes (or tracking stops/unmounts mid-dwell).
 */
export function ZoneAttentionTracker({ lookup, getScreenPoint, enabled, onDwell }: Props) {
  const { camera, scene } = useThree();
  const raycasterRef = useRef(new THREE.Raycaster());
  const lastSampleRef = useRef(0);
  const currentRef = useRef<{ zoneId: string; enteredAtMs: number; source: GazeScreenPoint["source"] } | null>(null);

  const flushCurrent = (now: number) => {
    const current = currentRef.current;
    if (current) {
      onDwell(current.zoneId, current.enteredAtMs, now - current.enteredAtMs, current.source);
      currentRef.current = null;
    }
  };

  // Flush an in-progress dwell whenever tracking is paused/disabled.
  useEffect(() => {
    if (!enabled) flushCurrent(performance.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    return () => flushCurrent(performance.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    if (!enabled || !lookup) return;
    const now = performance.now();
    if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS) return;
    lastSampleRef.current = now;

    const point = getScreenPoint();
    if (!point) return;

    const ndcX = point.x * 2 - 1;
    const ndcY = -(point.y * 2 - 1);
    raycasterRef.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hits = raycasterRef.current.intersectObjects(scene.children, true);

    let zoneId: string | null = null;
    for (const hit of hits) {
      const name = hit.object.name;
      if (name && lookup.meshNameToZoneId.has(name)) {
        zoneId = lookup.meshNameToZoneId.get(name)!;
        break;
      }
    }

    const current = currentRef.current;
    if (zoneId === (current?.zoneId ?? null)) return;

    flushCurrent(now);
    currentRef.current = zoneId ? { zoneId, enteredAtMs: now, source: point.source } : null;
  });

  return null;
}
