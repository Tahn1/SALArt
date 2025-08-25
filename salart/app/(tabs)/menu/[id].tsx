// app/(tabs)/menu/[id].tsx
// Đồng nhất với lib/cart.ts (base_price_vnd + addons[ { id, name, qty_units, extra_price_vnd_per_unit } ])

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
// 🔁 DÙNG HÀM CHECK MỚI & ĐỌC GIỎ
import { addToCartChecked, useCart } from "../../../lib/cart";
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
  stock_mode?: "ING" | "DISH" | null;
  stock_units?: number | null;
};

type Topping = {
  id: string | number;
  name: string;
  image_key?: string | null;
  amount_per_unit_g: number;
  extra_price_vnd: number;
  kcal_pu: number;
  protein_pu: number;
  fat_pu: number;
  carbs_pu: number;
  min_steps?: number | null;
  max_steps?: number | null;
  stock_g?: number;
  avail_steps?: number;
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

// ======= Storage helpers (INGREDIENT IMAGES) =======
const SUPA_PUBLIC = (bucket: string) => new RegExp(`^https?://[^?]+/storage/v1/object/public/${bucket}/`, "i");
const SUPA_SIGN   = (bucket: string) => new RegExp(`^https?://[^?]+/storage/v1/object/sign/${bucket}/`, "i");

function toBucketKey(bucket: "dishes" | "ingredients", path?: string | null) {
  let key = String(path || "").trim();
  if (!key) return "";
  key = key.replace(SUPA_PUBLIC(bucket), "").replace(SUPA_SIGN(bucket), "");
  key = key.replace(/^\/+/, "");
  if (!key.includes("/")) key = `${bucket}/${key}`;
  key = key.replace(new RegExp(`^${bucket}\\/(?:${bucket}\\/)+`, "i"), `${bucket}/`);
  return key;
}

function buildStorageUrl(
  bucket: "dishes" | "ingredients",
  key: string,
  w: number,
  q: number,
  webp: boolean,
  resize: "contain" | "cover" = "contain",
  h?: number
) {
  if (!key) return null;
  return supabase.storage.from(bucket).getPublicUrl(key, {
    transform: {
      width: w,
      ...(h ? { height: h } : {}),
      quality: q,
      resize,
      ...(webp ? { format: "webp" as const } : {}),
    },
  }).data.publicUrl;
}

const ING_DEFAULT_KEY = "ingredients/default.jpg";
const ingWebp = (key?: string | null, size = 160) =>
  buildStorageUrl("ingredients", key || ING_DEFAULT_KEY, size, 75, true,  "cover", size);
const ingJpg  = (key?: string | null, size = 160) =>
  buildStorageUrl("ingredients", key || ING_DEFAULT_KEY, size, 85, false, "cover", size);

const AddonImg = ({ imageKey }: { imageKey?: string | null }) => {
  const [useJpg, setUseJpg] = useState(false);
  const uri = useJpg ? ingJpg(imageKey) : ingWebp(imageKey);
  return (
    <Image
      source={{ uri: uri || undefined }}
      style={{ width: "100%", height: "100%" }}
      contentFit="cover"
      transition={140}
      cachePolicy="immutable"
      onError={() => setUseJpg(true)}
    />
  );
};

// ======== LẤY ADD-ON TỪ ingredient_addon_config ========
async function fetchAddonsFromConfig(dishId: number): Promise<Topping[]> {
  const diRes = await supabase
    .from("dish_ingredients")
    .select(`
      ingredient_id,
      category,
      ingredients:ingredients_nutrition(
        name,
        image_path,
        kcal_100g,
        protein_g_100g,
        fat_g_100g,
        carbs_g_100g
      )
    `)
    .eq("dish_id", dishId);

  if (diRes.error) return [];

  const rows = (diRes.data ?? []) as any[];
  const addonRows = rows.filter(r => String(r?.category ?? "").toLowerCase() !== "base");

  const idSet = new Set<number | string>();
  const ingredientInfo: Record<string | number, any> = {};
  for (const r of addonRows) {
    idSet.add(r.ingredient_id);
    ingredientInfo[r.ingredient_id] = r.ingredients || null;
  }
  const ids = Array.from(idSet);
  if (ids.length === 0) return [];

  const cfgRes = await supabase
    .from("ingredient_addon_config")
    .select("ingredient_id, step_g, price_vnd_per_step, min_steps, max_steps, is_active")
    .in("ingredient_id", ids as any[])
    .eq("is_active", true);

  if (cfgRes.error || !(cfgRes.data?.length)) return [];

  return (cfgRes.data ?? []).map((row: any) => {
    const info = ingredientInfo[row.ingredient_id] || {};
    const step = Number(row.step_g ?? 20);
    const f = step / 100;

    const kcal100    = Number(info?.kcal_100g       ?? 0);
    const protein100 = Number(info?.protein_g_100g  ?? 0);
    const fat100     = Number(info?.fat_g_100g      ?? 0);
    const carbs100   = Number(info?.carbs_g_100g    ?? 0);

    const key = toBucketKey("ingredients", info?.image_path) || ING_DEFAULT_KEY;

    return {
      id: row.ingredient_id,
      name: info?.name ?? "Nguyên liệu",
      image_key: key,
      amount_per_unit_g: step,
      extra_price_vnd: Number(row.price_vnd_per_step ?? 0),
      kcal_pu:   kcal100   * f,
      protein_pu:protein100* f,
      fat_pu:    fat100    * f,
      carbs_pu:  carbs100  * f,
      min_steps: row.min_steps ?? 0,
      max_steps: row.max_steps ?? null,
    } as Topping;
  });
}

export default function DishDetail() {
  const { id, name: nameParam } =
    useLocalSearchParams<{ id: string; name?: string }>();
  const dishId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [dish, setDish] = useState<DishRow | null>(null);

  const [toppings, setToppings] = useState<Topping[]>([]);
  const [counts, setCounts] = useState<Record<string | number, number>>({});

  // tồn kho món
  const [dishAvail, setDishAvail] = useState<number | null>(null);
  const [hadAddonSlots, setHadAddonSlots] = useState<boolean>(false);

  // === SỐ LƯỢNG ĐANG CÓ TRONG GIỎ CHO MÓN NÀY (để chặn vượt)
  const { items } = useCart();
  const inCartQtyForDish = useMemo(
    () => items.filter(it => it.dish_id === dishId).reduce((s, it) => s + (it.qty || 0), 0),
    [items, dishId]
  );

  const FOOTER_H = 96 + insets.bottom;

  // Lấy tồn kho món từ v_dish_available
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("v_dish_available")
          .select("dish_id,available_servings")
          .eq("dish_id", dishId)
          .limit(1);
        if (!alive) return;
        if (!error && (data?.length ?? 0) > 0) {
          setDishAvail(data![0].available_servings ?? null);
        } else {
          setDishAvail(null); // null = không giới hạn
        }
      } catch {
        if (alive) setDishAvail(null);
      }
    })();
    return () => { alive = false; };
  }, [dishId]);

  // Kiểm tra có “slot add-on”
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("dish_ingredients")
          .select("category")
          .eq("dish_id", dishId);
        if (!alive) return;
        if (!error) {
          const has = (data ?? []).some((r: any) => String(r?.category ?? "").toLowerCase() !== "base");
          setHadAddonSlots(has);
        } else {
          setHadAddonSlots(false);
        }
      } catch {
        if (alive) setHadAddonSlots(false);
      }
    })();
    return () => { alive = false; };
  }, [dishId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);

        // 1) món (lấy giá + stock fallback)
        const colsWithPrice = "id,name,image_path,price_vnd,stock_mode,stock_units";
        const colsNoPrice   = "id,name,image_path,stock_mode,stock_units";
        let d: any | null = null;
        const r1 = await supabase.from("dishes").select(colsWithPrice).eq("id", dishId).single();
        if (r1.error && (r1.error.message || "").includes("price_vnd")) {
          const r2 = await supabase.from("dishes").select(colsNoPrice).eq("id", dishId).single();
          if (r2.error) throw r2.error;
          d = { ...r2.data, price_vnd: 0 };
        } else if (r1.error) throw r1.error; else d = r1.data;

        if (!alive) return;
        setDish(d);

        // 2) dinh dưỡng base 1 suất
        const nutRes = await supabase
          .from("dish_nutrition_default")
          .select("kcal,protein,fat,carbs,serving_size_g")
          .eq("dish_id", dishId)
          .limit(1);
        if (!nutRes.error) {
          const nut = nutRes.data?.[0] ?? null;
          if (alive && nut) setDish((prev) => (prev ? { ...prev, ...nut } : prev));
        }

        // 3) danh sách add-on
        let tops: Topping[] = [];

        tops = await fetchAddonsFromConfig(dishId);

        if (tops.length === 0) {
          const v = await supabase
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
          if (!v.error && (v.data?.length ?? 0) > 0) {
            tops = (v.data ?? []).map((row: any) => ({
              id: row.ingredient_id,
              name: row.name,
              image_key: toBucketKey("ingredients", row.image_path) || ING_DEFAULT_KEY,
              amount_per_unit_g: Number(row.step_g ?? 0),
              extra_price_vnd:   Number(row.price_vnd_per_step ?? 0),
              kcal_pu:           Number(row.kcal_per_step ?? 0),
              protein_pu:        Number(row.protein_per_step_g ?? 0),
              fat_pu:            Number(row.fat_per_step_g ?? 0),
              carbs_pu:          Number(row.carbs_per_step_g ?? 0),
              min_steps:         row.min_steps,
              max_steps:         row.max_steps,
            }));
          }
        }

        if (tops.length === 0) {
          const di = await supabase
            .from("dish_ingredients")
            .select(`
              ingredient_id,
              category,
              min_steps,
              max_steps,
              step_g,
              price_vnd_per_step,
              ingredients:ingredients_nutrition(name,image_path)
            `)
            .eq("dish_id", dishId);
          if (!di.error && (di.data?.length ?? 0) > 0) {
            const rows2 = (di.data as any[]).filter(r => String(r?.category ?? "").toLowerCase() !== "base");
            tops = rows2.map((row: any) => ({
              id: row.ingredient_id,
              name: row?.ingredients?.name ?? "Nguyên liệu",
              image_key: toBucketKey("ingredients", row?.ingredients?.image_path) || ING_DEFAULT_KEY,
              amount_per_unit_g: Number(row.step_g ?? 20),
              extra_price_vnd:   Number(row.price_vnd_per_step ?? 0),
              kcal_pu: 0, protein_pu: 0, fat_pu: 0, carbs_pu: 0,
              min_steps: row.min_steps ?? 0,
              max_steps: row.max_steps ?? null,
            }));
          }
        }

        // 4) gắn tồn kho add-on
        if (tops.length > 0) {
          const ids = Array.from(new Set(tops.map(t => Number(t.id))));
          const stockRes = await supabase
            .from("ingredients_nutrition")
            .select("id, stock_g")
            .in("id", ids as any[]);
          const stockMap = new Map<number, number>();
          (stockRes.data ?? []).forEach((r:any) => stockMap.set(Number(r.id), Number(r.stock_g || 0)));

          const enriched = tops.map(t => {
            const step = Number(t.amount_per_unit_g || 0);
            const stockG = Number(stockMap.get(Number(t.id)) ?? 0);
            const avail = step > 0 ? Math.floor(stockG / step) : 0;
            return { ...t, stock_g: stockG, avail_steps: avail } as Topping;
          });

          const filtered = enriched.filter(t => {
            const minSteps = Math.max(0, t.min_steps ?? 0);
            return (t.avail_steps ?? 0) >= minSteps;
          });

          if (alive) {
            setToppings(filtered);
            setCounts(Object.fromEntries(filtered.map(t => [t.id, Math.max(0, t.min_steps ?? 0)])));
          }
        } else {
          if (alive) {
            setToppings([]);
            setCounts({});
          }
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
  const basePrice = n0(dish?.price_vnd);
  const pricePerDish = basePrice + extraPerDishVnd;

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

  // ===== Disable điều kiện =====
  const dishOutByMode = (dish?.stock_mode === "DISH") && Number(dish?.stock_units ?? 0) <= 0;
  const dishOutByView = (dishAvail != null && Number(dishAvail) <= 0);
  const dishOut = dishOutByMode || dishOutByView;

  // 🔒 chặn vượt khi đã có sẵn trong giỏ
  const leftForCart = dishAvail == null ? null : Math.max(0, Number(dishAvail) - inCartQtyForDish);
  const overByCart  = dishAvail != null && leftForCart <= 0;

  const addonsAllUnavailable = hadAddonSlots && toppings.length === 0;
  const addDisabled = dishOut || addonsAllUnavailable || overByCart;

  const incTop = (tid: string | number, max?: number | null) =>
    setCounts(prev => {
      const t = toppings.find(x => String(x.id) === String(tid));
      const cur = prev[tid] || 0;
      const hardMax = max ?? 99;
      const stockMax = t?.avail_steps ?? 0;
      const practicalMax = Math.min(hardMax, stockMax);
      if (addDisabled || cur >= practicalMax) return prev;
      return { ...prev, [tid]: cur + 1 };
    });

  const decTop = (tid: string | number, min?: number | null) =>
    setCounts(prev => {
      const cur = prev[tid] || 0;
      const lim = (min ?? 0);
      if (addDisabled || cur <= lim) return prev;
      return { ...prev, [tid]: cur - 1 };
    });

  const doAddToCart = async () => {
    if (!dish) return;

    if (addDisabled) {
      const msg =
        dishOut ? "Món đã hết hàng"
        : overByCart ? "Bạn đã thêm tối đa số suất có thể đặt."
        : "Tạm hết nguyên liệu add-on";
      Alert.alert("Không thể thêm", msg);
      return;
    }

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
      const ok = await addToCartChecked({
        dish_id: dish.id,
        name: dish.name,
        image_path: dish.image_path ?? null,
        base_price_vnd: basePrice,
        qty: 1,
        addons,
        kcal: totalNutriPerDish.kcal,
        protein: totalNutriPerDish.protein,
        fat: totalNutriPerDish.fat,
        carbs: totalNutriPerDish.carbs,
        serving_size_g: dish.serving_size_g ?? null,
        no_merge: true,
      }, true); // verifyWithServer = true

      if (!ok) {
        Alert.alert("Không thể thêm", "Món này không còn đủ suất.");
        return;
      }

      Alert.alert("Đã thêm vào giỏ", dish.name);
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

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* HEADER */}
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

      {/* NỘI DUNG: danh sách add-on */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 96 + insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Banner cảnh báo */}
        {addDisabled && (
          <View style={{ padding:10, borderRadius:10, borderWidth:1, borderColor:"#FECACA", backgroundColor:"#FEF2F2", marginBottom:8 }}>
            <Text style={{ color:"#B91C1C", fontWeight:"700" }}>
              {dishOut ? "Món đã hết hàng"
               : overByCart ? "Bạn đã thêm tối đa số suất có thể đặt."
               : "Tạm hết nguyên liệu add-on"}
            </Text>
            {inCartQtyForDish > 0 && (
              <Text style={{ color:"#B91C1C", marginTop:2 }}>
                Trong giỏ: {inCartQtyForDish}
              </Text>
            )}
          </View>
        )}

        <View style={{ opacity: addDisabled ? 0.55 : 1 }}>
          <View style={{ borderRadius: 12, overflow: "hidden", backgroundColor: C.white, borderWidth: 1, borderColor: C.line }}>
            {toppings.length === 0 ? (
              <View style={{ padding: 14 }}>
                <Text style={{ color: C.sub }}>
                  {hadAddonSlots ? "Tạm hết nguyên liệu add-on." : "Món này chưa có add-on."}
                </Text>
              </View>
            ) : (
              toppings.map((t, idx) => {
                const c = counts[t.id] || 0;
                const gramsAdded   = c * t.amount_per_unit_g;
                const kcalAdded    = c * t.kcal_pu;
                const carbsAdded   = c * t.carbs_pu;
                const fatAdded     = c * t.fat_pu;
                const proteinAdded = c * t.protein_pu;
                const moneyAdded   = c * t.extra_price_vnd;

                const last = idx === toppings.length - 1;

                const hardMax = t.max_steps ?? 99;
                const stockMax = t.avail_steps ?? 0;
                const practicalMax = Math.min(hardMax, stockMax);

                const canInc = !addDisabled && c < practicalMax;
                const canDec = !addDisabled && c > (t.min_steps ?? 0);

                return (
                  <View key={String(t.id)} style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderColor: C.line, backgroundColor: "#FBF7F0" }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", backgroundColor: C.white }}>
                        <AddonImg imageKey={t.image_key} />
                      </View>

                      <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Text style={{ color: C.text, fontWeight: "600" }}>{t.name}</Text>
                        <Text style={{ color: C.sub, marginTop: 2, fontSize: 12 }}>
                          +{fmtVND(t.extra_price_vnd)}
                          {t.amount_per_unit_g ? ` · ~${round1(t.amount_per_unit_g)}g` : ""}
                          <> · {round1(t.kcal_pu)} kcal, {round1(t.carbs_pu)}g C, {round1(t.fat_pu)}g F, {round1(t.protein_pu)}g P</>
                          {t.max_steps != null ? ` · tối đa ${t.max_steps} bước` : ""}
                          {t.avail_steps != null ? ` · còn ~${t.avail_steps} bước` : ""}
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
                      <View style={{ marginTop: 6, marginLeft: 76 }}>
                        <Text style={{ color: C.text, fontSize: 12 }}>
                          Đã thêm: <Text style={{ fontWeight: "700" }}>{round1(gramsAdded)}g</Text>
                          {" · "}+{round1(kcalAdded)} kcal · {round1(carbsAdded)}g C · {round1(fatAdded)}g F · {round1(proteinAdded)}g P
                          {" · "}+{fmtVND(moneyAdded)}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      {/* FOOTER */}
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
        {/* 🔕 chỉ hiện “Trong giỏ: X” */}
        {inCartQtyForDish > 0 && (
          <Text style={{ color: C.sub, marginBottom: 6 }}>
            Trong giỏ: {inCartQtyForDish}
          </Text>
        )}

        <View style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 18, fontWeight: "800", color: C.text }}>
            {fmtVND(pricePerDish)}
          </Text>
        </View>

        <Pressable
          disabled={addDisabled}
          onPress={doAddToCart}
          style={{
            width: "100%",
            paddingVertical: 12,
            paddingHorizontal: 18,
            backgroundColor: addDisabled ? "#9CA3AF" : C.accent,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: C.white, fontWeight: "700" }}>
            {dishOut ? "Hết hàng"
             : addonsAllUnavailable ? "Tạm hết nguyên liệu"
             : overByCart ? "Đã đủ suất trong giỏ"
             : "Thêm vào giỏ hàng"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
