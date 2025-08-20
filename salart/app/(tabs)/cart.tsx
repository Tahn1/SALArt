// app/(tabs)/cart.tsx — CartScreen (RPC create_order + v_dish_available)

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import {
  useCart,
  setLineQty,
  removeLine,
  clearCart,
  CartItem,
  lineSubtotalVnd,
} from "../../lib/cart";

type AvailRow = { dish_id: number; available_servings: number };

const fmtVnd = (n: number) => (n || 0).toLocaleString("vi-VN") + "₫";

export default function CartScreen() {
  const { items, totalQty, totalVnd } = useCart();
  // limits[dish_id] = số suất còn làm được; null = không giới hạn/không kiểm
  const [limits, setLimits] = useState<Record<number, number | null>>({});
  const [loading, setLoading] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [note, setNote] = useState("");
  const insets = useSafeAreaInsets();

  // ---- Load giới hạn từ view v_dish_available
  async function loadLimits(forItems: CartItem[]) {
    if (!forItems.length) {
      setLimits({});
      return;
    }
    const ids = [...new Set(forItems.map((i) => i.dish_id))];

    const { data, error } = await supabase
      .from("v_dish_available")
      .select("dish_id, available_servings")
      .in("dish_id", ids);

    if (error) {
      // Nếu view chưa sẵn → cho phép thao tác bình thường; backend RPC vẫn chặn oversell.
      const map: Record<number, number | null> = {};
      ids.forEach((id) => (map[id] = null));
      setLimits(map);
      return;
    }
    const map: Record<number, number | null> = {};
    (data as AvailRow[]).forEach((r) => (map[r.dish_id] = r.available_servings ?? 0));
    setLimits(map);
  }

  useEffect(() => {
    setLoading(true);
    loadLimits(items).finally(() => setLoading(false));
  }, [items]);

  // Tổng số suất mỗi món (cộng across lines)
  const qtyByDish = useMemo(() => {
    const m: Record<number, number> = {};
    items.forEach((it) => (m[it.dish_id] = (m[it.dish_id] ?? 0) + it.qty));
    return m;
  }, [items]);

  function inc(it: CartItem) {
    const limit = limits[it.dish_id]; // null = không giới hạn/không kiểm
    const sum = qtyByDish[it.dish_id] ?? 0;
    if (limit != null && sum + 1 > limit) {
      Alert.alert("Vượt giới hạn", `Chỉ còn làm được ${limit} suất cho món này.`);
      return;
    }
    setLineQty(it.line_id, it.qty + 1);
  }
  function dec(it: CartItem) {
    if (it.qty <= 1) return removeLine(it.line_id);
    setLineQty(it.line_id, it.qty - 1);
  }

  function addonsLabel(it: CartItem) {
    if (!it.addons || it.addons.length === 0) return "Không topping";
    return it.addons.map((a) => `${a.name}×${a.qty_units}`).join(", ");
  }

  // ---- Đặt hàng qua RPC create_order (transaction trong DB)
  async function placeOrder() {
    if (items.length === 0) {
      Alert.alert("Giỏ hàng trống", "Hãy thêm món trước khi đặt.");
      return;
    }
    // Kiểm tra sơ bộ theo giới hạn UI (backend vẫn kiểm tra lần cuối)
    for (const [dishIdStr, sumQty] of Object.entries(qtyByDish)) {
      const dishId = Number(dishIdStr);
      const limit = limits[dishId];
      if (limit != null && sumQty > limit) {
        Alert.alert(
          "Hết hàng",
          `Một số dòng của món #${dishId} vượt giới hạn ${limit}. Hãy giảm số lượng.`
        );
        return;
      }
    }

    try {
      setPlacing(true);
      const payload = {
        p_note: note.trim() || null,
        p_lines: items.map((i) => ({
          line_id: i.line_id,
          dish_id: i.dish_id,
          qty: i.qty,
          addons: (i.addons ?? []).map((a) => ({ id: a.id, qty_units: a.qty_units })),
        })),
        // p_user: session?.user?.id, // nếu muốn lưu user_id
      } as any;

      const { data, error } = await supabase.rpc("create_order", payload);
      if (error) throw error;

      const orderId = data as number;
      clearCart();
      Alert.alert("Đặt thành công", `Mã đơn: ${orderId}`);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("OUT_OF_STOCK")) {
        Alert.alert("Hết nguyên liệu", "Một số nguyên liệu hiện không đủ để chế biến.");
      } else if (msg.includes("OUT_OF_CAPACITY")) {
        Alert.alert("Hết công suất", "Một số món đã hết suất còn lại trong ca.");
      } else {
        Alert.alert("Đặt thất bại", e?.message ?? "Vui lòng thử lại.");
      }
    } finally {
      setPlacing(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#fff", paddingBottom: insets.bottom || 12 }}>
      {/* Header */}
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: "#111827" }}>Giỏ hàng</Text>
        <Text style={{ color: "#6b7280", marginTop: 4 }}>
          Tổng món: <Text style={{ fontWeight: "800" }}>{totalQty}</Text> · Tổng tiền:{" "}
          <Text style={{ fontWeight: "800" }}>{fmtVnd(totalVnd)}</Text>
        </Text>
      </View>

      {/* List */}
      {loading && items.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.line_id}
          contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
          ListEmptyComponent={
            <Text style={{ textAlign: "center", color: "#6b7280" }}>Giỏ hàng trống</Text>
          }
          renderItem={({ item }) => {
            const limit = limits[item.dish_id]; // null = không giới hạn/không kiểm
            const sumForDish = qtyByDish[item.dish_id] ?? 0;
            const warn = limit != null && sumForDish > limit;
            const subtotal = lineSubtotalVnd(item);
            return (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: warn ? "#fca5a5" : "#e5e7eb",
                  backgroundColor: "#fff",
                  borderRadius: 16,
                  padding: 14,
                  marginBottom: 12,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: "800", color: "#111827" }}>
                  {item.name}
                </Text>
                <Text style={{ color: "#6b7280", marginTop: 4 }}>{addonsLabel(item)}</Text>
                <Text style={{ marginTop: 4, color: warn ? "#b91c1c" : "#6b7280" }}>
                  Còn làm được:{" "}
                  <Text style={{ fontWeight: "800" }}>
                    {limit == null ? "không giới hạn" : limit}
                  </Text>
                  {limit != null ? " suất" : ""} · Đang đặt:{" "}
                  <Text style={{ fontWeight: "800" }}>{sumForDish}</Text>
                  {warn ? " • Vượt giới hạn!" : ""}
                </Text>

                {/* Qty controls */}
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 }}>
                  <Pressable
                    onPress={() => dec(item)}
                    style={{
                      width: 40, height: 40,
                      alignItems: "center", justifyContent: "center",
                      borderRadius: 10, borderWidth: 1, borderColor: "#e5e7eb",
                      backgroundColor: "#f9fafb",
                    }}
                  >
                    <Text style={{ fontSize: 18, fontWeight: "800" }}>–</Text>
                  </Pressable>
                  <Text style={{ minWidth: 32, textAlign: "center", fontWeight: "800" }}>
                    {item.qty}
                  </Text>
                  <Pressable
                    onPress={() => inc(item)}
                    style={{
                      width: 40, height: 40,
                      alignItems: "center", justifyContent: "center",
                      borderRadius: 10, borderWidth: 1, borderColor: "#e5e7eb",
                      backgroundColor: "#f3f4f6",
                    }}
                  >
                    <Text style={{ fontSize: 18, fontWeight: "800" }}>+</Text>
                  </Pressable>

                  <View style={{ flex: 1 }} />
                  <Text style={{ fontWeight: "700", color: "#374151", marginRight: 8 }}>
                    {fmtVnd(subtotal)}
                  </Text>
                  <Pressable
                    onPress={() => removeLine(item.line_id)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 8,
                      borderRadius: 10, borderWidth: 1, borderColor: "#e5e7eb",
                      backgroundColor: "#fff",
                    }}
                  >
                    <Text style={{ fontWeight: "700", color: "#374151" }}>Xoá</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Note + actions */}
      <View style={{ padding: 16, borderTopWidth: 1, borderColor: "#e5e7eb" }}>
        <Text style={{ color: "#374151", marginBottom: 6 }}>Ghi chú (tuỳ chọn)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Ví dụ: ít sốt, thêm tiêu…"
          placeholderTextColor="#9ca3af"
          style={{
            borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, color: "#111827",
          }}
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={clearCart}
            style={{
              flex: 1, alignItems: "center", paddingVertical: 12,
              borderRadius: 12, borderWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#fff",
            }}
          >
            <Text style={{ fontWeight: "800", color: "#111827" }}>Xoá giỏ</Text>
          </Pressable>
          <Pressable
            disabled={placing || items.length === 0}
            onPress={placeOrder}
            style={{
              flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12,
              backgroundColor: items.length === 0 ? "#9ca3af" : "#16a34a",
              borderWidth: 1, borderColor: items.length === 0 ? "#9ca3af" : "#15803d",
              opacity: placing ? 0.8 : 1,
            }}
          >
            {placing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ fontWeight: "800", color: "#fff" }}>Đặt ngay</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
