import { useEffect, useMemo, useRef, useState } from "react";

/** Top-down floor-plan attention heatmap: plots every product/checkout/ad
 * zone at its real (x, z) world position (from store_layout.json /
 * ad_zones.json) and renders a smooth, classic heat-gradient field (blue =
 * cold/low attention -> red = hot/high attention) instead of a bare bubble
 * chart, so it reads as an actual heatmap at a glance. Three modes answer
 * the challenge's core questions in one view each:
 *   - "Real shoppers"  - where did actual humans look?
 *   - "AI personas"    - where did the simulated shoppers look?
 *   - "Attention gap"  - where do the two diverge most (the strongest,
 *     most inspectable evidence of simulation accuracy/inaccuracy)?
 */
export interface PlottableZone {
  zone_id: string;
  display_name: string;
  type: string;
  center: [number, number, number];
}

export interface PerZoneShare {
  zone_id: string;
  display_name?: string;
  real_share: number;
  agent_share: number;
  abs_diff?: number;
}

interface Props {
  zones: PlottableZone[];
  perZone: PerZoneShare[];
}

type Mode = "real" | "agent" | "diff";

const WIDTH = 640;
const HEIGHT = 380;
const PADDING = 36;
// Low-res grid the heat field is actually computed on, then upscaled with
// canvas image smoothing - the standard heatmap.js-style trick. Computing
// per-pixel at full WIDTH*HEIGHT resolution for every zone would be ~40x
// more work for a result that looks identical once blurred/smoothed.
const GRID_W = 96;
const GRID_H = 58;
// Gaussian falloff radius, in canvas pixels, controlling how "blobby" vs
// "pinpoint" each zone's contribution looks - tuned by eye against this
// store's actual zone density (see convenience_store.glb / store_layout.json).
const SIGMA_PX = 46;

const MODES: { id: Mode; label: string }[] = [
  { id: "real", label: "Real shoppers" },
  { id: "agent", label: "AI personas" },
  { id: "diff", label: "Attention gap" },
];

/** Classic multi-stop heat color scale: deep blue (cold) -> cyan -> green ->
 * yellow -> red (hot). t is clamped to [0, 1]. */
function heatColor(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0.0, [30, 60, 160]],
    [0.25, [40, 170, 200]],
    [0.5, [60, 190, 90]],
    [0.75, [230, 200, 40]],
    [1.0, [220, 40, 40]],
  ];
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (clamped >= t0 && clamped <= t1) {
      const f = t1 === t0 ? 0 : (clamped - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function project(
  x: number,
  z: number,
  bounds: { minX: number; spanX: number; minZ: number; spanZ: number }
): [number, number] {
  const px = PADDING + ((x - bounds.minX) / bounds.spanX) * (WIDTH - 2 * PADDING);
  const py = PADDING + ((z - bounds.minZ) / bounds.spanZ) * (HEIGHT - 2 * PADDING);
  return [px, py];
}

function drawHeatField(
  canvas: HTMLCanvasElement,
  points: { px: number; py: number; value: number }[]
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const maxValue = Math.max(0.0001, ...points.map((p) => p.value));

  // Compute the field on a coarse grid first (cheap), then let the browser
  // do the upscale/blur via drawImage + imageSmoothingEnabled.
  const low = document.createElement("canvas");
  low.width = GRID_W;
  low.height = GRID_H;
  const lowCtx = low.getContext("2d")!;
  const imageData = lowCtx.createImageData(GRID_W, GRID_H);

  // Work entirely in grid-cell units: project each zone's canvas-pixel
  // position down to grid space once, then measure distance in that same
  // space for every grid cell - avoids the classic bug of mixing two
  // different unit systems inside one distance calculation.
  const scaleX = GRID_W / WIDTH;
  const scaleY = GRID_H / HEIGHT;
  const gridPoints = points.map((p) => ({ gx: p.px * scaleX, gy: p.py * scaleY, value: p.value }));
  const sigma2 = 2 * (SIGMA_PX * scaleX) ** 2;

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      let sum = 0;
      for (const p of gridPoints) {
        if (p.value <= 0) continue;
        const dx = p.gx - gx;
        const dy = p.gy - gy;
        const distSq = dx * dx + dy * dy;
        sum += (p.value / maxValue) * Math.exp(-distSq / sigma2);
      }
      const intensity = Math.max(0, Math.min(1, sum));
      const [r, g, b] = heatColor(intensity);
      const alpha = intensity > 0.03 ? Math.round(40 + intensity * 200) : 0;
      const idx = (gy * GRID_W + gx) * 4;
      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = alpha;
    }
  }
  lowCtx.putImageData(imageData, 0, 0);

  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(low, 0, 0, GRID_W, GRID_H, 0, 0, WIDTH, HEIGHT);
}

function Legend({ mode }: { mode: Mode }) {
  const stops = Array.from({ length: 20 }, (_, i) => heatColor(i / 19));
  return (
    <div className="heatmap-legend">
      <div
        className="heatmap-legend-bar"
        style={{
          background: `linear-gradient(to right, ${stops.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`).join(",")})`,
        }}
      />
      <div className="heatmap-legend-labels">
        <span>{mode === "diff" ? "No gap" : "No attention"}</span>
        <span>{mode === "diff" ? "Biggest gap" : "Peak attention"}</span>
      </div>
    </div>
  );
}

export function AttentionHeatmap({ zones, perZone }: Props) {
  const [mode, setMode] = useState<Mode>("real");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const bounds = useMemo(() => {
    if (zones.length === 0) return null;
    const xs = zones.map((z) => z.center[0]);
    const zs = zones.map((z) => z.center[2]);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    return {
      minX,
      minZ,
      spanX: Math.max(1, Math.max(...xs) - minX),
      spanZ: Math.max(1, Math.max(...zs) - minZ),
    };
  }, [zones]);

  const shareByZone = useMemo(() => new Map(perZone.map((p) => [p.zone_id, p])), [perZone]);

  const valueFor = (zoneId: string): number => {
    const share = shareByZone.get(zoneId);
    if (!share) return 0;
    if (mode === "real") return share.real_share;
    if (mode === "agent") return share.agent_share;
    return share.abs_diff ?? Math.abs(share.real_share - share.agent_share);
  };

  const projectedPoints = useMemo(() => {
    if (!bounds) return [];
    return zones.map((z) => {
      const [px, py] = project(z.center[0], z.center[2], bounds);
      return { zone: z, px, py, value: valueFor(z.zone_id) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, bounds, shareByZone, mode]);

  useEffect(() => {
    if (!canvasRef.current || !bounds) return;
    drawHeatField(
      canvasRef.current,
      projectedPoints.map((p) => ({ px: p.px, py: p.py, value: p.value }))
    );
  }, [projectedPoints, bounds]);

  if (!bounds) return null;

  const maxValue = Math.max(0.0001, ...projectedPoints.map((p) => p.value));

  return (
    <div className="heatmap-container">
      <div className="heatmap-mode-toggle">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? "active" : ""} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="heatmap-canvas-wrap">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="heatmap-canvas" />
        <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="heatmap-overlay-svg">
          {projectedPoints.map(({ zone, px, py, value }) => (
            <g key={zone.zone_id}>
              <circle cx={px} cy={py} r={3.5} className={`heatmap-dot-center heatmap-dot-${zone.type}`} />
              {value > 0.001 && (
                <text x={px} y={py - 8} className="heatmap-label" textAnchor="middle">
                  {zone.display_name} ({(100 * (value / maxValue)).toFixed(0)}% of peak)
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <Legend mode={mode} />
      {mode === "diff" && (
        <p className="heatmap-diff-hint">
          Red zones are where real shoppers and AI personas disagreed most about where to look - the strongest,
          most inspectable evidence of where the simulation is (or isn't yet) accurate.
        </p>
      )}
    </div>
  );
}
