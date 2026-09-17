import { useCallback, useEffect, useRef, useState } from "react";
import { fitCalibration, type CalibrationSample, type Coefficients } from "./gazeMapping";
import type { GazeFeatures } from "./useFaceLandmarker";

// Normalized (0..1) 3x3 grid of calibration targets across the viewport.
const GRID: Array<[number, number]> = [
  [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
  [0.08, 0.5], [0.5, 0.5], [0.92, 0.5],
  [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
];
const SETTLE_FRAMES = 24;
const SAMPLES_PER_POINT = 45;

interface Props {
  getFeatures: () => GazeFeatures | null;
  onComplete: (coefficients: Coefficients, sampleCount: number) => void;
  onCancel: () => void;
}

export function CalibrationOverlay({ getFeatures, onComplete, onCancel }: Props) {
  const [pointIndex, setPointIndex] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [progress, setProgress] = useState(0);
  const samplesRef = useRef<CalibrationSample[]>([]);

  const capturePoint = useCallback(() => {
    if (capturing) return;
    setCapturing(true);
    let collected = 0;
    let settleFrames = SETTLE_FRAMES;
    const pointSamples: GazeFeatures[] = [];
    const [targetX, targetY] = GRID[pointIndex];

    function tick() {
      const f = getFeatures();
      if (settleFrames > 0) {
        settleFrames--;
        requestAnimationFrame(tick);
        return;
      }
      if (f) {
        pointSamples.push(f);
        collected++;
        setProgress(collected / SAMPLES_PER_POINT);
      }
      if (collected < SAMPLES_PER_POINT) {
        requestAnimationFrame(tick);
        return;
      }
      const stableX = pointSamples.map((sample) => sample.avgX).sort((a, b) => a - b);
      const stableY = pointSamples.map((sample) => sample.avgY).sort((a, b) => a - b);
      const trim = Math.floor(stableX.length * 0.15);
      const trimmedX = stableX.slice(trim, stableX.length - trim);
      const trimmedY = stableY.slice(trim, stableY.length - trim);
      const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      samplesRef.current.push({
        avgX: mean(trimmedX),
        avgY: mean(trimmedY),
        targetX,
        targetY,
      });
      setCapturing(false);
      setProgress(0);
      setPointIndex((prev) => {
        const next = prev + 1;
        if (next >= GRID.length) {
          const coefficients = fitCalibration(samplesRef.current);
          onComplete(coefficients, samplesRef.current.length);
        }
        return next;
      });
    }
    requestAnimationFrame(tick);
  }, [capturing, pointIndex, getFeatures, onComplete]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.code === "Space") {
        e.preventDefault();
        if (pointIndex < GRID.length) capturePoint();
      } else if (e.code === "Escape") {
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [capturePoint, onCancel, pointIndex]);

  if (pointIndex >= GRID.length) return null;

  const [targetX, targetY] = GRID[pointIndex];

  return (
    <div className="calibration-overlay">
      <div className="calibration-instructions">
        <p>Look at the highlighted dot, keep your head still, then press <kbd>Space</kbd> to capture.</p>
        <p>
          Point {pointIndex + 1} / {GRID.length}
          {capturing ? ` — capturing ${Math.round(progress * 100)}%` : ""}
        </p>
        <button onClick={onCancel}>Cancel (Esc)</button>
      </div>
      <div
        className={`calibration-dot${capturing ? " capturing" : ""}`}
        style={{ left: `${targetX * 100}%`, top: `${targetY * 100}%` }}
        onClick={capturePoint}
      />
    </div>
  );
}
