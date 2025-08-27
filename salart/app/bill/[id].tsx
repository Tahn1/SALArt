// app/bill/[id].tsx
import React, { useMemo, useEffect, useState, useRef } from "react";
import { View, Text, ScrollView, Pressable, BackHandler } from "react-native";
import { Stack, useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { supabase } from "../../lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cancelActiveOrderIfAny } from "../../lib/cart";
import { clearActiveOrder } from "../../lib/active-order";
const ORDER_KEY = "LAST_ORDER_ID";

const C = {
  bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280",
  line:"#E5E7EB", ok:"#16a34a", warn:"#f59e0b", dark:"#111827"
};
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};

export default function BillScreen(){
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams() as { id?:string; summary?:string };
  const orderId = Number(params?.id);

  // ---- snapshot (giữ nguyên để hiển thị khi chưa thanh toán) ----
  const snap = useMemo(()=>{ try{
    if (!params.summary) return null;
    return JSON.parse(decodeURIComponent(String(params.summary)));
  }catch{ return null; }}, [params.summary]);

  // ---- Cleanup pointers when leaving ----
  const cleanedRef = useRef(false);
  const cleanupPointers = async () => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    try { await cancelActiveOrderIfAny(); } catch {}
    try { await clearActiveOrder(); } catch {}
    try { await AsyncStorage.removeItem(ORDER_KEY); } catch {}
    setTimeout(()=>{ cleanedRef.current = false; }, 1000);
  };

  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => { cleanupPointers(); });
    const backSub = BackHandler.addEventListener("hardwareBackPress", () => { cleanupPointers(); return false; });
    return () => { try { unsub(); } catch {} try { backSub.remove(); } catch {} };
  }, [navigation]);

  // ---- ETA cho trạng thái chưa thanh toán ----
  const eta = useMemo(()=>{
    const now = new Date();
    const add = snap?.method === "delivery" ? 30 : 15;
    const t = new Date(now.getTime() + add*60*1000);
    const hh = String(t.getHours()).padStart(2,"0");
    const mm = String(t.getMinutes()).padStart(2,"0");
    return `${hh}:${mm} Hôm nay`;
  }, [snap?.method]);

  const subTotal = snap?.subTotal ?? 0;
  const shippingFee = snap?.shippingFee ?? 0;
  const vat = snap?.vat ?? 0;
  const grandTotal = snap?.grandTotal ?? (subTotal + shippingFee + vat);
  const promotions = Array.isArray(snap?.promotions) ? snap?.promotions : [];

  // ===== FIX: key duy nhất, không dùng tên món =====
  const items = Array.isArray(snap?.items) ? snap.items : [];
  const lines = useMemo(() => {
    return items.flatMap((it: any, idx: number) => {
      const base = [{
        key: `dish-${idx}`,                             // ✅ luôn duy nhất
        text: `${it.name}`,
        price: (it.base_price_vnd ?? 0) * (it.qty ?? 1),
        right: it.qty > 1 ? `× ${it.qty}` : undefined
      }];

      const addons = (it.addons ?? []).map((a: any, j: number) => ({
        key: `addon-${idx}-${j}`,                      // ✅ duy nhất theo món + thứ tự topping
        text: `Topping — ${a.name}`,
        price: (a.qty_units ?? 0) * (a.extra_price_vnd_per_unit ?? 0) * (it.qty ?? 1),
        right: (a.qty_units ?? 0) > 0 ? `+${a.qty_units}` : undefined,
        sub: true
      }));

      return [...base, ...addons].filter(row => row.price > 0);
    });
  }, [items]);
  // ================================================

  // ---- Realtime trạng thái thanh toán ----
  const [payStatus, setPayStatus] = useState<string>("unpaid");
  useEffect(()=>{
    if (!Number.isFinite(orderId)) return;
    let ch:any;
    (async ()=>{
      const { data } = await supabase.from("orders")
        .select("payment_status").eq("id", orderId).maybeSingle();
      if (data?.payment_status) setPayStatus(String(data.payment_status));
      ch = supabase.channel(`orders:${orderId}`)
        .on("postgres_changes",
          { event:"UPDATE", schema:"public", table:"orders", filter:`id=eq.${orderId}` },
          (payload)=>{
            const s = (payload.new as any)?.payment_status;
            if (s) setPayStatus(String(s));
          }
        ).subscribe();
    })();
    return ()=>{ try{ supabase.removeChannel(ch); }catch{} };
  }, [orderId]);

  const paidLike = payStatus === "paid" || payStatus === "paid_demo";
  const pendingLike = payStatus === "pending_confirm";

  const goHome = async () => { await cleanupPointers(); router.replace("/"); };
  const goCart = async () => { await cleanupPointers(); router.replace("/(tabs)/cart"); };

  return (
    <View style={{ flex:1, backgroundColor:C.bg }}>
      <Stack.Screen
        options={{
          headerShown:true,
          title: params?.id ? `Hóa đơn #${params.id}` : "Hóa đơn",
          headerShadowVisible:false,
          headerStyle:{ backgroundColor: C.panel },
          headerTitleStyle:{ fontWeight:"800" }
        }}
      />

      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:24 }}>
        {paidLike ? (
          <View style={{ alignItems:"center", marginTop:8 }}>
            <View style={{
              width:92, height:92, borderRadius:46,
              backgroundColor:"#eafaf0", alignItems:"center", justifyContent:"center",
              borderWidth:2, borderColor:"#b7f0c9"
            }}>
              <Ionicons name="checkmark" size={56} color={C.ok} />
            </View>

            <Text style={{ marginTop:14, fontSize:22, fontWeight:"900", color:C.text }}>
              ĐÃ THANH TOÁN
            </Text>

            <Text style={{ marginTop:6, color:C.sub, textAlign:"center" }}>
              Cảm ơn bạn! Đơn hàng #{params.id} đã được ghi nhận.
            </Text>

            {Number(grandTotal)>0 && (
              <View style={{
                marginTop:14, paddingVertical:10, paddingHorizontal:14,
                backgroundColor:"#fff", borderRadius:12, borderWidth:1, borderColor:C.line
              }}>
                <Text style={{ color:C.sub, textAlign:"center" }}>Tổng thanh toán</Text>
                <Text style={{ color:C.text, fontWeight:"900", fontSize:18, textAlign:"center" }}>
                  {fmtVnd(grandTotal)}
                </Text>
              </View>
            )}

            <View style={{ width:"100%", marginTop:20, gap:10 }}>
              <Pressable onPress={goHome}
                style={{ backgroundColor:C.ok, paddingVertical:14, borderRadius:14, alignItems:"center" }}>
                <Text style={{ color:"#fff", fontWeight:"800" }}>Về Trang chủ</Text>
              </Pressable>
              <Pressable onPress={goCart}
                style={{ backgroundColor:"#fff", borderWidth:1, borderColor:C.line, paddingVertical:14, borderRadius:14, alignItems:"center" }}>
                <Text style={{ color:C.text, fontWeight:"800" }}>Xem giỏ hàng</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={{ marginBottom:12 }}>
              <View style={{
                alignSelf:"flex-start",
                backgroundColor: pendingLike ? "#fff7ed" : "#f3f4f6",
                borderColor: pendingLike ? C.warn : C.line,
                borderWidth:1, paddingHorizontal:10, paddingVertical:6, borderRadius:999
              }}>
                <Text style={{ color: pendingLike ? "#92400e" : C.text, fontWeight:"800" }}>
                  {pendingLike ? "ĐANG CHỜ XÁC NHẬN" : "CHƯA THANH TOÁN"}
                </Text>
              </View>
            </View>

            <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:14, marginBottom:12, gap:8 }}>
              <Text style={{ color:C.sub }}>
                {snap?.method==="delivery" ? "Nhận hàng" : "Nhận tại quầy"} <Text style={{ color:C.text, fontWeight:"800" }}>{eta}</Text>
              </Text>
              <Text style={{ color:C.text, fontWeight:"700", marginTop:2 }}>
                {snap?.method==="delivery" ? "Tại" : "Tại cửa hàng"}
              </Text>
              <Text style={{ color:C.text }}>
                {snap?.address || snap?.store?.address || "—"}
              </Text>
            </View>

            <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:14 }}>
              <Text style={{ fontWeight:"800", color:C.text, marginBottom:8 }}>Chi tiết thanh toán</Text>

              <Row label="Tổng tiền Món" value={fmtVnd(subTotal)} bold />
              {lines.map(row=>(
                <Row key={row.key} label={row.text} value={fmtVnd(row.price)} right={row.right} muted />
              ))}

              <Spacer />
              <Row label="Tổng tiền Phí giao hàng" value={fmtVnd(shippingFee)} bold />

              {!!promotions.length && (
                <>
                  <Spacer />
                  <Row label={`Tổng áp dụng ${promotions.map((p:any)=>p.code||"").filter(Boolean).join(", ")}`} value={fmtVnd(promotions.reduce((s:any,p:any)=>s+(p.amount||0),0))} danger />
                  {promotions.map((p:any, i:number)=>(
                    <Row key={`promo-${i}`} label={p.label || p.code || "Khuyến mãi"} value={fmtVnd(p.amount || 0)} danger muted />
                  ))}
                </>
              )}

              <Spacer />
              <Row label="Tổng thanh toán" value={fmtVnd(grandTotal)} bold big />
              <Text style={{ color:C.sub, fontSize:12, marginTop:6 }}>
                Bao gồm {Math.round((snap?.VAT_RATE??0.08)*100)}% VAT {snap?.method==="delivery" ? "và phí giao hàng" : ""}
              </Text>
            </View>

            <View style={{ marginTop:16, gap:10 }}>
              <Pressable
                onPress={()=>router.push({ pathname: "/pay/[id]", params: { id: String(params.id || ""), amount: String(grandTotal || 0) } })}
                style={{ backgroundColor:C.dark, paddingVertical:14, borderRadius:14, alignItems:"center" }}>
                <Text style={{ color:"#fff", fontWeight:"800" }}>Thanh toán</Text>
              </Pressable>

              <Pressable onPress={goHome}
                style={{ backgroundColor:C.ok, paddingVertical:14, borderRadius:14, alignItems:"center" }}>
                <Text style={{ color:"#fff", fontWeight:"800" }}>Về Trang chủ</Text>
              </Pressable>
              <Pressable onPress={goCart}
                style={{ backgroundColor:"#fff", borderWidth:1, borderColor:C.line, paddingVertical:14, borderRadius:14, alignItems:"center" }}>
                <Text style={{ color:C.text, fontWeight:"800" }}>Xem giỏ hàng</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, right, bold, big, muted, danger }:{
  label:string; value:string; right?:string; bold?:boolean; big?:boolean; muted?:boolean; danger?:boolean;
}){
  return (
    <View style={{ flexDirection:"row", alignItems:"flex-start", marginVertical:3 }}>
      <View style={{ flex:1 }}>
        <Text style={{ color: muted ? C.sub : C.text, fontWeight: bold ? "800":"600" }}>{label}</Text>
        {!!right && <Text style={{ color:C.sub, fontSize:12, marginTop:2 }}>{right}</Text>}
      </View>
      <Text style={{
        color: danger ? "#dc2626" : C.text,
        fontWeight: bold ? "800":"700",
        fontSize: big ? 18 : 14
      }}>{value}</Text>
    </View>
  );
}
function Spacer(){ return <View style={{ height:10, borderBottomWidth:1, borderColor:C.line, marginVertical:6 }} />; }
