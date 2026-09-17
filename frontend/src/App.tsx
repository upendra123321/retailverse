import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Experience } from "./components/Scene/Experience";
import { Hud } from "./components/HUD/Hud";
import { CalibrationOverlay } from "./components/EyeTracking/CalibrationOverlay";
import { GazeCursor } from "./components/EyeTracking/GazeCursor";
import { useFaceLandmarker } from "./components/EyeTracking/useFaceLandmarker";
import { predictGaze, type Coefficients } from "./components/EyeTracking/gazeMapping";
import { loadCalibrationProfile, saveCalibrationProfile, fetchStoreLayout, fetchAdZones } from "./api/client";
import { AgentSetupForm } from "./components/Agent/AgentSetupForm";
import { AgentGazeOverlay } from "./components/Agent/AgentGazeOverlay";
import { useAgentSimulation } from "./components/Agent/useAgentSimulation";
import type { AgentConfig } from "./components/Agent/types";
import type { GazeScreenPoint } from "./components/Scene/ZoneAttentionTracker";
import { buildFullLookup } from "./session/zoneLookup";
import { useBehaviorSession } from "./session/useBehaviorSession";
import { useShoppingCart } from "./components/Interaction/useShoppingCart";
import { ShoppingHud } from "./components/Interaction/ShoppingHud";
import { AnalyticsDashboard } from "./components/Dashboard/AnalyticsDashboard";
import type { AdZonesConfig, StoreZone } from "./types/store";
import "./App.css";

const PROFILE_ID = "default";

type AppMode = "manual" | "agent-setup" | "agent-running";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>("manual");
  const [manualMode, setManualMode] = useState<"navigate" | "calibrate">("navigate");
  const [coefficients, setCoefficients] = useState<Coefficients | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);

  // --- Store metadata (zones + ad variants), loaded once ---------------------
  const [zones, setZones] = useState<StoreZone[]>([]);
  const [adConfig, setAdConfig] = useState<AdZonesConfig | null>(null);
  const [variantId, setVariantId] = useState<string>("");
  const [storeLoadError, setStoreLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchStoreLayout(), fetchAdZones()])
      .then(([layout, ad]) => {
        setZones(layout.zones);
        setAdConfig(ad);
        const firstVariant = ad.ad_slots[0]?.variants[0]?.variant_id;
        if (firstVariant) setVariantId(firstVariant);
      })
      .catch((err) => setStoreLoadError(err instanceof Error ? err.message : "Failed to load store metadata"));
  }, []);

  const activeVariantId = appMode === "agent-running" && agentConfig ? agentConfig.variantId : variantId;
  const zoneLookup = useMemo(() => buildFullLookup(zones, adConfig, activeVariantId || null), [zones, adConfig, activeVariantId]);

  // --- Eye tracking (real shopper) --------------------------------------------
  const eyeTrackingActive = appMode === "manual";
  const { videoRef, isReady, error, getFeatures } = useFaceLandmarker(eyeTrackingActive);

  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasElementRef.current = canvas;
  }, []);
  const getCanvas = useCallback(() => canvasElementRef.current, []);

  useEffect(() => {
    loadCalibrationProfile(PROFILE_ID)
      .then((profile) => {
        if (profile && profile.coefficients.x.length === 3 && profile.coefficients.y.length === 3) {
          setCoefficients(profile.coefficients);
        }
      })
      .catch(() => {
        // No saved profile yet - user can calibrate manually.
      });
  }, []);

  const handleCalibrationComplete = useCallback((coeffs: Coefficients, sampleCount: number) => {
    setCoefficients(coeffs);
    setManualMode("navigate");
    void saveCalibrationProfile({
      profile_id: PROFILE_ID,
      coefficients: coeffs,
      sample_count: sampleCount,
      screen_width: window.innerWidth,
      screen_height: window.innerHeight,
    }).catch(() => {
      // Persisting is best-effort; calibration still works for this session.
    });
  }, []);

  const getRealGazePoint = useCallback((): GazeScreenPoint | null => {
    if (coefficients) {
      const f = getFeatures();
      if (f) {
        const { x, y } = predictGaze(coefficients, f.avgX, f.avgY);
        return { x: clamp01(x), y: clamp01(y), source: "calibrated_gaze" };
      }
    }
    // Uncalibrated fallback: still log navigation/zone data assuming the shopper
    // looks roughly where they're walking, clearly tagged so downstream
    // analytics can discount/exclude it if needed (Responsible AI: no silent
    // false precision).
    return { x: 0.5, y: 0.5, source: "camera_center_fallback" };
  }, [coefficients, getFeatures]);

  // --- Behavioral session tracking (shared real/agent) ------------------------
  const behaviorSession = useBehaviorSession();

  const handleZoneDwell = useCallback(
    (zoneId: string, enteredAtMs: number, durationMs: number, source: GazeScreenPoint["source"]) => {
      if (durationMs < 150) return; // ignore noise-level glances
      behaviorSession.logEvent({
        event_type: "zone_dwell",
        ts_ms: behaviorSession.toSessionMs(enteredAtMs),
        zone_id: zoneId,
        duration_ms: Math.round(durationMs),
        payload: { gaze_source: source },
      });
    },
    [behaviorSession]
  );

  const handleNavigationSample = useCallback(
    (sample: { position: [number, number, number]; yaw: number; tsMs: number }) => {
      behaviorSession.logEvent({
        event_type: "navigation_sample",
        ts_ms: behaviorSession.toSessionMs(sample.tsMs),
        payload: { position: sample.position, yaw: sample.yaw },
      });
    },
    [behaviorSession]
  );

  // Real-shopper session lifecycle: one active session per (manual+navigating, variant).
  useEffect(() => {
    if (appMode !== "manual" || manualMode !== "navigate" || !activeVariantId) return;
    behaviorSession.start({ subject_type: "real", variant_id: activeVariantId, meta: {} }).catch((err) => {
      console.warn("Failed to start real-shopper session:", err);
    });
    return () => {
      void behaviorSession.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, manualMode, activeVariantId]);

  // --- Shopping cart / product interactions (real shopper) --------------------
  const [hoveredProductZoneId, setHoveredProductZoneId] = useState<string | null>(null);
  const { cart, addToCart, clearCart, total } = useShoppingCart();
  const realInteractionEnabled = appMode === "manual" && manualMode === "navigate";

  const performCheckout = useCallback(() => {
    for (const item of cart) {
      behaviorSession.logEvent({
        event_type: "purchase",
        zone_id: item.zoneId,
        product_key: item.productKey,
        payload: { price: item.price, quantity: item.quantity },
      });
    }
    clearCart();
  }, [cart, clearCart, behaviorSession]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!realInteractionEnabled) return;
      if (e.code === "KeyE" && hoveredProductZoneId) {
        const zone = zoneLookup.zoneById.get(hoveredProductZoneId);
        if (!zone?.product_key) return;
        addToCart(hoveredProductZoneId, zone.product_key);
        behaviorSession.logEvent({
          event_type: "product_interaction",
          zone_id: hoveredProductZoneId,
          product_key: zone.product_key,
          payload: { interaction_type: "add_to_cart" },
        });
      } else if (e.code === "KeyC" && cart.length > 0) {
        performCheckout();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [realInteractionEnabled, hoveredProductZoneId, zoneLookup, addToCart, cart, behaviorSession, performCheckout]);

  const hoveredProductLabel = hoveredProductZoneId ? zoneLookup.zoneById.get(hoveredProductZoneId)?.display_name ?? null : null;

  // --- Agent mode --------------------------------------------------------------
  const agentGazeRef = useRef<GazeScreenPoint>({ x: 0.5, y: 0.5, source: "agent_heuristic" });
  const visitedProductZonesRef = useRef<StoreZone[]>([]);

  const {
    focus: agentFocus,
    isThinking: agentIsThinking,
    error: agentError,
  } = useAgentSimulation({
    config: agentConfig,
    running: appMode === "agent-running",
    getCanvas,
    onThought: (reason) =>
      behaviorSession.logEvent({ event_type: "agent_thought", payload: { reason } }),
  });

  const handleAgentArrive = useCallback(
    (zone: StoreZone) => {
      if (zone.type === "product") {
        visitedProductZonesRef.current.push(zone);
        behaviorSession.logEvent({
          event_type: "product_interaction",
          zone_id: zone.zone_id,
          product_key: zone.product_key,
          payload: { interaction_type: "view_detail" },
        });
      } else if (zone.zone_id === "checkout_counter" && agentConfig) {
        for (const visited of visitedProductZonesRef.current) {
          if (!visited.product_key) continue;
          if (Math.random() < agentConfig.persona.purchase_likelihood) {
            const price = 2.99 + (visited.product_key.length % 5); // simple deterministic-ish stand-in price
            behaviorSession.logEvent({
              event_type: "purchase",
              zone_id: visited.zone_id,
              product_key: visited.product_key,
              payload: { price, quantity: 1, decided_by: "persona_purchase_likelihood" },
            });
          }
        }
        visitedProductZonesRef.current = [];
      }
    },
    [behaviorSession, agentConfig]
  );

  // Agent session lifecycle.
  useEffect(() => {
    if (appMode !== "agent-running" || !agentConfig) return;
    visitedProductZonesRef.current = [];
    behaviorSession
      .start({
        subject_type: "agent",
        persona_key: agentConfig.persona.persona_key,
        persona_label: agentConfig.persona.label,
        variant_id: agentConfig.variantId,
        meta: { shopper_name: agentConfig.shopperName, shopper_age: agentConfig.shopperAge },
      })
      .catch((err) => console.warn("Failed to start agent session:", err));
    return () => {
      void behaviorSession.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, agentConfig]);

  const handleStartSimulation = useCallback((config: AgentConfig) => {
    setAgentConfig(config);
    setAppMode("agent-running");
  }, []);

  const handleStopSimulation = useCallback(() => {
    setAppMode("manual");
    setAgentConfig(null);
  }, []);

  const controlMode = useMemo(() => (appMode === "manual" ? "manual" : "agent"), [appMode]);

  return (
    <div className="app-root">
      <Experience
        controlMode={controlMode}
        onCanvasReady={handleCanvasReady}
        zones={zones}
        zoneLookup={zoneLookup}
        adConfig={adConfig}
        variantId={activeVariantId || null}
        realTrackingEnabled={appMode === "manual" && manualMode === "navigate"}
        getRealGazePoint={getRealGazePoint}
        onHoverProductChange={setHoveredProductZoneId}
        persona={agentConfig?.persona ?? null}
        agentGazeRef={agentGazeRef}
        onAgentArrive={handleAgentArrive}
        onZoneDwell={handleZoneDwell}
        onNavigationSample={handleNavigationSample}
      />

      {appMode === "manual" && (
        <Hud
          isTrackingReady={isReady}
          isCalibrated={coefficients !== null}
          trackingError={error}
          onCalibrate={() => setManualMode("calibrate")}
          onAgentMode={() => setAppMode("agent-setup")}
          onShowDashboard={() => setShowDashboard(true)}
          adConfig={adConfig}
          variantId={variantId}
          onVariantChange={setVariantId}
          storeLoadError={storeLoadError}
        />
      )}

      {appMode === "manual" && manualMode === "navigate" && (
        <ShoppingHud hoveredProductLabel={hoveredProductLabel} cart={cart} total={total} onCheckout={performCheckout} />
      )}

      {appMode === "manual" && manualMode === "calibrate" && (
        <CalibrationOverlay
          getFeatures={getFeatures}
          onComplete={handleCalibrationComplete}
          onCancel={() => setManualMode("navigate")}
        />
      )}

      {appMode === "manual" && manualMode === "navigate" && coefficients && (
        <GazeCursor getFeatures={getFeatures} coefficients={coefficients} />
      )}

      {appMode === "agent-setup" && <AgentSetupForm onStart={handleStartSimulation} onCancel={() => setAppMode("manual")} />}

      {appMode === "agent-running" && agentConfig && (
        <AgentGazeOverlay config={agentConfig} focus={agentFocus} isThinking={agentIsThinking} error={agentError} onStop={handleStopSimulation} />
      )}

      {showDashboard && <AnalyticsDashboard onClose={() => setShowDashboard(false)} />}

      <video ref={videoRef} className="webcam-preview" muted playsInline style={{ display: eyeTrackingActive ? "block" : "none" }} />
    </div>
  );
}
