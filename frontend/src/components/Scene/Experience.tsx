import { Suspense, useEffect } from "react";
import type { MutableRefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { StoreModel } from "./StoreModel";
import { StoreExterior } from "./StoreExterior";
import { FirstPersonControls } from "./FirstPersonControls";
import { AdBanners } from "./AdBanners";
import { AmbientStoreMusic, type AmbientMusicSelection } from "./AmbientStoreMusic";
import { ZoneAttentionTracker, type GazeScreenPoint } from "./ZoneAttentionTracker";
import { CrosshairRaycaster } from "./CrosshairRaycaster";
import { NavigationSampler } from "./NavigationSampler";
import { AgentSimulationController } from "../Agent/AgentSimulationController";
import type { Phase } from "../Agent/AgentSimulationController";
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
  ambientMusic: AmbientMusicSelection;
  musicPlaying: boolean;
  onMusicPlaybackError: (message: string) => void;

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
  onAgentPhaseChange?: (phase: Phase) => void;

  // Shared
  onZoneDwell: (zoneId: string, sessionMsEntered: number, durationMs: number, source: GazeScreenPoint["source"]) => void;
  onNavigationSample: (sample: { position: [number, number, number]; yaw: number; tsMs: number }) => void;
}

export function Experience({
  controlMode,
  onCanvasReady,
  ambientMusic,
  musicPlaying,
  onMusicPlaybackError,
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
  onAgentPhaseChange,
  onZoneDwell,
  onNavigationSample,
}: Props) {
  return (
    <Canvas camera={{ fov: 75, near: 0.1, far: 300 }} shadows gl={{ preserveDrawingBuffer: true }}>
      {/* Daylight sky + distance fog - the interior GLB has no ceiling/sky of
          its own, and now that shoppers can walk outside (StoreExterior),
          an unbounded black void would look broken beyond the parking lot. */}
      <color attach="background" args={["#8ec7e8"]} />
      <fog attach="fog" args={["#8ec7e8", 40, 160]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      <hemisphereLight args={["#bfe0ff", "#3a3a2a", 0.4]} />
      <AmbientStoreMusic
        selection={ambientMusic}
        enabled={controlMode === "manual"}
        playing={musicPlaying}
        onPlaybackError={onMusicPlaybackError}
      />
      <Suspense fallback={null}>
        <StoreModel />
        <StoreExterior />
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
          <AgentSimulationController
            persona={persona}
            zones={zones}
            gazeRef={agentGazeRef}
            onArrive={onAgentArrive}
            onPhaseChange={onAgentPhaseChange}
          />
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
