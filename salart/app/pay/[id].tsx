// app/pay/[id].tsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { View, Text, Pressable, Alert, ActivityIndicator, ScrollView, AppState, BackHandler } from "react-native";
import { Image } from "expo-image";
import QRCode from "react-native-qrcode-svg";
import { Stack, useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { clearCart, cancelActiveOrderIfAny } from "../../lib/cart";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveActiveOrder, loadActiveOrder, clearActiveOrder } from "../../lib/active-order";

const ORDER_KEY = "LAST_ORDER_ID";
const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", dark:"#111827" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};
const EXPIRE_MS = 15 * 60 * 1000;

type TOrder = {
  id: number;
  payment_status?: string | null;
  payment_method?: string | null;
  note?: any | null;
};

function parseNote(n: any): Record<string, any> {
  if (!n) return {};
  if (typeof n === "string") {
    try { return JSON.parse(n); } catch { return {}; }
  }
  return n;
}

export default function PayScreen(){
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams();

  // ===== Params
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawAmount = Array.isArray(params.amount) ? params.amount[0] : params.amount;
  const orderId = Number.parseInt(String(rawId ?? ""), 10);

  // guards
  const navigated   = useRef(false);
  const qrRequested = useRef(false);
  const leaveUnlocked = useRef(false); // cho phép rời màn khi thanh toán xong/hủy

  const wipePointers = async () => {
    try { await clearActiveOrder(); } catch {}
    try { await AsyncStorage.removeItem(ORDER_KEY); } catch {}
  };

  const goBill = React.useCallback(async () => {
    if (navigated.current) return;
    navigated.current = true;
    leaveUnlocked.current = true;
    try { clearCart?.(); } catch {}
    await wipePointers();
    router.replace(`/bill/${orderId}`);
  }, [orderId, router]);

  useEffect(() => {
    navigated.current = false;
    qrRequested.current = false;
    leaveUnlocked.current = false;
  }, [orderId]);

  // ======= Hủy đơn khi rời màn / back cứng => về GIỎ, trừ khi đã mở khóa =======
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", (e: any) => {
      if (leaveUnlocked.current) return;
      e.preventDefault();
      (async () => {
        await cancelActiveOrderIfAny();
        await wipePointers();
        router.replace("/(tabs)/cart");
      })();
    });

    const backSub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (leaveUnlocked.current) return false;
      (async () => {
        await cancelActiveOrderIfAny();
        await wipePointers();
        router.replace("/(tabs)/cart");
      })();
      return true;
    });

    return () => {
      try { unsub(); } catch {}
      try { backSub.remove(); } catch {}
    };
  }, [navigation, router, orderId]);

  // ===== state
  const [dbOrder, setDbOrder] = useState<TOrder | null>(null);
  const [storedAmount, setStoredAmount] = useState<number | null>(null);
  const [cachedQR, setCachedQR] = useState<string | null>(null);
  const [cachedExp, setCachedExp] = useState<number | null>(null);
  const [cachedEff, setCachedEff] = useState<number | null>(null);

  // hydrate cache
  useEffect(() => {
    if (!Number.isFinite(orderId)) return;
    (async () => {
      try {
        const ao = await loadActiveOrder();
        if (ao && ao.orderId === orderId) {
          if (Number(ao.amount) > 0) setStoredAmount(Number(ao.amount));
          if (ao.qr && ao.expiresAt && ao.expiresAt > Date.now()) {
            setCachedQR(ao.qr); setCachedExp(ao.expiresAt);
            setCachedEff(ao.effectiveAmount ?? null);
            qrRequested.current = true;
          }
        }
      } catch {}
      try {
        const { data } = await supabase
          .from("payments")
          .select("amount_vnd")
          .eq("order_id", orderId)
          .order("paid_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        const amt = Number(data?.amount_vnd ?? 0);
        if (amt > 0) setStoredAmount(amt);
      } catch {}
    })();
  }, [orderId]);

  // ==== lấy đơn (không đọc/ghi order_code)
  useEffect(()=>{
    if (!Number.isFinite(orderId)) return;
    (async ()=>{
      const { data, error } = await supabase
        .from("orders")
        .select("id, payment_status, payment_method, note")
        .eq("id", orderId)
        .maybeSingle();
      if (error) { console.warn(error); return; }
      const row = (data as TOrder) || null;

      if (!row) {
        Alert.alert("Không tìm thấy đơn hàng", "Vui lòng quay lại giỏ hàng để tạo đơn mới.");
        return;
      }

      if (row?.payment_status === "paid" || row?.payment_status === "paid_demo") {
        leaveUnlocked.current = true;
        await goBill();
        return;
      }

      setDbOrder({ ...row, note: parseNote(row?.note) });
    })();
  }, [orderId, goBill]);

  // MÃ ĐƠN hiển thị: luôn SAL_{orderId}
  const orderCode = useMemo(
    () => `SAL_${String(orderId).padStart(6, "0")}`,
    [orderId]
  );

  // tổng từ note
  const noteObj = useMemo(()=> parseNote(dbOrder?.note), [dbOrder]);
  const noteTotal = useMemo(() => {
    const cands = [
      noteObj?.GRAND_TOTAL, noteObj?.grand_total,
      noteObj?.TOTAL, noteObj?.total, noteObj?.GRANDTOTAL
    ];
    const v = Number(cands.find((x:any)=> x!=null));
    return Number.isFinite(v) && v>0 ? v : 0;
  }, [noteObj]);

  // tổng tiền ưu tiên (không đọc từ DB)
  const total = useMemo(()=>{
    const fromUrl = Number(rawAmount ?? "0");
    if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
    if (noteTotal > 0) return noteTotal;
    const fromCache = Number(storedAmount ?? 0);
    if (Number.isFinite(fromCache) && fromCache > 0) return fromCache;
    return 0;
  }, [rawAmount, noteTotal, storedAmount]);

  // 🔧 Mặc định mở tab COD để không tự tạo PayOS
  const [tab, setTab] = useState<"bank"|"cod">("cod");
  const [saving, setSaving] = useState(false);
  const [loadingQR, setLoadingQR] = useState(false);
  const [canceling, setCanceling] = useState(false);

  // ===== Hạn QR
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  useEffect(()=>{ const t=setInterval(()=>setNowTs(Date.now()),1000); return ()=>clearInterval(t); },[]);
  const expired = (expiresAt ?? cachedExp ?? 0) !== 0 && nowTs >= (expiresAt ?? cachedExp ?? 0);
  const leftSec = useMemo(()=>{
    const e = expiresAt ?? cachedExp;
    return e ? Math.max(0, Math.floor((e - nowTs)/1000)) : 0;
  }, [expiresAt, cachedExp, nowTs]);
  const mm = String(Math.floor(leftSec/60)).padStart(2,"0");
  const ss = String(leftSec%60).padStart(2,"0");

  // QR PayOS
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrContent, setQrContent] = useState<string | null>(null);

  // test info
  const [testInfo, setTestInfo] = useState<{ effective: number; original: number } | null>(null);
  const amountOnQr = useMemo(()=> {
    const eff = (testInfo?.effective ?? cachedEff ?? null);
    return eff ?? Math.round(total);
  }, [testInfo, cachedEff, total]);

  // Realtime
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
          async (payload)=>{
            const s = (payload.new as any)?.payment_status;
            if (!s) return;
            setPayStatus(String(s));
            if (s === "paid" || s === "paid_demo") {
              leaveUnlocked.current = true;
              await goBill();
            } else if (String(s) === "canceled") {
              await wipePointers();
              leaveUnlocked.current = true;
              router.replace("/");
            } else if (["expired","failed"].includes(String(s))) {
              await wipePointers();
              router.replace("/(tabs)/cart");
            }
          }
        )
        .subscribe();
    })();

    return ()=>{ try{ ch && supabase.removeChannel(ch); }catch{} };
  }, [orderId, goBill, router]);

  // Foreground check
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'active') {
        const { data } = await supabase.from('orders').select('payment_status').eq('id', orderId).maybeSingle();
        const st = data?.payment_status;
        if (st === "paid" || st === "paid_demo") {
          leaveUnlocked.current = true;
          await goBill();
        } else if (st === "canceled") {
          await wipePointers();
          leaveUnlocked.current = true;
          router.replace("/");
        } else if (["expired","failed"].includes(String(st))) {
          await wipePointers();
          router.replace("/(tabs)/cart");
        }
      }
    });
    return () => sub.remove();
  }, [orderId, goBill, router]);

  // Polling dự phòng
  useEffect(() => {
    if (!Number.isFinite(orderId)) return;
    const itv = setInterval(async () => {
      if (navigated.current) return;
      const { data } = await supabase
        .from("orders")
        .select("payment_status")
        .eq("id", orderId)
        .maybeSingle();
      const st = data?.payment_status;
      if (st === "paid" || st === "paid_demo") {
        leaveUnlocked.current = true;
        await goBill();
      } else if (st === "canceled") {
        await wipePointers();
        leaveUnlocked.current = true;
        router.replace("/");
      }
    }, 3000);
    return () => clearInterval(itv);
  }, [orderId, goBill]);

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

  async function ensureOrderBeforePayment() {
    const { data: cur } = await supabase
      .from("orders")
      .select("payment_status")
      .eq("id", orderId)
      .maybeSingle();

    if (cur?.payment_status === "paid" || cur?.payment_status === "paid_demo") {
      leaveUnlocked.current = true;
      await goBill();
      throw new Error("ALREADY_PAID");
    }

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

    await saveActiveOrder({
      orderId,
      orderCode,
      amount: Math.round(total),
      createdAt: Date.now(),
    });
  }

  // ===== Gọi PayOS
  async function createPayQR(forceNew = false){
    if (!Number.isFinite(orderId)) { Alert.alert("Lỗi", "Không xác định được mã đơn."); return; }
    if (!Number.isFinite(total) || total <= 0) {
      Alert.alert("Lỗi", "Số tiền không hợp lệ. Vui lòng về Hóa đơn.");
      return;
    }
    try{
      if (loadingQR) return;
      setLoadingQR(true);

      await ensureOrderBeforePayment();

      const { data, error } = await supabase.functions.invoke<any>("payos-create-payment", {
        body: {
          orderCode: orderId,
          displayCode: orderCode,
          amount: Math.round(total),
          description: `SALART - Đơn ${orderCode}`,
          forceNew,
        }
      });

      if (error) {
        const ctx = (error as any)?.context ?? {};
        const status = ctx?.status;
        let reason = "";
        const body = ctx?.body;
        if (typeof body === "string" && body.trim()) {
          try { const j = JSON.parse(body); reason = j?.error || j?.message || j?.desc || ""; }
          catch { reason = body.slice(0, 300); }
        }
        if (!reason) reason = "Không gọi được cổng thanh toán.";
        Alert.alert("Thông báo", `${reason}${status ? ` (HTTP ${status})` : ""}`);
        return;
      }

      const payload = data || {};
      if (payload?.ok === false) {
        const reason = payload?.error || payload?.raw?.desc || payload?.raw?.message || "Không nhận được QR từ cổng.";
        Alert.alert("Thông báo", String(reason));
        return;
      }

      const anyQr =
        payload?.data?.qrCodeUrl ?? payload?.qrCodeUrl ??
        payload?.data?.qrImageUrl?? payload?.qrImageUrl ??
        payload?.data?.qrCode    ?? payload?.qrCode ??
        payload?.data?.qr_content?? payload?.qr_content ?? null;

      const eff = Number(payload?.data?.effectiveAmount ?? 0);
      const orig = Math.round(total);
      if (Number.isFinite(eff) && eff > 0 && eff !== orig) {
        setTestInfo({ effective: eff, original: orig });
      } else {
        setTestInfo(null);
      }

      const exp = Date.now() + EXPIRE_MS;
      if (typeof anyQr === "string") {
        if (/^https?:\/\//i.test(anyQr) || anyQr.startsWith("data:image")) {
          setQrUrl(anyQr); setQrContent(null); setExpiresAt(exp);
        } else {
          setQrContent(anyQr); setQrUrl(null); setExpiresAt(exp);
        }
      } else {
        Alert.alert("Thông báo", "Không nhận được QR từ PayOS. Vui lòng thử lại.");
        return;
      }

      await saveActiveOrder({
        orderId,
        orderCode,
        amount: Math.round(total),
        gateway: "payos",
        ref: payload?.data?.id ?? payload?.data?.orderCode ?? null,
        qr: anyQr,
        expiresAt: exp,
        effectiveAmount: Number.isFinite(eff) && eff>0 ? eff : undefined,
        createdAt: Date.now(),
      });
    }catch(e:any){
      if (String(e?.message) !== "ALREADY_PAID") {
        Alert.alert("Lỗi", e?.message ?? "Không tạo được QR. Vui lòng thử lại.");
      }
    }finally{
      setLoadingQR(false);
    }
  }

  // 🔒 Chỉ tự tạo QR khi đang ở tab "bank"
  useEffect(() => {
    if (tab !== "bank") return;
    if (!Number.isFinite(orderId)) return;
    if (navigated.current) return;
    if (payStatus === "paid" || payStatus === "paid_demo") return;
    if (qrRequested.current) return;
    const amt = Math.round(Number(total || 0));
    if (amt > 0) {
      qrRequested.current = true;
      createPayQR(false);
    }
  }, [orderId, total, payStatus, tab]);

  // ✅ Nếu chuyển SANG COD: hạ PayOS pending → failed, xoá QR cache, reset đơn về unpaid
  useEffect(() => {
    if (tab !== "cod") return;
    (async () => {
      try {
        // đóng pending PayOS
        await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("order_id", orderId)
          .eq("gateway", "payos")
          .in("status", ["pending"]);

        // reset đơn về unpaid nếu đang chờ xác nhận ngân hàng
        await supabase
          .from("orders")
          .update({ payment_method: null, payment_status: "unpaid" })
          .eq("id", orderId)
          .in("payment_status", ["pending_confirm"]);

        // xoá QR/cache cục bộ
        try { await clearActiveOrder(); } catch {}
        setQrUrl(null);
        setQrContent(null);
        setExpiresAt(null);
        setCachedQR(null);
        setCachedExp(null);
        setCachedEff(null);
        setTestInfo(null);
        qrRequested.current = false;
      } catch (e) {
        console.warn("soft-cancel payos when switching to COD", e);
      }
    })();
  }, [tab, orderId]);

  // Nút: Tạo lại QR
  async function handleRecreateQR(){
    try {
      setQrUrl(null);
      setQrContent(null);
      setExpiresAt(null);
      setTestInfo(null);
      setCachedQR(null);
      setCachedExp(null);
      setCachedEff(null);
      qrRequested.current = false;
      await createPayQR(true);
    } catch (e:any) {
      Alert.alert("Lỗi", e?.message ?? "Không tạo lại được QR.");
    }
  }

  // HỦY THANH TOÁN → cập nhật DB, dọn cache, về Trang chủ
  async function handleCancelAndGoHome() {
    if (!Number.isFinite(orderId)) return;
    setCanceling(true);
    try {
      await supabase
        .from("orders")
        .update({ payment_status: "canceled", payment_method: null })
        .eq("id", orderId)
        .in("payment_status", ["unpaid", "pending_confirm"]);

      await supabase
        .from("payments")
        .update({ status: "failed" })
        .eq("order_id", orderId)
        .in("status", ["pending"]);

      await cancelActiveOrderIfAny();
      await wipePointers();

      leaveUnlocked.current = true;
      navigated.current = true;
      router.replace("/");
    } catch (e:any) {
      Alert.alert("Lỗi", e?.message ?? "Không hủy được thanh toán. Vui lòng thử lại.");
    } finally {
      setCanceling(false);
    }
  }

  // COD
  async function confirmCOD(){
    if (!Number.isFinite(orderId)) { Alert.alert("Lỗi", "Không xác định được mã đơn."); return; }
    setSaving(true);
    try{
      // 🔻 Đóng mọi PayOS pending (bảo hiểm lần nữa)
      await supabase
        .from("payments")
        .update({ status: "failed" })
        .eq("order_id", orderId)
        .eq("gateway", "payos")
        .in("status", ["pending"]);

      // 🧹 Dọn cache QR
      try { await clearActiveOrder(); } catch {}
      setQrUrl(null); setQrContent(null);
      setExpiresAt(null); setCachedQR(null); setCachedExp(null); setCachedEff(null);
      qrRequested.current = false;

      // Tiêu hao tồn kho (nếu chưa)
      const { error: eStock } = await supabase.rpc("consume_stock_for_order", { p_order_id: orderId });
      if (eStock && !/ALREADY_CONSUMED/i.test(String(eStock.message||""))) {
        if (/OUT_OF_STOCK/i.test(String(eStock.message||""))) throw new Error("Hết nguyên liệu cho một số món. Vui lòng điều chỉnh đơn.");
        throw eStock;
      }

      const nowIso = new Date().toISOString();
      // Ghi payment COD đã trả
      await upsertPayment({
        method: "cod",
        status: "paid",
        amount_vnd: Math.round(total),
        order_code: orderCode,
        paid_at: nowIso
      });

      // Cập nhật đơn sang COD + paid
      const { error: ePaid } = await supabase
        .from("orders")
        .update({ payment_method:"cod", payment_status:"paid", paid_at: nowIso })
        .eq("id", orderId);
      if (ePaid) throw ePaid;

      leaveUnlocked.current = true;
      await goBill();
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

  const totalIsZero = !Number.isFinite(total) || total <= 0;
  const showCachedQR = !!cachedQR && !expired;

  const renderQR = () => {
    if (loadingQR) return <ActivityIndicator />;
    if (showCachedQR) {
      if (/^https?:\/\//i.test(cachedQR!) || cachedQR!.startsWith("data:image")) {
        return <Image source={{ uri: cachedQR! }} style={{ width:220, height:220, borderRadius:12 }} contentFit="contain" />;
      }
      return <QRCode value={cachedQR!} size={220} />;
    }
    if (qrUrl) return <Image source={{ uri: qrUrl }} style={{ width:220, height:220, borderRadius:12 }} contentFit="contain" />;
    if (qrContent) return <QRCode value={qrContent} size={220} />;
    return <Text style={{ color:C.sub, textAlign:"center" }}>{ totalIsZero ? "Không xác định được số tiền. Vui lòng về Hóa đơn và mở lại." : "Không tải được QR. Vui lòng bấm “Tạo lại QR”." }</Text>;
  };

  return (
    <View style={{ flex:1, backgroundColor:C.bg }}>
      <Stack.Screen
        options={{
          headerShown:true,
          title:`Thanh toán ${orderCode}`,
          headerShadowVisible:false,
          headerStyle:{ backgroundColor:C.panel },
          headerTitleStyle:{ fontWeight:"800" }
        }}
      />

      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:24 }}>
        {/* Tabs */}
        <View style={{ backgroundColor:"#fff", borderRadius:12, borderWidth:1, borderColor:C.line, padding:4, flexDirection:"row", gap:6, marginBottom:12 }}>
          <Pressable onPress={()=>setTab("bank")} style={{ flex:1, paddingVertical:10, borderRadius:8, alignItems:"center", flexDirection:"row", justifyContent:"center", gap:8, backgroundColor: tab==="bank" ? C.dark : "transparent" }}>
            <Feather name="credit-card" size={16} color={tab==="bank" ? "#fff" : C.text} />
            <Text style={{ fontWeight:"800", color: tab==="bank" ? "#fff" : C.text }}>Chuyển khoản</Text>
          </Pressable>
          <Pressable onPress={()=>setTab("cod")} style={{ flex:1, paddingVertical:10, borderRadius:8, alignItems:"center", flexDirection:"row", justifyContent:"center", gap:8, backgroundColor: tab==="cod" ? C.dark : "transparent" }}>
            <Feather name="truck" size={16} color={tab==="cod" ? "#fff" : C.text} />
            <Text style={{ fontWeight:"800", color: tab==="cod" ? "#fff" : C.text }}>COD</Text>
          </Pressable>
        </View>

        {tab==="bank" ? (
          <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:16 }}>
            <Text style={{ textAlign:"center", color:C.sub }}>{hint}</Text>

            <Text style={{ textAlign:"center", color:C.sub, marginTop:6 }}>
              {(expiresAt ?? cachedExp) === null
                ? (loadingQR ? "Đang tạo mã QR…" : "Đang chờ QR từ PayOS…")
                : expired ? "Mã QR đã hết hạn"
                : `Mã QR còn hiệu lực trong ${mm}:${ss}`}
            </Text>

            {expired && (
              <View style={{ padding:12, borderRadius:10, backgroundColor:"#FFF4ED", borderWidth:1, borderColor:"#FFD8BF", marginTop:12 }}>
                <Text style={{ color:"#B35300", marginBottom:8, textAlign:"center" }}>Mã QR đã hết hạn sau 15 phút.</Text>
                <Pressable onPress={handleRecreateQR} style={{ paddingVertical:12, borderRadius:10, backgroundColor:"#111827", alignItems:"center" }}>
                  <Text style={{ color:"#fff", fontWeight:"600" }}>Tạo lại QR</Text>
                </Pressable>
              </View>
            )}

            {(testInfo || cachedEff) && (
              <View style={{ padding:12, borderRadius:10, backgroundColor:"#FEF9C3", borderWidth:1, borderColor:"#FDE68A", marginTop:12 }}>
                <Text style={{ color:"#92400E", textAlign:"center" }}>
                  Đang test luồng thật: QR dùng {fmtVnd(cachedEff ?? testInfo!.effective)} thay vì tổng đơn {fmtVnd(Math.round(total))}.
                </Text>
              </View>
            )}

            <View style={{ alignItems:"center", marginTop:14, minHeight:236, justifyContent:"center" }}>
              {renderQR()}
            </View>

            <View style={{ alignItems:"center", marginTop:12 }}>
              <Text style={{ color:C.sub }}>{(testInfo || cachedEff) ? "Số tiền trên QR" : "Số tiền"}</Text>
              <Text style={{ color:C.text, fontSize:28, fontWeight:"900" }}>{fmtVnd(amountOnQr)}</Text>
              {(testInfo || cachedEff) && (
                <Text style={{ color:C.sub, marginTop:4 }}>Tổng đơn: {fmtVnd(Math.round(total))}</Text>
              )}
              <Text style={{ color:C.sub, marginTop:6 }}>Nội dung: {orderCode}</Text>

              {totalIsZero && (
                <Pressable onPress={()=>router.replace("/(tabs)/cart")} style={{ marginTop:12, paddingVertical:10, paddingHorizontal:16, borderRadius:10, backgroundColor:C.dark }}>
                  <Text style={{ color:"#fff", fontWeight:"800" }}>Về Giỏ hàng</Text>
                </Pressable>
              )}

              {/* Nút hủy thanh toán => cập nhật 'canceled' & về Trang chủ */}
              <Pressable
                onPress={handleCancelAndGoHome}
                disabled={canceling}
                style={{ marginTop:12, paddingVertical:10, paddingHorizontal:16, borderRadius:10, borderWidth:1, borderColor:C.line, opacity: canceling ? 0.6 : 1 }}
              >
                <Text style={{ color:C.text, fontWeight:"800" }}>
                  {canceling ? "Đang hủy…" : "Hủy thanh toán & về Trang chủ"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:16 }}>
            <Text style={{ fontSize:18, fontWeight:"800", color:C.text, textAlign:"center" }}>Thanh toán khi nhận hàng (COD)</Text>
            <Text style={{ color:C.sub, textAlign:"center", marginTop:8 }}>Nhân viên giao hàng sẽ thu tiền mặt khi giao đơn.</Text>

            <View style={{ alignItems:"center", marginTop:16, padding:16, borderWidth:1, borderColor:C.line, borderRadius:12 }}>
              <Text style={{ color:C.sub }}>Số tiền</Text>
              <Text style={{ color:C.text, fontSize:28, fontWeight:"900" }}>{fmtVnd(total)}</Text>
              <Text style={{ color:C.sub, marginTop:6 }}>Đơn hàng {orderCode}</Text>
            </View>

            <Pressable
              disabled={saving || totalIsZero}
              onPress={confirmCOD}
              style={{ marginTop:16, backgroundColor:C.dark, paddingVertical:14, borderRadius:14, alignItems:"center", opacity: (saving || totalIsZero) ? 0.6 : 1 }}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color:"#fff", fontWeight:"800" }}>Xác nhận COD</Text>}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
