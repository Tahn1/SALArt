// app/(tabs)/profile.tsx
import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, SectionList, RefreshControl, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Redirect } from "expo-router";            // ⬅️ dùng Redirect (quan trọng)
import { supabase } from "../../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", dark:"#111827" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};

// đường dẫn login theo cây app/(auth)/login.tsx
const LOGIN_PATH = "/(auth)/login";

const TABS = [
  { key: "paid",    label: "Đã thanh toán", icon: "check-circle" as const },
  { key: "canceled",label: "Đã hủy",        icon: "x-circle" as const },
  { key: "cod",     label: "COD",           icon: "dollar-sign" as const },
] as const;
type TabKey = typeof TABS[number]["key"];

type OrderRow = {
  id: number;
  order_code?: string | null;
  status_norm?: "paid" | "canceled" | "other" | null;
  payment_method?: string | null;
  payment_method_norm?: "cod" | "online" | "other" | null;
  created_at?: string | null;
  paid_at?: string | null;
  note?: any | null;
};

function parseNote(n: any){ if(!n) return {}; if(typeof n==="string"){ try{return JSON.parse(n);}catch{return{}} } return n; }
function totalFromNote(note:any){
  const o = parseNote(note);
  const v = Number([o?.GRAND_TOTAL,o?.grand_total,o?.TOTAL,o?.total].find((x:any)=>x!=null));
  return Number.isFinite(v) && v>0 ? v : 0;
}
function statusLabel(s?:string|null){
  const v = String(s||"");
  if (v==="paid") return "ĐÃ THANH TOÁN";
  if (v==="canceled") return "ĐÃ HỦY";
  if (v==="other") return "KHÁC";
  return v.toUpperCase();
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const [session, setSession] = useState<Session|null>(null);
  const [booting, setBooting] = useState(true);      // ⬅️ tránh nhấp nháy khi lấy session
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
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE = 20;

  const load = useCallback(async (reset=false) => {
    if (!session?.user?.id) { setItems([]); setHasMore(false); return; }
    const uid = session.user.id;
    const from = reset ? 0 : page*PAGE;
    const to   = from + PAGE - 1;

    setLoading(true);

    let q = supabase
      .from("v_orders_history")
      .select("id, order_code, status_norm, payment_method, payment_method_norm, created_at, paid_at, note")
      .eq("user_id", uid)
      .order("id", { ascending: false })
      .range(from, to);

    if (tab === "paid")      q = q.eq("status_norm", "paid");
    if (tab === "canceled")  q = q.eq("status_norm", "canceled");
    if (tab === "cod")       q = q.eq("payment_method_norm", "cod");

    const { data, error } = await q;
    if (!error && data) {
      setItems(prev => reset ? (data as OrderRow[]) : [...prev, ...(data as OrderRow[])]);
      setHasMore((data ?? []).length === PAGE);
    }
    setLoading(false);
    if (reset) setPage(0);
  }, [session, tab, page]);

  useEffect(()=>{ setItems([]); setHasMore(true); setPage(0); load(true); }, [tab, session?.user?.id]);
  useEffect(()=>{ if(page>0) load(false); }, [page]);

  const onRefresh = async ()=>{ setRefreshing(true); await load(true); setRefreshing(false); };

  // ======= Đăng xuất (KHÔNG điều hướng thủ công) =======
  const handleSignOut = async () => {
    try {
      setSigningOut(true);
      const { error } = await supabase.auth.signOut();
      setSigningOut(false);
      if (error) {
        Alert.alert("Đăng xuất thất bại", error.message);
      }
      // Không navigate. Khi session về null, component sẽ <Redirect /> tự động.
    } catch (e:any) {
      setSigningOut(false);
      Alert.alert("Đăng xuất thất bại", String(e?.message ?? e));
    }
  };

  // ======= UI =======
  const HeaderBar = () => (
    <View
      style={{
        paddingTop: insets.top + 12,
        paddingBottom: 12,
        paddingHorizontal: 16,
        backgroundColor: C.panel,
        borderBottomWidth: 1,
        borderColor: C.line,
      }}
    >
      <Text style={{ fontSize: 22, fontWeight: "800", color: C.text }}>Hồ sơ</Text>
    </View>
  );

  const SettingsSectionHeader = () => (
    <View style={{ backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "900", color: C.text }}>Cài đặt</Text>
    </View>
  );

  const OrdersSectionHeader = () => (
    <View style={{ backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "900", color: C.text }}>Lịch sử đơn hàng</Text>
      <View
        style={{
          marginTop: 12,
          backgroundColor: "#F3F4F6",
          borderRadius: 12,
          padding: 4,
          borderWidth: 1,
          borderColor: C.line,
          flexDirection: "row",
        }}
      >
        {TABS.map(t => {
          const on = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                backgroundColor: on ? C.dark : "transparent",
              }}
            >
              <Feather name={t.icon} size={16} color={on ? "#fff" : C.text} />
              <Text style={{ marginLeft: 8, fontWeight: "800", color: on ? "#fff" : C.text }}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const SettingEmailRow = () => (
    <View
      style={{
        backgroundColor: "#fff",
        marginHorizontal: 16,
        marginTop: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: C.line,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Feather name="user" size={16} color={C.sub} />
        <Text style={{ marginLeft: 8, color: C.sub }}>
          {session?.user?.email ? String(session.user.email) : "Chưa có email"}
        </Text>
      </View>
    </View>
  );

  const SettingSignOutRow = () => (
    <Pressable
      onPress={handleSignOut}
      disabled={signingOut}
      style={{
        backgroundColor: "#fff",
        marginHorizontal: 16,
        marginTop: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: C.line,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        opacity: signingOut ? 0.6 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Feather name="log-out" size={16} color="#b91c1c" />
        <Text style={{ marginLeft: 10, color: "#b91c1c", fontWeight: "800" }}>
          {signingOut ? "Đang đăng xuất..." : "Đăng xuất"}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={C.sub} />
    </Pressable>
  );

  const OrderItem = ({ item }: { item: OrderRow }) => {
    const code = item.order_code || `SAL_${String(item.id).padStart(6, "0")}`;
    const total = totalFromNote(item.note);
    const when = item.paid_at || item.created_at || null;
    const rawStatus = item.status_norm ?? "other";

    const pill =
      rawStatus === "paid"
        ? { bg: "#eafaf0", bd: "#b7f0c9", tx: "#166534" }
        : rawStatus === "canceled"
        ? { bg: "#fee2e2", bd: "#fecaca", tx: "#991b1b" }
        : { bg: "#e5e7eb", bd: "#d1d5db", tx: "#374151" };

    return (
      <View
        style={{
          padding: 14,
          marginHorizontal: 16,
          marginTop: 8,
          backgroundColor: "#fff",
          borderRadius: 12,
          borderWidth: 1,
          borderColor: C.line,
        }}
        pointerEvents="none"
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", color: C.text }}>#{code}</Text>
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: pill.bg,
              borderWidth: 1,
              borderColor: pill.bd,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "800", color: pill.tx }}>{statusLabel(rawStatus)}</Text>
          </View>
        </View>
        <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: C.sub }}>{when ? new Date(when).toLocaleString("vi-VN") : "—"}</Text>
          {total > 0 ? <Text style={{ color: C.text, fontWeight: "800" }}>{fmtVnd(total)}</Text> : null}
        </View>
      </View>
    );
  };

  // ======= Gating =======
  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems:"center", justifyContent:"center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session?.user) {
    // ⬅️ Trả về Redirect (ở cấp root) -> không còn lỗi NAVIGATE/REPLACE
    return <Redirect href={LOGIN_PATH} />;
  }

  // 2 phần: Cài đặt + Lịch sử
  const sections = [
    { key: "settings", title: "Cài đặt", data: ["email", "signout"] as const },
    { key: "orders", title: "Lịch sử đơn hàng", data: items },
  ] as const;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <HeaderBar />
      <SectionList
        sections={sections as any}
        keyExtractor={(item, index) =>
          typeof item === "string" ? `setting-${item}-${index}` : `order-${(item as OrderRow).id}`
        }
        renderSectionHeader={({ section }) =>
          section.key === "settings" ? <SettingsSectionHeader /> : <OrdersSectionHeader />
        }
        renderItem={({ item, section }) => {
          if (section.key === "settings") {
            if (item === "email") return <SettingEmailRow />;
            if (item === "signout") return <SettingSignOutRow />;
            return null;
          }
          return <OrderItem item={item as OrderRow} />;
        }}
        contentContainerStyle={{
          paddingBottom: tabBarHeight + insets.bottom + 24,
          paddingTop: 8,
        }}
        stickySectionHeadersEnabled
        onEndReachedThreshold={0.2}
        onEndReached={() => { if (!loading && hasMore) setPage(p => p + 1); }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListFooterComponent={
          loading || hasMore ? <View style={{ paddingVertical: 16 }}>{loading ? <ActivityIndicator /> : null}</View> : null
        }
        ListEmptyComponent={
          !loading && items.length === 0 ? <Text style={{ textAlign: "center", color: C.sub, marginTop: 12 }}>Không có đơn nào.</Text> : null
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}
