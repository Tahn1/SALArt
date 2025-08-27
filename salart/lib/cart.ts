// lib/cart.ts — cart store (stock-aware) + persistence + tools to cancel active order when exiting payment

import { Alert } from "react-native";
import { useMemo, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { loadActiveOrder, clearActiveOrder } from "./active-order";

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
  // dinh dưỡng / 1 suất (optional)
  kcal?: number; protein?: number; fat?: number; carbs?: number; serving_size_g?: number | null;
  created_at: number;
};

export type AddCartInput = {
  dish_id: number | string;
  name: string;
  qty?: number;
  base_price_vnd?: number;
  image_path?: string | null;
  addons?: Partial<AddonItem>[];
  kcal?: number; protein?: number; fat?: number; carbs?: number; serving_size_g?: number | null;
  split_per_unit?: boolean;  // tách dòng nếu qty>1
  no_merge?: boolean;        // luôn tạo dòng mới
};

// -------- Internal store
type CartState = { items: CartItem[] };
let _state: CartState = { items: [] };
const _subs = new Set<() => void>();
const _emit = () => _subs.forEach((f) => f());

// === Persistence
const CART_KEY = "CART_ITEMS_V2";

async function persistCart() {
  try { await AsyncStorage.setItem(CART_KEY, JSON.stringify({ items: _state.items })); } catch {}
}

function _sanitizeItem(raw: any): CartItem | null {
  if (!raw) return null;
  const qty = Math.max(0, Math.min(999, Number(raw.qty ?? 1)));
  const base = Math.round(Number(raw.base_price_vnd ?? 0));
  const dish = Number(raw.dish_id);
  if (!Number.isFinite(base) || !Number.isFinite(dish) || qty <= 0) return null;

  const addons: AddonItem[] = Array.isArray(raw.addons)
    ? raw.addons.map((a: any) => ({
        id: a?.id,
        name: String(a?.name ?? ""),
        qty_units: Math.max(0, Math.min(99, Number(a?.qty_units ?? 0))),
        extra_price_vnd_per_unit: Math.round(Number(a?.extra_price_vnd_per_unit ?? 0)),
      }))
      .filter((a) => a.qty_units > 0)
    : [];

  return {
    line_id: String(raw.line_id ?? `${dish}-${base}-${Date.now()}`),
    dish_id: dish,
    name: String(raw.name ?? ""),
    image_path: raw.image_path ?? null,
    base_price_vnd: base,
    qty,
    addons,
    kcal: raw.kcal, protein: raw.protein, fat: raw.fat, carbs: raw.carbs,
    serving_size_g: raw.serving_size_g ?? null,
    created_at: Number(raw.created_at ?? Date.now()),
  };
}

async function hydrateCartFromStorage() {
  try {
    const raw = await AsyncStorage.getItem(CART_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) {
      const items = parsed.items.map(_sanitizeItem).filter(Boolean) as CartItem[];
      _state = { items };
      _emit();
    }
  } catch {}
}
hydrateCartFromStorage();

const _set = (updater: (s: CartState) => CartState) => {
  _state = updater(_state);
  persistCart(); // fire & forget
  _emit();
};

const _subscribe = (cb: () => void) => { _subs.add(cb); return () => _subs.delete(cb); };
export function getCartSnapshot(){ return _state; }

// -------- Helpers
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (x: number, min = 1, max = 999) => Math.max(min, Math.min(max, x));

const normalizeAddons = (raw?: Partial<AddonItem>[]): AddonItem[] => {
  const arr = (raw ?? [])
    .map((a) => ({
      id: a.id as any,
      name: String(a.name ?? ""),
      qty_units: Math.max(0, Math.min(99, num(a.qty_units, 0))),
      extra_price_vnd_per_unit: Math.round(num(a.extra_price_vnd_per_unit, 0)),
    }))
    .filter((a) => a.qty_units > 0);
  return arr.sort((x, y) => String(x.id).localeCompare(String(y.id)));
};

const addonsKey = (addons: AddonItem[]) =>
  addons.map((a) => `${a.id}:${a.qty_units}:${a.extra_price_vnd_per_unit}`).join("|");

const findMergeIndex = (items: CartItem[], dish_id: number, base_price_vnd: number, addons: AddonItem[]) => {
  const key = addonsKey(addons);
  return items.findIndex(
    (it) => it.dish_id === dish_id && it.base_price_vnd === base_price_vnd && addonsKey(it.addons) === key
  );
};

const genLineId = (dish_id: number, base_price_vnd: number, addons: AddonItem[]) =>
  `${dish_id}-${base_price_vnd}-${addonsKey(addons)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;

type NormalizedAdd = {
  dish_id:number; name:string; qty:number; base_price_vnd:number;
  addons:AddonItem[]; image_path:string|null; split:boolean; noMerge:boolean;
  nutrition:{ kcal?:number; protein?:number; fat?:number; carbs?:number; serving_size_g?:number|null };
};
function _normalizeAddArgs(args:any[]): NormalizedAdd {
  let payload: AddCartInput;
  if (typeof args[0] === "object" && args[0] != null) payload = args[0] as AddCartInput;
  else payload = { dish_id: args[0], name: args[1], qty: args[2] ?? 1, base_price_vnd: num(args[3], 0), addons: [] };

  const dish_id = num(payload.dish_id);
  const name = String(payload.name ?? "");
  const qty = clamp(num(payload.qty, 1), 1);
  const base_price_vnd = Math.round(num(payload.base_price_vnd, 0));
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

// -------- Public API (NO-LOCK)
export function lineSubtotalVnd(it: CartItem): number {
  const addonUnit = (it.addons ?? []).reduce(
    (s, a) => s + (Number(a.qty_units) || 0) * (Number(a.extra_price_vnd_per_unit) || 0),
    0
  );
  const unit = Math.round(Number(it.base_price_vnd) + addonUnit);
  return unit * Math.max(1, Number(it.qty || 1));
}

export function useCart() {
  const getSnap = () => _state;
  const getServerSnap = () => _state;
  const snap = useSyncExternalStore(_subscribe, getSnap, getServerSnap);
  const { items } = snap;
  const totalQty = useMemo(() => items.reduce((s, it) => s + it.qty, 0), [items]);
  const totalVnd = useMemo(() => items.reduce((s, it) => s + lineSubtotalVnd(it), 0), [items]);
  return { items, totalQty, totalVnd };
}

// ====== STOCK HELPERS ======
async function _getAvailableServings(dish_id:number): Promise<number|null> {
  const { data, error } = await supabase
    .from("v_dish_available")
    .select("available_servings")
    .eq("dish_id", dish_id)
    .maybeSingle();
  if (error) throw error;
  return (data?.available_servings ?? null) as number | null; // null = không giới hạn cứng
}
function _qtyInCart(dish_id:number){
  return _state.items.filter(i => Number(i.dish_id) === Number(dish_id)).reduce((s, i) => s + (i.qty || 0), 0);
}

// ================== ADD TO CART ==================
export function addToCart(...args: any[]) {
  const { dish_id, name, qty, base_price_vnd, addons, image_path, split, noMerge, nutrition } = _normalizeAddArgs(args);

  _set((s) => {
    const items = [...s.items];

    if (split && qty > 1) {
      for (let i = 0; i < qty; i++) {
        items.unshift({
          line_id: genLineId(dish_id, base_price_vnd, addons),
          dish_id, name, image_path, base_price_vnd, qty: 1, addons, ...nutrition, created_at: Date.now(),
        });
      }
      return { items };
    }

    if (noMerge) {
      items.unshift({
        line_id: genLineId(dish_id, base_price_vnd, addons),
        dish_id, name, image_path, base_price_vnd, qty, addons, ...nutrition, created_at: Date.now(),
      });
      return { items };
    }

    const idx = findMergeIndex(items, dish_id, base_price_vnd, addons);
    if (idx >= 0) {
      items[idx] = { ...items[idx], qty: clamp(items[idx].qty + qty) };
      return { items };
    }
    items.unshift({
      line_id: genLineId(dish_id, base_price_vnd, addons),
      dish_id, name, image_path, base_price_vnd, qty, addons, ...nutrition, created_at: Date.now(),
    });
    return { items };
  });
}

/** Thêm món có kiểm tồn suất. Trả: "added" | "clamped" | "blocked" */
export async function addToCartChecked(...args:any[]): Promise<"added"|"clamped"|"blocked"> {
  const p = _normalizeAddArgs(args);

  let limit: number | null = null;
  try { limit = await _getAvailableServings(p.dish_id); }
  catch { Alert.alert("Lỗi tồn kho", "Không kiểm tra được số suất còn lại. Vui lòng thử lại."); return "blocked"; }

  if (limit == null) { addToCart(p); return "added"; }

  const current = _qtyInCart(p.dish_id);
  const allow = Math.max(0, limit - current);

  if (allow <= 0) { Alert.alert("Hết suất", `Món này chỉ còn ${limit} suất và bạn đã đạt tối đa trong giỏ.`); return "blocked"; }

  const addQty = Math.min(p.qty, allow);
  addToCart({ ...p, qty: addQty });

  if (addQty < p.qty) { Alert.alert("Giới hạn suất", `Chỉ có thể thêm ${addQty}/${p.qty} (còn ${limit} suất).`); return "clamped"; }
  return "added";
}

// ================== UPDATE / REMOVE ==================
export function setLineQty(line_id: string, qty: number) {
  const q = Math.round(num(qty, 1));
  if (q <= 0) { _set((s) => ({ items: s.items.filter((it) => it.line_id !== line_id) })); return; }
  _set((s) => ({ items: s.items.map((it) => it.line_id === line_id ? { ...it, qty: clamp(q) } : it) }));
}

export async function setLineQtyChecked(line_id:string, qty:number): Promise<"ok"|"clamped"|"removed"|"blocked"> {
  const line = _state.items.find(it => it.line_id === line_id);
  if (!line) return "blocked";

  let limit: number | null = null;
  try { limit = await _getAvailableServings(line.dish_id); }
  catch { Alert.alert("Lỗi tồn kho", "Không kiểm tra được số suất còn lại."); return "blocked"; }

  if (limit == null) { setLineQty(line_id, qty); return "ok"; }

  const others = _state.items.filter(it => it.dish_id === line.dish_id && it.line_id !== line_id).reduce((s, it) => s + (it.qty || 0), 0);
  const allowForLine = Math.max(0, limit - others);
  const want = Math.max(0, Math.min(999, Math.round(num(qty, 1))));
  const finalQty = Math.min(want, allowForLine);

  if (finalQty <= 0) {
    _set(s => ({ items: s.items.filter(it => it.line_id !== line_id) }));
    Alert.alert("Hết suất", "Không thể giữ thêm suất cho món này, dòng đã được xoá khỏi giỏ.");
    return "removed";
  }
  if (finalQty < want) { setLineQty(line_id, finalQty); Alert.alert("Giới hạn suất", `Tối đa ${finalQty} suất cho món này.`); return "clamped"; }
  setLineQty(line_id, want); return "ok";
}

export function removeLine(line_id: string) { _set((s) => ({ items: s.items.filter((it) => it.line_id !== line_id) })); }

export function removeAddon(line_id: string, addon_id: string | number) {
  _set((s) => {
    const items = s.items.map((it) => {
      if (it.line_id !== line_id) return it;
      const nextAddons = (it.addons ?? []).filter((a) => String(a.id) !== String(addon_id));
      return { ...it, addons: nextAddons };
    });
    return { items };
  });
}

export function setAddonQty(line_id: string, addon_id: string | number, qty_units: number) {
  const q = Math.max(0, Math.min(99, Math.round(num(qty_units, 0))));
  _set((s) => {
    const items = s.items.map((it) => {
      if (it.line_id !== line_id) return it;
      const exists = (it.addons ?? []).some((a) => String(a.id) === String(addon_id));
      if (!exists) return it; // không tự thêm mới
      const next = (it.addons ?? [])
        .map((a) => String(a.id) === String(addon_id) ? { ...a, qty_units: q } : a)
        .filter((a) => a.qty_units > 0);
      return { ...it, addons: next };
    });
    return { items };
  });
}

export function changeAddonQty(line_id: string, addon_id: string | number, delta: number) {
  _set((s) => {
    const items = s.items.map((it) => {
      if (it.line_id !== line_id) return it;
      const found = (it.addons ?? []).find((a) => String(a.id) === String(addon_id));
      if (!found) return it;
      const q = Math.max(0, Math.min(99, Math.round(found.qty_units + num(delta, 0))));
      const next = (it.addons ?? [])
        .map((a) => String(a.id) === String(addon_id) ? { ...a, qty_units: q } : a)
        .filter((a) => a.qty_units > 0);
      return { ...it, addons: next };
    });
    return { items };
  });
}

export function clearCart() {
  _set(() => ({ items: [] }));
  (async () => { try { await AsyncStorage.setItem(CART_KEY, JSON.stringify({ items: [] })); } catch {} })();
}

// ====== EXTRA: tiện ích hủy đơn đang chờ (gọi khi thoát màn Thanh toán) ======
export async function cancelActiveOrderIfAny(): Promise<boolean> {
  try {
    const ao = await loadActiveOrder();
    if (!ao?.orderId) return false;

    // đánh dấu canceled nếu còn ở trạng thái đang chờ/đang xử lý
  await supabase.from("orders")
  .update({ payment_status: "canceled", note: "user_exit_payment" })
  .eq("id", ao.orderId)
 .in("payment_status", ["pending", "pending_confirm", "processing", "awaiting_payment"]);



    await clearActiveOrder();
    return true;
  } catch {
    // vẫn cho tiếp tục sửa giỏ kể cả update fail
    try { await clearActiveOrder(); } catch {}
    return false;
  }
}
