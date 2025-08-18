// app/(tabs)/menu.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, Pressable,
  ScrollView, Text, TextInput, View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { addToCart } from "../../lib/cart";

type Dish = { id: number; name: string; base: string[]; topping: string[] };

const IMAGE_OF: Record<string,string> = {
  "Salad Caesar":"https://images.unsplash.com/photo-1551892374-5d9bb97f0e12?q=80&w=1200&auto=format&fit=crop",
  "Salad Hy Lạp":"https://images.unsplash.com/photo-1540420773420-3366772f4999?q=80&w=1200&auto=format&fit=crop",
  "Salad Cobb":"https://images.unsplash.com/photo-1568605114967-8130f3a36994?q=80&w=1200&auto=format&fit=crop",
  "Salad Niçoise":"https://images.unsplash.com/photo-1526318472351-c75fcf070305?q=80&w=1200&auto=format&fit=crop",
  "Salad Waldorf":"https://images.unsplash.com/photo-1498837167922-ddd27525d352?q=80&w=1200&auto=format&fit=crop",
};

const CHIP_ITEMS = ["Nổi bật", "Salad", "Tự chọn", "Đồ uống"] as const;

const BG   = "#f0efea"; // nền chữ + nền ảnh
const PAD  = 16;
const FONT = { title: 30, sauce: 17, label: 16, text: 16, pill: 13, brand: 14 };

export default function MenuScreen() {
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof CHIP_ITEMS)[number]>("Nổi bật");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Dish[]>([]);

  async function load() {
    try {
      setLoading(true);
      const { data: dishes, error: e1 } = await supabase.from("dishes").select("id,name").order("name");
      if (e1) throw e1;

      const { data: ing, error: e3 } = await supabase
        .from("dish_ingredients")
        .select("dish_id, category, ingredients(name)")
        .order("dish_id");
      if (e3) throw e3;

      const grouped: Record<number, { base: string[]; topping: string[] }> = {};
      (ing ?? []).forEach((row: any) => {
        const id = row.dish_id as number;
        if (!grouped[id]) grouped[id] = { base: [], topping: [] };
        const name = row.ingredients?.name as string;
        if (!name) return;
        if (row.category === "base") grouped[id].base.push(name);
        else grouped[id].topping.push(name);
      });

      setItems(
        (dishes ?? []).map((d: any) => ({
          id: d.id, name: d.name,
          base: grouped[d.id]?.base ?? [], topping: grouped[d.id]?.topping ?? [],
        }))
      );
    } catch (e: any) {
      Alert.alert("Lỗi tải thực đơn", e?.message ?? "Không thể tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let arr = items;
    if (filter === "Đồ uống") arr = [];
    if (!term) return arr;
    return arr.filter((it) => it.name.toLowerCase().includes(term));
  }, [q, items, filter]);

  function addOneToCart(item: Dish) {
    addToCart(item.id, item.name, 1);
    Alert.alert("Đã thêm vào giỏ", `${item.name} ×1`);
  }

  if (loading && items.length === 0) {
    return (
      <View style={{ flex:1, alignItems:"center", justifyContent:"center", backgroundColor:"#fff" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Đang tải thực đơn…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, backgroundColor:"#fff" }}>
      {/* Header + chip + search */}
      <View style={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
        <View style={{ flexDirection:"row", alignItems:"center", gap: 8 }}>
          <Pressable style={{ padding: 8 }}>
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </Pressable>
          <Text style={{ fontSize: 22, fontWeight:"800", color:"#111827" }}>Thực đơn</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}
          contentContainerStyle={{ gap: 8 }}>
          {CHIP_ITEMS.map((c) => {
            const on = filter === c;
            return (
              <Pressable key={c} onPress={() => setFilter(c)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22, borderWidth: 1,
                  borderColor: on ? "#a16207" : "#e5e7eb", backgroundColor: on ? "#ede9fe" : "#fff",
                }}>
                <Text style={{ color: on ? "#522504" : "#374151", fontWeight:"700" }}>{c}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <TextInput
          placeholder="Tìm món…" placeholderTextColor="#9ca3af" value={q} onChangeText={setQ}
          style={{
            marginTop: 12, borderWidth: 1, borderColor:"#e5e7eb", backgroundColor:"#f9fafb",
            borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color:"#111827", fontSize: 16,
          }}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ paddingHorizontal: 0, paddingBottom: 24 }}
        onRefresh={load} refreshing={loading}
        renderItem={({ item }) => (
          // Card: nền BG tràn toàn card, ảnh không tràn (có khoảng cách)
          <View style={{
            marginHorizontal: 12, marginBottom: 14, borderRadius: 16, overflow: "hidden",
            borderWidth: 1, borderColor: "#e5e7eb", backgroundColor: BG,
          }}>
            {/* Text block trên nền BG */}
            <View style={{ padding: PAD }}>
              <View style={{ flexDirection:"row", alignItems:"center", justifyContent:"space-between" }}>
                <Text style={{ color: "#6b7280", fontWeight:"700", fontSize: FONT.brand }}>Saladays</Text>
                <View style={{ flexDirection:"row", gap: 12 }}>
                  <Ionicons name="eye-off-outline" size={20} color="#374151" />
                  <Ionicons name="heart-outline" size={20} color="#374151" />
                </View>
              </View>

              <Text style={{ fontSize: FONT.title, fontWeight:"900", color:"#1f2937", marginTop: 6 }}>
                {item.name}
              </Text>
              <Text style={{ marginTop: 4, fontSize: FONT.sauce, lineHeight: 22 }}>
                <Text style={{ color: "#6b7280" }}>Xốt </Text>
                <Text style={{ fontWeight:"800", color:"#111827" }}>Chanh Mù Tạt</Text>
              </Text>

              {item.base.length > 0 && (
                <Text style={{ marginTop: 12, color:"#1f2937", fontSize: FONT.text, lineHeight: 22 }}>
                  <Text style={{ fontWeight:"900", fontSize: FONT.label }}>Rau nền </Text>
                  <Text>{item.base.join(", ")}</Text>
                </Text>
              )}
              {item.topping.length > 0 && (
                <Text style={{ marginTop: 6, color:"#1f2937", fontSize: FONT.text, lineHeight: 22 }}>
                  <Text style={{ fontWeight:"900", fontSize: FONT.label }}>Lớp phủ </Text>
                  <Text>{item.topping.join(", ")}</Text>
                </Text>
              )}
            </View>

            {/* Ảnh KHÔNG tràn: thêm padding để cách viền nền */}
            <View style={{ backgroundColor: BG, paddingHorizontal: PAD, paddingBottom: 12 }}>
              <Image
                source={{ uri: IMAGE_OF[item.name] ??
                  "https://images.unsplash.com/photo-1551218808-94e220e084d2?q=80&w=1200&auto=format&fit=crop" }}
                style={{ width: "100%", height: 320, borderRadius: 14 }}
                resizeMode="cover"
              />
            </View>

            {/* Pills dinh dưỡng trên nền BG */}
            <View style={{ marginTop: 6, marginBottom: 12, alignSelf: "center", flexDirection: "row", gap: 8 }}>
              <Pill label="426 kcal" />
              <Pill label="65g carbs" />
              <Pill label="8.9g fat" />
              <Pill label="50g protein" />
            </View>
          </View>
        )}
      />
    </View>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View
      style={{
        borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb",
        paddingHorizontal: 12, paddingVertical: 6,
      }}
    >
      <Text style={{ color: "#111827", fontWeight: "800", fontSize: FONT.pill }}>{label}</Text>
    </View>
  );
}
