import { useMemo } from "react";
import * as THREE from "three";
import type { AdZonesConfig } from "../../types/store";
import { adBannerMeshName, pickSlotVariant, resolveAbGroup } from "../../session/zoneLookup";
import { FLOOR_Y } from "./storeBounds";

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

/** Renders the store's virtual ad banners/billboards - NOT part of the
 * source GLB - so A/B ad-placement experiments can be tested against the
 * same base store (per the challenge's bonus ask: "decide where to put
 * ads/banners", including *outdoor, open-space* placements).
 *
 * One variant per slot is shown, resolved via a shared ab_group so a single
 * A/B selection swaps every placement (indoor + outdoor) together - see
 * resolveAbGroup()/pickSlotVariant() in session/zoneLookup.ts. Each slot
 * renders at its OWN size (a pre-existing bug used slot 0's size for every
 * slot; fixed here now that there's more than one slot).
 */
export function AdBanners({ config, variantId }: Props) {
  const abGroup = useMemo(() => (config ? resolveAbGroup(config, variantId) : undefined), [config, variantId]);

  return (
    <>
      {(config?.ad_slots ?? []).map((slot) => {
        const variant = pickSlotVariant(slot, variantId, abGroup);
        if (!variant) return null;

        const texture = makeCreativeTexture(variant.creative_text, variant.creative_color);
        const rotationY = (variant.rotation_y_deg * Math.PI) / 180;
        const isBillboard = slot.mount === "billboard";
        const [, panelY] = variant.position;
        const poleHeight = Math.max(0.1, panelY - slot.size.height / 2 - FLOOR_Y);
        const localPoleY = FLOOR_Y + poleHeight / 2 - panelY;

        return (
          <group key={variant.variant_id} position={variant.position} rotation={[0, rotationY, 0]}>
            {isBillboard && (
              // raycast disabled - see StoreExterior.tsx's NO_RAYCAST comment;
              // a tall pole must never answer FirstPersonControls' floor probe.
              <mesh position={[0, localPoleY, 0]} castShadow raycast={() => null}>
                <cylinderGeometry args={[0.25, 0.32, poleHeight, 12]} />
                <meshStandardMaterial color="#3a3a3a" metalness={0.6} roughness={0.4} />
              </mesh>
            )}
            {isBillboard && (
              // Solid dark backing behind the panel so the sign reads as a
              // real structure (with visible edges/back) from any angle,
              // instead of a paper-thin decal.
              <mesh position={[0, 0, -0.08]} raycast={() => null}>
                <planeGeometry args={[slot.size.width + 0.5, slot.size.height + 0.5]} />
                <meshStandardMaterial color="#1a1a1a" side={THREE.DoubleSide} roughness={0.8} />
              </mesh>
            )}
            <mesh name={adBannerMeshName(variant.variant_id)} castShadow={isBillboard}>
              <planeGeometry args={[slot.size.width, slot.size.height]} />
              <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}
