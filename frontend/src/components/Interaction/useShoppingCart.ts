import { useCallback, useState } from "react";
import { priceFor } from "../../data/productCatalog";

export interface CartItem {
  zoneId: string;
  productKey: string;
  label: string;
  price: number;
  quantity: number;
}

/** Local cart state for the real-shopper "add to cart" / "checkout" flow -
 * checkout emits one 'purchase' behavioral event per line item (see App.tsx).
 */
export function useShoppingCart() {
  const [cart, setCart] = useState<CartItem[]>([]);

  const addToCart = useCallback((zoneId: string, productKey: string) => {
    const { label, price } = priceFor(productKey);
    setCart((prev) => {
      const existing = prev.find((item) => item.zoneId === zoneId);
      if (existing) {
        return prev.map((item) => (item.zoneId === zoneId ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...prev, { zoneId, productKey, label, price, quantity: 1 }];
    });
  }, []);

  const clearCart = useCallback(() => setCart([]), []);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return { cart, addToCart, clearCart, total };
}
