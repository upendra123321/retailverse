import type { AdZonesConfig } from "../../types/store";
import { AMBIENT_PRESET_OPTIONS, type AmbientMusicSelection, type AmbientPresetTrackId } from "../Scene/AmbientStoreMusic";

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
  ambientMusic: AmbientMusicSelection;
  musicPlaying: boolean;
  musicError: string | null;
  onAmbientPresetChange: (trackId: AmbientPresetTrackId) => void;
  onAmbientFileChange: (file: File) => void;
  onMusicPlayingChange: (playing: boolean) => void;
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
  ambientMusic,
  musicPlaying,
  musicError,
  onAmbientPresetChange,
  onAmbientFileChange,
  onMusicPlayingChange,
  storeLoadError,
}: Props) {
  const musicDisabled = ambientMusic.kind === "preset" && ambientMusic.id === "off";

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

        <div className="hud-music-control">
          <label className="hud-variant-picker">
            Background music:
            <select
              value={ambientMusic.kind === "preset" ? ambientMusic.id : ambientMusic.id}
              onChange={(e) => onAmbientPresetChange(e.target.value as AmbientPresetTrackId)}
            >
              {AMBIENT_PRESET_OPTIONS.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.label}
                </option>
              ))}
              {ambientMusic.kind === "uploaded" && <option value={ambientMusic.id}>{ambientMusic.label}</option>}
            </select>
          </label>
          <label className="hud-file-picker">
            Add music file:
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onAmbientFileChange(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <button type="button" onClick={() => onMusicPlayingChange(!musicPlaying)} disabled={musicDisabled}>
            {musicPlaying ? "Pause Music" : "Play Music"}
          </button>
          <p className="hud-music-insight">
            Music is tagged with each shopper session so the report can compare mood, search intent, and purchases by track.
          </p>
          {musicError && <p className="hud-error">Music: {musicError}</p>}
        </div>

        <button onClick={onCalibrate}>{isCalibrated ? "Recalibrate Eyes" : "Calibrate Eyes"}</button>
        <button onClick={onAgentMode}>Agent Mode</button>
        <button onClick={onShowDashboard}>View Insights Report</button>
      </div>
    </div>
  );
}
