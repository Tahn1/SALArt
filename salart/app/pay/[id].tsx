// app/pay/[id].tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Image, Alert, ActivityIndicator, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "../../lib/supabase";
import { clearCart } from "../../lib/cart";

const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", dark:"#111827" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};

// Fallback QR VietQR nếu cổng lỗi/chưa có link
const BANK_SHORT = "TCB";
const ACCOUNT_NO  = "19022024724012";
const ACCOUNT_NAME = "SALArt Vietnam";

type TOrder = {
  id: number;
  order_code?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  total_vnd?: number | null;
};

export default function PayScreen(){
  const router = useRouter();
  const params = useLocalSearchParams();

  // ===== Params
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawAmount = Array.isArray(params.amount) ? params.amount[0] : params.amount;
  const orderId = Number.parseInt(String(rawId ?? ""), 10);

  const [dbOrder, setDbOrder] = useState<TOrder | null>(null);
  const total = useMemo(()=>{
    const nParam = Number(rawAmount ?? "0");
    if (Number.isFinite(nParam) && nParam > 0) return nParam;
    const nDb = Number(dbOrder?.total_vnd ?? 0);
    return Number.isFinite(nDb) ? nDb : 0;
  }, [rawAmount, dbOrder]);

  const [tab, setTab] = useState<"bank"|"cod">("bank");
  const [saving, setSaving] = useState(false);   // COD
  const [paying, setPaying] = useState(false);   // BANK

  // Đếm ngược 15'
  const [left, setLeft] = useState(15*60);
  useEffect(()=>{ const t=setInterval(()=>setLeft(s=>Math.max(0,s-1)),1000); return ()=>clearInterval(t); },[]);
  const mm = String(Math.floor(left/60)).padStart(2,"0");
  const ss = String(left%60).padStart(2,"0");

  // Lấy đơn từ DB + đảm bảo có order_code
  useEffect(()=>{
    if (!Number.isFinite(orderId)) return;
    (async ()=>{
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_code, payment_status, payment_method, total_vnd")
        .eq("id", orderId)
        .maybeSingle<TOrder>();
      if (error) { console.warn(error); return; }
      let row = data || null;

      if (!row) {
        Alert.alert("Không tìm thấy đơn hàng", "Vui lòng quay lại giỏ hàng để tạo đơn mới.");
        return;
      }

      if (!row.order_code) {
        const gen = `SAL_${String(orderId).padStart(6,"0")}`;
        const { data: upd, error: eUpd } = await supabase
          .from("orders")
          .update({ order_code: gen })
          .eq("id", orderId)
          .select("id, order_code, payment_status, payment_method, total_vnd")
          .maybeSingle<TOrder>();
        if (!eUpd && upd) row = upd;
      }
      setDbOrder(row);
    })();
  }, [orderId]);

  // order_code hiển thị
  const orderCode = useMemo(()=>{
    if (dbOrder?.order_code) return dbOrder.order_code;
    return `SAL_${String(Number.isFinite(orderId) ? orderId : "").padStart(6,"0")}`;
  }, [dbOrder, orderId]);

  // Fallback QR VietQR
  const qrUrlFallback = useMemo(()=>{
    const info = encodeURIComponent(`Thanh toan don hang #${orderCode}`);
    const name = encodeURIComponent(ACCOUNT_NAME);
    const amt = Math.max(0, Math.round(total));
    return `https://img.vietqr.io/image/${BANK_SHORT}-${ACCOUNT_NO}-qr_only.png?amount=${amt}&addInfo=${info}&accountName=${name}`;
  }, [total, orderCode]);

  // QR từ cổng (nếu có)
  const [gatewayQr, setGatewayQr] = useState<string | null>(null);

  // Realtime → tự về Bill (✅ xoá giỏ trước khi điều hướng)
  const [payStatus, setPayStatus] = useState<string|null>(null);
  useEffect(()=>{
    if (!Number.isFinite(orderId)) return;
    let ch:any;

    (async ()=>{
      const { data } = await supabase
        .from("orders")
        .select("payment_status")
        .eq("id", orderId)
        .maybeSingle();
      if (data?.payment_status) setPayStatus(String(data.payment_status));

      ch = supabase
        .channel(`orders:${orderId}`)
        .on("postgres_changes",
          { event:"UPDATE", schema:"public", table:"orders", filter:`id=eq.${orderId}` },
          (payload)=>{
            const s = (payload.new as any)?.payment_status;
            if (!s) return;
            setPayStatus(String(s));
            if (s === "paid" || s === "paid_demo") {
              try { clearCart?.(); } catch {}
              router.replace(`/bill/${orderId}`);
            }
          }
        )
        .subscribe();
    })();

    return ()=>{ try{ ch && supabase.removeChannel(ch); }catch{} };
  }, [orderId]);

  // ===== Fallback: POLLING trạng thái mỗi 4s (✅ xoá giỏ trước khi điều hướng)
  const [checking, setChecking] = useState(false);
  async function checkNow(){
    if (!Number.isFinite(orderId)) return;
    try{
      setChecking(true);
      const { data, error } = await supabase
        .from("orders")
        .select("payment_status")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      const s = data?.payment_status ? String(data.payment_status) : null;
      if (s) setPayStatus(s);
      if (s === "paid" || s === "paid_demo") {
        try { clearCart?.(); } catch {}
        router.replace(`/bill/${orderId}`);
      }
    }catch(e){ /* noop */ }
    finally{ setChecking(false); }
  }
  useEffect(()=>{
    if (!Number.isFinite(orderId)) return;
    const itv = setInterval(checkNow, 4000);
    return ()=>clearInterval(itv);
  }, [orderId]);

  // ===== Helpers ghi nhận payments idempotent
  async function upsertPayment(record: {
    method: "bank" | "cod",
    status: "pending" | "paid" | "failed",
    amount_vnd: number,
    order_code: string,
    gateway?: string | null,
    ref?: string | null,
    paid_at?: string | null
  }) {
    const payload = {
      order_id: orderId,
      order_code: record.order_code,
      amount_vnd: record.amount_vnd,
      method: record.method,
      status: record.status,
      gateway: record.gateway ?? null,
      ref: record.ref ?? null,
      paid_at: record.paid_at ?? null,
    };
    const { error } = await supabase
      .from("payments")
      .upsert(payload, { onConflict: "order_id" })
      .select("order_id")
      .maybeSingle();
    if (error) throw error;
  }

  // Đảm bảo đơn trước khi gọi cổng
  async function ensureOrderBeforePayment() {
    const { error } = await supabase
      .from("orders")
      .update({ payment_method: "bank", payment_status: "pending_confirm" })
      .eq("id", orderId);
    if (error) throw error;

    await upsertPayment({
      method: "bank",
      status: "pending",
      amount_vnd: Math.round(total),
      order_code: orderCode
    });
  }

  // ===== Nút: Thanh toán VietQR (PayOS)
  async function onPayVietQR(){
    if (!Number.isFinite(orderId)) { Alert.alert("Lỗi", "Không xác định được mã đơn."); return; }
    if (!Number.isFinite(total) || total <= 0) { Alert.alert("Lỗi", "Số tiền không hợp lệ."); return; }
    try{
      if (paying) return;
      setPaying(true);

      await ensureOrderBeforePayment();

      const { data, error } = await supabase.functions.invoke<any>("payos-create-payment", {
        body: {
          orderCode: orderId,
          amount: Math.round(total),
          description: `SALART - Đơn ${orderCode}`,
        }
      });
      if (error) throw error;

      const checkoutUrl =
        data?.data?.checkoutUrl ??
        data?.checkoutUrl ??
        data?.url;

      const qrCodeUrl =
        data?.data?.qrCode ??
        data?.qrCode ??
        data?.data?.qr_content;

      if (checkoutUrl) {
        await WebBrowser.openBrowserAsync(checkoutUrl);
        return;
      }
      if (qrCodeUrl) {
        setGatewayQr(qrCodeUrl);
        return;
      }

      const reason =
        data?.error ||
        data?.desc ||
        data?.message ||
        (data?.code && data.code !== "00" ? `Mã lỗi: ${data.code}` : "");

      console.log("payos-create-payment resp:", JSON.stringify(data, null, 2));
      Alert.alert(
        "Thông báo",
        reason
          ? `Không nhận được link thanh toán: ${reason}`
          : "Không nhận được link thanh toán, vui lòng quét QR bên dưới."
      );
    }catch(e:any){
      Alert.alert("Lỗi", e?.message ?? "Không tạo được link thanh toán. Vui lòng quét QR bên dưới.");
    }finally{
      setPaying(false);
    }
  }

  // ===== Nút: Xác nhận COD (đã có clearCart)
  async function confirmCOD(){
    if (!Number.isFinite(orderId)) { Alert.alert("Lỗi", "Không xác định được mã đơn."); return; }
    setSaving(true);
    try{
      const { error: eStock } = await supabase.rpc("consume_stock_for_order", { p_order_id: orderId });
      if (eStock && !/ALREADY_CONSUMED/i.test(String(eStock.message||""))) {
        if (/OUT_OF_STOCK/i.test(String(eStock.message||""))) {
          throw new Error("Hết nguyên liệu cho một số món. Vui lòng điều chỉnh đơn.");
        }
        throw eStock;
      }

      const nowIso = new Date().toISOString();
      await upsertPayment({
        method: "cod",
        status: "paid",
        amount_vnd: Math.round(total),
        order_code: orderCode,
        paid_at: nowIso
      });

      const { error: ePaid } = await supabase
        .from("orders")
        .update({ payment_method:"cod", payment_status:"paid", paid_at: nowIso })
        .eq("id", orderId);
      if (ePaid) throw ePaid;

      try { clearCart?.(); } catch {}
      router.replace(`/bill/${orderId}`);
    }catch(e:any){
      Alert.alert("Lỗi", e?.message ?? "Vui lòng thử lại.");
    }finally{
      setSaving(false);
    }
  }

  const hint =
    payStatus === "pending_confirm" ? "Hệ thống đã ghi nhận, đang chờ xác nhận giao dịch từ ngân hàng…"
    : payStatus === "paid" || payStatus === "paid_demo" ? "Đã thanh toán"
    : "Quét QR hoặc bấm 'Thanh toán VietQR'. Hệ thống sẽ tự cập nhật khi ngân hàng xác nhận thành công.";

  if (!Number.isFinite(orderId)) {
    return (
      <View style={{ flex:1, backgroundColor:C.bg }}>
        <Stack.Screen options={{ headerShown:true, title:"Thanh toán", headerStyle:{ backgroundColor:C.panel }, headerTitleStyle:{ fontWeight:"800" } }} />
        <View style={{ flex:1, alignItems:"center", justifyContent:"center", padding:24 }}>
          <Text style={{ color:C.text, fontWeight:"800", fontSize:16, marginBottom:8 }}>Thiếu mã đơn hàng</Text>
          <Text style={{ color:C.sub, textAlign:"center", marginBottom:16 }}>Hãy quay lại Hóa đơn và mở lại trang thanh toán.</Text>
          <Pressable onPress={()=>router.replace("/")} style={{ backgroundColor:C.dark, paddingVertical:12, paddingHorizontal:18, borderRadius:12 }}>
            <Text style={{ color:"#fff", fontWeight:"800" }}>Về Trang chủ</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex:1, backgroundColor:C.bg }}>
      <Stack.Screen
        options={{
          headerShown:true,
          title:`Thanh toán #${orderId}`,
          headerShadowVisible:false,
          headerStyle:{ backgroundColor:C.panel },
          headerTitleStyle:{ fontWeight:"800" }
        }}
      />

      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:24 }}>
        {/* Tabs */}
        <View style={{ backgroundColor:"#fff", borderRadius:12, borderWidth:1, borderColor:C.line, padding:4, flexDirection:"row", gap:6, marginBottom:12 }}>
          <Pressable
            onPress={()=>setTab("bank")}
            style={{ flex:1, paddingVertical:10, borderRadius:8, alignItems:"center", flexDirection:"row", justifyContent:"center", gap:8,
                     backgroundColor: tab==="bank" ? C.dark : "transparent" }}
          >
            <Feather name="credit-card" size={16} color={tab==="bank" ? "#fff" : C.text} />
            <Text style={{ fontWeight:"800", color: tab==="bank" ? "#fff" : C.text }}>Chuyển khoản</Text>
          </Pressable>
          <Pressable
            onPress={()=>setTab("cod")}
            style={{ flex:1, paddingVertical:10, borderRadius:8, alignItems:"center", flexDirection:"row", justifyContent:"center", gap:8,
                     backgroundColor: tab==="cod" ? C.dark : "transparent" }}
          >
            <Feather name="truck" size={16} color={tab==="cod" ? "#fff" : C.text} />
            <Text style={{ fontWeight:"800", color: tab==="cod" ? "#fff" : C.text }}>COD</Text>
          </Pressable>
        </View>

        {tab==="bank" ? (
          <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:16 }}>
            <Text style={{ textAlign:"center", color:C.sub }}>{hint}</Text>
            <Text style={{ textAlign:"center", fontWeight:"900", color:C.text, marginTop:6 }}>{ACCOUNT_NAME}</Text>
            <Text style={{ textAlign:"center", color:C.text, fontWeight:"800", marginTop:2 }}>{ACCOUNT_NO}</Text>
            <Text style={{ textAlign:"center", color:C.sub, marginTop:6 }}>Mã QR còn hiệu lực trong {mm}:{ss}</Text>

            <View style={{ alignItems:"center", marginTop:14 }}>
              <Image source={{ uri: gatewayQr ?? qrUrlFallback }} style={{ width:220, height:220 }} resizeMode="contain" />
            </View>

            <View style={{ alignItems:"center", marginTop:12 }}>
              <Text style={{ color:C.sub }}>Số tiền</Text>
              <Text style={{ color:C.text, fontSize:28, fontWeight:"900" }}>{fmtVnd(total)}</Text>
              <Text style={{ color:C.sub, marginTop:6 }}>Nội dung: {orderCode}</Text>
            </View>

            <Pressable
              disabled={paying}
              onPress={onPayVietQR}
              style={{ marginTop:16, backgroundColor:C.dark, paddingVertical:14, borderRadius:14, alignItems:"center", opacity: paying ? 0.6 : 1 }}
            >
              {paying ? <ActivityIndicator color="#fff" /> : <Text style={{ color:"#fff", fontWeight:"800" }}>Thanh toán VietQR</Text>}
            </Pressable>

            {/* Fallback thủ công: kiểm tra ngay trạng thái */}
            <Pressable
              disabled={checking}
              onPress={checkNow}
              style={{ marginTop:10, paddingVertical:10, borderRadius:12, alignItems:"center", borderWidth:1, borderColor:C.line, backgroundColor:"#fff", opacity: checking ? 0.6 : 1 }}
            >
              {checking ? <ActivityIndicator /> : (
                <Text style={{ color:C.text, fontWeight:"700" }}>
                  <Feather name="refresh-cw" size={14} />  Kiểm tra trạng thái
                </Text>
              )}
            </Pressable>

            {/* Không dùng nút “Tôi đã chuyển khoản” — chờ webhook/realtime/poll */}
          </View>
        ) : (
          <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:16 }}>
            <Text style={{ fontSize:18, fontWeight:"800", color:C.text, textAlign:"center" }}>Thanh toán khi nhận hàng (COD)</Text>
            <Text style={{ color:C.sub, textAlign:"center", marginTop:8 }}>Nhân viên giao hàng sẽ thu tiền mặt khi giao đơn.</Text>

            <View style={{ alignItems:"center", marginTop:16, padding:16, borderWidth:1, borderColor:C.line, borderRadius:12 }}>
              <Text style={{ color:C.sub }}>Số tiền</Text>
              <Text style={{ color:C.text, fontSize:28, fontWeight:"900" }}>{fmtVnd(total)}</Text>
              <Text style={{ color:C.sub, marginTop:6 }}>Đơn hàng #{orderId}</Text>
            </View>

            <Pressable
              disabled={saving}
              onPress={confirmCOD}
              style={{ marginTop:16, backgroundColor:C.dark, paddingVertical:14, borderRadius:14, alignItems:"center", opacity: saving ? 0.6 : 1 }}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color:"#fff", fontWeight:"800" }}>Xác nhận COD</Text>}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
