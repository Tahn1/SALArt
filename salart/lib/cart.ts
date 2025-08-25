// lib/cart.ts — unified cart store (stock-aware add + qty)

import { Alert } from "react-native";
import { useMemo, useSyncExternalStore } from "react";
import { supabase } from "./supabase";

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
  base_price_vnd: number;
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
  addons?: Partial<AddonItem>[];
  // optional nutrition per serving:
  kcal?: number; protein?: number; fat?: number; carbs?: number; serving_size_g?: number | null;

  // --- NEW flags ---
  /** Nếu true và qty > 1, tách thành nhiều dòng, mỗi dòng qty=1 (để chỉnh add-on riêng). */
  split_per_unit?: boolean;
  /** Nếu true, luôn tạo dòng mới, không gộp với dòng giống (dù qty=1). */
  no_merge?: boolean;
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

// ---- expose snapshot (nếu cần dùng ngoài)
export function getCartSnapshot(){ return _state; }

// -------- Helpers
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (x: number, min = 1, max = 999) => Math.max(min, Math.min(max, x));

const normalizeAddons = (raw?: Partial<AddonItem>[]): AddonItem[] => {
  const arr = (raw ?? []).map((a) => ({
    id: a.id as any,
    name: String(a.name ?? ""),
    qty_units: Math.max(0, Math.min(99, num(a.qty_units, 0))), // 0..99
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
  `${dish_id}-${base_price_vnd}-${addonsKey(addons)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;

// Chuẩn hoá input cho addToCart / addToCartChecked
type NormalizedAdd = {
  dish_id:number; name:string; qty:number; base_price_vnd:number;
  addons:AddonItem[]; image_path:string|null; split:boolean; noMerge:boolean;
  nutrition:{ kcal?:number; protein?:number; fat?:number; carbs?:number; serving_size_g?:number|null };
};
function _normalizeAddArgs(args:any[]): NormalizedAdd {
  let payload: AddCartInput;
  if (typeof args[0] === "object" && args[0] != null) {
    payload = args[0] as AddCartInput;
  } else {
    payload = { dish_id: args[0], name: args[1], qty: args[2] ?? 1, base_price_vnd: num(args[3], 0), addons: [] };
  }
  const dish_id = num(payload.dish_id);
  const name = String(payload.name ?? "");
  const qtyRaw = num(payload.qty, 1);
  const qty = clamp(qtyRaw, 1);
  const base_price_vnd = num(payload.base_price_vnd, 0);
  const addons = normalizeAddons(payload.addons);
  const image_path = payload.image_path ?? null;
  const split = !!payload.split_per_unit;
  const noMerge = !!payload.no_merge;
  const nutrition = {
    kcal: payload.kcal, protein: payload.protein, fat: payload.fat,
    carbs: payload.carbs, serving_size_g: payload.serving_size_g ?? null,
  };
  return { dish_id, name, qty, base_price_vnd, addons, image_path, split, noMerge, nutrition };
}

// -------- Public API

export function lineSubtotalVnd(it: CartItem): number {
  const addonUnit = it.addons.reduce((s, a) => s + a.qty_units * a.extra_price_vnd_per_unit, 0);
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

// ====== STOCK-AWARE helper ======
async function _getAvailableServings(dish_id:number): Promise<number|null> {
  const { data, error } = await supabase
    .from("v_dish_available")
    .select("available_servings")
    .eq("dish_id", dish_id)
    .maybeSingle();
  if (error) throw error;
  // null = món tính theo nguyên liệu/không giới hạn cứng
  return (data?.available_servings ?? null) as number | null;
}
function _qtyInCart(dish_id:number){
  return _state.items
    .filter(i => Number(i.dish_id) === Number(dish_id))
    .reduce((s, i) => s + (i.qty || 0), 0);
}

// ================== ADD TO CART (giữ nguyên hành vi cũ) ==================
export function addToCart(...args: any[]) {
  const { dish_id, name, qty, base_price_vnd, addons, image_path, split, noMerge, nutrition } = _normalizeAddArgs(args);

  _set((s) => {
    const items = [...s.items];

    // tách dòng nếu split_per_unit và qty > 1
    if (split && qty > 1) {
      for (let i = 0; i < qty; i++) {
        const line: CartItem = {
          line_id: genLineId(dish_id, base_price_vnd, addons),
          dish_id,
          name,
          image_path,
          base_price_vnd,
          qty: 1,
          addons,
          ...nutrition,
          created_at: Date.now(),
        };
        items.unshift(line);
      }
      return { items };
    }

    if (noMerge) {
      const line: CartItem = {
        line_id: genLineId(dish_id, base_price_vnd, addons),
        dish_id, name, image_path, base_price_vnd,
        qty, addons, ...nutrition, created_at: Date.now(),
      };
      items.unshift(line);
      return { items };
    }

    // gộp nếu trùng dish + base_price + addons
    const idx = findMergeIndex(items, dish_id, base_price_vnd, addons);
    if (idx >= 0) {
      items[idx] = { ...items[idx], qty: clamp(items[idx].qty + qty) };
      return { items };
    }
    const line: CartItem = {
      line_id: genLineId(dish_id, base_price_vnd, addons),
      dish_id, name, image_path, base_price_vnd,
      qty, addons, ...nutrition, created_at: Date.now(),
    };
    items.unshift(line);
    return { items };
  });
}

// ================== ADD TO CART (CÓ KIỂM TỒN SUẤT) ==================
/**
 * Thêm món vào giỏ nhưng KHÔNG vượt số suất còn lại (v_dish_available).
 * Trả về: "added" | "clamped" | "blocked"
 */
export async function addToCartChecked(...args:any[]): Promise<"added"|"clamped"|"blocked"> {
  const p = _normalizeAddArgs(args);

  let limit: number | null = null;
  try {
    limit = await _getAvailableServings(p.dish_id);
  } catch {
    Alert.alert("Lỗi tồn kho", "Không kiểm tra được số suất còn lại. Vui lòng thử lại.");
    return "blocked";
  }

  // null => không giới hạn cứng → thêm bình thường
  if (limit == null) {
    addToCart(p);
    return "added";
  }

  const current = _qtyInCart(p.dish_id);
  const allow = Math.max(0, limit - current);

  if (allow <= 0) {
    Alert.alert("Hết suất", `Món này chỉ còn ${limit} suất và bạn đã đạt tối đa trong giỏ.`);
    return "blocked";
  }

  const addQty = Math.min(p.qty, allow);
  addToCart({ ...p, qty: addQty });

  if (addQty < p.qty) {
    Alert.alert("Giới hạn suất", `Chỉ có thể thêm ${addQty}/${p.qty} (còn ${limit} suất).`);
    return "clamped";
  }
  return "added";
}

// ================== SET QTY ==================
export function setLineQty(line_id: string, qty: number) {
  _set((s) => {
    const items = s.items.map((it) =>
      it.line_id === line_id ? { ...it, qty: clamp(num(qty, 1)) } : it
    );
    return { items };
  });
}

/**
 * Đặt lại số lượng cho 1 dòng nhưng KHÔNG vượt số suất còn lại.
 * Nếu allowed = 0 sẽ tự xoá dòng.
 */
export async function setLineQtyChecked(line_id:string, qty:number): Promise<"ok"|"clamped"|"removed"|"blocked"> {
  const line = _state.items.find(it => it.line_id === line_id);
  if (!line) return "blocked";

  let limit: number | null = null;
  try {
    limit = await _getAvailableServings(line.dish_id);
  } catch {
    Alert.alert("Lỗi tồn kho", "Không kiểm tra được số suất còn lại.");
    return "blocked";
  }
  if (limit == null) { setLineQty(line_id, qty); return "ok"; }

  const others = _state.items
    .filter(it => it.dish_id === line.dish_id && it.line_id !== line_id)
    .reduce((s, it) => s + (it.qty || 0), 0);

  const allowForLine = Math.max(0, limit - others);
  const want = clamp(num(qty, 1));
  const finalQty = Math.min(want, allowForLine);

  if (finalQty <= 0) {
    // hết sạch suất cho dòng này → xoá
    _set(s => ({ items: s.items.filter(it => it.line_id !== line_id) }));
    Alert.alert("Hết suất", "Không thể giữ thêm suất cho món này, dòng đã được xoá khỏi giỏ.");
    return "removed";
  }

  if (finalQty < want) {
    setLineQty(line_id, finalQty);
    Alert.alert("Giới hạn suất", `Chỉ có thể đặt tối đa ${finalQty} suất cho món này.`);
    return "clamped";
  }

  setLineQty(line_id, want);
  return "ok";
}

export function removeLine(line_id: string) {
  _set((s) => ({ items: s.items.filter((it) => it.line_id !== line_id) }));
}

// Xoá 1 add-on khỏi 1 dòng
export function removeAddon(line_id: string, addon_id: string | number) {
  _set((s) => {
    const items = s.items.map((it) => {
      if (it.line_id !== line_id) return it;
      const nextAddons = (it.addons ?? []).filter(
        (a) => String(a.id) !== String(addon_id)
      );
      return { ...it, addons: nextAddons };
    });
    return { items };
  });
}

// Đặt số lượng add-on (0..99). Nếu 0 → xoá add-on.
export function setAddonQty(line_id: string, addon_id: string | number, qty_units: number) {
  const q = Math.max(0, Math.min(99, num(qty_units, 0)));
  _set((s) => {
    const items = s.items.map((it) => {
      if (it.line_id !== line_id) return it;
      const exists = (it.addons ?? []).some((a) => String(a.id) === String(addon_id));
      if (!exists) return it; // không tự thêm mới
      const next = (it.addons ?? []).map((a) =>
        String(a.id) === String(addon_id) ? { ...a, qty_units: q } : a
      ).filter((a) => a.qty_units > 0);
      return { ...it, addons: next };
    });
    return { items };
  });
}

// Cộng/trừ số lượng add-on (delta có thể âm/dương)
export function changeAddonQty(line_id: string, addon_id: string | number, delta: number) {
  _set((s) => {
    const items = s.items.map((it) => {
      if (it.line_id !== line_id) return it;
      const found = (it.addons ?? []).find((a) => String(a.id) === String(addon_id));
      if (!found) return it;
      const q = Math.max(0, Math.min(99, found.qty_units + num(delta, 0)));
      const next = (it.addons ?? []).map((a) =>
        String(a.id) === String(addon_id) ? { ...a, qty_units: q } : a
      ).filter((a) => a.qty_units > 0);
      return { ...it, addons: next };
    });
    return { items };
  });
}

export function clearCart() { _set(() => ({ items: [] })); }
