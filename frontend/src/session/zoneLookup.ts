import type { AdSlot, AdZonesConfig, AdZoneVariant, StoreZone } from "../types/store";

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

/** Finds the ab_group ("a"/"b") of whichever slot's variant matches the
 * globally-selected variantId (that selection is sourced from the FIRST ad
 * slot only - see App.tsx). Every other slot then picks its own variant
 * that shares that ab_group, so one control swaps every ad placement
 * (indoor banner + outdoor billboard, etc.) together as one coherent
 * strategy, while each placement keeps a unique zone_id for independent
 * attention tracking.
 */
export function resolveAbGroup(config: AdZonesConfig, variantId: string | null): string | undefined {
  for (const slot of config.ad_slots) {
    const match = slot.variants.find((v) => v.variant_id === variantId);
    if (match) return match.ab_group;
  }
  return undefined;
}

/** Picks the one variant to render/track for a given slot: prefer the
 * shared ab_group match (see resolveAbGroup), then an exact variant_id
 * match (the slot the selector itself came from), then just the first
 * variant as a safe default.
 */
export function pickSlotVariant(
  slot: AdSlot,
  variantId: string | null,
  abGroup?: string
): AdZoneVariant | undefined {
  if (abGroup) {
    const byGroup = slot.variants.find((v) => v.ab_group === abGroup);
    if (byGroup) return byGroup;
  }
  return slot.variants.find((v) => v.variant_id === variantId) ?? slot.variants[0];
}

export function activeAdVariants(config: AdZonesConfig, variantId: string | null) {
  const abGroup = resolveAbGroup(config, variantId);
  return config.ad_slots
    .map((slot) => pickSlotVariant(slot, variantId, abGroup))
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
