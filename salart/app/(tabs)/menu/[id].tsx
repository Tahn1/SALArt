// app/(tabs)/menu/[id].tsx
// Đồng nhất với lib/cart.ts (base_price_vnd + addons[ { id, name, qty_units, extra_price_vnd_per_unit } ])

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { addToCart } from "../../../lib/cart";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type DishRow = {
  id: number;
  name: string;
  image_path?: string | null;
  price_vnd?: number | null;
  kcal?: number | null;
  protein?: number | null;
  fat?: number | null;
  carbs?: number | null;
  serving_size_g?: number | null;
};

type Topping = {
  id: string | number;
  name: string;
  image_path?: string | null;
  amount_per_unit_g: number;  // gram mỗi step
  extra_price_vnd: number;    // phụ thu / 1 step (sẽ map -> extra_price_vnd_per_unit khi addToCart)
  kcal_pu: number;
  protein_pu: number;
  fat_pu: number;
  carbs_pu: number;
  min_steps?: number | null;
  max_steps?: number | null;
};

const C = {
  bg: "#F6F2EA",
  panel: "#EFE9DE",
  text: "#2B241F",
  sub: "#6B615C",
  accent: "#7A4E3A",
  line: "#E6DFD4",
  white: "#fff",
};

const n0 = (x?: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtVND = (n = 0) => {
  try { return n.toLocaleString("vi-VN") + " đ"; }
  catch { return `${Math.round(n)} đ`; }
};

export default function DishDetail() {
  const { id, name: nameParam, image: imageUrlFromList } =
    useLocalSearchParams<{ id: string; name?: string; image?: string }>();
  const dishId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [dish, setDish] = useState<DishRow | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(imageUrlFromList ?? null);

  const [toppings, setToppings] = useState<Topping[]>([]);
  const [counts, setCounts] = useState<Record<string | number, number>>({});
  const [qty, setQty] = useState(1);

  // cao hơn để tránh footer che nội dung
  const FOOTER_H = 96 + insets.bottom;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);

        // 1) Load món (fallback nếu thiếu price_vnd)
        const colsWithPrice = "id,name,image_path,price_vnd";
        const colsNoPrice = "id,name,image_path";
        let d: any | null = null;
        const r1 = await supabase.from("dishes").select(colsWithPrice).eq("id", dishId).single();
        if (r1.error && (r1.error.message || "").includes("price_vnd")) {
          const r2 = await supabase.from("dishes").select(colsNoPrice).eq("id", dishId).single();
          if (r2.error) throw r2.error;
          d = { ...r2.data, price_vnd: 0 };
        } else if (r1.error) throw r1.error; else d = r1.data;

        if (!alive) return;
        setDish(d);
        if (!imageUrlFromList && d?.image_path && typeof d.image_path === "string" && d.image_path.startsWith("http")) {
          setImageUrl(d.image_path);
        }

        // 2) Dinh dưỡng base 1 suất
        const nutRes = await supabase
          .from("dish_nutrition_default")
          .select("kcal,protein,fat,carbs,serving_size_g")
          .eq("dish_id", dishId)
          .limit(1);
        if (nutRes.error) throw nutRes.error;
        const nut = nutRes.data?.[0] ?? null;
        if (alive && nut) setDish((prev) => (prev ? { ...prev, ...nut } : prev));

        // 3) Toppings (view per-step đã tính sẵn)
        const topRes = await supabase
          .from("v_dish_topping_options")
          .select(`
            ingredient_id,
            name,
            image_path,
            step_g,
            price_vnd_per_step,
            kcal_per_step,
            protein_per_step_g,
            fat_per_step_g,
            carbs_per_step_g,
            min_steps,
            max_steps
          `)
          .eq("dish_id", dishId);
        if (topRes.error) throw topRes.error;

        const tops: Topping[] = (topRes.data ?? []).map((row: any) => ({
          id: row.ingredient_id,
          name: row.name,
          image_path: row.image_path ?? null,
          amount_per_unit_g: Number(row.step_g ?? 0),
          extra_price_vnd:   Number(row.price_vnd_per_step ?? 0),
          kcal_pu:           Number(row.kcal_per_step ?? 0),
          protein_pu:        Number(row.protein_per_step_g ?? 0),
          fat_pu:            Number(row.fat_per_step_g ?? 0),
          carbs_pu:          Number(row.carbs_per_step_g ?? 0),
          min_steps:         row.min_steps,
          max_steps:         row.max_steps,
        }));

        if (alive) {
          setToppings(tops);
          // khởi tạo theo min_steps (nếu có), đảm bảo đồng bộ với giá hiển thị
          setCounts(Object.fromEntries(tops.map(t => [t.id, Math.max(0, t.min_steps ?? 0)])));
        }
      } catch (err: any) {
        Alert.alert("Lỗi", err?.message ?? "Không tải được dữ liệu món");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [dishId]);

  // ===== TÍNH TOÁN =====
  const extraPerDishVnd = useMemo(
    () => toppings.reduce((sum, t) => sum + (counts[t.id] || 0) * t.extra_price_vnd, 0),
    [toppings, counts]
  );

  const basePrice = n0(dish?.price_vnd);              // GIÁ GỐC / 1 SUẤT
  const pricePerDish = basePrice + extraPerDishVnd;    // gốc + addon
  const finalPrice = pricePerDish * qty;

  const addedNutri = useMemo(
    () =>
      toppings.reduce(
        (acc, t) => {
          const c = counts[t.id] || 0;
          acc.kcal    += c * t.kcal_pu;
          acc.protein += c * t.protein_pu;
          acc.fat     += c * t.fat_pu;
          acc.carbs   += c * t.carbs_pu;
          return acc;
        },
        { kcal: 0, protein: 0, fat: 0, carbs: 0 }
      ),
    [toppings, counts]
  );

  const totalNutriPerDish = {
    kcal:    n0(dish?.kcal)    + addedNutri.kcal,
    protein: n0(dish?.protein) + addedNutri.protein,
    fat:     n0(dish?.fat)     + addedNutri.fat,
    carbs:   n0(dish?.carbs)   + addedNutri.carbs,
  };
  const totalNutriAll = {
    kcal:    totalNutriPerDish.kcal    * qty,
    protein: totalNutriPerDish.protein * qty,
    fat:     totalNutriPerDish.fat     * qty,
    carbs:   totalNutriPerDish.carbs   * qty,
  };

  const incTop = (tid: string | number, max?: number | null) =>
    setCounts(prev => {
      const cur = prev[tid] || 0;
      const lim = (max ?? 99);
      if (cur >= lim) return prev;
      return { ...prev, [tid]: cur + 1 };
    });

  const decTop = (tid: string | number, min?: number | null) =>
    setCounts(prev => {
      const cur = prev[tid] || 0;
      const lim = (min ?? 0);
      if (cur <= lim) return prev;
      return { ...prev, [tid]: cur - 1 };
    });

  const incQty = () => setQty(q => Math.min(99, q + 1));
  const decQty = () => setQty(q => Math.max(1, q - 1));

  const doAddToCart = async () => {
    if (!dish) return;

    // map topping -> format của lib/cart (extra_price_vnd_per_unit)
    const addons = toppings
      .map(t => {
        const units = counts[t.id] || 0;
        return units > 0
          ? {
              id: t.id,
              name: t.name,
              qty_units: units,
              extra_price_vnd_per_unit: t.extra_price_vnd,
            }
          : null;
      })
      .filter(Boolean) as {
        id: string | number;
        name: string;
        qty_units: number;
        extra_price_vnd_per_unit: number;
      }[];

    try {
      addToCart({
        dish_id: dish.id,
        name: dish.name,
        image_path: dish.image_path ?? null,
        base_price_vnd: basePrice, // GIÁ GỐC / 1 SUẤT (không cộng topping)
        qty,
        addons,                    // [] nếu không chọn gì -> sẽ merge với dòng "không topping"
        // snapshot dinh dưỡng / 1 suất (đã + addon)
        kcal: totalNutriPerDish.kcal,
        protein: totalNutriPerDish.protein,
        fat: totalNutriPerDish.fat,
        carbs: totalNutriPerDish.carbs,
        serving_size_g: dish.serving_size_g ?? null,
      });
      Alert.alert("Đã thêm vào giỏ", `${dish.name} (${qty}x)`);
      router.back();
    } catch (e: any) {
      Alert.alert("Lỗi", e?.message ?? "Không thể thêm vào giỏ");
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!dish) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}>
        <Text>Không tìm thấy món.</Text>
      </View>
    );
  }

  // 👉 nếu có giá ưu đãi thì set vào đây (vd 109000)
  const wowPrice: number | null = null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Ẩn header mặc định */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER custom */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 12,
          backgroundColor: C.white,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderBottomWidth: 1,
          borderColor: C.line,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 20, fontWeight: "700", color: C.text }}>
          {dish.name || nameParam || "Món"}
        </Text>
      </View>

      {/* Ảnh món */}
      <View style={{ height: 220, backgroundColor: C.white }}>
        <Image
          source={imageUrl ? { uri: imageUrl } : undefined}
          contentFit="cover"
          style={{ width: "100%", height: "100%" }}
          transition={200}
        />
      </View>

      {/* Nội dung kéo được, không bị footer che */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: FOOTER_H + 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Danh sách topping */}
        <View style={{ borderRadius: 12, overflow: "hidden", backgroundColor: C.white, borderWidth: 1, borderColor: C.line }}>
          {toppings.map((t, idx) => {
            const c = counts[t.id] || 0;
            const gramsAdded   = c * t.amount_per_unit_g;
            const kcalAdded    = c * t.kcal_pu;
            const carbsAdded   = c * t.carbs_pu;
            const fatAdded     = c * t.fat_pu;
            const proteinAdded = c * t.protein_pu;
            const moneyAdded   = c * t.extra_price_vnd;

            const last = idx === toppings.length - 1;
            const canInc = t.max_steps == null || c < (t.max_steps as number);
            const canDec = c > (t.min_steps ?? 0);

            return (
              <View key={String(t.id)} style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderColor: C.line, backgroundColor: "#FBF7F0" }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden", backgroundColor: C.white }}>
                    {t.image_path ? (
                      <Image
                        source={t.image_path.startsWith("http") ? { uri: t.image_path } : undefined}
                        contentFit="cover"
                        style={{ width: "100%", height: "100%" }}
                      />
                    ) : null}
                  </View>

                  <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Text style={{ color: C.text, fontWeight: "600" }}>{t.name}</Text>
                    <Text style={{ color: C.sub, marginTop: 2, fontSize: 12 }}>
                      +{fmtVND(t.extra_price_vnd)}
                      {t.amount_per_unit_g ? ` · ~${round1(t.amount_per_unit_g)}g` : ""}
                      <> · {round1(t.kcal_pu)} kcal, {round1(t.carbs_pu)}g C, {round1(t.fat_pu)}g F, {round1(t.protein_pu)}g P</>
                      {t.max_steps != null ? ` · tối đa ${t.max_steps} bước` : ""}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable
                      onPress={() => decTop(t.id, t.min_steps)}
                      disabled={!canDec}
                      style={{
                        width: 36, height: 36, borderRadius: 8,
                        backgroundColor: C.white, borderWidth: 1, borderColor: C.line,
                        alignItems: "center", justifyContent: "center", opacity: canDec ? 1 : 0.4,
                      }}
                    >
                      <Ionicons name="remove" size={18} color={C.text} />
                    </Pressable>
                    <Text style={{ minWidth: 20, textAlign: "center", fontWeight: "700" }}>{c}</Text>
                    <Pressable
                      onPress={() => incTop(t.id, t.max_steps)}
                      disabled={!canInc}
                      style={{
                        width: 36, height: 36, borderRadius: 8,
                        backgroundColor: C.white, borderWidth: 1, borderColor: C.line,
                        alignItems: "center", justifyContent: "center", opacity: canInc ? 1 : 0.4,
                      }}
                    >
                      <Ionicons name="add" size={18} color={C.text} />
                    </Pressable>
                  </View>
                </View>

                {c > 0 && (
                  <View style={{ marginTop: 6, marginLeft: 68 }}>
                    <Text style={{ color: C.text, fontSize: 12 }}>
                      Đã thêm: <Text style={{ fontWeight: "700" }}>{round1(gramsAdded)}g</Text>
                      {" · "}+{round1(kcalAdded)} kcal · {round1(carbsAdded)}g C · {round1(fatAdded)}g F · {round1(proteinAdded)}g P
                      {" · "}+{fmtVND(moneyAdded)}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Dinh dưỡng tổng */}
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: C.sub, marginBottom: 6 }}>Dinh dưỡng ước tính</Text>
          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
            <Text style={{ color: C.text }}>
              <Text style={{ fontWeight: "700" }}>{Math.round(totalNutriAll.kcal)}</Text> kcal
            </Text>
            <Text style={{ color: C.text }}>
              <Text style={{ fontWeight: "700" }}>{round1(totalNutriAll.carbs)}</Text> g carbs
            </Text>
            <Text style={{ color: C.text }}>
              <Text style={{ fontWeight: "700" }}>{round1(totalNutriAll.fat)}</Text> g fat
            </Text>
            <Text style={{ color: C.text }}>
              <Text style={{ fontWeight: "700" }}>{round1(totalNutriAll.protein)}</Text> g protein
            </Text>
          </View>
          <Text style={{ color: C.sub, marginTop: 4, fontSize: 12 }}>
            (Cộng thêm từ add-on: {Math.round(addedNutri.kcal)} kcal, {round1(addedNutri.carbs)}g C, {round1(addedNutri.fat)}g F, {round1(addedNutri.protein)}g P)
          </Text>
        </View>
      </ScrollView>

      {/* FOOTER: giá + qty + nút Thêm vào giỏ */}
      <View
        style={{
          position: "absolute",
          left: 0, right: 0, bottom: 0,
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 10 + insets.bottom,
          backgroundColor: C.white,
          borderTopWidth: 1, borderColor: C.line,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {/* Giá bên trái */}
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: C.text }} numberOfLines={1}>
              {fmtVND(finalPrice)} {qty > 1 ? `(${fmtVND(pricePerDish)} x ${qty})` : ""}
            </Text>
            {/* Giá ưu đãi nếu có */}
            {/* {typeof wowPrice === "number" && (
              <Text style={{ fontSize: 12, color: "#6b7280", fontStyle: "italic" }} numberOfLines={1}>
                {fmtVND(wowPrice)} (WOWCARE)
              </Text>
            )} */}
          </View>

          {/* Qty stepper */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              onPress={decQty}
              style={{
                width: 36, height: 36, borderRadius: 8,
                backgroundColor: C.white, borderWidth: 1, borderColor: C.line,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Ionicons name="remove" size={18} color={C.text} />
            </Pressable>
            <Text style={{ minWidth: 24, textAlign: "center", fontWeight: "800", color: C.text }}>{qty}</Text>
            <Pressable
              onPress={incQty}
              style={{
                width: 36, height: 36, borderRadius: 8,
                backgroundColor: C.white, borderWidth: 1, borderColor: C.line,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Ionicons name="add" size={18} color={C.text} />
            </Pressable>
          </View>

          {/* Nút thêm vào giỏ */}
          <Pressable
            onPress={doAddToCart}
            style={{
              paddingVertical: 12,
              paddingHorizontal: 18,
              backgroundColor: C.accent,
              borderRadius: 20,
              minWidth: 170,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: C.white, fontWeight: "700" }} numberOfLines={1}>
              Thêm vào giỏ hàng
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
