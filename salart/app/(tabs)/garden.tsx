// app/(tabs)/garden.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { router } from "expo-router";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs"; // ⬅️ thêm

const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", dark:"#111827" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};
const POINT_PER_VND = 1/10000;          // 1 điểm cho mỗi 10.000đ
const LEVELS = [0, 300_000, 700_000, 1_500_000]; // mốc VND cho level 0→1→2→3

type Row = {
  id: number;
  created_at?: string | null;
  paid_at?: string | null;
  note?: any | null;
  payment_method_norm?: "cod" | "online" | "other" | null;
};

function parseNote(n:any){ if(!n) return {}; if(typeof n==="string"){ try{return JSON.parse(n);}catch{return{}} } return n; }
function totalFromNote(note:any){
  const o = parseNote(note);
  const cand = [o?.GRAND_TOTAL,o?.grand_total,o?.TOTAL,o?.total,o?.amount,o?.Amount];
  const v = Number(cand.find((x:any)=> x!=null));
  return Number.isFinite(v) && v>0 ? v : 0;
}

export default function Garden() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight(); // ⬅️ chiều cao bottom tab
  const [session, setSession] = useState<Session|null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription?.unsubscribe();
  }, []);

  const load = useCallback(async ()=>{
    if (!session?.user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("v_orders_history")
      .select("id, created_at, paid_at, note, payment_method_norm")
      .eq("user_id", session.user.id)
      .eq("status_norm", "paid")        // chỉ lấy đơn đã thanh toán
      .order("id", { ascending: false })
      .limit(500);
    if (!error && data) setRows(data as Row[]);
    setLoading(false);
  }, [session?.user?.id]);

  useEffect(()=>{ load(); }, [load]);

  // ==== KPIs ====
  const {
    totalOrders, totalSpendVND, points,
    treeLevel, nextLevelNeed, codCount,
    activeDays30, streakDays, recent
  } = useMemo(()=>{
    const paidDates = new Map<string, number>(); // yyyy-mm-dd -> count
    let spend = 0, cod = 0;

    for (const r of rows) {
      const amt = totalFromNote(r.note);
      spend += amt;
      if (r.payment_method_norm === "cod") cod++;
      const d = new Date(r.paid_at || r.created_at || "");
      if (!Number.isFinite(d.valueOf())) continue;
      const key = d.toISOString().slice(0,10);
      paidDates.set(key, (paidDates.get(key)||0)+1);
    }

    const totalOrders = rows.length;
    const totalSpendVND = spend;
    const points = Math.floor(totalSpendVND * POINT_PER_VND);

    // level theo tổng chi
    let treeLevel = 0;
    for (let i=0;i<LEVELS.length;i++){ if (totalSpendVND >= LEVELS[i]) treeLevel = i; }
    const nextLevelTarget = LEVELS[Math.min(treeLevel+1, LEVELS.length-1)];
    const nextLevelNeed = Math.max(0, nextLevelTarget - totalSpendVND);

    // active days in last 30 days
    const today = new Date(); today.setHours(0,0,0,0);
    let active30 = 0;
    for (let i=0;i<30;i++){
      const d = new Date(today); d.setDate(today.getDate()-i);
      const key = d.toISOString().slice(0,10);
      if (paidDates.has(key)) active30++;
    }

    // streak: liên tiếp tính từ hôm nay lùi về
    let streak = 0;
    for(;;){
      const d = new Date(today); d.setDate(today.getDate()-streak);
      const key = d.toISOString().slice(0,10);
      if (paidDates.has(key)) streak++; else break;
      if (streak>365) break;
    }

    const recent = rows.slice(0, 8).map(r=>{
      const when = new Date(r.paid_at || r.created_at || "");
      return { id: r.id, when, amount: totalFromNote(r.note) }
    });

    return {
      totalOrders, totalSpendVND, points,
      treeLevel, nextLevelNeed, codCount: cod,
      activeDays30: active30, streakDays: streak, recent
    };
  }, [rows]);

  const TreeEmoji = () => {
    const e = treeLevel>=3 ? "🌳" : treeLevel>=2 ? "🌿" : treeLevel>=1 ? "🌱" : "🪴";
    const label = treeLevel>=3 ? "Cây lớn" : treeLevel>=2 ? "Cây non" : treeLevel>=1 ? "Mầm cây" : "Chậu giống";
    return (
      <View style={{ alignItems:"center", paddingVertical:12 }}>
        <Text style={{ fontSize:48 }}>{e}</Text>
        <Text style={{ marginTop:6, fontWeight:"800", color:C.text }}>{label}</Text>
        <Text style={{ color:C.sub, marginTop:4 }}>
          Cần thêm {fmtVnd(nextLevelNeed)} để lên cấp tiếp theo
        </Text>
      </View>
    );
  };

  const Stat = ({label, value}:{label:string; value:string})=>(
    <View style={{ flex:1, padding:12, backgroundColor:"#fff", borderRadius:12, borderWidth:1, borderColor:C.line, alignItems:"center" }}>
      <Text style={{ fontSize:18, fontWeight:"900", color:C.text }}>{value}</Text>
      <Text style={{ fontSize:12, color:C.sub, marginTop:2 }}>{label}</Text>
    </View>
  );

  const ProgressBar = ({ value, max }:{ value:number; max:number })=>{
    const ratio = Math.max(0, Math.min(1, max>0 ? value/max : 0));
    return (
      <View style={{ height:10, backgroundColor:"#E5E7EB", borderRadius:999, overflow:"hidden" }}>
        <View style={{ width: `${ratio*100}%`, height:"100%", backgroundColor:C.dark }} />
      </View>
    );
  };

  const Badges = () => {
    const b: {key:string; ok:boolean; label:string}[] = [
      { key:"first", ok: totalOrders>=1, label: "Đơn đầu tiên" },
      { key:"3orders", ok: totalOrders>=3, label: "3 đơn" },
      { key:"5orders", ok: totalOrders>=5, label: "5 đơn" },
      { key:"500k", ok: totalSpendVND>=500_000, label: "Chi 500k" },
      { key:"codlover", ok: codCount>=3, label: "Ưa COD" },
      { key:"streak3", ok: streakDays>=3, label: "Chuỗi 3 ngày" },
    ];
    return (
      <View style={{ flexDirection:"row", flexWrap:"wrap", gap:10 }}>
        {b.map(x=>(
          <View key={x.key} style={{
            width:"31%",
            backgroundColor:"#fff",
            borderRadius:12, borderWidth:1, borderColor: x.ok ? "#22c55e" : C.line,
            padding:10, alignItems:"center"
          }}>
            <Text style={{ fontSize:24 }}>{x.ok ? "🏆" : "🎖️"}</Text>
            <Text style={{ fontSize:12, textAlign:"center", color:x.ok ? "#166534" : C.sub, marginTop:6, fontWeight:"700" }}>
              {x.label}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  if (!session?.user) {
    return (
      <View style={{ flex:1, backgroundColor:C.bg }}>
        <View style={{ paddingTop: insets.top+12, paddingBottom:12, paddingHorizontal:16, backgroundColor:C.panel, borderBottomWidth:1, borderColor:C.line }}>
          <Text style={{ fontSize:22, fontWeight:"800", color:C.text }}>Hành trình xanh</Text>
        </View>
        <View style={{ flex:1, alignItems:"center", justifyContent:"center", padding:24 }}>
          <Text style={{ fontSize:18, fontWeight:"700", color:C.text, marginBottom:8 }}>Bạn chưa đăng nhập</Text>
          <Text style={{ color:C.sub, textAlign:"center", marginBottom:16 }}>Đăng nhập để xem hành trình và huy hiệu của bạn.</Text>
          <Pressable onPress={()=>router.push("/login")} style={{ backgroundColor:C.dark, paddingVertical:12, paddingHorizontal:18, borderRadius:10 }}>
            <Text style={{ color:"#fff", fontWeight:"800" }}>Đăng nhập</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex:1, backgroundColor:C.bg }}>
      <View style={{ paddingTop: insets.top+12, paddingBottom:12, paddingHorizontal:16, backgroundColor:C.panel, borderBottomWidth:1, borderColor:C.line }}>
        <Text style={{ fontSize:22, fontWeight:"800", color:C.text }}>Hành trình xanh</Text>
      </View>

      {loading ? (
        <View style={{ flex:1, alignItems:"center", justifyContent:"center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            gap: 16,
            // chừa chỗ cho bottom tab + safe area
            paddingBottom: tabBarHeight + insets.bottom + 24,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* CÂY & LEVEL */}
          <View style={{ backgroundColor:"#fff", borderRadius:16, borderWidth:1, borderColor:C.line, padding:16 }}>
            <TreeEmoji />
            <View style={{ marginTop:12 }}>
              <ProgressBar
                value={Math.max(0, totalSpendVND - LEVELS[Math.max(0, treeLevel)])}
                max={Math.max(1, (LEVELS[Math.min(treeLevel+1, LEVELS.length-1)] - LEVELS[Math.max(0, treeLevel)]))}
              />
              <Text style={{ color:C.sub, marginTop:6, textAlign:"center" }}>
                Tổng chi: {fmtVnd(totalSpendVND)} · Điểm: <Text style={{ fontWeight:"800", color:C.text }}>{points}</Text>
              </Text>
            </View>
          </View>

          {/* KPIs */}
          <View style={{ flexDirection:"row", gap:12 }}>
            <Stat label="Đơn đã mua" value={String(totalOrders)} />
            <Stat label="Ngày hoạt động (30d)" value={String(activeDays30)} />
            <Stat label="Chuỗi ngày" value={String(streakDays)} />
          </View>

          {/* BADGES */}
          <View style={{ backgroundColor:"#fff", borderRadius:16, borderWidth:1, borderColor:C.line, padding:16 }}>
            <Text style={{ fontWeight:"900", color:C.text, marginBottom:12 }}>Huy hiệu</Text>
            <Badges />
          </View>

          {/* GẦN ĐÂY */}
          <View style={{ backgroundColor:"#fff", borderRadius:16, borderWidth:1, borderColor:C.line, padding:16 }}>
            <Text style={{ fontWeight:"900", color:C.text, marginBottom:8 }}>Hoạt động gần đây</Text>
            {recent.length===0 ? (
              <Text style={{ color:C.sub }}>Chưa có đơn nào.</Text>
            ) : recent.map(row=>(
              <View key={row.id} style={{ paddingVertical:8, borderBottomWidth:1, borderBottomColor:"#F3F4F6" }}>
                <Text style={{ color:C.text, fontWeight:"700" }}>#{String(row.id).padStart(6,"0")} — {fmtVnd(row.amount)}</Text>
                <Text style={{ color:C.sub }}>{row.when?.toLocaleString("vi-VN")}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
