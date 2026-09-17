import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ZoneLookup } from "../../session/zoneLookup";

const SAMPLE_INTERVAL_MS = 150;
const MAX_INTERACT_DISTANCE = 6; // meters - can't "pick up" a product across the store

interface Props {
  lookup: ZoneLookup | null;
  enabled: boolean;
  onHoverChange: (zoneId: string | null) => void;
}

/** Lives inside <Canvas>. Casts a ray straight down the crosshair (screen
 * center) and reports which PRODUCT zone (if any) is directly ahead, within
 * interaction range, so the HUD can prompt "[E] Add <product> to cart".
 */
export function CrosshairRaycaster({ lookup, enabled, onHoverChange }: Props) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const lastSampleRef = useRef(0);
  const lastZoneRef = useRef<string | null>(null);

  useFrame(() => {
    if (!enabled || !lookup) {
      if (lastZoneRef.current !== null) {
        lastZoneRef.current = null;
        onHoverChange(null);
      }
      return;
    }
    const now = performance.now();
    if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS) return;
    lastSampleRef.current = now;

    raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.current.far = MAX_INTERACT_DISTANCE;
    const hits = raycaster.current.intersectObjects(scene.children, true);

    let zoneId: string | null = null;
    if (hits.length > 0) {
      const name = hits[0].object.name;
      const mapped = name ? lookup.meshNameToZoneId.get(name) : undefined;
      if (mapped) {
        const zone = lookup.zoneById.get(mapped);
        if (zone && zone.type === "product") zoneId = mapped;
      }
    }

    if (zoneId !== lastZoneRef.current) {
      lastZoneRef.current = zoneId;
      onHoverChange(zoneId);
    }
  });

  return null;
}
