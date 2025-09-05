// app/(tabs)/profile.tsx
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { View, Text, Pressable, ActivityIndicator, SectionList, RefreshControl, Alert, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { supabase } from "../../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", dark:"#111827" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};

const LOGIN_PATH = "/(auth)/login";

const TABS = [
  { key: "paid",     label: "Đã thanh toán", icon: "check-circle" as const },
  { key: "canceled", label: "Đã hủy",        icon: "x-circle" as const },
  { key: "cod",      label: "COD",           icon: "dollar-sign" as const },
] as const;
type TabKey = typeof TABS[number]["key"];

type OrderRow = {
  id: number;
  user_id?: string | null;
  // order_code?: string | null;  // ❌ Không dùng nữa để tránh lệch
  status_norm?: "paid" | "pending" | "canceled" | "other" | null;
  payment_method?: string | null;
  payment_method_norm?: "cod" | "online" | "bank" | "other" | null;
  created_at?: string | null;
  paid_at?: string | null;
  total_vnd?: number | null;
};

type OrderItemRow = {
  id: number;
  order_id: number;
  dish_id?: number | null;
  dish_name?: string | null;
  name?: string | null;
  qty?: number | null;
  quantity?: number | null;
  line_total_vnd?: number | null;
  addons_text?: string | null;
};

const statusLabel = (s?:string|null) => {
  const v = String(s||"");
  if (v==="paid") return "ĐÃ THANH TOÁN";
  if (v==="pending") return "ĐANG THU";
  if (v==="canceled") return "ĐÃ HỦY";
  if (v==="other") return "KHÁC";
  return v.toUpperCase();
};
const itemName = (it: OrderItemRow) => it.dish_name ?? it.name ?? (it.dish_id ? `Món #${it.dish_id}` : "Món");
const itemQty  = (it: OrderItemRow) => (typeof it.qty === "number" ? it.qty : it.quantity) ?? 1;

// ✅ Hiển thị mã đơn LUÔN từ orders.id
const displayCodeFromId = (id: number) => `SAL_${String(id).padStart(6, "0")}`;

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const [session, setSession] = useState<Session|null>(null);
  const [booting, setBooting] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription?.unsubscribe();
  }, []);

  const [tab, setTab] = useState<TabKey>("paid");
  const [items, setItems] = useState<OrderRow[]>([]);
  const [itemsByOrder, setItemsByOrder] = useState<Record<number, OrderItemRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE = 20;

  const load = useCallback(async (reset=false) => {
    if (!session?.user?.id) { setItems([]); setItemsByOrder({}); setHasMore(false); return; }
    const uid = session.user.id;
    const from = reset ? 0 : page*PAGE;
    const to   = from + PAGE - 1;

    setLoading(true);

    // ❗ Không lấy order_code nữa để tránh phụ thuộc dữ liệu cũ
    let q = supabase
      .from("v_orders_history")
      .select("id, user_id, status_norm, payment_method, payment_method_norm, created_at, paid_at, total_vnd")
      .eq("user_id", uid)
      .order("id", { ascending: false })
      .range(from, to);

    if (tab === "paid")      q = q.eq("status_norm", "paid");
    if (tab === "canceled")  q = q.eq("status_norm", "canceled");
    if (tab === "cod")       q = q.eq("payment_method_norm", "cod");

    const { data, error } = await q;

    if (error) {
      setLoading(false);
      if (reset) setPage(0);
      Alert.alert("Lỗi", error.message);
      return;
    }

    const orders = (data ?? []) as OrderRow[];
    setItems(prev => reset ? orders : [...prev, ...orders]);
    setHasMore(orders.length === PAGE);

    if (orders.length) {
      const orderIds = orders.map(o => o.id);
      const { data: rowsItems, error: errItems } = await supabase
        .from("order_lines")
        .select("*")
        .in("order_id", orderIds);

      if (!errItems) {
        setItemsByOrder(prev => {
          const next: Record<number, OrderItemRow[]> = reset ? {} : { ...prev };
          for (const it of (rowsItems ?? []) as OrderItemRow[]) {
            (next[it.order_id] ||= []).push(it);
          }
          Object.values(next).forEach(arr => arr.sort((a,b)=> (a.id||0)-(b.id||0)));
          return next;
        });
      } else {
        console.warn(errItems);
      }
    }

    setLoading(false);
    if (reset) setPage(0);
  }, [session, tab, page]);

  useEffect(()=>{ setItems([]); setItemsByOrder({}); setHasMore(true); setPage(0); load(true); }, [tab, session?.user?.id]);
  useEffect(()=>{ if(page>0) load(false); }, [page]);

  const onRefresh = async ()=>{ setRefreshing(true); await load(true); setRefreshing(false); };

  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      const { error } = await supabase.auth.signOut();
      setSigningOut(false);
      if (error) Alert.alert("Đăng xuất thất bại", error.message);
    } catch (e:any) {
      setSigningOut(false);
      Alert.alert("Đăng xuất thất bại", String(e?.message ?? e));
    }
  };

  // nhóm theo ngày
  const sections = useMemo(() => {
    const byDate: Record<string, OrderRow[]> = {};
    for (const o of items) {
      const d = new Date(o.created_at ?? o.paid_at ?? Date.now());
      const key = d.toISOString().slice(0,10);
      (byDate[key] ||= []).push(o);
    }
    return [
      { key: "settings", title: "Cài đặt", data: ["email","signout"] as const },
      ...Object.entries(byDate)
        .sort((a,b)=> (a[0] < b[0] ? 1 : -1))
        .map(([date, data]) => ({ key: `orders-${date}`, title: date, data })),
    ] as const;
  }, [items]);

  const HeaderBar = () => (
    <View style={{ paddingTop: insets.top + 12, paddingBottom: 12, paddingHorizontal: 16, backgroundColor: C.panel, borderBottomWidth: 1, borderColor: C.line }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: C.text }}>Hồ sơ</Text>
    </View>
  );

  const TabsBar = () => (
    <View style={{ backgroundColor: C.panel, borderBottomWidth: 1, borderColor: C.line }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
      >
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? C.dark : C.line,
                backgroundColor: active ? C.dark : "#fff",
                flexDirection: "row",
                alignItems: "center",
                gap: 8
              }}
            >
              <Feather name={t.icon} size={14} color={active ? "#fff" : C.text} />
              <Text style={{ color: active ? "#fff" : C.text, fontWeight: "800", fontSize: 13 }}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const OrderCard = ({ item }: { item: OrderRow }) => {
    const oid = item.id;                              // ✅ nguồn sự thật
    const code = displayCodeFromId(oid);              // ✅ SAL_xxxxxx từ id
    const total = Number(item.total_vnd ?? 0);
    const when = item.paid_at || item.created_at || null;
    const finalStatus = (item.status_norm ?? "other") as "paid" | "pending" | "canceled" | "other";

    const pill =
      finalStatus === "paid"
        ? { bg: "#eafaf0", bd: "#b7f0c9", tx: "#166534" }
        : finalStatus === "canceled"
        ? { bg: "#fee2e2", bd: "#fecaca", tx: "#991b1b" }
        : finalStatus === "pending"
        ? { bg: "#fef3c7", bd: "#fde68a", tx: "#92400e" }
        : { bg: "#e5e7eb", bd: "#d1d5db", tx: "#374151" };

    const its = itemsByOrder[oid] || [];
    const compact = its.map(it => ({
      id: it.id,
      dish_id: it.dish_id,
      dish_name: it.dish_name,
      name: it.name,
      qty: typeof it.qty === "number" ? it.qty : (it.quantity ?? 1),
      line_total_vnd: Number(it.line_total_vnd ?? 0),
      addons_text: it.addons_text ?? ""
    }));
    const itsParam = encodeURIComponent(JSON.stringify(compact));

    return (
      <Pressable
        onPress={() => router.push({ pathname: "/bill/[id]", params: { id: String(oid), its: itsParam } })}
        android_ripple={{ color: "#eee" }}
        style={{ padding: 14, marginHorizontal: 16, marginTop: 8, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.line }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", color: C.text }}>{code}</Text>
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: pill.bg, borderWidth: 1, borderColor: pill.bd }}>
            <Text style={{ fontSize: 12, fontWeight: "800", color: pill.tx }}>{statusLabel(finalStatus)}</Text>
          </View>
        </View>

        <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <Text style={{ color: C.sub, flex: 1 }}>{when ? new Date(when).toLocaleString("vi-VN") : "—"}</Text>
          {total > 0 ? <Text style={{ color: C.text, fontWeight: "800" }}>{fmtVnd(total)}</Text> : null}
        </View>

        <View style={{ marginTop: 10, gap: 8 }}>
          {its.length === 0 ? (
            <Text style={{ color: C.sub, fontStyle: "italic" }}>Không tìm thấy danh sách món</Text>
          ) : its.map((it) => (
            <View key={it.id} style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <Text style={{ color: C.sub, marginRight: 8 }}>•</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text }}>
                  {itemName(it)} <Text style={{ color: C.sub }}>x{itemQty(it)}</Text>
                </Text>
                {!!it.addons_text && (
                  <Text style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>{it.addons_text}</Text>
                )}
              </View>
              {typeof it.line_total_vnd === "number" && (
                <Text style={{ color: C.text, fontWeight: "600", marginLeft: 8 }}>
                  {fmtVnd(Number(it.line_total_vnd ?? 0))}
                </Text>
              )}
            </View>
          ))}
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: C.sub, fontSize: 12 }}>Chạm để xem chi tiết hóa đơn</Text>
        </View>
      </Pressable>
    );
  };

  if (booting) {
    return <View style={{ flex: 1, backgroundColor: C.bg, alignItems:"center", justifyContent:"center" }}><ActivityIndicator /></View>;
  }
  if (!session?.user) {
    return <Redirect href={LOGIN_PATH} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <HeaderBar />
      <TabsBar />

      <SectionList
        sections={sections as any}
        keyExtractor={(item, index) => typeof item === "string" ? `setting-${item}-${index}` : `order-${(item as OrderRow).id}`}
        renderSectionHeader={({ section }) => {
          if (section.key === "settings") {
            return (
              <View style={{ backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: "900", color: C.text }}>Cài đặt</Text>
              </View>
            );
          }
          return (
            <View style={{ backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "900", color: C.text }}>
                {new Date(section.title as string).toLocaleDateString("vi-VN", { weekday:"short", year:"numeric", month:"2-digit", day:"2-digit" })}
              </Text>
            </View>
          );
        }}
        renderItem={({ item, section }) => {
          if (section.key === "settings") {
            if (item === "email") return (
              <View style={{ backgroundColor: "#fff", marginHorizontal: 16, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Feather name="user" size={16} color={C.sub} />
                  <Text style={{ marginLeft: 8, color: C.sub }}>{session?.user?.email ? String(session.user.email) : "Chưa có email"}</Text>
                </View>
              </View>
            );
            if (item === "signout") return (
              <Pressable
                onPress={handleSignOut}
                disabled={signingOut}
                style={{ backgroundColor: "#fff", marginHorizontal: 16, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", opacity: signingOut ? 0.6 : 1 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Feather name="log-out" size={16} color="#b91c1c" />
                  <Text style={{ marginLeft: 10, color: "#b91c1c", fontWeight: "800" }}>{signingOut ? "Đang đăng xuất..." : "Đăng xuất"}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={C.sub} />
              </Pressable>
            );
            return null;
          }
          return <OrderCard item={item as OrderRow} />;
        }}
        contentContainerStyle={{ paddingBottom: tabBarHeight + insets.bottom + 24, paddingTop: 8 }}
        stickySectionHeadersEnabled
        onEndReachedThreshold={0.2}
        onEndReached={() => { if (!loading && hasMore) setPage(p => p + 1); }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListFooterComponent={(loading || hasMore) ? <View style={{ paddingVertical: 16 }}>{loading ? <ActivityIndicator /> : null}</View> : null}
        ListEmptyComponent={!loading && items.length === 0 ? (
          <View style={{ alignItems:"center", justifyContent:"center", padding:24 }}>
            <Feather name="inbox" size={34} color={C.sub} />
            <Text style={{ color:C.sub, marginTop:8 }}>Chưa có đơn hàng nào</Text>
          </View>
        ) : null}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}
