// app/(tabs)/menu.tsx
import React, { useEffect, useState, useMemo } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, Alert, TextInput } from "react-native";
import { supabase } from "../../lib/supabase"; // giữ nguyên path như các màn khác
import { addToCart, getCart } from "../../lib/cart";   // <-- thêm import

type Dish = { id: number; name: string; max_servings: number };

export default function MenuScreen() {
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [items, setItems] = useState<Dish[]>([]);
  const [q, setQ] = useState("");

  async function load() {
    try {
      setLoading(true);
      const [{ data: dishes, error: e1 }, { data: servings, error: e2 }] = await Promise.all([
        supabase.from("dishes").select("id,name").order("name"),
        supabase.from("dish_servings").select("dish_id,max_servings"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const map = Object.fromEntries((servings ?? []).map((r: any) => [r.dish_id, r.max_servings]));
      setItems((dishes ?? []).map((d: any) => ({ ...d, max_servings: map[d.id] ?? 0 })));
    } catch (e: any) {
      Alert.alert("Lỗi tải menu", e?.message ?? "Không thể tải danh sách món");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((it) => it.name.toLowerCase().includes(term));
  }, [q, items]);

  async function orderOne(dishId: number) {
    try {
      setPlacing(true);
      const { data, error } = await supabase.functions.invoke("create-order", {
        body: { items: [{ dish_id: dishId, servings: 1 }] },
      });
      if (error) throw error;
      Alert.alert("Đã đặt món", `Mã đơn: ${(data as any)?.order_id}`);
      await load(); // reload lại số suất còn
    } catch (e: any) {
      Alert.alert("Đặt món thất bại", e?.message ?? "Vui lòng thử lại");
    } finally {
      setPlacing(false);
    }
  }

  // === mới: thêm vào giỏ 1 suất, có kiểm tra không vượt max_servings ===
  function addOneToCart(item: Dish) {
    if (item.max_servings <= 0) {
      return Alert.alert("Hết hàng", "Món này tạm thời không còn suất.");
    }
    const existingQty = getCart().find((x) => x.dish_id === item.id)?.qty ?? 0;
    if (existingQty + 1 > item.max_servings) {
      return Alert.alert(
        "Vượt giới hạn",
        `Món "${item.name}" chỉ còn ${item.max_servings} suất trong kho.`
      );
    }
    addToCart(item.id, item.name, 1);
    Alert.alert("Đã thêm vào giỏ", `${item.name} ×1`);
  }

  if (loading && items.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Đang tải menu…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* Tìm kiếm */}
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "800" }}>Đặt món</Text>
        <TextInput
          placeholder="Tìm món…"
          placeholderTextColor="#9ca3af"
          value={q}
          onChangeText={setQ}
          style={{
            marginTop: 10,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            backgroundColor: "#f9fafb",
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            color: "#111827",
          }}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        onRefresh={load}
        refreshing={loading}
        renderItem={({ item }) => (
          <View
            style={{
              borderWidth: 1,
              borderColor: "#e5e7eb",
              backgroundColor: "#fff",
              borderRadius: 16,
              padding: 14,
              marginBottom: 12,
              shadowColor: "#000",
              shadowOpacity: 0.06,
              shadowRadius: 8,
              elevation: 1,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "800", color: "#111827" }}>{item.name}</Text>
            <Text style={{ marginTop: 4, color: "#6b7280" }}>
              Còn làm được: <Text style={{ fontWeight: "800" }}>{item.max_servings}</Text> suất
            </Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable
                disabled={item.max_servings <= 0 || placing}
                onPress={() => orderOne(item.id)}
                android_ripple={{ color: "#e0efe4" }}
                style={{
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: item.max_servings <= 0 ? "#9ca3af" : "#16a34a",
                  borderWidth: 1,
                  borderColor: item.max_servings <= 0 ? "#9ca3af" : "#15803d",
                  opacity: placing ? 0.8 : 1,
                }}
              >
                {placing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "800" }}>Đặt 1 suất</Text>
                )}
              </Pressable>

              {/* Nút mới: Thêm vào giỏ */}
              <Pressable
                disabled={item.max_servings <= 0}
                onPress={() => addOneToCart(item)}
                android_ripple={{ color: "#e5e7eb" }}
                style={{
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: item.max_servings <= 0 ? "#9ca3af" : "#2563eb",
                  borderWidth: 1,
                  borderColor: item.max_servings <= 0 ? "#9ca3af" : "#1d4ed8",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Thêm vào giỏ</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}
