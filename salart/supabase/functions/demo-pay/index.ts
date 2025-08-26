

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAYOS_CLIENT_ID    = Deno.env.get("PAYOS_CLIENT_ID")!;
const PAYOS_API_KEY      = Deno.env.get("PAYOS_API_KEY")!;
const PAYOS_CHECKSUM_KEY = Deno.env.get("PAYOS_CHECKSUM_KEY")!; // để sẵn nếu cần ký sau này

// (tuỳ chọn) cấu hình return/cancel url nếu muốn PayOS redirect về web của bạn
const PAYOS_RETURN_URL   = Deno.env.get("PAYOS_RETURN_URL") || undefined;
const PAYOS_CANCEL_URL   = Deno.env.get("PAYOS_CANCEL_URL") || undefined;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

type Req = {
  orderCode: number | string;  // ID đơn trong DB (vd 48)
  amount: number | string;     // VND
  description?: string;
  forceNew?: boolean;
};

// Sinh mã biến thể số: vẫn map về đơn gốc qua payments.order_id
function makeVariantCode(base: number) {
  const suffix = Date.now() % 1000;      // 3 chữ số dao động theo thời gian
  return base * 1000 + suffix;           // 48 -> 48000..48099
}

async function createPayOSLink(payosOrderCode: number, amount: number, description?: string) {
  const payload: Record<string, unknown> = {
    orderCode: payosOrderCode,
    amount,
    description: description ?? `SALART - Đơn ${payosOrderCode}`,
  };
  if (PAYOS_RETURN_URL) payload.returnUrl = PAYOS_RETURN_URL;
  if (PAYOS_CANCEL_URL) payload.cancelUrl = PAYOS_CANCEL_URL;

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
  return { ok: r.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ error: "ONLY_POST" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Req;

    // Chuẩn hoá tham số
    const baseCode = Number(body.orderCode);
    const amt = Math.round(Number(body.amount));
    const desc = (body.description || "").toString().slice(0, 200);
    const forceNew = Boolean(body.forceNew);

    if (!Number.isFinite(baseCode) || baseCode <= 0 || !Number.isFinite(amt) || amt <= 0) {
      return json({ error: "INVALID_PARAMS", detail: { orderCode: body.orderCode, amount: body.amount } }, 400);
    }

    // Nếu forceNew -> dùng mã biến thể ngay
    let codeToUse = forceNew ? makeVariantCode(baseCode) : baseCode;

    // 1) Gọi PayOS
    let { ok, data } = await createPayOSLink(codeToUse, amt, desc);

    // 2) Nếu báo "đơn tồn tại", tự dùng mã biến thể và thử lại 1 lần (khi client chưa gửi forceNew)
    const msg = String(data?.desc || data?.message || "");
    const isExists =
      /đơn.*tồn tại/i.test(msg) || /order.*exist/i.test(msg) ||
      data?.code === "E018" || data?.code === "order_exists";

    if (!ok && isExists && !forceNew) {
      codeToUse = makeVariantCode(baseCode);
      const retry = await createPayOSLink(codeToUse, amt, desc);
      ok = retry.ok; data = retry.data;
    }

    if (!ok) {
      // Trả về nguyên thông báo (để UI hiện toast/alert chuẩn)
      return json({
        error: data?.desc || data?.message || "PAYOS_ERROR",
        data,
      }, 400);
    }

    const checkoutUrl =
      data?.data?.checkoutUrl ?? data?.checkoutUrl ?? data?.url ?? null;
    const qrCodeUrl =
      data?.data?.qrCode ?? data?.qrCode ?? data?.data?.qr_content ?? null;
    const paymentLinkId =
      data?.data?.paymentLinkId ?? data?.paymentLinkId ?? data?.data?.id ?? null;

    // 3) Ghi/ cập nhật payments idempotent theo order_id (map về đơn gốc)
    try {
      await sb.from("payments").upsert({
        order_id: baseCode,
        amount_vnd: amt,
        method: "bank",
        status: "pending",
        gateway: "payos",
        ref: String(paymentLinkId ?? codeToUse), // lưu id/mã biến thể để tra cứu
        checkout_url: checkoutUrl ?? null,
      }, { onConflict: "order_id" }).select("order_id").maybeSingle();
    } catch (e) {
      console.log("payments upsert error:", (e as any)?.message || e);
      // không fail toàn bộ chỉ vì bảng thiếu cột
    }

    // (an toàn) Cập nhật đơn sang pending_confirm nếu client chưa làm
    try {
      await sb.from("orders")
        .update({ payment_method: "bank", payment_status: "pending_confirm" })
        .eq("id", baseCode);
    } catch (_) {}

    return json({
      data: {
        checkoutUrl,
        qrCode: qrCodeUrl,
        paymentLinkId,
        payOrderCode: codeToUse, // mã PayOS thực tế đã dùng để tạo phiên
      },
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "INTERNAL_ERROR" }, 500);
  }
});
