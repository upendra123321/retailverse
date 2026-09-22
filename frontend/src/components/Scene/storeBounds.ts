/** Hand-measured world-space bounds of convenience_store.glb's actual
 * geometry (mirrors backend/data/store_layout.json's `store_bounds` - kept
 * in sync by convention, not derived at runtime, since the frontend has no
 * reason to fetch+parse the GLB just for six numbers).
 *
 * The GLB itself contains ONLY interior shelving/products/checkout - no
 * exterior walls, roof, or ground plane at all. These bounds are what
 * StoreExterior.tsx wraps a procedural building shell + parking lot around,
 * and what grounds outdoor billboard poles (AdBanners.tsx) at the same
 * floor height as the interior, so there's no visible seam/step when a
 * shopper walks from inside the store out through the front door.
 */
export const STORE_BOUNDS = {
  min: [-26.32, -0.39, -12.72] as [number, number, number],
  max: [29.03, 8.0, 20.27] as [number, number, number],
};

export const FLOOR_Y = STORE_BOUNDS.min[1];
