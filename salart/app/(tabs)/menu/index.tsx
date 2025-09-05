import React, { useEffect, useMemo, useState, useCallback, memo } from "react";
import {
  ActivityIndicator, Alert, Pressable,
  ScrollView, Text, TextInput, View, StatusBar, Dimensions, PixelRatio, InteractionManager
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";

type Dish = {
  id: number;
  name: string;
  image_path?: string | null;
  base: string[];
  topping: string[];
  serving_size_g?: number | null;
  kcal?: number | null;
  protein?: number | null;
  fat?: number | null;
  carbs?: number | null;
};

const CHIP_ITEMS = ["Nổi bật", "Salad", "Tự chọn", "Đồ uống"] as const;
const BG   = "#d6d0b4ff";
const PAD  = 16;
const FONT = { title: 30, sauce: 17, label: 16, text: 16, pill: 13, brand: 14 };
const IMAGE_BUCKET = "dishes";
const FALLBACK =
  "https://images.unsplash.com/photo-1551218808-94e220e084d2?q=80&w=1200&auto=format&fit=crop";

const SCREEN_W   = Dimensions.get("window").width;
const CARD_W     = SCREEN_W - 24;
const IMG_W      = CARD_W - PAD * 2;
const DPR        = Math.min(2, PixelRatio.get());
const SCALE_DOWN = 0.72;
const LQIP_W     = 24;

const SUPA_PUBLIC_RE = new RegExp(`^https?://[^?]+/storage/v1/object/public/${IMAGE_BUCKET}/`, "i");
const SUPA_SIGN_RE   = new RegExp(`^https?://[^?]+/storage/v1/object/sign/${IMAGE_BUCKET}/`, "i");
function toBucketKey(p?: string | null) {
  let key = String(p || "").trim();
  if (!key) return "";
  key = key.replace(SUPA_PUBLIC_RE, "").replace(SUPA_SIGN_RE, "");
  key = key.replace(/^\/+/, "");
  if (!key.includes("/")) key = `dishes/${key}`;
  key = key.replace(/^dishes\/(?:dishes\/)+/i, "dishes/");
  return key;
}
function buildUrl(path: string, opts: { w: number; q: number; resize: "cover" | "contain"; webp?: boolean }) {
  const key = toBucketKey(path);
  if (!key) return FALLBACK;
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(key, {
    transform: { width: opts.w, quality: opts.q, resize: opts.resize, ...(opts.webp ? { format: "webp" as const } : {}) },
  }).data.publicUrl;
}
function urlMainWebp(path?: string | null) {
  if (!path) return FALLBACK;
  const targetW = Math.max(420, Math.round(IMG_W * DPR * SCALE_DOWN));
  return buildUrl(path, { w: targetW, q: 70, resize: "contain", webp: true });
}
function urlMainFallback(path?: string | null) {
  if (!path) return FALLBACK;
  const targetW = Math.max(420, Math.round(IMG_W * DPR * SCALE_DOWN));
  return buildUrl(path, { w: targetW, q: 80, resize: "contain" });
}
function urlTiny(path?: string | null, webp = true) {
  if (!path) return FALLBACK;
  return buildUrl(path, { w: LQIP_W, q: 20, resize: "contain", webp });
}
function fmt1(x?: number | null) {
  if (x == null) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(1);
}

const SWAP_PAIR_IDX: [number, number] = [1, 2];
function swapByIndex<T>(arr: T[], [i, j]: [number, number]) {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export default function MenuScreen() {
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof CHIP_ITEMS)[number]>("Nổi bật");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [items, setItems] = useState<Dish[]>([]);

  const insets = useSafeAreaInsets();
  const tabH = useBottomTabBarHeight();
  const TAB_PLATE_BASE = 110;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      // 1) dishes
      let dishes: any[] = [];
      const colsWithOrder = "id,name,image_path,display_order";
      const colsFallback  = "id,name,image_path";
      const d1 = await supabase
        .from("dishes")
        .select(colsWithOrder)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true });
      if (d1.error && (d1.error.message || "").toLowerCase().includes("display_order")) {
        const d2 = await supabase.from("dishes").select(colsFallback).order("id", { ascending: true });
        if (d2.error) throw d2.error;
        dishes = d2.data ?? [];
      } else if (d1.error) {
        throw d1.error;
      } else {
        dishes = d1.data ?? [];
      }

      // 2) Thành phần (lấy ingredient_id để join config)
      const ingRes = await supabase
        .from("dish_ingredients")
        .select(`
          dish_id,
          ingredient_id,
          category,
          ingredients:ingredients_nutrition(
            name,
            kcal_100g,
            protein_g_100g,
            fat_g_100g,
            carbs_g_100g
          )
        `)
        .order("dish_id");
      if (ingRes.error) throw ingRes.error;

      // a) nhóm tên base/topping
      const grouped: Record<number, { base: string[]; topping: string[] }> = {};
      // b) map dinh dưỡng 100g theo ingredient
      const nutri100ByIng: Record<number, { kcal:number; protein:number; fat:number; carbs:number }> = {};
      // c) map dish -> danh sách ingredient_id (không base), đã khử trùng lặp
      const nonBaseByDish: Record<number, number[]> = {};

      for (const row of (ingRes.data ?? []) as any[]) {
        const dishId = Number(row.dish_id);
        const ingId  = Number(row.ingredient_id);
        const name   = row.ingredients?.name as string | undefined;
        const cat    = String(row.category ?? "").toLowerCase();

        if (name) {
          if (!grouped[dishId]) grouped[dishId] = { base: [], topping: [] };
          (cat === "base" ? grouped[dishId].base : grouped[dishId].topping).push(name);
        }

        nutri100ByIng[ingId] = {
          kcal:    Number(row.ingredients?.kcal_100g      ?? 0),
          protein: Number(row.ingredients?.protein_g_100g ?? 0),
          fat:     Number(row.ingredients?.fat_g_100g     ?? 0),
          carbs:   Number(row.ingredients?.carbs_g_100g   ?? 0),
        };

        if (cat !== "base") {
          if (!nonBaseByDish[dishId]) nonBaseByDish[dishId] = [];
          if (!nonBaseByDish[dishId].includes(ingId)) nonBaseByDish[dishId].push(ingId);
        }
      }
      for (const g of Object.values(grouped)) {
        g.base = Array.from(new Set(g.base));
        g.topping = Array.from(new Set(g.topping));
      }

      // 3) dinh dưỡng "base" từ dish_nutrition_default — cộng dồn theo dish_id
      const ids = dishes.map((d: any) => d.id);
      const nutriMap: Record<number, {kcal:number;protein:number;fat:number;carbs:number;serving_size_g:number}> = {};
      if (ids.length) {
        const defsRes = await supabase
          .from("dish_nutrition_default")
          .select("dish_id,kcal,protein,fat,carbs,serving_size_g")
          .in("dish_id", ids);
        if (defsRes.error) throw defsRes.error;

        for (const r of defsRes.data ?? []) {
          const cur = nutriMap[r.dish_id] ?? { kcal:0, protein:0, fat:0, carbs:0, serving_size_g:0 };
          cur.kcal           += Number(r.kcal ?? 0);
          cur.protein        += Number(r.protein ?? 0);
          cur.fat            += Number(r.fat ?? 0);
          cur.carbs          += Number(r.carbs ?? 0);
          cur.serving_size_g += Number(r.serving_size_g ?? 0);
          nutriMap[r.dish_id] = cur;
        }
      }

      // 4) cộng thêm dinh dưỡng từ ADD-ON MẶC ĐỊNH (ingredient_addon_config.min_steps * step_g)
      const allNonBaseIngIds = Array.from(new Set(Object.values(nonBaseByDish).flat()));
      if (allNonBaseIngIds.length > 0) {
        const cfgRes = await supabase
          .from("ingredient_addon_config")
          .select("ingredient_id, step_g, min_steps, is_active")
          .in("ingredient_id", allNonBaseIngIds as any[])
          .eq("is_active", true);

        if (!cfgRes.error) {
          // build map cấu hình để tra nhanh
          const cfgByIng = new Map<number, { min:number; step:number }>();
          for (const r of (cfgRes.data ?? [])) {
            const ingId = Number((r as any).ingredient_id);
            cfgByIng.set(ingId, {
              min:  Number((r as any).min_steps ?? 0),
              step: Number((r as any).step_g ?? 0),
            });
          }

          for (const [dishIdStr, ingIds] of Object.entries(nonBaseByDish)) {
            const dishId = Number(dishIdStr);
            let add = { kcal:0, protein:0, fat:0, carbs:0, grams:0 };

            for (const ingId of ingIds) {
              const cfg = cfgByIng.get(Number(ingId));
              if (!cfg) continue;
              const grams = cfg.min * cfg.step;
              if (grams <= 0) continue;

              const n = nutri100ByIng[Number(ingId)] ?? { kcal:0, protein:0, fat:0, carbs:0 };
              const f = grams / 100;
              add.kcal    += n.kcal    * f;
              add.protein += n.protein * f;
              add.fat     += n.fat     * f;
              add.carbs   += n.carbs   * f;
              add.grams   += grams;
            }

            if (add.grams > 0) {
              const cur = nutriMap[dishId] ?? { kcal:0, protein:0, fat:0, carbs:0, serving_size_g:0 };
              cur.kcal           += add.kcal;
              cur.protein        += add.protein;
              cur.fat            += add.fat;
              cur.carbs          += add.carbs;
              cur.serving_size_g += add.grams;
              nutriMap[dishId] = cur;
            }
          }
        }
      }

      // 5) dữ liệu cho UI
      let next: Dish[] = dishes.map((d: any) => ({
        id: d.id,
        name: d.name,
        image_path: d.image_path as string | null | undefined,
        base: grouped[d.id]?.base ?? [],
        topping: grouped[d.id]?.topping ?? [],
        serving_size_g: nutriMap[d.id]?.serving_size_g ?? null,
        kcal:   nutriMap[d.id]?.kcal   ?? null,
        protein:nutriMap[d.id]?.protein?? null,
        fat:    nutriMap[d.id]?.fat    ?? null,
        carbs:  nutriMap[d.id]?.carbs  ?? null,
      }));

      if (next.length >= 3) next = swapByIndex(next, SWAP_PAIR_IDX);
      setItems(next);

      // prefetch ảnh
      next.slice(0, 3).forEach((it) => {
        Image.prefetch(urlMainWebp(it.image_path)).catch(() => {
          Image.prefetch(urlMainFallback(it.image_path)).catch(() => {});
        });
      });
    } catch (e: any) {
      Alert.alert("Lỗi tải thực đơn", e?.message ?? "Không thể tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(load);
    return () => task.cancel();
  }, [load]);

  const filtered = useMemo(() => {
    let arr = items;
    if (filter === "Đồ uống") arr = [];
    if (!debouncedQ) return arr;
    return arr.filter((it) => it.name.toLowerCase().includes(debouncedQ));
  }, [debouncedQ, items, filter]);

  const renderItem = useCallback(
    ({ item }: { item: Dish }) => <MenuCard item={item} />,
    []
  );
  const keyExtractor = useCallback((it: Dish) => String(it.id), []);

  const bottomSpace = Math.max(tabH, TAB_PLATE_BASE + (insets.bottom || 0)) + 16;

  if (loading && items.length === 0) {
    return (
      <View style={{ flex:1, alignItems:"center", justifyContent:"center", backgroundColor:"#fff" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Đang tải thực đơn…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:"#fff" }} edges={["top","left","right"]}>
      <StatusBar translucent={false} backgroundColor="#fff" barStyle="dark-content" />
      {/* Chips + Search */}
      <View style={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
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
          placeholder="Tìm món…" placeholderTextColor="#9ca3af" value={query} onChangeText={setQuery}
          style={{
            marginTop: 12, borderWidth: 1, borderColor:"#e5e7eb", backgroundColor:"#f9fafb",
            borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color:"#111827", fontSize: 16,
          }}
        />
      </View>

      {/* FlashList */}
      <FlashList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        estimatedItemSize={520}
        contentContainerStyle={{ paddingHorizontal: 0, paddingBottom: bottomSpace }}
        scrollIndicatorInsets={{ bottom: bottomSpace }}
        keyboardShouldPersistTaps="handled"
        onRefresh={load}
        refreshing={loading}
        ListFooterComponent={<View style={{ height: 8 }} />}
      />
    </SafeAreaView>
  );
}

// ===== Ảnh có fallback WebP -> JPEG/PNG (KHÔNG CROP) =====
const ImgWithFallback = ({ path, recyclingKey }: { path?: string | null; recyclingKey: string }) => {
  const [useWebp, setUseWebp] = useState(true);
  const sourceUri = useWebp ? urlMainWebp(path) : urlMainFallback(path);
  const tinyUri   = urlTiny(path, useWebp);

  return (
    <Image
      source={{ uri: sourceUri }}
      placeholder={{ uri: tinyUri }}
      placeholderContentFit="contain"
      style={{ width: "100%", aspectRatio: 4/3, borderRadius: 14 }}
      contentFit="contain"
      transition={120}
      priority="low"
      cachePolicy="immutable"
      recyclingKey={recyclingKey}
      onError={() => setUseWebp(false)}
    />
  );
};

const MenuCard = memo(function MenuCard({ item }: { item: Dish }) {
  const openDetail = () => {
    router.push({
      pathname: "/menu/[id]",
      params: { id: String(item.id), name: item.name, image: urlMainWebp(item.image_path) },
    });
  };

  return (
    <Pressable
      onPress={openDetail}
      style={{
        marginHorizontal: 12, marginBottom: 14, borderRadius: 16, overflow: "hidden",
        borderWidth: 1, borderColor: "#e5e7eb", backgroundColor: BG,
      }}
    >
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

      <View style={{ backgroundColor: BG, paddingHorizontal: PAD, paddingBottom: 12 }}>
        <ImgWithFallback path={item.image_path} recyclingKey={String(item.id)} />
      </View>

      <View style={{ marginTop: 6, marginBottom: 12, alignSelf: "center", flexDirection: "row", gap: 8 }}>
        {typeof item.serving_size_g === "number" && item.serving_size_g > 0 && (
          <Pill label={`${Math.round(item.serving_size_g)}g`} />
        )}
        {typeof item.kcal === "number"    && <Pill label={`${Math.round(item.kcal)} kcal`} />}
        {typeof item.carbs === "number"   && <Pill label={`C ${fmt1(item.carbs)}g`} />}
        {typeof item.fat === "number"     && <Pill label={`F ${fmt1(item.fat)}g`} />}
        {typeof item.protein === "number" && <Pill label={`P ${fmt1(item.protein)}g`} />}
      </View>
    </Pressable>
  );
});

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
