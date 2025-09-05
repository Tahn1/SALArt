// app/bill/[id].tsx
import React, { useMemo, useEffect, useState, useRef } from "react";
import { View, Text, ScrollView, Pressable, BackHandler, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { supabase } from "../../lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cancelActiveOrderIfAny } from "../../lib/cart";
import { clearActiveOrder } from "../../lib/active-order";

const ORDER_KEY = "LAST_ORDER_ID";

const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", ok:"#16a34a", warn:"#f59e0b", dark:"#111827" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};

// ---------- helpers ----------
const parseJson = (x:any)=> (typeof x==="string" ? (()=>{ try{return JSON.parse(x);}catch{return null;} })() : x) ?? null;
const parseNoteAny = (n:any)=> parseJson(n) || {};
const pos = (v:any)=>{ const n=Number(v); return Number.isFinite(n) && n>0 ? n : 0; };
const firstPos = (...vals:any[])=>{ for(const v of vals){ const n=pos(v); if(n>0) return n; } return 0; };
const qtyOf = (it:any)=> Number(it?.qty ?? it?.quantity ?? 1);
const labelOf = (it:any)=> it?.name ?? it?.dish_name ?? (it?.dish_id ? `Món #${it.dish_id}` : "Món");

// chuẩn hoá 1 dòng từ ORDER_LINES với dishMap
function normalizeFromOrderLine(row:any, dishMap:Map<number, any>){
  const snap = parseNoteAny(row?.line_snapshot);
  const addonsArr = Array.isArray(parseJson(row?.addons)) ? parseJson(row?.addons) : Array.isArray(snap?.addons) ? snap.addons : [];
  const qty = firstPos(row?.qty, snap?.qty, 1) || 1;

  // tổng dòng từ snapshot (nếu có)
  const totalFromSnap = firstPos(
    snap?.line_total_vnd, snap?.final_line_total_vnd,
    snap?.line_total, snap?.total_vnd, snap?.total,
    snap?.total_with_addons_vnd, snap?.total_price_vnd
  );

  // đơn giá
  const dish = dishMap.get(Number(row?.dish_id)) || {};
  const unit = firstPos(
    snap?.unit_price_final_vnd, snap?.unit_price_with_addons_vnd,
    snap?.unit_price_after_discount_vnd, snap?.base_price_vnd,
    snap?.price_vnd, snap?.price, dish?.price_vnd
  );

  // addons trên 1 đơn vị
  const addonsPerUnitFromSnap = firstPos(
    snap?.addons_total_per_unit_vnd, snap?.addons_total_vnd_per_unit,
    snap?.addons_total_vnd, snap?.toppings_total_per_unit_vnd, snap?.toppings_total_vnd
  );
  const addonsPerUnitFromArray = addonsArr.reduce((s:number,a:any)=>{
    const u = firstPos(a?.qty_units, a?.qty);
    const p = firstPos(a?.extra_price_vnd_per_unit, a?.price_per_unit, a?.price);
    return s + (u * p);
  },0);
  const addonsPerUnit = addonsPerUnitFromSnap>0 ? addonsPerUnitFromSnap : addonsPerUnitFromArray;

  const line_total_vnd = totalFromSnap>0 ? totalFromSnap : (unit + addonsPerUnit) * qty;

  const name = snap?.dish_name ?? snap?.name ?? dish?.name ?? (row?.dish_id ? `Món #${row.dish_id}` : "Món");
  const addons_text =
    typeof snap?.addons_text === "string" && snap.addons_text
      ? snap.addons_text
      : (addonsArr.length ? addonsArr.map((a:any)=>`${a?.name ?? "Topping"}${firstPos(a?.qty_units, a?.qty) ? ` +${firstPos(a?.qty_units, a?.qty)}`:""}`).join(", ") : "");

  return { id: row?.id, order_id: row?.order_id, dish_id: row?.dish_id ?? snap?.dish_id ?? null, name, qty, line_total_vnd, addons_text };
}

// chuẩn hoá khi chỉ có items từ param `its`
function normalizeFromParam(it:any, dishMap:Map<number, any>){
  const qty = qtyOf(it);
  const dish = dishMap.get(Number(it?.dish_id)) || {};
  const line_total_vnd = pos(it?.line_total_vnd) || (pos(it?.base_price_vnd) * qty) || (pos(dish?.price_vnd) * qty) || 0;
  return {
    id: it?.id ?? `${it?.dish_id}-${Math.random()}`,
    order_id: it?.order_id ?? null,
    dish_id: it?.dish_id ?? null,
    name: labelOf({ ...it, name: it?.name ?? it?.dish_name ?? dish?.name }),
    qty,
    line_total_vnd,
    addons_text: it?.addons_text ?? ""
  };
}
// --------------------------------

export default function BillScreen(){
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams() as { id?:string; summary?:string; its?:string; meta?:string };
  const orderId = Number(params?.id);

  const snap = useMemo(()=>{ try{ return params.summary ? JSON.parse(decodeURIComponent(String(params.summary))) : null; }catch{ return null; }}, [params.summary]);
  const itemsFromProfile = useMemo(()=>{ try{ return params.its ? JSON.parse(decodeURIComponent(String(params.its))) : null; }catch{ return null; }}, [params.its]);
  const meta = useMemo(()=>{ try{ return params.meta ? JSON.parse(decodeURIComponent(String(params.meta))) : null; }catch{ return null; }}, [params.meta]);

  const [lines, setLines] = useState<any[]>([]);
  const [dbNote, setDbNote] = useState<any|null>(null);
  const [loading, setLoading] = useState(false);

  // Cho phép rời màn khi chính ta điều hướng (ví dụ bấm "Về Trang chủ")
  const allowLeaveRef = useRef(false);

  // chặn back/gesture
  useEffect(() => {
    navigation.setOptions?.({
      headerBackVisible: false,
      headerLeft: () => null,
      gestureEnabled: false,
    } as any);

    const backSub = BackHandler.addEventListener("hardwareBackPress", () => true);
    const unsub = navigation.addListener("beforeRemove", (e: any) => {
      if (allowLeaveRef.current) return;
      e.preventDefault();
    });

    return () => {
      try { backSub.remove(); } catch {}
      try { (unsub as any)(); } catch {}
    };
  }, [navigation]);

  // ---- cleanup pointers (đơn đang chờ) ----
  const cleanedRef = useRef(false);
  const cleanupPointers = async () => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    try { await cancelActiveOrderIfAny(); } catch {}
    try { await clearActiveOrder(); } catch {}
    try { await AsyncStorage.removeItem(ORDER_KEY); } catch {}
    setTimeout(()=>{ cleanedRef.current = false; }, 1000);
  };

  // fetch orders.note + order_lines + dishes (lấy giá)
  useEffect(() => {
    if (!Number.isFinite(orderId) || snap) return; // đi từ giỏ có snapshot thì khỏi fetch DB
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { data: ord } = await supabase
          .from("orders")
          .select("id, note")
          .eq("id", orderId)
          .maybeSingle();
        if (alive) setDbNote(ord?.note ?? null);

        const { data: ol } = await supabase
          .from("order_lines")
          .select("*")
          .eq("order_id", orderId)
          .order("id", { ascending: true });

        const raw = ol ?? [];

        // gom dish_id
        const noteObj = parseNoteAny(ord?.note);
        const noteItems = Array.isArray(noteObj?.items) ? noteObj.items : (Array.isArray(noteObj?.cart?.items) ? noteObj.cart.items : []);
        const dishIds = [...new Set(
          [
            ...raw.map((r:any)=> Number(r?.dish_id)),
            ...(Array.isArray(itemsFromProfile) ? itemsFromProfile.map((i:any)=>Number(i?.dish_id)) : []),
            ...noteItems.map((i:any)=>Number(i?.dish_id))
          ].filter(Boolean)
        )];

        // lấy giá từ bảng dishes
        let dishMap = new Map<number, any>();
        if (dishIds.length){
          const { data: dishes } = await supabase
            .from("dishes")
            .select("id, name, price_vnd")
            .in("id", dishIds);
          dishMap = new Map((dishes ?? []).map((d:any)=>[Number(d.id), d]));
        }

        const normalized = raw.length
          ? raw.map((r:any)=> normalizeFromOrderLine(r, dishMap))
          : (Array.isArray(itemsFromProfile) ? itemsFromProfile.map((i:any)=> normalizeFromParam(i, dishMap)) : []);

        if (alive) setLines(normalized);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [orderId, snap, itemsFromProfile]);

  // realtime payment_status
  const [payStatus, setPayStatus] = useState<string>("unpaid");
  useEffect(()=>{
    if (!Number.isFinite(orderId)) return;
    let ch:any;
    (async ()=>{
      const { data } = await supabase.from("orders").select("payment_status").eq("id", orderId).maybeSingle();
      if (data?.payment_status) setPayStatus(String(data.payment_status));
      ch = supabase.channel(`orders:${orderId}`)
        .on("postgres_changes", { event:"UPDATE", schema:"public", table:"orders", filter:`id=eq.${orderId}` },
          (payload)=>{ const s = (payload.new as any)?.payment_status; if (s) setPayStatus(String(s)); }
        ).subscribe();
    })();
    return ()=>{ try{ supabase.removeChannel(ch); }catch{} };
  }, [orderId]);

  const paidLike    = payStatus === "paid" || payStatus === "paid_demo";
  const pendingLike = payStatus === "pending_confirm";

  // ✅ Khi đã thanh toán → tự dọn con trỏ (tránh quay về đơn cũ)
  useEffect(() => {
    if (paidLike) cleanupPointers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidLike]);

  // ===== dữ liệu hiển thị =====
  const noteObj = useMemo(()=> parseNoteAny(dbNote), [dbNote]);
  const method  = snap?.method  ?? meta?.method  ?? noteObj?.method;
  const address = snap?.address ?? meta?.address ?? noteObj?.address ?? noteObj?.ADDRESS;
  const store   = snap?.store   ?? meta?.store   ?? noteObj?.store;

  const promotions = Array.isArray(snap?.promotions) ? snap.promotions
                     : Array.isArray(meta?.promotions) ? meta.promotions : [];

  const subTotalFromLines = (lines ?? []).reduce((s:number,it:any)=> s + pos(it.line_total_vnd), 0);
  const subTotal =
    snap ? pos(snap?.subTotal)
         : (subTotalFromLines > 0 ? subTotalFromLines :
            pos(noteObj?.SUBTOTAL ?? noteObj?.sub_total ?? noteObj?.subtotal));

  // 🔧 FIX: bỏ dấu ngoặc thừa
  const shippingFee =
    snap ? pos(snap?.shippingFee)
         : pos(meta?.shippingFee ?? noteObj?.SHIPPING_FEE ?? noteObj?.shipping_fee ?? noteObj?.ship_fee);

  // 🔧 FIX: không xuống dòng trước ?? để tránh lỗi syntax
  const vatRate = Number(snap?.VAT_RATE ?? meta?.VAT_RATE ?? noteObj?.VAT_RATE ?? 0.08);

  const vat =
    snap ? pos(snap?.vat)
         : pos(noteObj?.VAT_AMOUNT ?? Math.round((subTotal + shippingFee) * vatRate));

  const grandTotal =
    snap ? pos(snap?.grandTotal)
         : firstPos(meta?.grandTotal, noteObj?.GRAND_TOTAL, noteObj?.grand_total, (subTotal + shippingFee + vat));

  // ==== Mã đơn hiển thị: CHỈ dựa vào params.id ====
  const displayCode = useMemo(() => {
    const idNum = Number(params?.id);
    return Number.isFinite(idNum) ? `SAL_${String(idNum).padStart(6, "0")}` : "";
  }, [params?.id]);

  // Cho phép rời màn khi bấm CTA này
  const goHome = async () => {
    allowLeaveRef.current = true;
    await cleanupPointers();
    router.replace("/");
    setTimeout(() => { allowLeaveRef.current = false; }, 500);
  };

  return (
    <View style={{ flex:1, backgroundColor:C.bg }}>
      <Stack.Screen
        options={{
          headerShown:true,
          title: displayCode ? `Hóa đơn ${displayCode}` : (params?.id ? `Hóa đơn #${params.id}` : "Hóa đơn"),
          headerShadowVisible:false,
          headerStyle:{ backgroundColor: C.panel },
          headerTitleStyle:{ fontWeight:"800" },
          headerBackVisible:false,
          headerLeft: () => null,
          gestureEnabled:false,
        }}
      />
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:24 }}>

        {paidLike ? (
          <View style={{ alignItems:"center", marginTop:8, marginBottom:12 }}>
            <View style={{ width:92, height:92, borderRadius:46, backgroundColor:"#eafaf0", alignItems:"center", justifyContent:"center", borderWidth:2, borderColor:"#b7f0c9" }}>
              <Ionicons name="checkmark" size={56} color={C.ok} />
            </View>
            <Text style={{ marginTop:14, fontSize:22, fontWeight:"900", color:C.text }}>ĐÃ THANH TOÁN</Text>
            <Text style={{ marginTop:6, color:C.sub, textAlign:"center" }}>
              Cảm ơn bạn! Đơn hàng {displayCode || `#${params.id}`} đã được ghi nhận.
            </Text>
          </View>
        ) : (
          <View style={{ marginBottom:12 }}>
            <View style={{ alignSelf:"flex-start", backgroundColor: pendingLike ? "#fff7ed" : "#f3f4f6", borderColor: pendingLike ? C.warn : C.line, borderWidth:1, paddingHorizontal:10, paddingVertical:6, borderRadius:999 }}>
              <Text style={{ color: pendingLike ? "#92400e" : C.text, fontWeight:"800" }}>
                {pendingLike ? "ĐANG CHỜ XÁC NHẬN" : "CHƯA THANH TOÁN"}
              </Text>
            </View>
          </View>
        )}

        {/* Thông tin nhận hàng */}
        <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:14, marginBottom:12, gap:6 }}>
          <Text style={{ color:C.text, fontWeight:"700" }}>
            {method==="delivery" ? "Giao đến" : "Nhận tại quầy"}
          </Text>
          <Text style={{ color:C.text }}>
            {address || store?.address || "—"}
          </Text>
        </View>

        {/* Chi tiết thanh toán */}
        <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:14 }}>
          <Text style={{ fontWeight:"800", color:C.text, marginBottom:8 }}>Chi tiết thanh toán</Text>

          <Row label="Tổng tiền Món" value={fmtVnd(subTotal)} bold />

          {snap ? (
            (Array.isArray(snap?.items) ? snap.items : []).flatMap((it:any, idx:number) => {
              const rows:any[] = [{
                key:`dish-${idx}`, text:String(it.name ?? `Món #${idx+1}`),
                price: firstPos(it?.line_total_vnd, (pos(it.base_price_vnd) * Number(it.qty ?? 1))),
                right: Number(it.qty ?? 1) > 1 ? `× ${Number(it.qty ?? 1)}` : undefined
              }];
              for (let j=0;j<(it.addons||[]).length;j++){
                const a = it.addons[j];
                rows.push({
                  key:`addon-${idx}-${j}`, text:`Topping — ${a.name}`,
                  price: firstPos(a?.line_total_vnd, (pos(a.qty_units) * pos(a.extra_price_vnd_per_unit) * Number(it.qty ?? 1))),
                  right: pos(a.qty_units) > 0 ? `+${pos(a.qty_units)}` : undefined,
                });
              }
              return rows;
            }).filter(r=>pos(r.price)>0).map((row:any)=>(
              <Row key={row.key} label={row.text} value={fmtVnd(row.price)} right={row.right} muted />
            ))
          ) : (
            <>
              {loading && <View style={{ paddingVertical:6 }}><ActivityIndicator /></View>}

              {(lines ?? []).map((it:any)=>(
                <View key={it.id} style={{ marginVertical:3 }}>
                  <Row
                    label={labelOf(it)}
                    value={fmtVnd(pos(it.line_total_vnd))}
                    right={qtyOf(it) > 1 ? `× ${qtyOf(it)}` : undefined}
                    muted
                  />
                  {!!it.addons_text && (
                    <Text style={{ color:C.sub, fontSize:12, marginTop:2, marginLeft:6 }}>
                      {String(it.addons_text)}
                    </Text>
                  )}
                </View>
              ))}

              {(!lines || lines.length===0) && (
                <Text style={{ color:C.sub, fontStyle:"italic" }}>Không tìm thấy danh sách món</Text>
              )}
            </>
          )}

          <Spacer />
          <Row label="Tổng tiền Phí giao hàng" value={fmtVnd(shippingFee)} bold />

          {!!promotions.length && (
            <>
              <Spacer />
              <Row
                label={`Tổng áp dụng ${promotions.map((p:any)=>p.code||"").filter(Boolean).join(", ")}`}
                value={fmtVnd(promotions.reduce((s:any,p:any)=>s+pos(p.amount),0))}
                danger
              />
              {promotions.map((p:any, i:number)=>(
                <Row key={`promo-${i}`} label={p.label || p.code || "Khuyến mãi"} value={fmtVnd(pos(p.amount))} danger muted />
              ))}
            </>
          )}

          <Spacer />
          <Row label="Tổng thanh toán" value={fmtVnd(grandTotal)} bold big />
          <Text style={{ color:C.sub, fontSize:12, marginTop:6 }}>
            Bao gồm {Math.round(vatRate*100)}% VAT {method==="delivery" ? "và phí giao hàng" : ""}
          </Text>
        </View>

        {/* Actions */}
        <View style={{ marginTop:16, gap:10 }}>
          {!(payStatus === "paid" || payStatus === "paid_demo") && (
            <Pressable
              onPress={()=>router.push({ pathname: "/pay/[id]", params: { id: String(params.id || ""), amount: String(grandTotal || 0) } })}
              style={{ backgroundColor:C.dark, paddingVertical:14, borderRadius:14, alignItems:"center" }}>
              <Text style={{ color:"#fff", fontWeight:"800" }}>Thanh toán</Text>
            </Pressable>
          )}

          <Pressable onPress={goHome}
            style={{ backgroundColor:C.ok, paddingVertical:14, borderRadius:14, alignItems:"center" }}>
            <Text style={{ color:"#fff", fontWeight:"800" }}>Về Trang chủ</Text>
          </Pressable>
        </View>
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
