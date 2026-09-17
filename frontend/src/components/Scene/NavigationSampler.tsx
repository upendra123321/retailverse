import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

const SAMPLE_INTERVAL_MS = 1000;

interface Props {
  enabled: boolean;
  onSample: (sample: { position: [number, number, number]; yaw: number; tsMs: number }) => void;
}

/** Periodically reports camera position/heading for the navigation-path
 * behavioral signal (works identically for real shoppers and agents). */
export function NavigationSampler({ enabled, onSample }: Props) {
  const { camera } = useThree();
  const lastRef = useRef(0);

  useFrame(() => {
    if (!enabled) return;
    const now = performance.now();
    if (now - lastRef.current < SAMPLE_INTERVAL_MS) return;
    lastRef.current = now;
    onSample({
      position: [camera.position.x, camera.position.y, camera.position.z],
      yaw: camera.rotation.y,
      tsMs: now,
    });
  });

  return null;
}
