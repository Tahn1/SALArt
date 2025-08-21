// app/(tabs)/cart.tsx — CartScreen (Floating CTA, addon chips with +/- & 'Xoá', no dish qty controls)

import React, { useEffect, useMemo, useState } from "react";
import { Alert, ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { supabase } from "../../lib/supabase";
import {
  useCart,
  removeLine,
  removeAddon,
  setAddonQty,
} from "../../lib/cart";

const C = {
  bg: "#F6F2EA",
  panel: "#FFFFFF",
  text: "#111827",
  sub: "#6B7280",
  line: "#E5E7EB",
  good: "#16a34a",
  goodDark: "#15803d",
  danger: "#dc2626",
};

const fmtVnd = (n = 0) => {
  try { return n.toLocaleString("vi-VN") + " đ"; }
  catch { return `${Math.round(n)} đ`; }
};

type AvailRow = { dish_id: number; available_servings: number | null };

export default function CartScreen() {
  const insets = useSafeAreaInsets();
  const tabH = useBottomTabBarHeight();
  const { items, totalQty, totalVnd } = useCart();

  const [limits, setLimits] = useState<Record<number, number | null>>({});
  const [loading, setLoading] = useState(false);
  const [placing, setPlacing] = useState(false);

  const qtyByDish = useMemo(() => {
    const map: Record<number, number> = {};
    for (const it of items) map[it.dish_id] = (map[it.dish_id] ?? 0) + it.qty;
    return map;
  }, [items]);

  const overCapacity = useMemo(() => {
    for (const d of Object.keys(qtyByDish)) {
      const id = Number(d);
      const limit = limits[id];
      if (limit != null && qtyByDish[id] > limit) return true;
    }
    return false;
  }, [qtyByDish, limits]);

  const lineSubtotal = (it: any) =>
    (it.base_price_vnd +
      (it.addons ?? []).reduce(
        (s: number, a: any) => s + a.qty_units * a.extra_price_vnd_per_unit,
        0
      )) * it.qty;

  async function loadLimits() {
    const dishIds = Array.from(new Set(items.map((i) => i.dish_id)));
    if (dishIds.length === 0) { setLimits({}); return; }
    const { data, error } = await supabase
      .from("v_dish_available")
      .select("dish_id,available_servings")
      .in("dish_id", dishIds as any[]);
    if (error) { setLimits({}); return; }
    const map: Record<number, number | null> = {};
    (data as AvailRow[]).forEach((r) => (map[r.dish_id] = r.available_servings));
    setLimits(map);
  }

  useEffect(() => {
    setLoading(true);
    loadLimits().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  async function placeOrder() {
    if (items.length === 0) return;
    if (overCapacity) { Alert.alert("Vượt công suất","Một số món vượt số suất còn lại."); return; }

    setPlacing(true);
    try {
      const p_lines = items.map((it) => ({
        dish_id: it.dish_id,
        qty: it.qty,
        addons: (it.addons ?? []).map((a: any) => ({
          id: a.id,
          name: a.name,
          qty_units: a.qty_units,
          extra_price_vnd_per_unit: a.extra_price_vnd_per_unit,
        })),
      }));
      const { data, error } = await supabase.rpc("create_order", { p_note: null, p_lines });
      if (error) throw error;
      const orderId = Number(data);
      Alert.alert("Đặt hàng thành công", `Mã đơn #${orderId}\nCảm ơn bạn!`);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("OUT_OF_STOCK")) Alert.alert("Hết hàng","Một số nguyên liệu đã hết.");
      else if (msg.includes("OUT_OF_CAPACITY")) Alert.alert("Vượt công suất","Số lượng vượt suất còn lại.");
      else if (msg.includes("EMPTY_CART")) Alert.alert("Giỏ trống","Không có gì để đặt.");
      else Alert.alert("Đặt thất bại", e?.message ?? "Vui lòng thử lại.");
    } finally { setPlacing(false); }
  }

  const canPlace = items.length > 0 && !overCapacity && !placing;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: C.bg,
        paddingBottom: (insets.bottom || 12) + tabH + 90, // chừa chỗ cho tab + nút nổi
      }}
    >
      {/* Header */}
      <View style={{ padding: 16, backgroundColor: C.panel, borderBottomWidth: 1, borderColor: C.line }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: C.text }}>Giỏ hàng</Text>
        <Text style={{ color: C.sub, marginTop: 4 }}>
          Tổng món: <Text style={{ fontWeight: "800", color: C.text }}>{totalQty}</Text> · Tổng tiền:{" "}
          <Text style={{ fontWeight: "800", color: C.text }}>{fmtVnd(totalVnd)}</Text>
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
          keyExtractor={(it: any) => it.line_id}
          contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
          ListEmptyComponent={<Text style={{ textAlign: "center", color: C.sub }}>Giỏ hàng trống</Text>}
          renderItem={({ item }: any) => {
            const addons = item.addons ?? [];
            const subtotal = lineSubtotal(item);
            const limit = limits[item.dish_id];
            const sumQtyDish = qtyByDish[item.dish_id] ?? item.qty;
            const exceed = limit != null && sumQtyDish > limit;

            return (
              <View
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderColor: C.line,
                  borderRadius: 12,
                  backgroundColor: "#fff",
                  marginBottom: 12,
                  gap: 8,
                }}
              >
                {/* Hàng tiêu đề món + qty badge + subtotal */}
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: C.text }}>
                      {item.name}
                    </Text>
                    {item.qty > 1 && (
                      <View
                        style={{
                          marginLeft: 8,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 999,
                          backgroundColor: "#F3F4F6",
                          borderWidth: 1,
                          borderColor: C.line,
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "700", color: C.text }}>
                          × {item.qty}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontWeight: "800", color: C.text }}>
                    {fmtVnd(subtotal)}
                  </Text>
                </View>

                {/* Add-ons: chip có +/- và nút chữ 'Xoá' (không hiển thị giá) */}
                {addons.length === 0 ? (
                  <Text style={{ color: C.sub }}>Không có add-on</Text>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {addons.map((a: any) => (
                      <View
                        key={`${item.line_id}-${a.id}`}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: C.line,
                          backgroundColor: "#fff",
                          marginRight: 6,
                          marginBottom: 6,
                          gap: 6,
                        }}
                      >
                        <Text style={{ color: C.text, fontSize: 12, fontWeight: "700" }}>
                          {a.name}
                        </Text>

                        {/* Counter cho add-on */}
                        <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 8 }}>
                          <Pressable
                            onPress={() => setAddonQty(item.line_id, a.id, Math.max(0, a.qty_units - 1))}
                            style={{ paddingHorizontal: 6, paddingVertical: 2 }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: "800", color: C.text }}>–</Text>
                          </Pressable>
                          <Text style={{ minWidth: 18, textAlign: "center", fontWeight: "800", color: C.text, fontSize: 12 }}>
                            {a.qty_units}
                          </Text>
                          <Pressable
                            onPress={() => setAddonQty(item.line_id, a.id, Math.min(99, a.qty_units + 1))}
                            style={{ paddingHorizontal: 6, paddingVertical: 2 }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: "800", color: C.text }}>+</Text>
                          </Pressable>
                        </View>

                        {/* Nút chữ 'Xoá' thay cho icon × */}
                        <Pressable
                          onPress={() => removeAddon(item.line_id, a.id)}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 8,
                            backgroundColor: "#fee2e2",
                            borderWidth: 1,
                            borderColor: "#fecaca",
                          }}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "700", color: "#b91c1c" }}>Xoá</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                {limit == null ? (
                  <Text style={{ color: C.sub, fontSize: 12 }}>
                    Công suất: <Text style={{ fontWeight: "700" }}>không giới hạn</Text>
                  </Text>
                ) : (
                  <Text
                    style={{
                      color: exceed ? C.danger : C.sub,
                      fontSize: 12,
                      fontWeight: (exceed ? "700" : "400") as any,
                    }}
                  >
                    Còn: {limit} suất · Bạn đang đặt: {sumQtyDish}
                  </Text>
                )}

                {/* Chỉ giữ nút Xoá món */}
                <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                  <Pressable
                    onPress={() => removeLine(item.line_id)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: C.line,
                      backgroundColor: "#fff",
                    }}
                  >
                    <Text style={{ color: C.text, fontWeight: "700" }}>Xoá món</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* CTA nổi: sát tab bar, hiển thị tổng tiền trên nút */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          bottom: tabH + 12,
        }}
      >
        <Pressable
          disabled={!canPlace}
          onPress={placeOrder}
          style={{
            paddingVertical: 14,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canPlace ? C.good : "#9ca3af",
            elevation: 5,
            shadowColor: "#000",
            shadowOpacity: 0.15,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          {placing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>
              Đặt ngay — {fmtVnd(totalVnd)}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
