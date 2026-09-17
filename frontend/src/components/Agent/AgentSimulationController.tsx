import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Persona, StoreZone } from "../../types/store";
import { buildTargetQueue, dwellDurationMs, maybePickGlanceZone, rebuildQueueForContinuousBrowsing } from "./personaNavigation";
import type { GazeScreenPoint } from "../Scene/ZoneAttentionTracker";

const MOVE_SPEED = 1.3; // meters/second - relaxed browsing pace
const EYE_HEIGHT = 2.2;
const GROUND_PROBE_HEIGHT = 5;
const ARRIVAL_RADIUS = 1.8;
const OBSTACLE_DISTANCE = 1.3;
const YAW_TURN_RATE = 2.2; // rad/sec turning speed while walking toward a target
const GLANCE_MIN_MS = 1200;
const GLANCE_MAX_MS = 3000;

type Phase = "seeking" | "dwelling" | "finished";

interface Props {
  persona: Persona | null;
  zones: StoreZone[];
  paused?: boolean;
  /** Written every frame with the agent's current simulated gaze point (NDC-normalized
   * 0..1 viewport coords) - read by ZoneAttentionTracker to attribute dwell time. */
  gazeRef: MutableRefObject<GazeScreenPoint>;
  /** Fired once when the agent arrives and begins dwelling at a new target zone -
   * used by the caller to log product_interaction / eventual purchase events. */
  onArrive?: (zone: StoreZone) => void;
}

/** Goal-directed shopper navigation driven by a persona's declarative goals
 * (see personaNavigation.ts) - replaces pure random wandering with: walk to
 * target zone(s) in an order + cadence determined by the persona archetype,
 * dwell there for a persona-appropriate duration, and simulate believable
 * "peripheral" gaze glances at ads/off-path shelves along the way. This is
 * the core differentiator: gaze + movement are *derived from the persona*,
 * not from a generic LLM chat loop.
 */
export function AgentSimulationController({ persona, zones, paused = false, gazeRef, onArrive }: Props) {
  const { camera, scene } = useThree();
  const yawRef = useRef(Math.PI);
  const groundRay = useRef(new THREE.Raycaster());
  const obstacleRay = useRef(new THREE.Raycaster());

  const queueRef = useRef<StoreZone[]>([]);
  const targetIndexRef = useRef(0);
  const phaseRef = useRef<Phase>("seeking");
  const dwellUntilRef = useRef(0);
  const glanceUntilRef = useRef(0);
  const glanceZoneRef = useRef<StoreZone | null>(null);

  useEffect(() => {
    camera.position.set(0, EYE_HEIGHT, 4);
    yawRef.current = Math.PI;
    camera.rotation.set(0, yawRef.current, 0);
    queueRef.current = persona && zones.length > 0 ? buildTargetQueue(persona, zones) : [];
    targetIndexRef.current = 0;
    phaseRef.current = "seeking";
    glanceUntilRef.current = 0;
  }, [camera, persona, zones]);

  useFrame((_, delta) => {
    if (paused || !persona || queueRef.current.length === 0 || phaseRef.current === "finished") return;
    const now = performance.now();
    const target = queueRef.current[targetIndexRef.current];
    if (!target) return;

    if (phaseRef.current === "seeking") {
      const dx = target.center[0] - camera.position.x;
      const dz = target.center[2] - camera.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= ARRIVAL_RADIUS) {
        phaseRef.current = "dwelling";
        dwellUntilRef.current = now + dwellDurationMs(persona, queueRef.current.length);
        onArrive?.(target);
      } else {
        const desiredYaw = Math.atan2(-dx, -dz); // matches forward = (-sin(yaw), 0, -cos(yaw))
        let yawDiff = desiredYaw - yawRef.current;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
        const maxStep = YAW_TURN_RATE * delta;
        yawRef.current += Math.max(-maxStep, Math.min(maxStep, yawDiff));

        const forward = new THREE.Vector3(-Math.sin(yawRef.current), 0, -Math.cos(yawRef.current));
        obstacleRay.current.set(camera.position, forward);
        obstacleRay.current.far = OBSTACLE_DISTANCE;
        const blocked = obstacleRay.current.intersectObjects(scene.children, true).length > 0;
        if (blocked) {
          yawRef.current += Math.PI / 2.2; // sidestep around the obstacle
        } else {
          camera.position.addScaledVector(forward, MOVE_SPEED * delta);
        }
        camera.rotation.set(0, yawRef.current, 0);
      }
    } else if (phaseRef.current === "dwelling" && now >= dwellUntilRef.current) {
      const atEnd = targetIndexRef.current >= queueRef.current.length - 1;
      if (atEnd) {
        if (persona.navigation_style === "explore") {
          queueRef.current = rebuildQueueForContinuousBrowsing(persona, zones);
          targetIndexRef.current = 0;
          phaseRef.current = "seeking";
        } else {
          phaseRef.current = "finished";
        }
      } else {
        targetIndexRef.current += 1;
        phaseRef.current = "seeking";
      }
    }

    // Snap to floor height under wherever the agent currently is.
    groundRay.current.set(
      new THREE.Vector3(camera.position.x, camera.position.y + GROUND_PROBE_HEIGHT, camera.position.z),
      new THREE.Vector3(0, -1, 0)
    );
    const groundHits = groundRay.current.intersectObjects(scene.children, true);
    if (groundHits.length > 0) camera.position.y = groundHits[0].point.y + EYE_HEIGHT;

    // --- Persona-biased gaze simulation (independent of body/camera facing) ---
    if (now >= glanceUntilRef.current) {
      const glance = maybePickGlanceZone(persona, zones, target.zone_id);
      if (glance) {
        glanceZoneRef.current = glance;
        glanceUntilRef.current = now + (GLANCE_MIN_MS + Math.random() * (GLANCE_MAX_MS - GLANCE_MIN_MS));
      } else {
        glanceZoneRef.current = null;
      }
    }
    const gazeZone = glanceZoneRef.current ?? target;
    const projected = new THREE.Vector3(...gazeZone.center).project(camera);
    const inView = projected.z < 1 && Math.abs(projected.x) <= 1.2 && Math.abs(projected.y) <= 1.2;
    gazeRef.current = {
      x: inView ? THREE.MathUtils.clamp((projected.x + 1) / 2, 0, 1) : 0.5,
      y: inView ? THREE.MathUtils.clamp((1 - projected.y) / 2, 0, 1) : 0.5,
      source: "agent_heuristic",
    };
  });

  return null;
}
