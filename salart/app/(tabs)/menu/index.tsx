import React, { useEffect, useMemo, useState, useCallback, memo } from "react";
import {
  ActivityIndicator, Alert, Pressable,
  ScrollView, Text, TextInput, View, StatusBar, Dimensions, PixelRatio, InteractionManager
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { addToCart } from "../../../lib/cart";
import { Image } from "expo-image";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router"; // ✅ thêm để điều hướng sang chi tiết

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

// ==== Kích thước ảnh mục tiêu (mượt + “mờ nhẹ”) ====
const SCREEN_W   = Dimensions.get("window").width;
const CARD_W     = SCREEN_W - 24;         // marginHorizontal: 12 x 2
const IMG_W      = CARD_W - PAD * 2;      // paddingHorizontal trong vùng ảnh
const DPR        = Math.min(2, PixelRatio.get()); // 2x là đủ đẹp
const SCALE_DOWN = 0.72;                  // xin ảnh nhỏ hơn -> upsample nhẹ => mờ mờ, đỡ lag
const LQIP_W     = 24;                    // placeholder siêu nhỏ để hiện ngay

// ===== Helpers build URL (ưu tiên WebP, fallback JPEG/PNG) =====
function buildUrl(path: string, opts: { w: number; q: number; resize: "cover" | "contain"; webp?: boolean }) {
  const safePath = path.replace(/^dishes\/dishes\//, "dishes/");
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(safePath, {
    transform: {
      width: opts.w,
      quality: opts.q,
      resize: opts.resize,
      ...(opts.webp ? { format: "webp" as const } : {}),
    },
  }).data.publicUrl;
}

// 👉 ĐỔI sang "contain" để không bị crop
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

export default function MenuScreen() {
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof CHIP_ITEMS)[number]>("Nổi bật");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState(""); // debounce 250ms
  const [items, setItems] = useState<Dish[]>([]);

  const insets = useSafeAreaInsets();
  const tabH = useBottomTabBarHeight();
  const TAB_PLATE_BASE = 110;
  const bottomSpace = Math.max(tabH, TAB_PLATE_BASE + (insets.bottom || 0)) + 16;

  // debounce tìm kiếm
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const addOneToCart = useCallback((item: Dish) => {
    addToCart(item.id, item.name, 1);
    Alert.alert("Đã thêm vào giỏ", `${item.name} ×1`);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      // 1) dishes + 2) ingredients (song song)
      const [dishesRes, ingRes] = await Promise.all([
        supabase.from("dishes").select("id,name,image_path").order("name"),
        supabase
          .from("dish_ingredients")
          .select("dish_id, category, ingredients:ingredients_nutrition(name)")
          .order("dish_id"),
      ]);
      if (dishesRes.error) throw dishesRes.error;
      if (ingRes.error) throw ingRes.error;

      const dishes = dishesRes.data ?? [];
      const ing = ingRes.data ?? [];

      // nhóm base/topping
      const grouped: Record<number, { base: string[]; topping: string[] }> = {};
      for (const row of ing as any[]) {
        const id = row.dish_id as number;
        const name = row.ingredients?.name as string | undefined;
        if (!name) continue;
        if (!grouped[id]) grouped[id] = { base: [], topping: [] };
        (row.category === "base" ? grouped[id].base : grouped[id].topping).push(name);
      }
      for (const g of Object.values(grouped)) {
        g.base = Array.from(new Set(g.base));
        g.topping = Array.from(new Set(g.topping));
      }

      // 3) dinh dưỡng mặc định
      const ids = dishes.map((d: any) => d.id);
      const nutriMap: Record<number, {kcal:number;protein:number;fat:number;carbs:number;serving_size_g:number}> = {};
      if (ids.length) {
        const defsRes = await supabase
          .from("dish_nutrition_default")
          .select("dish_id,kcal,protein,fat,carbs,serving_size_g")
          .in("dish_id", ids);
        if (defsRes.error) throw defsRes.error;
        for (const r of defsRes.data ?? []) {
          nutriMap[r.dish_id] = {
            kcal: Number(r.kcal ?? 0),
            protein: Number(r.protein ?? 0),
            fat: Number(r.fat ?? 0),
            carbs: Number(r.carbs ?? 0),
            serving_size_g: Number(r.serving_size_g ?? 0),
          };
        }
      }

      const next = dishes.map((d: any) => ({
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

      setItems(next);

      // Prefetch 2–3 ảnh đầu: thử webp trước (contain)
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

  // Trì hoãn load để tránh giật khung đầu phiên
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(load);
    return () => task.cancel();
  }, [load]);

  const filtered = useMemo(() => {
    let arr = items;
    if (filter === "Đồ uống") arr = []; // hiện tại chưa có
    if (!debouncedQ) return arr;
    return arr.filter((it) => it.name.toLowerCase().includes(debouncedQ));
  }, [debouncedQ, items, filter]);

  const renderItem = useCallback(
    ({ item }: { item: Dish }) => <MenuCard item={item} onAdd={addOneToCart} />,
    [addOneToCart]
  );
  const keyExtractor = useCallback((it: Dish) => String(it.id), []);

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
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
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
        contentContainerStyle={{ paddingHorizontal: 0, paddingBottom: Math.max(tabH, TAB_PLATE_BASE + (insets.bottom || 0)) + 16 }}
        scrollIndicatorInsets={{ bottom: Math.max(tabH, TAB_PLATE_BASE + (insets.bottom || 0)) + 16 }}
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
      placeholderContentFit="contain"   // không crop placeholder
      style={{ width: "100%", aspectRatio: 4/3, borderRadius: 14 }}
      contentFit="contain"              // 👈 không cắt ảnh, thấy trọn cái bát
      transition={120}
      priority="low"
      cachePolicy="immutable"
      recyclingKey={recyclingKey}
      onError={() => setUseWebp(false)} // nếu webp lỗi -> fallback
    />
  );
};

// ✅ SỬA: bọc toàn bộ card bằng Pressable để mở màn chi tiết
const MenuCard = memo(function MenuCard({
  item, onAdd,
}: {
  item: Dish;
  onAdd: (it: Dish) => void;
}) {
  const openDetail = () => {
    router.push({
      pathname: "/menu/[id]",                    // không có (tabs)
      params: {
        id: String(item.id),
        name: item.name,
        image: urlMainWebp(item.image_path),     // truyền sẵn URL ảnh đã transform
      },
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
      {/* Text block */}
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

      {/* Ảnh: LQIP + WebP ưu tiên + fallback (contain) */}
      <View style={{ backgroundColor: BG, paddingHorizontal: PAD, paddingBottom: 12 }}>
        <ImgWithFallback path={item.image_path} recyclingKey={String(item.id)} />
      </View>

      {/* Pills dinh dưỡng */}
      <View style={{ marginTop: 6, marginBottom: 12, alignSelf: "center", flexDirection: "row", gap: 8 }}>
        {typeof item.serving_size_g === "number" && item.serving_size_g > 0 && (
          <Pill label={`${Math.round(item.serving_size_g)}g`} />
        )}
        {typeof item.kcal === "number"    && <Pill label={`${Math.round(item.kcal)} kcal`} />}
        {typeof item.carbs === "number"   && <Pill label={`C ${fmt1(item.carbs)}g`} />}
        {typeof item.fat === "number"     && <Pill label={`F ${fmt1(item.fat)}g`} />}
        {typeof item.protein === "number" && <Pill label={`P ${fmt1(item.protein)}g`} />}
      </View>

      {/* Nút thêm vào giỏ: vẫn hoạt động độc lập */}
      <View style={{ paddingHorizontal: PAD, paddingBottom: PAD, flexDirection:"row", justifyContent:"flex-end" }}>
        <Pressable
          onPress={() => onAdd(item)}
          style={{ backgroundColor: "#1f2937", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 }}
        >
          <Text style={{ color: "#fff", fontWeight: "800" }}>Thêm vào giỏ</Text>
        </Pressable>
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
