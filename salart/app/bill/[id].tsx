// app/bill/[id].tsx
import React, { useMemo } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";

const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", ok:"#16a34a" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};

export default function BillScreen(){
  const router = useRouter();
  const params = useLocalSearchParams() as { id?:string; summary?:string };

  // Parse snapshot
  const snap = useMemo(()=>{
    try{
      if (!params.summary) return null;
      return JSON.parse(decodeURIComponent(String(params.summary)));
    }catch{ return null; }
  }, [params.summary]);

  // Thời gian dự kiến (demo): +30' nếu giao tại nhà, +15' nếu nhận tại quầy
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

  const items = Array.isArray(snap?.items) ? snap.items : [];
  const lines = items.flatMap((it:any) => {
    const base = [{
      key: `dish-${it.name}`,
      text: `${it.name}`,
      price: (it.base_price_vnd ?? 0) * (it.qty ?? 1),
      right: it.qty > 1 ? `× ${it.qty}` : undefined
    }];
    const addons = (it.addons ?? []).map((a:any, idx:number) => ({
      key: `addon-${it.name}-${idx}`,
      text: `Topping — ${a.name}`,
      price: (a.qty_units ?? 0) * (a.extra_price_vnd_per_unit ?? 0) * (it.qty ?? 1),
      right: (a.qty_units ?? 0) > 0 ? `+${a.qty_units}` : undefined,
      sub: true
    }));
    return [...base, ...addons].filter(row => row.price > 0);
  });

  return (
    <View style={{ flex:1, backgroundColor:C.bg }}>
      <Stack.Screen
        options={{
          title: "Hóa đơn",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: C.panel },
          headerTitleStyle: { fontWeight: "800" },
        }}
      />

      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:24 }}>
        {/* Khối thông tin giao/nhận */}
        <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:14, marginBottom:12, gap:8 }}>
          <Text style={{ color:C.sub }}> {snap?.method==="delivery" ? "Nhận hàng" : "Nhận tại quầy"} <Text style={{ color:C.text, fontWeight:"800" }}>{eta}</Text></Text>
          <Text style={{ color:C.text, fontWeight:"700", marginTop:2 }}>
            {snap?.method==="delivery" ? "Tại" : "Tại cửa hàng"}
          </Text>
          <Text style={{ color:C.text }}>
            {snap?.address || snap?.store?.address || "—"}
          </Text>
          {snap?.method==="delivery" && typeof snap?.distanceKm === "number" && (
            <Text style={{ color:C.sub, fontSize:12, marginTop:4 }}>
              Khoảng cách ~{Number(snap.distanceKm).toFixed(1)} km
            </Text>
          )}
        </View>

        {/* Chi tiết thanh toán */}
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

        {/* CTA */}
        <View style={{ marginTop:16, gap:10 }}>
          <Pressable
            onPress={()=>router.replace("/")}
            style={{ backgroundColor:C.ok, paddingVertical:14, borderRadius:14, alignItems:"center" }}
          >
            <Text style={{ color:"#fff", fontWeight:"800" }}>Về Trang chủ</Text>
          </Pressable>
          <Pressable
            onPress={()=>router.push("/(tabs)/cart")}
            style={{ backgroundColor:"#fff", borderWidth:1, borderColor:C.line, paddingVertical:14, borderRadius:14, alignItems:"center" }}
          >
            <Text style={{ color:C.text, fontWeight:"800" }}>Xem giỏ hàng</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({
  label, value, right, bold, big, muted, danger
}:{
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
