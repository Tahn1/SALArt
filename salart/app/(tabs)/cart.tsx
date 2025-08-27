// app/(tabs)/cart.tsx — CartScreen (NO MAP) + Add-on stock limits + NAV→BILL (jsonb)
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, ActivityIndicator, ScrollView, Pressable, Text, TextInput, View, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import * as Location from "expo-location";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useCart, removeLine, removeAddon, setAddonQty, cancelActiveOrderIfAny } from "../../lib/cart"; // ⬅ thêm cancelActiveOrderIfAny
import { STORE } from "../../lib/store";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

// 🟡 Helper lưu đơn đang chờ (chỉ dùng để lưu/đọc ngầm, không hiển thị banner)
import {
  saveActiveOrder,
  loadActiveOrder,
} from "../../lib/active-order";

const ORDER_KEY = "LAST_ORDER_ID"; // back-compat

const GEOAPIFY_KEY = process.env.EXPO_PUBLIC_GEOAPIFY_KEY || "";

const C = { bg:"#F6F2EA", panel:"#FFFFFF", text:"#111827", sub:"#6B7280", line:"#E5E7EB", good:"#16a34a", danger:"#dc2626" };
const fmtVnd = (n=0)=>{ try{ return n.toLocaleString("vi-VN")+" đ"; }catch{ return `${Math.round(n)} đ`; }};

const FEE_PER_STEP = 500;   // 500đ mỗi 0.1km
const STEP_KM = 0.1;
const VAT_RATE = 0.08;

const MIN_QUERY_CHARS = 4;
const DEBOUNCE_MS = 600;
const MAX_SUGGESTIONS = 4;

type AvailRow = { dish_id:number; available_servings:number|null };
type SuggestItem = { id: string; label: string; lat: number; lng: number; precise: boolean };

// ===== Helpers =====
function haversineKm(lat1:number, lon1:number, lat2:number, lon2:number){
  const toRad=(x:number)=>(x*Math.PI)/180; const R=6371;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function isFiniteCoord(v:any){ return typeof v==="number" && isFinite(v); }

// Heuristic tiếng Việt cho nhập tay
const STREET_KEYWORDS = [
  "đường","duong","phố","pho","ngõ","ngo","hẻm","hem","hxh",
  "quốc lộ","ql","tỉnh lộ","tl","đt","dt","ấp","ap","thôn","thon","xóm","xom","khu phố","kp"
];
const BUILDING_KEYWORDS = [
  "tòa","toa","chung cư","cc","building","tower","block","residence","plaza","mall",
  "vinhomes","landmark","ecopark","smart city","royal city","times city","the manor",
  "campus","bệnh viện","benh vien","bv","trường","truong","đại học","dai hoc",
  "công ty","cong ty","company","office","văn phòng","van phong"
];
function isDetailedAddress(raw: string): boolean {
  if (!raw) return false;
  const s = raw.trim().toLowerCase();
  if (s.length < 8) return false;
  const hasNumber = /\d/.test(s);
  const hasStreet = STREET_KEYWORDS.some(k => s.includes(k));
  const hasBuilding = BUILDING_KEYWORDS.some(k => s.includes(k));
  const hasHouseNumberLike =
    /\b((số|so)\s*)?\d{1,4}[a-z\-\/]?\b/.test(s) || /\b\d+\/\d+\b/.test(s);
  return (hasStreet && (hasHouseNumberLike || hasBuilding)) || (hasBuilding && hasNumber);
}

// “Chính xác” với Geoapify: có số nhà HOẶC tên POI/toà nhà
function preciseByProps(p:any){
  const hasHouse = !!p?.housenumber;
  const hasPOI = !!p?.name || !!p?.building;
  const rt = String(p?.result_type || "");
  const goodTypes = ["building","amenity","house","address","poi"];
  return hasHouse || hasPOI || goodTypes.includes(rt);
}

// ===== So sánh giỏ hiện tại và snapshot trong ActiveOrder =====
function normAddons(arr:any[] = []) {
  return arr.map(a => ({
    id: String(a.id),
    qty_units: Number(a.qty_units || 0),
    extra_price_vnd_per_unit: Number(a.extra_price_vnd_per_unit || 0),
  })).sort((x,y)=>x.id.localeCompare(y.id));
}
function normSnapshotItems(list:any[] = []) {
  // list có thể đến từ snapshot đã lưu hoặc tự build từ cart
  return list.map(it => ({
    name: String(it.name || ""),
    qty: Number(it.qty || 0),
    base_price_vnd: Number(it.base_price_vnd || 0),
    addons: normAddons(it.addons || []),
  })).sort((a,b)=>{
    const ka = `${a.name}|${a.base_price_vnd}|${a.qty}|${a.addons.map(z=>`${z.id}:${z.qty_units}:${z.extra_price_vnd_per_unit}`).join(",")}`;
    const kb = `${b.name}|${b.base_price_vnd}|${b.qty}|${b.addons.map(z=>`${z.id}:${z.qty_units}:${z.extra_price_vnd_per_unit}`).join(",")}`;
    return ka.localeCompare(kb);
  });
}
function buildSnapshotFromCart(items:any[]) {
  return items.map((it:any)=>({
    name: it.name,
    qty: it.qty,
    base_price_vnd: it.base_price_vnd,
    addons: (it.addons ?? []).map((a:any)=>({
      id:a.id, name:a.name, qty_units:a.qty_units, extra_price_vnd_per_unit:a.extra_price_vnd_per_unit
    })),
  }));
}
function sameCartSnapshot(a:any[], b:any[]) {
  const A = JSON.stringify(normSnapshotItems(a));
  const B = JSON.stringify(normSnapshotItems(b));
  return A === B;
}

export default function CartScreen(){
  const insets = useSafeAreaInsets();
  const tabH   = useBottomTabBarHeight();
  const bottomSpace = (insets.bottom || 12) + tabH + 90;
  const { items, totalVnd } = useCart();
  const router = useRouter();

  // ===== Shipping & Address =====
  const [shipMethod,setShipMethod] = useState<"pickup"|"delivery">("pickup");
  const [shippingAddress,setShippingAddress] = useState("");
  const [destCoords,setDestCoords] = useState<{lat:number;lng:number}|null>(null);
  const [destPrecise,setDestPrecise] = useState<boolean>(false);

  // ===== Store coords =====
  const [storeCoords,setStoreCoords] = useState<{lat:number;lng:number}|null>(null);
  const [storeGeoStatus,setStoreGeoStatus] = useState<"idle"|"ok"|"error">("idle");

  useEffect(()=>{
    let mounted = true;
    async function geocodeStore(){
      const preLat = (STORE as any).lat;
      const preLng = (STORE as any).lng;
      if (isFiniteCoord(preLat) && isFiniteCoord(preLng)) {
        if (!mounted) return;
        setStoreCoords({ lat: preLat, lng: preLng });
        setStoreGeoStatus("ok");
        return;
      }
      if (GEOAPIFY_KEY && STORE.address?.trim()) {
        try{
          const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(STORE.address.trim())}&lang=vi&limit=1&apiKey=${GEOAPIFY_KEY}`;
          const res = await fetch(url);
          const json = await res.json();
          const feat = (json?.features ?? [])[0];
          const lng = feat?.geometry?.coordinates?.[0];
          const lat = feat?.geometry?.coordinates?.[1];
          if (isFiniteCoord(lat) && isFiniteCoord(lng)) {
            if (!mounted) return;
            setStoreCoords({ lat, lng });
            setStoreGeoStatus("ok");
            return;
          }
        }catch{}
      }
      if (STORE.address?.trim()) {
        try{
          const rs = await Location.geocodeAsync(STORE.address.trim());
          if (!mounted) return;
          if (rs && rs.length>0) {
            setStoreCoords({ lat: rs[0].latitude, lng: rs[0].longitude });
            setStoreGeoStatus("ok");
            return;
          }
        }catch{}
      }
      if (mounted) setStoreGeoStatus("error");
    }
    geocodeStore();
    return ()=>{ mounted=false; };
  }, []);

  // ===== Geoapify Autocomplete =====
  const [suggestions,setSuggestions] = useState<SuggestItem[]>([]);
  const [suggestLoading,setSuggestLoading] = useState(false);
  const [suppressSuggest,setSuppressSuggest] = useState(false);
  const typingRef = useRef<number|null>(null);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController|null>(null);

  async function fetchGeoapifySuggestions(query:string){
    if(!GEOAPIFY_KEY || suppressSuggest){ setSuggestions([]); return; }
    abortRef.current?.abort();
    const ac = new AbortController(); abortRef.current = ac;
    const seq = ++requestSeqRef.current;

    const bias = storeCoords ? `&bias=proximity:${storeCoords.lat},${storeCoords.lng}` : "";
    const url =
      `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}` +
      `&lang=vi&filter=countrycode:vn&limit=${MAX_SUGGESTIONS}${bias}&apiKey=${GEOAPIFY_KEY}`;
    try{
      setSuggestLoading(true);
      const res = await fetch(url,{ signal: ac.signal });
      const json = await res.json();
      if(requestSeqRef.current !== seq) return;
      const feats = (json?.features ?? []) as any[];
      const list:SuggestItem[] = feats.map((f:any)=>{
        const p = f?.properties || {};
        return {
          id: String(p.place_id ?? p.datasource?.raw?.place_id ?? Math.random()),
          label: p.formatted || p.address_line1 || "",
          lat: f?.geometry?.coordinates?.[1],
          lng: f?.geometry?.coordinates?.[0],
          precise: preciseByProps(p),
        };
      }).filter(s=>s.label && isFiniteCoord(s.lat) && isFiniteCoord(s.lng));
      setSuggestions(list);
    }catch(e:any){ if(e?.name!=="AbortError") setSuggestions([]); }
    finally{ if(requestSeqRef.current===seq) setSuggestLoading(false); }
  }

  useEffect(()=>{
    if (shipMethod!=="delivery") { setSuggestions([]); return; }
    if (suppressSuggest) { setSuggestions([]); return; }
    if (typingRef.current) clearTimeout(typingRef.current);
    const q = shippingAddress.trim();
    if (q.length < MIN_QUERY_CHARS) { setSuggestions([]); return; }
    typingRef.current = setTimeout(()=>fetchGeoapifySuggestions(q), DEBOUNCE_MS) as unknown as number;
    return ()=>{ if(typingRef.current) clearTimeout(typingRef.current); };
  },[shippingAddress, shipMethod, suppressSuggest]);

  const onPickSuggestion = (s: SuggestItem) => {
    if (!s.precise) {
      Alert.alert("Địa chỉ chưa đủ chi tiết","Vui lòng chọn gợi ý có số nhà/toà nhà hoặc địa điểm cụ thể.");
      return;
    }
    setShippingAddress(s.label);
    setDestCoords({ lat: s.lat, lng: s.lng });
    setDestPrecise(true);
    setSuggestions([]);
    setSuppressSuggest(true);
  };

  // ✅ Chỉ reset khi NGƯỜI DÙNG GÕ TAY
  useEffect(()=>{
    if (!suppressSuggest) {
      setDestPrecise(false);
      setDestCoords(null);
    }
  }, [shippingAddress, suppressSuggest]);

  // ===== Distance & fee =====
  const [distanceKm,setDistanceKm] = useState<number|null>(null);
  const [geoStatus,setGeoStatus] = useState<"idle"|"ok"|"error">("idle");

  useEffect(()=>{
    if(shipMethod!=="delivery"){ setDistanceKm(null); setGeoStatus("idle"); return; }
    if(!storeCoords || !destCoords){ setGeoStatus("idle"); setDistanceKm(null); return; }
    try{
      const km = Math.max(0, haversineKm(storeCoords.lat,storeCoords.lng,destCoords.lat,destCoords.lng));
      setDistanceKm(km);
      setGeoStatus("ok");
    }catch{
      setGeoStatus("error"); setDistanceKm(null);
    }
  },[shipMethod, storeCoords, destCoords]);

  const computedFee = useMemo(()=>{
    if (shipMethod!=="delivery" || distanceKm==null) return 0;
    const steps = Math.ceil(distanceKm/STEP_KM);
    return steps * FEE_PER_STEP;
  },[shipMethod, distanceKm]);

  // ===== Totals =====
  const subTotal = totalVnd;
  const shippingFee = computedFee;
  const beforeVat = subTotal + shippingFee;
  const vat = Math.round(beforeVat * VAT_RATE);
  const grandTotal = beforeVat + vat;

  // ===== Capacity (logic giữ, UI ẩn) =====
  const [limits,setLimits] = useState<Record<number,number|null>>({});
  const [loading,setLoading] = useState(false);
  const [placing,setPlacing] = useState(false);

  const qtyByDish = useMemo(()=>{ const m:Record<number,number>={}; for(const it of items) m[it.dish_id]=(m[it.dish_id]??0)+it.qty; return m; },[items]);
  const overCapacity = useMemo(()=>{ for(const d of Object.keys(qtyByDish)){ const id=Number(d); const limit=limits[id]; if(limit!=null && qtyByDish[id]>limit) return true; } return false; },[qtyByDish,limits]);

  const lineSubtotal = (it:any)=>(it.base_price_vnd+(it.addons??[]).reduce((s:number,a:any)=>s+a.qty_units*a.extra_price_vnd_per_unit,0))*it.qty;

  async function loadLimits(){
    const dishIds = Array.from(new Set(items.map(i=>i.dish_id)));
    if(dishIds.length===0){ setLimits({}); return; }
    const { data, error } = await supabase.from("v_dish_available").select("dish_id,available_servings").in("dish_id",dishIds as any[]);
    if(error){ setLimits({}); return; }
    const map:Record<number,number|null> = {};
    (data as AvailRow[]).forEach(r=>map[r.dish_id]=r.available_servings);
    setLimits(map);
  }
  useEffect(()=>{ setLoading(true); loadLimits().finally(()=>setLoading(false)); },[items.length]);

  // ===== Add-on meta (step/min/max/stock) =====
  type AddonMeta = { step_g:number; min_steps:number; max_steps:number|null; stock_g:number };
  const [addonMeta, setAddonMeta] = useState<Record<number,AddonMeta>>({});
  const [addonMetaLoading, setAddonMetaLoading] = useState(false);

  const addonIds = useMemo(()=>{
    const s = new Set<number>();
    for (const it of items) for (const a of (it.addons??[])) s.add(Number(a.id));
    return Array.from(s);
  }, [items]);

  async function loadAddonMeta(){
    if (addonIds.length === 0) { setAddonMeta({}); return; }
    setAddonMetaLoading(true);
    try{
      const { data, error } = await supabase
        .from("ingredients_nutrition")
        .select("id, stock_g, ingredient_addon_config(step_g, min_steps, max_steps)")
        .in("id", addonIds as any[]);
      if (error) throw error;
      const map: Record<number, AddonMeta> = {};
      (data as any[]).forEach(row=>{
        const cfg = row.ingredient_addon_config && (Array.isArray(row.ingredient_addon_config) ? row.ingredient_addon_config[0] : row.ingredient_addon_config);
        map[row.id] = {
          step_g: Number(cfg?.step_g ?? 10),
          min_steps: Number(cfg?.min_steps ?? 0),
          max_steps: cfg?.max_steps == null ? null : Number(cfg.max_steps),
          stock_g: Number(row?.stock_g ?? 0),
        };
      });
      setAddonMeta(map);
    }catch{
      setAddonMeta({}); // fallback
    }finally{
      setAddonMetaLoading(false);
    }
  }
  useEffect(()=>{ loadAddonMeta(); }, [addonIds.join(",")]);

  // Tổng số bước add-on đã đặt trong giỏ theo ingredient
  const reservedStepsByIng = useMemo(()=>{
    const m:Record<number,number> = {};
    for (const it of items) for (const a of (it.addons??[])) {
      const id = Number(a.id);
      m[id] = (m[id] || 0) + (Number(a.qty_units) || 0);
    }
    return m;
  }, [items]);

  // ===== Place order =====
  async function placeOrder(){
    if(items.length===0) return;

    // 🔁 Nếu còn đơn chờ → CHỈ tiếp tục khi giỏ HIỆN TẠI GIỐNG snapshot; nếu khác → hủy & tạo mới
    try {
      const ao = await loadActiveOrder();
      const idCandidate = ao?.orderId ?? Number(await AsyncStorage.getItem(ORDER_KEY));
      if (Number.isFinite(idCandidate)) {
        const { data: exist } = await supabase
          .from("orders")
          .select("id, payment_status")
          .eq("id", Number(idCandidate))
          .maybeSingle();
        const st = String(exist?.payment_status || "");
        const isTerminal = ["paid","paid_demo","canceled","expired","failed"].includes(st);

        if (exist && !isTerminal) {
          const snapItems = ao?.snapshot?.items || [];
          const curItems = buildSnapshotFromCart(items);
          const same = sameCartSnapshot(snapItems, curItems);

          if (same) {
            // Tiếp tục đơn cũ vì giỏ không đổi
            router.replace({ pathname: "/bill/[id]", params: { id: String(idCandidate) } });
            return;
          }

          // Giỏ đã thay đổi → hủy đơn cũ & bỏ con trỏ để tạo đơn mới
          try { await cancelActiveOrderIfAny(); } catch {}
          try { await AsyncStorage.removeItem(ORDER_KEY); } catch {}
        }
      }
    } catch {}

    if(overCapacity){ Alert.alert("Vượt công suất","Một số món vượt số suất còn lại."); return; }

    // Chặn vượt kho add-on
    for (const idStr of Object.keys(reservedStepsByIng)) {
      const id = Number(idStr);
      const meta = addonMeta[id] ?? { step_g:10, min_steps:0, max_steps:null, stock_g:0 };
      const totalSteps = Math.floor(Math.max(0, meta.stock_g) / Math.max(1, meta.step_g));
      const reserved = reservedStepsByIng[id] || 0;
      if (reserved > totalSteps) {
        let name = "";
        items.forEach(it => (it.addons||[]).forEach((a:any)=>{ if(Number(a.id)===id && !name) name=a.name; }));
        Alert.alert("Add-on vượt tồn kho", `${name || "Một add-on"} đã vượt số bước còn lại trong kho.`);
        return;
      }
    }

    if(shipMethod==="delivery"){
      if(!shippingAddress.trim()){
        Alert.alert("Thiếu địa chỉ","Vui lòng nhập địa chỉ giao hàng.");
        return;
      }
      if(storeGeoStatus!=="ok"){
        Alert.alert("Không xác định được cửa hàng","Kiểm tra lại địa chỉ cửa hàng.");
        return;
      }
      if (GEOAPIFY_KEY) {
        if (!destPrecise || !destCoords || geoStatus!=="ok") {
          Alert.alert("Địa chỉ chưa đủ chi tiết","Vui lòng chọn gợi ý có số nhà/toà nhà/địa điểm cụ thể.");
          return;
        }
      } else {
        if (!isDetailedAddress(shippingAddress)) {
          Alert.alert("Địa chỉ chưa đủ chi tiết","Vui lòng ghi SỐ NHÀ + TÊN ĐƯỜNG hoặc TÊN TÒA NHÀ/CÔNG TY.");
          return;
        }
        try {
          const geos = await Location.geocodeAsync(shippingAddress.trim());
          if (geos?.length) setDestCoords({ lat: geos[0].latitude, lng: geos[0].longitude });
        } catch {}
      }
    }

    setPlacing(true);
    try{
      const p_lines = items.map(it=>({
        dish_id: it.dish_id,
        qty: it.qty,
        addons: (it.addons??[]).map((a:any)=>({
          id:a.id, name:a.name, qty_units:a.qty_units, extra_price_vnd_per_unit:a.extra_price_vnd_per_unit
        })),
      }));

      // JSONB meta -> khớp RPC (jsonb,jsonb)
      const meta = {
        METHOD: shipMethod,
        ADDRESS: shipMethod==="delivery" ? shippingAddress.trim() : null,
        DISTANCE_KM: shipMethod==="delivery" ? Number((distanceKm??0).toFixed(2)) : 0,
        SHIPPING_FEE: shippingFee,
        VAT_RATE, VAT_AMOUNT: vat, GRAND_TOTAL: grandTotal,
        STORE: { id:STORE.id, name:STORE.name, address:STORE.address, lat:storeCoords?.lat??null, lng:storeCoords?.lng??null },
        DEST: destCoords,
        DEST_PRECISE: destPrecise,
      };
      const p_note = meta; // gửi JSON, KHÔNG stringify

      const { data, error } = await supabase.rpc("create_order",{ p_note, p_lines });
      if(error) throw error;

      const orderId = Number(data);
      if (!Number.isFinite(orderId)) throw new Error("ORDER_ID_INVALID");

      // 🔒 Lưu “đơn đang chờ” (persist, không hiển thị banner)
      const summary = {
        orderId,
        createdAt: Date.now(),
        method: shipMethod,
        address: shipMethod==="delivery" ? shippingAddress.trim() : (STORE.address || ""),
        distanceKm: meta.DISTANCE_KM,
        shippingFee,
        vat,
        subTotal,
        grandTotal,
        store: { id: STORE.id, name: STORE.name, address: STORE.address },
        items: buildSnapshotFromCart(items), // đồng nhất format để so sánh lần sau
      };
      await saveActiveOrder({ orderId, createdAt: Date.now(), snapshot: summary });
      try { await AsyncStorage.setItem(ORDER_KEY, String(orderId)); } catch {}

      // Điều hướng: luôn sang BILL
      router.replace({
        pathname: "/bill/[id]",
        params: {
          id: String(orderId),
          summary: encodeURIComponent(JSON.stringify(summary)),
        },
      });
    }catch(e:any){
      const msg=String(e?.message??"");
      if(msg.includes("OUT_OF_STOCK")) Alert.alert("Hết hàng","Một số nguyên liệu đã hết.");
      else if(msg.includes("OUT_OF_CAPACITY")) Alert.alert("Vượt công suất","Số lượng vượt suất còn lại.");
      else if(msg.includes("EMPTY_CART")) Alert.alert("Giỏ trống","Không có gì để đặt.");
      else Alert.alert("Đặt thất bại", e?.message ?? "Vui lòng thử lại.");
    }finally{ setPlacing(false); }
  }

  const feeReady = shipMethod==="pickup" || (geoStatus==="ok" && distanceKm!=null && storeGeoStatus==="ok");

  // Nếu có vi phạm add-on ngay ở UI thì khoá luôn CTA (tránh ấn thử)
  const addonViolation = useMemo(()=>{
    for (const idStr of Object.keys(reservedStepsByIng)) {
      const id = Number(idStr);
      const meta = addonMeta[id] ?? { step_g:10, min_steps:0, max_steps:null, stock_g:0 };
      const totalSteps = Math.floor(Math.max(0, meta.stock_g) / Math.max(1, meta.step_g));
      if ((reservedStepsByIng[id] || 0) > totalSteps) return true;
    }
    return false;
  }, [reservedStepsByIng, addonMeta]);

  const canPlace = items.length>0 && !overCapacity && !placing && !addonViolation && (
    shipMethod==="pickup" ||
    (
      shippingAddress.trim().length>0 &&
      feeReady &&
      (GEOAPIFY_KEY ? destPrecise : isDetailedAddress(shippingAddress))
    )
  );

  const addressRef = useRef<TextInput>(null);

  return (
    <View style={{ flex:1, backgroundColor:C.bg }}>
      {/* Header */}
      <View style={{ paddingTop:insets.top+12, paddingBottom:12, paddingHorizontal:16, backgroundColor:C.panel, borderBottomWidth:1, borderColor:C.line }}>
        <Text style={{ fontSize:22, fontWeight:"800", color:C.text }}>Giỏ hàng</Text>
      </View>

      {/* Body */}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding:16, paddingBottom: bottomSpace }}>
        {/* Items */}
        {loading && items.length===0 ? (
          <View style={{ alignItems:"center", justifyContent:"center", paddingVertical:40 }}>
            <ActivityIndicator />
          </View>
        ) : items.length===0 ? (
          <Text style={{ textAlign:"center", color:C.sub }}>Giỏ hàng trống</Text>
        ) : (
          items.map((item:any) => {
            const addons = item.addons ?? [];
            const subtotal = lineSubtotal(item);

            return (
              <View key={item.line_id} style={{ padding:12, borderWidth:1, borderColor:C.line, borderRadius:12, backgroundColor:"#fff", marginBottom:12, gap:8 }}>
                <View style={{ flexDirection:"row", alignItems:"center" }}>
                  <View style={{ flex:1, flexDirection:"row", alignItems:"center" }}>
                    <Text style={{ fontSize:16, fontWeight:"700", color:C.text }}>{item.name}</Text>
                    {item.qty>1 && (
                      <View style={{ marginLeft:8, paddingHorizontal:8, paddingVertical:2, borderRadius:999, backgroundColor:"#F3F4F6", borderWidth:1, borderColor:C.line }}>
                        <Text style={{ fontSize:12, fontWeight:"700", color:C.text }}>× {item.qty}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontWeight:"800", color:C.text }}>{fmtVnd(subtotal)}</Text>
                </View>

                {addons.length===0 ? (
                  <Text style={{ color:C.sub }}>Không có add-on</Text>
                ) : (
                  <View style={{ flexDirection:"row", flexWrap:"wrap" }}>
                    {addons.map((a:any)=>{
                      const meta = addonMeta[a.id] ?? { step_g:10, min_steps:0, max_steps:null, stock_g:0 };
                      const totalStepsFromStock = Math.floor(Math.max(0, meta.stock_g) / Math.max(1, meta.step_g));
                      const reservedOthers = (reservedStepsByIng[a.id] || 0) - (a.qty_units || 0);
                      const remainingSteps = Math.max(0, totalStepsFromStock - reservedOthers);
                      const perLineCap = meta.max_steps == null ? 99 : Math.max(0, Number(meta.max_steps));
                      const allowUpTo = Math.min(remainingSteps, perLineCap);
                      const canInc = (a.qty_units || 0) < allowUpTo;
                      const remainForLine = Math.max(0, allowUpTo - (a.qty_units || 0));
                      const showOut = (a.qty_units || 0) === 0 && remainingSteps < (meta.min_steps || 0);

                      return (
                        <View key={`${item.line_id}-${a.id}`} style={{ flexDirection:"row", alignItems:"center", paddingHorizontal:10, paddingVertical:6, borderRadius:999, borderWidth:1, borderColor:C.line, backgroundColor:"#fff", marginRight:6, marginBottom:6, gap:6 }}>
                          <View style={{ gap:2 }}>
                            <Text style={{ color:C.text, fontSize:12, fontWeight:"700" }}>{a.name}</Text>
                            {!addonMetaLoading && (
                              <Text style={{ fontSize:10, color: showOut ? C.danger : "#059669" }}>
                                {showOut ? "Hết" : (remainForLine>0 ? `Còn +${remainForLine} bước` : "Đã tối đa")}
                              </Text>
                            )}
                          </View>

                          <View style={{ flexDirection:"row", alignItems:"center", borderWidth:1, borderColor:C.line, borderRadius:8 }}>
                            <Pressable onPress={()=>setAddonQty(item.line_id,a.id,Math.max(0,(a.qty_units||0)-1))} style={{ paddingHorizontal:6, paddingVertical:2 }}>
                              <Text style={{ fontSize:12, fontWeight:"800", color:C.text }}>–</Text>
                            </Pressable>
                            <Text style={{ minWidth:18, textAlign:"center", fontWeight:"800", color:C.text, fontSize:12 }}>
                              {a.qty_units || 0}
                            </Text>
                            <Pressable
                              disabled={!canInc}
                              onPress={()=>{
                                if (!canInc) return;
                                setAddonQty(item.line_id, a.id, Math.min(99, (a.qty_units||0)+1));
                              }}
                              style={{ paddingHorizontal:6, paddingVertical:2, opacity: canInc ? 1 : 0.35 }}
                            >
                              <Text style={{ fontSize:12, fontWeight:"800", color:C.text }}>+</Text>
                            </Pressable>
                          </View>

                          <Pressable onPress={()=>removeAddon(item.line_id,a.id)} style={{ paddingHorizontal:8, paddingVertical:4, borderRadius:8, backgroundColor:"#fee2e2", borderWidth:1, borderColor:"#fecaca" }}>
                            <Text style={{ fontSize:12, fontWeight:"700", color:"#b91c1c" }}>Xoá</Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}

                <View style={{ flexDirection:"row", justifyContent:"flex-end" }}>
                  <Pressable onPress={()=>removeLine(item.line_id)} style={{ paddingHorizontal:12, paddingVertical:8, borderRadius:10, borderWidth:1, borderColor:C.line, backgroundColor:"#fff" }}>
                    <Text style={{ color:C.text, fontWeight:"700" }}>Xoá món</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        {/* SHIPPING — segmented control */}
        <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, padding:14, marginTop:12, gap:10 }}>
          <Text style={{ color:C.sub, fontSize:12 }}>Hình thức nhận hàng</Text>

          <View style={{ flexDirection:"row", backgroundColor:"#F3F4F6", borderRadius:12, padding:4, gap:6, borderWidth:1, borderColor:C.line }}>
            <Pressable
              onPress={()=>setShipMethod("pickup")}
              style={{ flex:1, paddingVertical:10, borderRadius:8, alignItems:"center", justifyContent:"center",
                backgroundColor: shipMethod==="pickup" ? "#111827" : "transparent", flexDirection:"row", gap:8 }}
            >
              <Feather name="shopping-bag" size={16} color={shipMethod==="pickup" ? "#fff" : "#111827"} />
              <Text style={{ fontWeight:"800", color: shipMethod==="pickup" ? "#fff" : "#111827" }}>Nhận tại quầy</Text>
            </Pressable>

            <Pressable
              onPress={()=>setShipMethod("delivery")}
              style={{ flex:1, paddingVertical:10, borderRadius:8, alignItems:"center", justifyContent:"center",
                backgroundColor: shipMethod==="delivery" ? "#111827" : "transparent", flexDirection:"row", gap:8 }}
            >
              <Feather name="truck" size={16} color={shipMethod==="delivery" ? "#fff" : "#111827"} />
              <Text style={{ fontWeight:"800", color: shipMethod==="delivery" ? "#fff" : "#111827" }}>Giao tại nhà</Text>
            </Pressable>
          </View>

          {shipMethod==="delivery" && (
            <View style={{ marginTop:8 }}>
              <Text style={{ color:C.sub, fontSize:12, marginBottom:6 }}>Địa chỉ giao hàng</Text>

              {/* Nhập địa chỉ */}
              <TextInput
                ref={addressRef}
                value={shippingAddress}
                onChangeText={(t)=>{
                  setShippingAddress(t);
                  setSuppressSuggest(false);
                  setDestPrecise(false);
                  setDestCoords(null);
                  if(Platform.OS==="android") setTimeout(()=>addressRef.current?.focus(),0);
                }}
                autoCorrect={false}
                autoCapitalize="none"
                multiline
                numberOfLines={3}
                style={{ minHeight:64, paddingHorizontal:12, paddingVertical:10, borderRadius:10, borderWidth:1, borderColor: C.line, backgroundColor:"#fff", color:C.text, textAlignVertical:"top" }}
                placeholder="Số nhà + tên đường, hoặc tên tòa nhà/công ty…"
              />

              {/* Suggestions (Geoapify) */}
              {GEOAPIFY_KEY ? (
                <View style={{ marginTop:6, borderWidth:suggestions.length?1:0, borderColor:C.line, borderRadius:10, backgroundColor:"#fff", maxHeight:220, overflow:"hidden" }}>
                  {suggestLoading && <View style={{ padding:10 }}><Text style={{ color:C.sub, fontSize:12 }}>Đang tìm gợi ý…</Text></View>}
                  {suggestions.map((s)=>(
                    <Pressable key={s.id} onPress={()=>onPickSuggestion(s)} style={{ paddingHorizontal:12, paddingVertical:10, borderTopWidth:1, borderTopColor:C.line, opacity: s.precise ? 1 : 0.5 }}>
                      <Text style={{ color:C.text }} numberOfLines={2}>{s.label}</Text>
                      <Text style={{ color: s.precise ? "#059669" : "#9CA3AF", fontSize:11, marginTop:2 }}>
                        {s.precise ? "Địa chỉ OK — có số nhà/POI" : "Chưa đủ chi tiết — cần số nhà/toà nhà/POI"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ):null}

              <Text style={{ marginTop:6, fontSize:12, color: storeGeoStatus!=="ok" ? C.danger : (geoStatus==="ok" ? "#065f46" : (suggestLoading ? "#374151" : C.sub)) }}>
                {storeGeoStatus!=="ok"
                  ? "Không xác định được tọa độ cửa hàng. Kiểm tra STORE.address hoặc thêm STORE.lat/lng."
                  : geoStatus==="ok" && distanceKm!=null
                    ? `Khoảng cách ước tính: ~${distanceKm.toFixed(1)} km`
                    : (shippingAddress.trim().length<MIN_QUERY_CHARS ? `Gõ tối thiểu ${MIN_QUERY_CHARS} ký tự để nhận gợi ý.` : "Chọn gợi ý có số nhà/toà nhà/địa điểm cụ thể.")}
              </Text>
            </View>
          )}
        </View>

        {/* SUMMARY */}
        <View style={{ backgroundColor:C.panel, borderWidth:1, borderColor:C.line, borderRadius:12, paddingHorizontal:16, paddingVertical:14, marginTop:12, gap:8 }}>
          <Row label={`Tạm tính (${items.length})`} value={fmtVnd(subTotal)} />
          <Row
            label={shipMethod==="delivery" && distanceKm!=null ? `Phí giao hàng${distanceKm!=null ? ` (~${distanceKm.toFixed(1)} km)` : ""}` : "Phí giao hàng"}
            value={shipMethod==="delivery" ? (feeReady ? fmtVnd(shippingFee) : "—") : "Miễn phí"}
          />
          <Row label="Thuế VAT (8%)" value={fmtVnd(vat)} />
          <View style={{ height:1, backgroundColor:C.line, marginVertical:6 }} />
          <Row label="THÀNH TIỀN" value={fmtVnd(grandTotal)} bold />
          {addonViolation && (
            <Text style={{ marginTop:6, color:C.danger, fontSize:12 }}>
              Một số add-on đã vượt số bước còn lại trong kho. Vui lòng giảm số bước.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* CTA nổi */}
      <View pointerEvents="box-none" style={{ position:"absolute", left:16, right:16, bottom:tabH+12 }}>
        <Pressable disabled={!canPlace} onPress={placeOrder}
          style={{ paddingVertical:14, borderRadius:16, alignItems:"center", justifyContent:"center", backgroundColor:canPlace?C.good:"#9ca3af",
            elevation:5, shadowColor:"#000", shadowOpacity:0.15, shadowRadius:10, shadowOffset:{ width:0, height:4 } }}>
          {placing ? <ActivityIndicator color="#fff" /> : <Text style={{ color:"#fff", fontWeight:"800", fontSize:16 }}>Đặt ngay — {fmtVnd(grandTotal)}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Row({ label, value, bold=false }:{ label:string; value:string; bold?:boolean }){
  return (
    <View style={{ flexDirection:"row", alignItems:"center" }}>
      <Text style={{ flex:1, color:"#374151", fontWeight:bold?"800":"400" }}>{label}</Text>
      <Text style={{ color:"#111827", fontWeight:bold?"800":"700" }}>{value}</Text>
    </View>
  );
}
