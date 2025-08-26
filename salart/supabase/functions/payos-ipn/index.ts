// supabase/functions/payos-ipn/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHECKSUM_KEY  = Deno.env.get("PAYOS_CHECKSUM_KEY") || "";
const SKIP_VERIFY   = (Deno.env.get("PAYOS_IPN_SKIP_VERIFY") ?? "") === "1";
const DEBUG         = (Deno.env.get("DEBUG_PAYOS") ?? "") === "1";

// ✅ Test mode: amount == TEST_AMOUNT => coi như paid (gateway = payos_test)
const TEST_MODE     = (Deno.env.get("PAYOS_TEST_MODE") ?? "") === "1";
const TEST_AMOUNT   = Math.max(0, Number(Deno.env.get("PAYOS_TEST_AMOUNT_VND") ?? "1000")) || 1000;

// ✅ Ngưỡng coi là "paid_demo" khi KHÔNG ở TEST_MODE (ví dụ 2k~5k tuỳ bạn)
const TEST_MAX_VND  = Math.max(0, Number(Deno.env.get("PAY_TEST_MAX_VND") ?? "5000")) || 5000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-signature, x-payos-signature, x-webhook-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

async function hmacHex(secret: string, data: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ ok: false, error: "ONLY_POST" }, 405);

  // Lấy raw body để verify chữ ký
  const raw = await req.text();
  let evt: any;
  try { evt = JSON.parse(raw); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }

  // Verify HMAC (trừ khi skip)
  if (!SKIP_VERIFY && CHECKSUM_KEY) {
    const headerNames = ["x-signature", "x-payos-signature", "x-webhook-signature"];
    const gotSig = headerNames.map((h) => req.headers.get(h)).find(Boolean);
    if (!gotSig) return json({ ok: false, error: "SIGNATURE_MISSING" }, 401);
    const expect = await hmacHex(CHECKSUM_KEY, raw);
    if (expect !== gotSig) return json({ ok: false, error: "SIGNATURE_INVALID" }, 401);
  }

  // Trích xuất trường phổ biến từ IPN PayOS
  const data = evt?.data ?? {};
  const code   = String(evt?.code ?? data?.code ?? "");
  const status = String(data?.status ?? data?.paymentStatus ?? evt?.status ?? "");
  const payOk  = (code === "00") || /^(PAID|SUCCESS|SUCCEEDED|COMPLETED)$/i.test(status);

  const payosOrderCode = Number(data?.orderCode ?? evt?.orderCode ?? data?.order_code);
  const amountVnd      = Number(data?.amount ?? evt?.amount ?? data?.amount_vnd ?? 0);
  const paymentLinkId  = data?.paymentLinkId ?? data?.id ?? data?.payment_link_id ?? null;

  if (!Number.isFinite(payosOrderCode)) {
    return json({ ok: false, error: "MISSING_ORDER_CODE", debug: DEBUG ? { evt } : undefined }, 400);
  }

  // map về order_id gốc: base*1000+suffix -> base
  const baseGuess = payosOrderCode >= 1000 ? Math.floor(payosOrderCode / 1000) : payosOrderCode;
  let orderId = baseGuess;

  // cố gắng map chính xác qua bảng payments
  try {
    const { data: pmt } = await admin
      .from("payments")
      .select("order_id")
      .or([
        paymentLinkId ? `ref.eq.${paymentLinkId}` : "",
        `ref.eq.${payosOrderCode}`,
        `order_id.eq.${baseGuess}`
      ].filter(Boolean).join(","))
      .limit(1);
    if (pmt && pmt.length) orderId = Number(pmt[0].order_id);
  } catch {}

  // Lấy đơn + total_vnd để đối chiếu
  const { data: ord } = await admin
    .from("orders")
    .select("id, payment_status, total_vnd")
    .eq("id", orderId)
    .maybeSingle();

  if (!ord) return json({ ok: false, error: "ORDER_NOT_FOUND", payosOrderCode, orderId }, 404);

  const nowIso = new Date().toISOString();
  const total = Number(ord?.total_vnd ?? 0);

  if (payOk) {
    const fullMatch      = total > 0 && amountVnd === total;
    const allowTestPaid  = TEST_MODE && amountVnd === TEST_AMOUNT;                 // test mode: coi như paid
    const isSmallDemo    = !allowTestPaid && !fullMatch && amountVnd > 0 && amountVnd <= TEST_MAX_VND;

    // Quyết định trạng thái orders cần set (có thể nâng cấp từ paid_demo -> paid)
    let targetOrderStatus: "paid" | "paid_demo" | null = null;
    if (fullMatch || allowTestPaid) targetOrderStatus = "paid";
    else if (isSmallDemo) targetOrderStatus = "paid_demo";

    // Nếu đơn đã 'paid' rồi -> idempotent
    if (String(ord.payment_status || "") === "paid") {
      // vẫn ghi payment để lưu vết, nhưng không đổi order
      try {
        await admin.from("payments").upsert({
          order_id: orderId,
          amount_vnd: amountVnd || undefined,
          method: "bank",
          status: "paid",
          gateway: allowTestPaid ? "payos_test" : "payos",
          ref: paymentLinkId ? String(paymentLinkId) : String(payosOrderCode),
          paid_at: nowIso
        }, { onConflict: "order_id" }).select("order_id").maybeSingle();
      } catch {}
      return json({ ok: true, already: true, order_id: orderId, status: "paid" });
    }

    // Nếu đơn đang 'paid_demo' và lần này đủ điều kiện 'paid' -> nâng cấp
    const upgradingToPaid = String(ord.payment_status || "") === "paid_demo" && targetOrderStatus === "paid";

    // Ghi payment trước
    try {
      await admin.from("payments").upsert({
        order_id: orderId,
        amount_vnd: amountVnd || undefined,
        method: "bank",
        status: targetOrderStatus ? "paid" : "mismatch",
        gateway: allowTestPaid ? "payos_test" : "payos",
        ref: paymentLinkId ? String(paymentLinkId) : String(payosOrderCode),
        paid_at: nowIso
      }, { onConflict: "order_id" }).select("order_id").maybeSingle();
    } catch (e) {
      console.log("payments upsert error:", (e as any)?.message || e);
    }

    if (!targetOrderStatus) {
      // Không đủ điều kiện: không đổi trạng thái đơn
      return json({ ok: true, order_id: orderId, status: "mismatch", amount: amountVnd, total, test: TEST_MODE });
    }

    // Cập nhật orders (nâng cấp nếu cần)
    const newStatus = upgradingToPaid ? "paid" : targetOrderStatus;
    const { error: eUpd } = await admin
      .from("orders")
      .update({ payment_method: "bank", payment_status: newStatus, paid_at: nowIso })
      .eq("id", orderId);
    if (eUpd) return json({ ok: false, error: eUpd.message || String(eUpd) }, 500);

    // (Tuỳ chọn) trừ kho: chỉ khi trạng thái cuối là 'paid'
    if (newStatus === "paid") {
      try { await admin.rpc("consume_stock_for_order", { p_order_id: orderId }); } catch {}
    }

    return json({ ok: true, order_id: orderId, status: newStatus, amount: amountVnd, total, test: TEST_MODE });
  } else {
    // Thanh toán thất bại
    try {
      await admin.from("payments").upsert({
        order_id: orderId,
        amount_vnd: amountVnd || undefined,
        method: "bank",
        status: "failed",
        gateway: TEST_MODE ? "payos_test" : "payos",
        ref: paymentLinkId ? String(paymentLinkId) : String(payosOrderCode),
      }, { onConflict: "order_id" }).select("order_id").maybeSingle();
    } catch {}

    return json({ ok: true, order_id: orderId, status: "failed" });
  }
});
