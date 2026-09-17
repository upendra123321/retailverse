import { useEffect, useRef } from "react";
import type { GazeFeatures } from "./useFaceLandmarker";
import { predictGaze, type Coefficients } from "./gazeMapping";

interface Props {
  getFeatures: () => GazeFeatures | null;
  coefficients: Coefficients;
}

/** Overlay dot that follows the estimated on-screen gaze point every frame. */
export function GazeCursor({ getFeatures, coefficients }: Props) {
  const dotRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    function loop() {
      const f = getFeatures();
      if (f && dotRef.current) {
        const { x, y } = predictGaze(coefficients, f.avgX, f.avgY);
        const clampedX = Math.min(1, Math.max(0, x));
        const clampedY = Math.min(1, Math.max(0, y));
        dotRef.current.style.left = `${clampedX * 100}%`;
        dotRef.current.style.top = `${clampedY * 100}%`;
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [getFeatures, coefficients]);

  return <div ref={dotRef} className="gaze-cursor" />;
}
