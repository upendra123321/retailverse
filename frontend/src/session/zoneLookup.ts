import type { AdZonesConfig, StoreZone } from "../types/store";

export interface ZoneLookup {
  meshNameToZoneId: Map<string, string>;
  zoneById: Map<string, StoreZone>;
}

/** Maps every raycastable Three.js mesh name back to its analytics zone id. */
export function buildZoneLookup(zones: StoreZone[]): ZoneLookup {
  const meshNameToZoneId = new Map<string, string>();
  const zoneById = new Map<string, StoreZone>();
  for (const zone of zones) {
    zoneById.set(zone.zone_id, zone);
    for (const name of zone.mesh_node_names ?? []) {
      meshNameToZoneId.set(name, zone.zone_id);
    }
  }
  return { meshNameToZoneId, zoneById };
}

/** Ad banners are separate meshes we render ourselves (see AdBanners.tsx),
 * named "ad-banner-<variant_id>" - map that mesh name straight to its zone_id
 * (the variant_id doubles as the zone_id for event logging/analytics).
 */
export function adBannerMeshName(variantId: string): string {
  return `ad-banner-${variantId}`;
}

export function activeAdVariants(config: AdZonesConfig, variantId: string | null) {
  return config.ad_slots
    .map((slot) => slot.variants.find((v) => v.variant_id === variantId) ?? slot.variants[0])
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
}

/** Combines GLB-derived product/shelf zones with the currently-active ad
 * banner(s) into one lookup so gaze raycasting resolves both.
 */
export function buildFullLookup(
  zones: StoreZone[],
  adConfig: AdZonesConfig | null,
  variantId: string | null
): ZoneLookup {
  const lookup = buildZoneLookup(zones);
  if (!adConfig) return lookup;
  for (const variant of activeAdVariants(adConfig, variantId)) {
    lookup.meshNameToZoneId.set(adBannerMeshName(variant.variant_id), variant.variant_id);
    lookup.zoneById.set(variant.variant_id, {
      zone_id: variant.variant_id,
      type: "ad",
      category: "ad",
      display_name: variant.label,
      min: variant.position,
      max: variant.position,
      center: variant.position,
    });
  }
  return lookup;
}
