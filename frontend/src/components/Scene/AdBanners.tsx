import { useMemo } from "react";
import * as THREE from "three";
import type { AdZonesConfig } from "../../types/store";
import { activeAdVariants, adBannerMeshName } from "../../session/zoneLookup";

interface Props {
  config: AdZonesConfig | null;
  variantId: string | null;
}

function makeCreativeTexture(text: string, color: string): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > canvas.width - 80 && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const lineHeight = 76;
  const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, startY + i * lineHeight));

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** Renders the store's virtual ad banner(s) - NOT part of the source GLB - so
 * A/B ad-placement experiments can be tested against the same base store
 * (per the challenge's bonus ask: "decide where to put ads/banners").
 * Only the variant matching the current session's variant_id is shown.
 */
export function AdBanners({ config, variantId }: Props) {
  const variants = useMemo(() => (config ? activeAdVariants(config, variantId) : []), [config, variantId]);
  const slotSize = config?.ad_slots[0]?.size ?? { width: 6, height: 3 };

  return (
    <>
      {variants.map((variant) => {
        const texture = makeCreativeTexture(variant.creative_text, variant.creative_color);
        return (
          <mesh
            key={variant.variant_id}
            name={adBannerMeshName(variant.variant_id)}
            position={variant.position}
            rotation={[0, (variant.rotation_y_deg * Math.PI) / 180, 0]}
          >
            <planeGeometry args={[slotSize.width, slotSize.height]} />
            <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        );
      })}
    </>
  );
}
