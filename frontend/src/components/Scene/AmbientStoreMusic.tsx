import { useEffect, useRef } from "react";

export type AmbientPresetTrackId = "off" | "calm" | "retro" | "night";

export type AmbientMusicSelection =
  | { kind: "preset"; id: AmbientPresetTrackId; label: string }
  | { kind: "uploaded"; id: string; label: string; objectUrl: string };

const PRESET_TRACKS: Record<Exclude<AmbientPresetTrackId, "off">, { volume: number; lfo: number; notes: number[] }> = {
  calm: {
    volume: 0.035,
    lfo: 0.06,
    notes: [261.63, 329.63, 392.0, 523.25],
  },
  retro: {
    volume: 0.03,
    lfo: 0.09,
    notes: [220.0, 277.18, 329.63, 440.0],
  },
  night: {
    volume: 0.028,
    lfo: 0.04,
    notes: [196.0, 246.94, 293.66, 392.0],
  },
};

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

export function AmbientStoreMusic({ selection, enabled, playing, onPlaybackError }: Props) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!enabled || !playing) return;
    if (selection.kind === "preset" && selection.id === "off") return;

    let cancelled = false;

    if (selection.kind === "uploaded") {
      const audio = new Audio(selection.objectUrl);
      audio.loop = true;
      audio.volume = 0.45;
      cleanupRef.current = () => {
        audio.pause();
        audio.src = "";
      };
      audio.play().catch((err) => {
        if (!cancelled) onPlaybackError?.(err instanceof Error ? err.message : "Unable to play uploaded music");
      });
      return () => {
        cancelled = true;
        cleanupRef.current?.();
        cleanupRef.current = null;
      };
    }

    if (selection.id === "off") return;
    const track = PRESET_TRACKS[selection.id];
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();

    const masterGain = audioContext.createGain();
    masterGain.gain.value = track.volume;
    masterGain.connect(audioContext.destination);

    const oscillators = track.notes.map((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = index % 2 === 0 ? "sine" : "triangle";
      oscillator.frequency.value = frequency / 2;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.start();
      return { oscillator, gain };
    });

    const lfo = audioContext.createOscillator();
    const lfoGain = audioContext.createGain();
    lfo.frequency.value = track.lfo;
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain);
    lfoGain.connect(masterGain.gain);
    lfo.start();

    cleanupRef.current = () => {
      oscillators.forEach(({ oscillator, gain }) => {
        gain.gain.setTargetAtTime(0, audioContext.currentTime, 0.4);
        oscillator.stop(audioContext.currentTime + 0.6);
      });
      lfo.stop(audioContext.currentTime + 0.6);
      window.setTimeout(() => void audioContext.close(), 800);
    };

    audioContext.resume().catch((err) => {
      if (!cancelled) onPlaybackError?.(err instanceof Error ? err.message : "Unable to start ambient music");
    });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [enabled, onPlaybackError, playing, selection]);

  return null;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
