// lib/cart.ts — unified cart store (no external deps), supports both old & new call styles

import { useMemo, useSyncExternalStore } from "react";

// -------- Types
export type AddonItem = {
  id: string | number;
  name: string;
  qty_units: number;                 // số "bước"/đơn vị topping
  extra_price_vnd_per_unit: number;  // phụ thu / 1 đơn vị
};

export type CartItem = {
  line_id: string;
  dish_id: number;
  name: string;
  image_path?: string | null;
  base_price_vnd: number;            // giá gốc / 1 suất (chưa tính addon)
  qty: number;
  addons: AddonItem[];

  // snapshot dinh dưỡng / 1 suất (đã + addon) — optional
  kcal?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  serving_size_g?: number | null;

  created_at: number;
};

export type AddCartInput = {
  dish_id: number | string;
  name: string;
  qty?: number;
  base_price_vnd?: number; // mặc định 0 nếu không truyền
  image_path?: string | null;
  addons?: Partial<AddonItem>[]; // có thể bỏ trống => []
  // optional nutrition per serving:
  kcal?: number; protein?: number; fat?: number; carbs?: number; serving_size_g?: number | null;
};

// -------- Internal store (useSyncExternalStore)
type CartState = { items: CartItem[] };
let _state: CartState = { items: [] };
const _subs = new Set<() => void>();
const _emit = () => _subs.forEach((f) => f());
const _set = (updater: (s: CartState) => CartState) => {
  _state = updater(_state);
  _emit();
};
const _subscribe = (cb: () => void) => { _subs.add(cb); return () => _subs.delete(cb); };

// -------- Helpers
const num = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const clamp = (x: number, min = 1, max = 999) => Math.max(min, Math.min(max, x));

const normalizeAddons = (raw?: Partial<AddonItem>[]): AddonItem[] => {
  const arr = (raw ?? []).map((a) => ({
    id: a.id as any,
    name: String(a.name ?? ""),
    qty_units: clamp(num(a.qty_units, 0), 0, 99),
    extra_price_vnd_per_unit: num(a.extra_price_vnd_per_unit, 0),
  }));
  // sort để tạo key ổn định (id asc)
  return arr.sort((x, y) => String(x.id).localeCompare(String(y.id)));
};

const addonsKey = (addons: AddonItem[]) =>
  addons.map((a) => `${a.id}:${a.qty_units}:${a.extra_price_vnd_per_unit}`).join("|");

const findMergeIndex = (items: CartItem[], dish_id: number, base_price_vnd: number, addons: AddonItem[]) => {
  const key = addonsKey(addons);
  return items.findIndex(
    (it) =>
      it.dish_id === dish_id &&
      it.base_price_vnd === base_price_vnd &&
      addonsKey(it.addons) === key
  );
};

const genLineId = (dish_id: number, base_price_vnd: number, addons: AddonItem[]) =>
  `${dish_id}-${base_price_vnd}-${addonsKey(addons)}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;

// -------- Public API

export function lineSubtotalVnd(it: CartItem): number {
  const addonUnit = it.addons.reduce(
    (s, a) => s + a.qty_units * a.extra_price_vnd_per_unit,
    0
  );
  const unit = it.base_price_vnd + addonUnit;
  return unit * it.qty;
}

export function useCart() {
  const snap = useSyncExternalStore(_subscribe, () => _state);
  const { items } = snap;
  const totalQty = useMemo(() => items.reduce((s, it) => s + it.qty, 0), [items]);
  const totalVnd = useMemo(() => items.reduce((s, it) => s + lineSubtotalVnd(it), 0), [items]);
  return { items, totalQty, totalVnd };
}

// HỖ TRỢ HAI KIỂU GỌI:
// 1) addToCart({ dish_id, name, base_price_vnd, qty, addons, ... })
// 2) addToCart(dish_id, name, qty)  // legacy từ menu list
export function addToCart(...args: any[]) {
  let payload: AddCartInput;
  if (typeof args[0] === "object" && args[0] != null) {
    payload = args[0] as AddCartInput;
  } else {
    // legacy: (dish_id, name, qty)
    payload = {
      dish_id: args[0],
      name: args[1],
      qty: args[2] ?? 1,
      base_price_vnd: num(args[3], 0), // nếu không truyền giá -> 0
      addons: [],
    };
  }

  const dish_id = num(payload.dish_id);
  const name = String(payload.name ?? "");
  const qty = clamp(num(payload.qty, 1));
  const base_price_vnd = num(payload.base_price_vnd, 0);
  const addons = normalizeAddons(payload.addons);
  const image_path = payload.image_path ?? null;

  const nutrition = {
    kcal: payload.kcal,
    protein: payload.protein,
    fat: payload.fat,
    carbs: payload.carbs,
    serving_size_g: payload.serving_size_g ?? null,
  };

  _set((s) => {
    const items = [...s.items];
    const idx = findMergeIndex(items, dish_id, base_price_vnd, addons);
    if (idx >= 0) {
      items[idx] = { ...items[idx], qty: clamp(items[idx].qty + qty) };
      return { items };
    }
    const line: CartItem = {
      line_id: genLineId(dish_id, base_price_vnd, addons),
      dish_id,
      name,
      image_path,
      base_price_vnd,
      qty,
      addons,
      ...nutrition,
      created_at: Date.now(),
    };
    items.unshift(line); // thêm lên đầu
    return { items };
  });
}

export function setLineQty(line_id: string, qty: number) {
  _set((s) => {
    const items = s.items.map((it) =>
      it.line_id === line_id ? { ...it, qty: clamp(num(qty, 1)) } : it
    );
    return { items };
  });
}

export function removeLine(line_id: string) {
  _set((s) => ({ items: s.items.filter((it) => it.line_id !== line_id) }));
}

export function clearCart() {
  _set(() => ({ items: [] }));
}
