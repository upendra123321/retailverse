/** Synthetic retail prices for the products the GLB actually contains
 * (backend/data/store_layout.json product_key values). Not derived from any
 * real pricing data source - purely so "purchase" events have a plausible
 * $ amount for the demo/report. Edit freely.
 */
export const PRODUCT_PRICES: Record<string, { label: string; price: number }> = {
  trix: { label: "Trix Cereal", price: 4.49 },
  luckycharm: { label: "Lucky Charms Cereal", price: 4.79 },
  luckycharm_1: { label: "Lucky Charms Cereal (Family Size)", price: 5.49 },
  "rice crisps": { label: "Rice Crispies Cereal", price: 4.29 },
  crispix: { label: "Crispix Cereal", price: 4.99 },
  "cerial meal": { label: "Cereal Meal", price: 3.99 },
  Oatmeal: { label: "Oatmeal (Value Pack)", price: 3.49 },
  "Oatmeal_#1": { label: "Oatmeal (Family Pack)", price: 5.99 },
  "Tuna can": { label: "Tuna Can (Small)", price: 1.29 },
  "tuna can large": { label: "Tuna Can (Large)", price: 2.49 },
};

export function priceFor(productKey: string | undefined): { label: string; price: number } {
  if (productKey && PRODUCT_PRICES[productKey]) return PRODUCT_PRICES[productKey];
  return { label: productKey ?? "Item", price: 2.99 };
}
