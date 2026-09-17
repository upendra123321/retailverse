import type { AdZonesConfig } from "../../types/store";

interface Props {
  isTrackingReady: boolean;
  isCalibrated: boolean;
  trackingError: string | null;
  onCalibrate: () => void;
  onAgentMode: () => void;
  onShowDashboard: () => void;
  adConfig: AdZonesConfig | null;
  variantId: string;
  onVariantChange: (variantId: string) => void;
  storeLoadError: string | null;
}

export function Hud({
  isTrackingReady,
  isCalibrated,
  trackingError,
  onCalibrate,
  onAgentMode,
  onShowDashboard,
  adConfig,
  variantId,
  onVariantChange,
  storeLoadError,
}: Props) {
  return (
    <div className="hud">
      <div className="hud-panel">
        <strong>Convenience Store Walkthrough</strong>
        <p>Click the 3D view, then use W A S D (or arrow keys) to move and the mouse to look around.</p>
        <p>
          Press <kbd>E</kbd> to add the shelf you're looking at to your cart, <kbd>C</kbd> to checkout. Press{" "}
          <kbd>Esc</kbd> to release the mouse.
        </p>
        <p>For calibration, sit centered about 50–70 cm from the camera and keep your head still.</p>
        <p>
          Eye tracking:{" "}
          {trackingError ? `error – ${trackingError}` : isTrackingReady ? "camera active" : "starting…"}
        </p>
        {storeLoadError && <p className="hud-error">Store data: {storeLoadError}</p>}

        {adConfig && adConfig.ad_slots.length > 0 && (
          <label className="hud-variant-picker">
            Ad placement variant (A/B):
            <select value={variantId} onChange={(e) => onVariantChange(e.target.value)}>
              {adConfig.ad_slots.flatMap((slot) =>
                slot.variants.map((v) => (
                  <option key={v.variant_id} value={v.variant_id}>
                    {v.label}
                  </option>
                ))
              )}
            </select>
          </label>
        )}

        <button onClick={onCalibrate}>{isCalibrated ? "Recalibrate Eyes" : "Calibrate Eyes"}</button>
        <button onClick={onAgentMode}>Agent Mode</button>
        <button onClick={onShowDashboard}>View Insights Report</button>
      </div>
    </div>
  );
}
