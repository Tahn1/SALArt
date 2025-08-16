// lib/cart.ts
import { useEffect, useState } from "react";

export type CartItem = { dish_id: number; name: string; qty: number };

let cart: CartItem[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const fn of listeners) fn(); };

export function getCart(): CartItem[] {
  return cart;
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addToCart(dish_id: number, name: string, qty = 1) {
  const i = cart.findIndex((x) => x.dish_id === dish_id);
  if (i === -1) cart.push({ dish_id, name, qty });
  else cart[i].qty += qty;
  emit();
}

export function setQty(dish_id: number, qty: number) {
  const i = cart.findIndex((x) => x.dish_id === dish_id);
  if (i === -1) return;
  if (qty <= 0) cart.splice(i, 1);
  else cart[i].qty = qty;
  emit();
}

export function removeFromCart(dish_id: number) {
  setQty(dish_id, 0);
}

export function clearCart() {
  cart = [];
  emit();
}

export function useCart() {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((v) => v + 1)), []);
  return {
    items: getCart(),
    addToCart,
    setQty,
    removeFromCart,
    clearCart,
  };
}
