import { Suspense, useEffect } from "react";
import type { MutableRefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { StoreModel } from "./StoreModel";
import { FirstPersonControls } from "./FirstPersonControls";
import { AdBanners } from "./AdBanners";
import { ZoneAttentionTracker, type GazeScreenPoint } from "./ZoneAttentionTracker";
import { CrosshairRaycaster } from "./CrosshairRaycaster";
import { NavigationSampler } from "./NavigationSampler";
import { AgentSimulationController } from "../Agent/AgentSimulationController";
import type { ZoneLookup } from "../../session/zoneLookup";
import type { AdZonesConfig, Persona, StoreZone } from "../../types/store";

function CanvasReady({ onReady }: { onReady: (canvas: HTMLCanvasElement) => void }) {
  const { gl } = useThree();
  useEffect(() => {
    onReady(gl.domElement);
  }, [gl, onReady]);
  return null;
}

interface Props {
  controlMode: "manual" | "agent";
  onCanvasReady: (canvas: HTMLCanvasElement) => void;

  zones: StoreZone[];
  zoneLookup: ZoneLookup | null;
  adConfig: AdZonesConfig | null;
  variantId: string | null;

  // Real-shopper (manual) tracking
  realTrackingEnabled: boolean;
  getRealGazePoint: () => GazeScreenPoint | null;
  onHoverProductChange: (zoneId: string | null) => void;

  // Agent tracking
  persona: Persona | null;
  agentGazeRef: MutableRefObject<GazeScreenPoint>;
  onAgentArrive: (zone: StoreZone) => void;

  // Shared
  onZoneDwell: (zoneId: string, sessionMsEntered: number, durationMs: number, source: GazeScreenPoint["source"]) => void;
  onNavigationSample: (sample: { position: [number, number, number]; yaw: number; tsMs: number }) => void;
}

export function Experience({
  controlMode,
  onCanvasReady,
  zones,
  zoneLookup,
  adConfig,
  variantId,
  realTrackingEnabled,
  getRealGazePoint,
  onHoverProductChange,
  persona,
  agentGazeRef,
  onAgentArrive,
  onZoneDwell,
  onNavigationSample,
}: Props) {
  return (
    <Canvas camera={{ fov: 75, near: 0.1, far: 200 }} shadows gl={{ preserveDrawingBuffer: true }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      <Suspense fallback={null}>
        <StoreModel />
        <AdBanners config={adConfig} variantId={variantId} />
      </Suspense>

      {controlMode === "manual" ? (
        <>
          <FirstPersonControls />
          <CrosshairRaycaster lookup={zoneLookup} enabled onHoverChange={onHoverProductChange} />
          <ZoneAttentionTracker
            lookup={zoneLookup}
            enabled={realTrackingEnabled}
            getScreenPoint={getRealGazePoint}
            onDwell={(zoneId, enteredAtMs, durationMs, source) => onZoneDwell(zoneId, enteredAtMs, durationMs, source)}
          />
        </>
      ) : (
        <>
          <AgentSimulationController persona={persona} zones={zones} gazeRef={agentGazeRef} onArrive={onAgentArrive} />
          <ZoneAttentionTracker
            lookup={zoneLookup}
            enabled
            getScreenPoint={() => agentGazeRef.current}
            onDwell={(zoneId, enteredAtMs, durationMs, source) => onZoneDwell(zoneId, enteredAtMs, durationMs, source)}
          />
        </>
      )}

      <NavigationSampler enabled onSample={onNavigationSample} />
      <CanvasReady onReady={onCanvasReady} />
    </Canvas>
  );
}
