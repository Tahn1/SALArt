// app/pay/[id].tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Image, Alert, ActivityIndicator, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";

const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", dark:"#111827" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};

// Thông tin tài khoản (đổi theo thực tế)
const BANK_SHORT = "TCB";
const ACCOUNT_NO  = "19022024724012";
const ACCOUNT_NAME = "SALArt Vietnam";

export default function PayScreen(){
  const router = useRouter();
  const params = useLocalSearchParams();

  // ⚠️ id/amount có thể là string | string[] | undefined → chuẩn hoá
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawAmount = Array.isArray(params.amount) ? params.amount[0] : params.amount;

  const orderId = Number.parseInt(String(rawId ?? ""), 10);
  const total = useMemo(()=> {
    const n = Number(rawAmount ?? "0");
    return Number.isFinite(n) ? n : 0;
  }, [rawAmount]);

  const [tab, setTab] = useState<"bank"|"cod">("bank");
  const [saving, setSaving] = useState(false);

  // đếm ngược 15 phút cho QR
  const [left, setLeft] = useState(15*60);
  useEffect(()=>{ const t=setInterval(()=>setLeft(s=>Math.max(0,s-1)),1000); return ()=>clearInterval(t); },[]);
  const mm = String(Math.floor(left/60)).padStart(2,"0");
  const ss = String(left%60).padStart(2,"0");

  const orderCode = useMemo(()=>{
    const idStr = String(Number.isFinite(orderId) ? orderId : "").padStart(6, "0");
    return `SAL_${idStr}`;
  }, [orderId]);

  const qrUrl = useMemo(()=>{
    const info = encodeURIComponent(`Thanh toan don hang #${orderCode}`);
    const name = encodeURIComponent(ACCOUNT_NAME);
    const amt = Math.max(0, Math.round(total));
    return `https://img.vietqr.io/image/${BANK_SHORT}-${ACCOUNT_NO}-qr_only.png?amount=${amt}&addInfo=${info}&accountName=${name}`;
  }, [total, orderCode]);

  // === Realtime: chỉ nghe server đổi trạng thái → tự về Bill khi đã thanh toán
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
              router.replace(`/bill/${orderId}`);
            }
          }
        )
        .subscribe();
    })();

    return ()=>{ try{ ch && supabase.removeChannel(ch); }catch{} };
  }, [orderId]);

  // COD như cũ
  async function confirmCOD(){
    if (!Number.isFinite(orderId)) { Alert.alert("Lỗi", "Không xác định được mã đơn."); return; }
    setSaving(true);
    try{
      const { error } = await supabase
        .from("orders")
        .update({ payment_method:"cod", payment_status:"awaiting_cod" })
        .eq("id", orderId);
      if (error && !/column .* does not exist/i.test(error.message)) throw error;
      router.replace(`/bill/${orderId}`);
    }catch(e:any){
      Alert.alert("Lỗi", e?.message ?? "Vui lòng thử lại.");
    }finally{ setSaving(false); }
  }

  const hint =
    payStatus === "pending_confirm" ? "Hệ thống đã ghi nhận, đang chờ xác nhận giao dịch từ ngân hàng…"
    : payStatus === "paid" || payStatus === "paid_demo" ? "Đã thanh toán"
    : "Quét QR để chuyển khoản. Hệ thống sẽ tự cập nhật khi ngân hàng xác nhận thành công.";

  // ⛔ Guard: thiếu/ID không hợp lệ → tránh crash & báo điều hướng
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
              <Image source={{ uri: qrUrl }} style={{ width:220, height:220 }} resizeMode="contain" />
            </View>

            <View style={{ alignItems:"center", marginTop:12 }}>
              <Text style={{ color:C.sub }}>Số tiền</Text>
              <Text style={{ color:C.text, fontSize:28, fontWeight:"900" }}>{fmtVnd(total)}</Text>
              <Text style={{ color:C.sub, marginTop:6 }}>Nội dung: {orderCode}</Text>
            </View>

            {/* KHÔNG có nút “Tôi đã chuyển khoản” — chỉ dựa vào webhook server */}
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
