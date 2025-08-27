// lib/active-order.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "ACTIVE_ORDER_V1";

export type ActiveOrder = {
  orderId: number;
  orderCode?: string | null;
  amount?: number | null;
  gateway?: string | null;  // "payos" | ...
  ref?: string | null;      // id phía cổng
  qr?: string | null;
  effectiveAmount?: number | null; // test mode
  expiresAt?: number | null;       // epoch ms
  createdAt: number;               // epoch ms
  snapshot?: any;                  // bill summary để hiển thị nhanh
};

export async function saveActiveOrder(patch: Partial<ActiveOrder> & { orderId: number }) {
  try {
    const cur = await loadActiveOrder();
    const next = { ...(cur || {}), ...patch };
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export async function loadActiveOrder(): Promise<ActiveOrder | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function clearActiveOrder() {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}
