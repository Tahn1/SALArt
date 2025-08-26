// app/pay/[id].tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Alert, ActivityIndicator, ScrollView, AppState } from "react-native";
import { Image } from "expo-image";
import QRCode from "react-native-qrcode-svg";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { clearCart } from "../../lib/cart";

const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", dark:"#111827" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};

// Thời hạn QR 15 phút
const EXPIRE_MS = 15 * 60 * 1000;

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
  const [saving, setSaving] = useState(false);         // COD
  const [loadingQR, setLoadingQR] = useState(false);   // BANK (load QR)

  // ===== Hạn QR
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  useEffect(()=>{ const t=setInterval(()=>setNowTs(Date.now()),1000); return ()=>clearInterval(t); },[]);
  const expired = expiresAt !== null && nowTs >= expiresAt;
  const leftSec = useMemo(()=> expiresAt ? Math.max(0, Math.floor((expiresAt - nowTs)/1000)) : 0, [expiresAt, nowTs]);
  const mm = String(Math.floor(leftSec/60)).padStart(2,"0");
  const ss = String(leftSec%60).padStart(2,"0");

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

  // QR từ PayOS
  const [qrUrl, setQrUrl] = useState<string | null>(null);       // URL ảnh QR (nếu PayOS trả URL)
  const [qrContent, setQrContent] = useState<string | null>(null); // Chuỗi payload QR (nếu PayOS trả chuỗi)

  // 👉 Thông tin test: số tiền trên QR khác tổng đơn
  const [testInfo, setTestInfo] = useState<{ effective: number; original: number } | null>(null);
  const amountOnQr = useMemo(()=> testInfo?.effective ?? Math.round(total), [testInfo, total]);

  // Realtime → tự về Bill
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
            } else if (s === "canceled" || s === "expired" || s === "failed") {
              router.replace(`/bill/${orderId}`);
            }
          }
        )
        .subscribe();
    })();

    return ()=>{ try{ ch && supabase.removeChannel(ch); }catch{} };
  }, [orderId]);

  // Khi app trở lại foreground -> kiểm tra 1 lần
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'active') {
        const { data } = await supabase.from('orders').select('payment_status').eq('id', orderId).maybeSingle();
        const st = data?.payment_status;
        if (st === "paid" || st === "paid_demo") {
          clearCart?.();
          router.replace(`/bill/${orderId}`);
        } else if (st === "canceled" || st === "expired" || st === "failed") {
          router.replace(`/bill/${orderId}`);
        }
      }
    });
    return () => sub.remove();
  }, [orderId]);

  // ===== Helpers payments
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

  // ===== Tạo link PayOS → lấy QR (URL hoặc payload), KHÔNG mở web
  async function createPayQR(forceNew = false){
    if (!Number.isFinite(orderId)) { Alert.alert("Lỗi", "Không xác định được mã đơn."); return; }
    if (!Number.isFinite(total) || total <= 0) { Alert.alert("Lỗi", "Số tiền không hợp lệ."); return; }
    try{
      if (loadingQR) return;
      setLoadingQR(true);

      await ensureOrderBeforePayment();

      const { data, error } = await supabase.functions.invoke<any>("payos-create-payment", {
        body: {
          orderCode: orderId,          // PayOS yêu cầu SỐ
          displayCode: orderCode,      // gửi kèm mã SAL_... nếu server cần
          amount: Math.round(total),
          description: `SALART - Đơn ${orderCode}`,
          forceNew,
        }
      });

      if (error) {
        console.log("payos-create-payment ERROR ctx:", (error as any)?.context);
        const ctx = (error as any)?.context ?? {};
        const status = ctx?.status;
        let reason = "";
        const body = ctx?.body;

        if (typeof body === "string" && body.trim()) {
          try {
            const j = JSON.parse(body);
            reason = j?.error || j?.message || j?.desc || "";
          } catch {
            reason = body.slice(0, 300);
          }
        }
        if (!reason) reason = "Không gọi được cổng thanh toán.";
        Alert.alert("Thông báo", `${reason}${status ? ` (HTTP ${status})` : ""}`);
        return;
      }

      const payload = data || {};
      if (payload?.ok === false) {
        const reason =
          payload?.error ||
          payload?.raw?.desc ||
          payload?.raw?.message ||
          "Không nhận được QR từ cổng.";
        Alert.alert("Thông báo", String(reason));
        return;
      }

      // Lấy URL ảnh hoặc chuỗi payload
      const anyQr =
        payload?.data?.qrCodeUrl ?? payload?.qrCodeUrl ??
        payload?.data?.qrImageUrl?? payload?.qrImageUrl ??
        payload?.data?.qrCode    ?? payload?.qrCode ??
        payload?.data?.qr_content?? payload?.qr_content ??
        null;

      // test-mode: amount hiệu lực khác tổng đơn
      const eff = Number(payload?.data?.effectiveAmount ?? 0);
      const orig = Math.round(total);
      if (Number.isFinite(eff) && eff > 0 && eff !== orig) {
        setTestInfo({ effective: eff, original: orig });
      } else {
        setTestInfo(null);
      }

      if (typeof anyQr === "string") {
        // Nếu là URL ảnh hoặc data:image -> hiển thị bằng Image
        if (/^https?:\/\//i.test(anyQr) || anyQr.startsWith("data:image")) {
          setQrUrl(anyQr);
          setQrContent(null);
          setExpiresAt(Date.now() + EXPIRE_MS);
          return;
        }
        // Còn lại coi như là "payload" -> vẽ QR trực tiếp
        setQrContent(anyQr);
        setQrUrl(null);
        setExpiresAt(Date.now() + EXPIRE_MS);
        return;
      }

      Alert.alert("Thông báo", "Không nhận được QR từ PayOS. Vui lòng thử lại.");
    }catch(e:any){
      Alert.alert("Lỗi", e?.message ?? "Không tạo được QR. Vui lòng thử lại.");
    }finally{
      setLoadingQR(false);
    }
  }

  // Gọi tạo QR ngay khi vào màn
  useEffect(() => {
    if (Number.isFinite(orderId)) createPayQR(false);
  }, [orderId]);

  // Nút: Tạo lại QR khi hết hạn
  async function handleRecreateQR(){
    try {
      setQrUrl(null);
      setQrContent(null);
      setExpiresAt(null);
      setTestInfo(null);
      await createPayQR(true);
    } catch (e:any) {
      Alert.alert("Lỗi", e?.message ?? "Không tạo lại được QR.");
    }
  }

  // Nút: Xác nhận COD
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
    : "Quét mã VietQR. Hệ thống sẽ tự cập nhật khi ngân hàng xác nhận thành công.";

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

            <Text style={{ textAlign:"center", color:C.sub, marginTop:6 }}>
              {expiresAt === null
                ? (loadingQR ? "Đang tạo mã QR…" : "Đang chờ QR từ PayOS…")
                : expired ? "Mã QR đã hết hạn"
                : <>Mã QR còn hiệu lực trong {mm}:{ss}</>}
            </Text>

            {/* Banner hết hạn + CTA tạo lại */}
            {expired && (
              <View style={{ padding:12, borderRadius:10, backgroundColor:"#FFF4ED", borderWidth:1, borderColor:"#FFD8BF", marginTop:12 }}>
                <Text style={{ color:"#B35300", marginBottom:8, textAlign:"center" }}>
                  Mã QR đã hết hạn sau 15 phút.
                </Text>
                <Pressable
                  onPress={handleRecreateQR}
                  style={{ paddingVertical:12, borderRadius:10, backgroundColor:"#111827", alignItems:"center" }}>
                  <Text style={{ color:"#fff", fontWeight:"600" }}>Tạo lại QR</Text>
                </Pressable>
              </View>
            )}

            {/* Banner test: amount trên QR khác tổng đơn */}
            {testInfo && (
              <View style={{ padding:12, borderRadius:10, backgroundColor:"#FEF9C3", borderWidth:1, borderColor:"#FDE68A", marginTop:12 }}>
                <Text style={{ color:"#92400E", textAlign:"center" }}>
                  Đang test luồng thật: QR dùng {fmtVnd(testInfo.effective)} thay vì tổng đơn {fmtVnd(testInfo.original)}.
                </Text>
              </View>
            )}

            <View style={{ alignItems:"center", marginTop:14, minHeight:236, justifyContent:"center" }}>
              {loadingQR && <ActivityIndicator />}
              {!loadingQR && qrUrl && (
                <Image source={{ uri: qrUrl }} style={{ width:220, height:220, borderRadius:12 }} contentFit="contain" />
              )}
              {!loadingQR && !qrUrl && qrContent && (
                <QRCode value={qrContent} size={220} />
              )}
              {!loadingQR && !qrUrl && !qrContent && (
                <Text style={{ color:C.sub }}>Không tải được QR. Vui lòng bấm “Tạo lại QR”.</Text>
              )}
            </View>

            <View style={{ alignItems:"center", marginTop:12 }}>
              <Text style={{ color:C.sub }}>{testInfo ? "Số tiền trên QR" : "Số tiền"}</Text>
              <Text style={{ color:C.text, fontSize:28, fontWeight:"900" }}>{fmtVnd(amountOnQr)}</Text>
              {testInfo && (
                <Text style={{ color:C.sub, marginTop:4 }}>Tổng đơn: {fmtVnd(testInfo.original)}</Text>
              )}
              <Text style={{ color:C.sub, marginTop:6 }}>Nội dung: {orderCode}</Text>
            </View>

            {/* KHÔNG có nút “Thanh toán VietQR” và KHÔNG có nút “Kiểm tra trạng thái” */}
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
