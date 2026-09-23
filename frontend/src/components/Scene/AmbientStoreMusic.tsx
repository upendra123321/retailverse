import { useEffect, useRef } from "react";

export type AmbientPresetTrackId = "off" | "calm" | "retro" | "night";

export type AmbientMusicSelection =
  | { kind: "preset"; id: AmbientPresetTrackId; label: string }
  | { kind: "uploaded"; id: string; label: string; objectUrl: string };

// Ambient beds for the convenience store scene. Files live in
// frontend/src/public/audio and are served from /audio/* (see vite.config.ts).
const PRESET_TRACKS: Record<Exclude<AmbientPresetTrackId, "off">, { src: string; volume: number }> = {
  calm: {
    src: "/audio/abiding-comfort.mp3",
    volume: 0.35,
  },
  retro: {
    src: "/audio/a-cool-day-for-the-barbeque.mp3",
    volume: 0.32,
  },
  night: {
    src: "/audio/a-flower-grows-where-the-battle-was.mp3",
    volume: 0.3,
  },
};

const FADE_OUT_MS = 400;

interface Props {
  selection: AmbientMusicSelection;
  enabled: boolean;
  playing: boolean;
  onPlaybackError?: (message: string) => void;
}

export const AMBIENT_PRESET_OPTIONS: { id: AmbientPresetTrackId; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "calm", label: "Calm Store Ambience" },
  { id: "retro", label: "Retro Convenience Groove" },
  { id: "night", label: "Late-Night Shopping" },
];

export const DEFAULT_AMBIENT_SELECTION: AmbientMusicSelection = {
  kind: "preset",
  id: "calm",
  label: "Calm Store Ambience",
};

export function ambientMusicAnalyticsMeta(selection: AmbientMusicSelection): Record<string, string> {
  return {
    music_id: selection.id,
    music_label: selection.label,
    music_source: selection.kind,
  };
}

// Ease the volume down before pausing so switching tracks mid-walkthrough
// doesn't cut the bed off with an audible click.
function fadeOutAndStop(audio: HTMLAudioElement) {
  const steps = 8;
  const startVolume = audio.volume;
  let step = 0;
  const timer = window.setInterval(() => {
    step += 1;
    audio.volume = Math.max(0, startVolume * (1 - step / steps));
    if (step >= steps) {
      window.clearInterval(timer);
      audio.pause();
      audio.src = "";
    }
  }, FADE_OUT_MS / steps);
}

export function AmbientStoreMusic({ selection, enabled, playing, onPlaybackError }: Props) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!enabled || !playing) return;
    if (selection.kind === "preset" && selection.id === "off") return;

    const track =
      selection.kind === "uploaded"
        ? { src: selection.objectUrl, volume: 0.45 }
        : PRESET_TRACKS[selection.id as Exclude<AmbientPresetTrackId, "off">];

    let cancelled = false;

    const audio = new Audio(track.src);
    audio.loop = true;
    audio.volume = track.volume;
    audio.preload = "auto";

    cleanupRef.current = () => fadeOutAndStop(audio);

    // Browsers block playback until the visitor has interacted with the page;
    // the HUD surfaces the rejection so the demo driver can hit Play Music.
    audio.play().catch((err) => {
      if (!cancelled) onPlaybackError?.(err instanceof Error ? err.message : "Unable to play ambient music");
    });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [enabled, onPlaybackError, playing, selection]);

  return null;
}
