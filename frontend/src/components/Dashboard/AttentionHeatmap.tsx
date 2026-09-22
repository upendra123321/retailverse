/** Top-down floor-plan attention heatmap: plots every product/checkout/ad
 * zone at its real (x, z) world position (from store_layout.json / ad_zones.json)
 * as a dot sized/colored by how much of that subject's total attention it
 * captured. Rendering real and AI-persona shoppers side by side on the same
 * physical layout answers the challenge's core question - "which
 * section/aisle did they look at, and where did we not put any ad" - in one
 * glance, instead of a bar chart you have to read line by line.
 */
export interface PlottableZone {
  zone_id: string;
  display_name: string;
  type: string;
  center: [number, number, number];
}

export interface PerZoneShare {
  zone_id: string;
  real_share: number;
  agent_share: number;
}

interface Props {
  zones: PlottableZone[];
  perZone: PerZoneShare[];
}

const WIDTH = 340;
const HEIGHT = 240;
const PADDING = 28;

function project(
  x: number,
  z: number,
  bounds: { minX: number; spanX: number; minZ: number; spanZ: number }
): [number, number] {
  const px = PADDING + ((x - bounds.minX) / bounds.spanX) * (WIDTH - 2 * PADDING);
  const py = PADDING + ((z - bounds.minZ) / bounds.spanZ) * (HEIGHT - 2 * PADDING);
  return [px, py];
}

export function AttentionHeatmap({ zones, perZone }: Props) {
  if (zones.length === 0) return null;

  const xs = zones.map((z) => z.center[0]);
  const zs = zones.map((z) => z.center[2]);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const bounds = {
    minX,
    minZ,
    spanX: Math.max(1, Math.max(...xs) - minX),
    spanZ: Math.max(1, Math.max(...zs) - minZ),
  };
  const shareByZone = new Map(perZone.map((p) => [p.zone_id, p]));

  const renderPanel = (key: "real_share" | "agent_share", label: string) => {
    const maxShare = Math.max(0.0001, ...perZone.map((p) => p[key]));
    return (
      <div className="heatmap-panel">
        <h4>{label}</h4>
        <svg width={WIDTH} height={HEIGHT} className="heatmap-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="heatmap-bg" />
          {zones.map((z) => {
            const share = shareByZone.get(z.zone_id)?.[key] ?? 0;
            const [cx, cy] = project(z.center[0], z.center[2], bounds);
            const intensity = Math.min(1, share / maxShare);
            const radius = 5 + intensity * 20;
            return (
              <g key={z.zone_id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius}
                  className={`heatmap-dot heatmap-dot-${z.type}`}
                  style={{ opacity: 0.2 + intensity * 0.7 }}
                />
                <circle cx={cx} cy={cy} r={2} className="heatmap-dot-center" />
                {share > 0 && (
                  <text x={cx} y={cy - radius - 4} className="heatmap-label" textAnchor="middle">
                    {z.display_name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className="heatmap-container">
      {renderPanel("real_share", "Real shoppers")}
      {renderPanel("agent_share", "AI personas")}
    </div>
  );
}
