import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// MediaPipe FaceMesh landmark indices (with iris refinement enabled by default).
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const LEFT_EYE_TOP = 159;
const LEFT_EYE_BOTTOM = 145;
const LEFT_IRIS_CENTER = 468;

const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;
const RIGHT_EYE_TOP = 386;
const RIGHT_EYE_BOTTOM = 374;
const RIGHT_IRIS_CENTER = 473;

export interface GazeFeatures {
  avgX: number;
  avgY: number;
}

type Point = { x: number; y: number };

function axisRatio(point: Point, a: Point, b: Point, axis: "x" | "y") {
  const span = b[axis] - a[axis];
  if (Math.abs(span) < 1e-6) return 0.5;
  return (point[axis] - a[axis]) / span;
}

function computeFeatures(landmarks: Point[]): GazeFeatures | null {
  const required = [
    LEFT_IRIS_CENTER, RIGHT_IRIS_CENTER,
    LEFT_EYE_OUTER, LEFT_EYE_INNER, RIGHT_EYE_INNER, RIGHT_EYE_OUTER,
    LEFT_EYE_TOP, LEFT_EYE_BOTTOM, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM,
  ];
  if (required.some((index) => !landmarks[index])) return null;

  const leftX = axisRatio(landmarks[LEFT_IRIS_CENTER], landmarks[LEFT_EYE_OUTER], landmarks[LEFT_EYE_INNER], "x");
  const leftY = axisRatio(landmarks[LEFT_IRIS_CENTER], landmarks[LEFT_EYE_TOP], landmarks[LEFT_EYE_BOTTOM], "y");
  const rightX = axisRatio(landmarks[RIGHT_IRIS_CENTER], landmarks[RIGHT_EYE_INNER], landmarks[RIGHT_EYE_OUTER], "x");
  const rightY = axisRatio(landmarks[RIGHT_IRIS_CENTER], landmarks[RIGHT_EYE_TOP], landmarks[RIGHT_EYE_BOTTOM], "y");
  const avgX = (leftX + rightX) / 2;
  const avgY = (leftY + rightY) / 2;
  if (!Number.isFinite(avgX) || !Number.isFinite(avgY)) return null;
  if (avgX < -0.25 || avgX > 1.25 || avgY < -0.25 || avgY > 1.25) return null;
  return { avgX, avgY };
}

export interface FaceLandmarkerState {
  videoRef: React.RefObject<HTMLVideoElement>;
  isReady: boolean;
  error: string | null;
  getFeatures: () => GazeFeatures | null;
}

/**
 * Starts the webcam + MediaPipe FaceLandmarker and keeps the latest
 * normalized iris-position feature vector in a ref (no per-frame re-renders).
 */
export function useFaceLandmarker(active: boolean): FaceLandmarkerState {
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const featuresRef = useRef<GazeFeatures | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    function loop() {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (video && landmarker && video.readyState >= 2) {
        const result = landmarker.detectForVideo(video, performance.now());
        const landmarks = result.faceLandmarks?.[0];
        if (landmarks) {
          const next = computeFeatures(landmarks);
          if (next) {
            // Smooth normal landmark jitter while retaining deliberate eye motion.
            const previous = featuresRef.current;
            featuresRef.current = previous
              ? {
                  avgX: previous.avgX * 0.7 + next.avgX * 0.3,
                  avgY: previous.avgY * 0.7 + next.avgY * 0.3,
                }
              : next;
          }
        } else {
          featuresRef.current = null;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    async function setup() {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setIsReady(true);
        loop();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to start eye tracking");
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      setIsReady(false);
    };
  }, [active]);

  return { videoRef, isReady, error, getFeatures: () => featuresRef.current };
}
