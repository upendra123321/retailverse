import type { Persona, StoreZone } from "../../types/store";

/**
 * Turns a persona's declarative goals (preferred_product_keys /
 * target_categories / navigation_style) into an ordered sequence of physical
 * waypoints in the store - this is what makes the agent's movement
 * goal-directed instead of pure random wander, per persona archetype:
 *   - direct   (Mission Shopper / Brand Loyalist): beeline to preferred
 *               product(s), then checkout.
 *   - compare  (Switcher): bounce between 2+ similar-category products
 *               (visited twice, simulating back-and-forth comparison), then checkout.
 *   - explore  (Browser): wander the full product set in random order, no
 *               fixed checkout goal (may finish without buying).
 */
export function buildTargetQueue(persona: Persona, zones: StoreZone[]): StoreZone[] {
  const productZones = zones.filter((z) => z.type === "product");
  const checkout = zones.find((z) => z.zone_id === "checkout_counter");

  const byPreferredKey = persona.preferred_product_keys
    .map((key) => productZones.find((z) => z.product_key === key))
    .filter((z): z is StoreZone => Boolean(z));
  const byCategory = productZones.filter(
    (z) => persona.target_categories.includes(z.category) && !byPreferredKey.includes(z)
  );

  let queue: StoreZone[];
  switch (persona.navigation_style) {
    case "direct":
      queue = byPreferredKey.length > 0 ? byPreferredKey : byCategory.length > 0 ? byCategory.slice(0, 1) : productZones.slice(0, 1);
      break;
    case "compare": {
      const pool = byCategory.length >= 2 ? byCategory : productZones.slice(0, Math.min(3, productZones.length));
      queue = [...pool, ...pool]; // revisit each once (comparison back-and-forth)
      break;
    }
    case "explore":
    default:
      queue = shuffle(productZones);
      break;
  }

  if (queue.length === 0) queue = productZones.slice(0, 1);
  if (checkout && persona.navigation_style !== "explore") queue = [...queue, checkout];
  return queue;
}

/** For "explore" personas whose queue runs out, generate a fresh shuffled lap. */
export function rebuildQueueForContinuousBrowsing(persona: Persona, zones: StoreZone[]): StoreZone[] {
  return buildTargetQueue(persona, zones);
}

export function dwellDurationMs(persona: Persona, targetCount: number): number {
  const base = (persona.patience_seconds * 1000) / Math.max(1, targetCount);
  const jitter = 0.6 + Math.random() * 0.8; // +/-40% jitter so repeated runs aren't identical
  return Math.min(20000, Math.max(2500, base * jitter));
}

/** Simulated peripheral attention: occasionally glance at an ad banner or an
 * off-target product shelf while the body/camera stays oriented at the
 * primary goal - biased by the persona's ad_attention_bias / browse_probability.
 * Mirrors how a real shopper's eyes dart around without turning their head.
 */
export function maybePickGlanceZone(
  persona: Persona,
  zones: StoreZone[],
  primaryTargetId: string | null
): StoreZone | null {
  const adZones = zones.filter((z) => z.type === "ad");
  if (adZones.length > 0 && Math.random() < persona.ad_attention_bias * 0.35) {
    return adZones[Math.floor(Math.random() * adZones.length)];
  }
  if (Math.random() < persona.browse_probability * 0.3) {
    const candidates = zones.filter((z) => z.type === "product" && z.zone_id !== primaryTargetId);
    if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return null;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
