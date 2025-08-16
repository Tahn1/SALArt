import React, { useEffect, useMemo, useState } from "react";
import { Alert, ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { useCart, setQty, removeFromCart, clearCart, CartItem } from "../../lib/cart";

type ServingRow = { dish_id: number; max_servings: number };

export default function CartScreen() {
  const { items } = useCart();
  const [limits, setLimits] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [note, setNote] = useState("");

  // Tải max_servings cho các món có trong giỏ
  async function loadLimits(forItems: CartItem[]) {
    if (!forItems.length) {
      setLimits({});
      return;
    }
    const ids = [...new Set(forItems.map((i) => i.dish_id))];
    const { data, error } = await supabase
      .from("dish_servings")
      .select("dish_id,max_servings")
      .in("dish_id", ids);
    if (error) {
      Alert.alert("Lỗi tải tồn kho", error.message);
      return;
    }
    const map: Record<number, number> = {};
    (data as ServingRow[]).forEach((r) => (map[r.dish_id] = r.max_servings ?? 0));
    setLimits(map);
  }

  useEffect(() => {
    setLoading(true);
    loadLimits(items).finally(() => setLoading(false));
  }, [items]);

  const totalQty = useMemo(() => items.reduce((s, it) => s + it.qty, 0), [items]);

  function inc(it: CartItem) {
    const max = limits[it.dish_id] ?? 0;
    if (it.qty + 1 > max) {
      Alert.alert("Vượt giới hạn", `Chỉ còn làm được ${max} suất cho món này.`);
      return;
    }
    setQty(it.dish_id, it.qty + 1);
  }
  function dec(it: CartItem) {
    setQty(it.dish_id, it.qty - 1);
  }

  async function placeOrder() {
    if (items.length === 0) return Alert.alert("Giỏ hàng trống", "Hãy thêm món trước khi đặt.");
    // Validate lần nữa so với max_servings
    for (const it of items) {
      const max = limits[it.dish_id] ?? 0;
      if (it.qty > max) {
        return Alert.alert(
          "Hết hàng",
          `Món "${it.name}" chỉ còn ${max} suất. Hãy giảm số lượng rồi thử lại.`
        );
      }
    }
    try {
      setPlacing(true);
      // gọi Edge Function: create-order
      const payload = { items: items.map((i) => ({ dish_id: i.dish_id, servings: i.qty })) };
      const { data, error } = await supabase.functions.invoke("create-order", { body: payload });
      if (error) throw error;
      const orderId = (data as any)?.order_id;
      clearCart();
      Alert.alert("Đặt thành công", `Mã đơn: ${orderId}`);
    } catch (e: any) {
      Alert.alert("Đặt thất bại", e?.message ?? "Vui lòng thử lại.");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* Header */}
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: "#111827" }}>Giỏ hàng</Text>
        <Text style={{ color: "#6b7280", marginTop: 4 }}>
          Tổng món: <Text style={{ fontWeight: "800" }}>{totalQty}</Text>
        </Text>
      </View>

      {/* List giỏ */}
      {loading && items.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.dish_id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
          ListEmptyComponent={
            <Text style={{ textAlign: "center", color: "#6b7280" }}>Giỏ hàng trống</Text>
          }
          renderItem={({ item }) => {
            const max = limits[item.dish_id] ?? 0;
            const warn = item.qty > max;
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
                <Text style={{ marginTop: 4, color: warn ? "#b91c1c" : "#6b7280" }}>
                  Còn làm được:{" "}
                  <Text style={{ fontWeight: "800" }}>{max}</Text> suất
                  {warn ? " • Vượt giới hạn!" : ""}
                </Text>

                {/* Qty controls */}
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 }}>
                  <Pressable
                    onPress={() => dec(item)}
                    style={{
                      width: 40,
                      height: 40,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: "#e5e7eb",
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
                      width: 40,
                      height: 40,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: "#e5e7eb",
                      backgroundColor: "#f3f4f6",
                    }}
                  >
                    <Text style={{ fontSize: 18, fontWeight: "800" }}>+</Text>
                  </Pressable>

                  <View style={{ flex: 1 }} />
                  <Pressable
                    onPress={() => removeFromCart(item.dish_id)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: "#e5e7eb",
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

      {/* Ghi chú / nút đặt */}
      <View style={{ padding: 16, borderTopWidth: 1, borderColor: "#e5e7eb" }}>
        <Text style={{ color: "#374151", marginBottom: 6 }}>Ghi chú (tuỳ chọn)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Ví dụ: ít sốt, thêm tiêu… (hiện chỉ lưu ở client)"
          placeholderTextColor="#9ca3af"
          style={{
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 12,
            color: "#111827",
          }}
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={clearCart}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#e5e7eb",
              backgroundColor: "#fff",
            }}
          >
            <Text style={{ fontWeight: "800", color: "#111827" }}>Xoá giỏ</Text>
          </Pressable>
          <Pressable
            disabled={placing || items.length === 0}
            onPress={placeOrder}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: items.length === 0 ? "#9ca3af" : "#16a34a",
              borderWidth: 1,
              borderColor: items.length === 0 ? "#9ca3af" : "#15803d",
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
