// supabase/functions/payos-create-payment/index.ts
// Tạo link PayOS có ký HMAC + fallback khi đơn đã tồn tại hoặc tham số không hợp lệ.
// Trả 200 kèm { ok: true|false, data|error } để client không bị "non-2xx".
// Hỗ trợ TEST MODE: ép amount nhỏ để test luồng thật với chi phí thấp (tối thiểu 2.000đ).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAYOS_CLIENT_ID    = Deno.env.get("PAYOS_CLIENT_ID")!;
const PAYOS_API_KEY      = Deno.env.get("PAYOS_API_KEY")!;
const PAYOS_CHECKSUM_KEY = Deno.env.get("PAYOS_CHECKSUM_KEY")!;
const RETURN_URL  = Deno.env.get("PAY_RETURN_URL")  ?? "https://salart.vn/payos/return";
const CANCEL_URL  = Deno.env.get("PAY_CANCEL_URL")  ?? "https://salart.vn/payos/cancel";
const DEBUG       = (Deno.env.get("DEBUG_PAYOS") ?? "") === "1";

// ✅ Test mode (mặc định 2.000đ)
const TEST_MODE   = (Deno.env.get("PAYOS_TEST_MODE") ?? "") === "1";
const TEST_AMOUNT = Math.max(0, Number(Deno.env.get("PAYOS_TEST_AMOUNT_VND") ?? "2000")) || 2000;

// ✅ Ngưỡng tối thiểu an toàn (PayOS không nhận quá nhỏ)
const FALLBACK_MIN_VND = Math.max(0, Number(Deno.env.get("PAYOS_MIN_VND_FALLBACK") ?? "2000")) || 2000;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// CORS
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

type Req = {
  orderCode: number;
  amount: number;
  description?: string;
  forceNew?: boolean;
  forceTinyDesc?: boolean; // tuỳ chọn: ép mô tả ngắn ngay từ đầu
};

const isAbsUrl = (u: string) => /^https?:\/\/[^ ]+$/i.test(u);

// HMAC SHA-256 hex
async function hmacHex(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Mô tả “an toàn”
function safeDesc(s: string, fallback: string, maxLen = 25) {
  const cleaned = (s || fallback).replace(/[^A-Za-z0-9 _-]/g, "").trim();
  return (cleaned || fallback).slice(0, maxLen);
}

// orderCode biến thể để tránh “đơn đã tồn tại”
function variantCode(base: number) {
  const suffix = Date.now() % 1000; // 0..999
  return base * 1000 + suffix;
}

async function callPayOS(payload: Record<string, unknown>) {
  try {
    const r = await fetch("https://api-merchant.payos.vn/v2/payment-requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": PAYOS_CLIENT_ID,
        "x-api-key": PAYOS_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && data?.code === "00", data };
  } catch (e: any) {
    return { ok: false, data: { code: "NETWORK", message: String(e?.message || e) } };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ ok: false, error: "ONLY_POST" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Req;
    const baseCode = Number(body?.orderCode);
    const reqAmount = Math.round(Number(body?.amount || 0));
    if (!Number.isFinite(baseCode) || !Number.isFinite(reqAmount) || reqAmount <= 0) {
      return json({ ok: false, error: "INVALID_PARAMS" });
    }

    const returnUrl = isAbsUrl(RETURN_URL) ? RETURN_URL : "https://example.com/return";
    const cancelUrl = isAbsUrl(CANCEL_URL) ? CANCEL_URL : "https://example.com/cancel";

    const defaultDesc = `SAL_${String(baseCode).padStart(6, "0")}`;
    const desc = safeDesc(body?.description ?? defaultDesc, "SALART");
    const tinyDesc = safeDesc(`SAL${baseCode}`, "SAL", 12);

    // ⚠️ Test mode: ép amount nhưng luôn ≥ ngưỡng tối thiểu
    const originalAmount = reqAmount;
    let amount = TEST_MODE ? Math.max(TEST_AMOUNT, FALLBACK_MIN_VND) : reqAmount;

    // orderCode dùng để tạo (forceNew => tạo biến thể luôn)
    let codeToUse = body?.forceNew ? variantCode(baseCode) : baseCode;

    // build payload + signature
    const buildPayload = (orderCode: number, description: string, amt: number) => {
      const signData =
        `amount=${amt}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`;
      return {
        payload: {
          orderCode,
          amount: amt,
          description,
          cancelUrl,
          returnUrl,
          signature: "" as unknown as string,
        },
        signData,
      };
    };

    const signAndCall = async (orderCode: number, description: string, amt: number) => {
      const { payload, signData } = buildPayload(orderCode, description, amt);
      payload.signature = await hmacHex(PAYOS_CHECKSUM_KEY, signData);
      const { ok, data } = await callPayOS(payload);
      return { ok, data, signData };
    };

    // 1) Gọi lần 1
    const firstDesc = body?.forceTinyDesc ? tinyDesc : desc;
    let { ok, data, signData } = await signAndCall(codeToUse, firstDesc, amount);

    // 2) Nếu “đơn đã tồn tại” => thử lại với mã biến thể
    let msg = String(data?.desc || data?.message || "");
    const isExists = /đơn.*tồn tại/i.test(msg) || /order.*exist/i.test(msg) || data?.code === "E018";
    if (!ok && isExists && !body?.forceNew) {
      codeToUse = variantCode(baseCode);
      ({ ok, data, signData } = await signAndCall(codeToUse, firstDesc, amount));
      msg = String(data?.desc || data?.message || "");
    }

    // 3) Nếu lỗi tham số => mô tả ngắn + đảm bảo amount ≥ ngưỡng tối thiểu
    const invalidParam = data?.code === "20" || /không đúng/i.test(msg) || /INVALID_PARAM/i.test(msg);
    if (!ok && invalidParam) {
      const retryAmount = Math.max(amount, FALLBACK_MIN_VND);
      ({ ok, data, signData } = await signAndCall(codeToUse, tinyDesc, retryAmount));
      amount = retryAmount;
    }

    if (!ok) {
      return json({
        ok: false,
        error: data?.desc || data?.message || "PAYOS_ERROR",
        code: data?.code,
        raw: data,
        debug: DEBUG ? { signData } : undefined,
      });
    }

    const checkoutUrl =
      data?.data?.checkoutUrl ?? data?.checkoutUrl ?? data?.url ?? null;
    const qrCodeUrl =
      data?.data?.qrCode ?? data?.qrCode ?? data?.data?.qr_content ?? null;
    const paymentLinkId =
      data?.data?.paymentLinkId ?? data?.paymentLinkId ?? data?.data?.id ?? null;

    // Ghi payments (best-effort)
    try {
      await sb.from("payments")
        .upsert({
          order_id: baseCode,
          amount_vnd: amount,                               // số tiền thực gửi PayOS
          method: "bank",
          status: "pending",
          gateway: TEST_MODE ? "payos_test" : "payos",
          ref: String(paymentLinkId ?? codeToUse),
          checkout_url: checkoutUrl ?? null,
        }, { onConflict: "order_id" })
        .select("order_id")
        .maybeSingle();
    } catch (e) {
      console.log("payments upsert error:", (e as any)?.message || e);
    }

    return json({
      ok: true,
      data: {
        checkoutUrl,
        qrCode: qrCodeUrl,
        paymentLinkId,
        payOrderCode: codeToUse,
        effectiveAmount: amount,   // số tiền thực dùng với PayOS
        originalAmount,            // số tiền gốc của đơn
      },
      debug: DEBUG ? { signData } : undefined,
    });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? "INTERNAL_ERROR" });
  }
});
