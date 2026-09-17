import type { CartItem } from "./useShoppingCart";

interface Props {
  hoveredProductLabel: string | null;
  cart: CartItem[];
  total: number;
  onCheckout: () => void;
}

export function ShoppingHud({ hoveredProductLabel, cart, total, onCheckout }: Props) {
  return (
    <>
      <div className="crosshair" />
      {hoveredProductLabel && (
        <div className="interaction-prompt">
          Press <kbd>E</kbd> to add <strong>{hoveredProductLabel}</strong> to cart
        </div>
      )}
      <div className="cart-hud">
        <strong>Cart ({cart.reduce((n, i) => n + i.quantity, 0)})</strong>
        {cart.length > 0 && (
          <>
            <ul>
              {cart.map((item) => (
                <li key={item.zoneId}>
                  {item.quantity}x {item.label} — ${(item.price * item.quantity).toFixed(2)}
                </li>
              ))}
            </ul>
            <p className="cart-total">Total: ${total.toFixed(2)}</p>
            <button onClick={onCheckout}>Checkout (C)</button>
          </>
        )}
      </div>
    </>
  );
}
