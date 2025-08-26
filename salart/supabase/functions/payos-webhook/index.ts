// supabase/functions/payos-webhook/index.ts
// Secrets cần có: PAYOS_CHECKSUM_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Nhớ tắt Verify JWT cho function này (webhook từ PayOS)

import { createClient } from "npm:@supabase/supabase-js@2";

/* ===================== Helpers ký & build chuỗi ===================== */
function sortObj(obj: Record<string, any>) {
  return Object.keys(obj || {}).sort().reduce((acc: any, k) => (acc[k] = obj[k], acc), {});
}
function objToQuery(obj: Record<string, any>) {
  // Quy tắc PayOS: key=value nối bằng &, không encode, bỏ undefined
  // Mảng/đối tượng lồng → stringify theo thứ tự key
  return Object.keys(obj || {})
    .filter((k) => obj[k] !== undefined)
    .map((k) => {
      let v = obj[k];
      if (Array.isArray(v)) {
        v = JSON.stringify(v.map((it) => (typeof it === "object" ? sortObj(it) : it)));
      } else if (v && typeof v === "object") {
        v = JSON.stringify(sortObj(v));
      } else if (v === null || v === "null" || v === "undefined") {
        v = "";
      }
      return `${k}=${v}`;
    })
    .join("&");
}
async function hmacSHA256Hex(key: string, data: string) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ===================== Supabase client (service role) ===================== */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/* ===================== Utils ===================== */
function extractOrderRef(body: any) {
  const d = body?.data ?? body ?? {};
  // PayOS thường gửi orderCode là SỐ
  let idNum: number | null = null;
  const raw = d?.orderCode ?? d?.order_id ?? d?.code;
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isFinite(n)) idNum = n;
  }
  // Fallback: SAL_000123 trong description/param tùy bên bạn gửi
  const desc = String(d?.description ?? body?.description ?? "");
  const sal = desc.match(/SAL_\d{6}/)?.[0] || d?.displayCode || null;
  return { idNum, salCode: sal };
}

function mapPaymentStatus(body: any): "paid" | "canceled" | "expired" | null {
  const d = body?.data ?? {};
  const code = String(d?.code ?? body?.code ?? "").trim();
  const status = String(d?.status ?? body?.status ?? body?.event ?? "").toLowerCase();
  const okFlag = body?.success === true || d?.success === true;

  if (code === "00" || okFlag || /paid|success|completed/.test(status)) return "paid";
  if (/cancel/.test(status)) return "canceled";
  if (/expire/.test(status)) return "expired";
  return null;
}

/* ===================== Handler ===================== */
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let payload: any;
  try { payload = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400 }); }

  const checksumKey = Deno.env.get("PAYOS_CHECKSUM_KEY");
  if (!checksumKey) return new Response("Missing PAYOS_CHECKSUM_KEY", { status: 500 });

  // Một số phiên bản gửi 'signature', số khác gửi 'dataSignature'
  const signature = payload?.signature ?? payload?.dataSignature;
  const data = payload?.data;
  if (!signature || !data) return new Response("Missing signature/data", { status: 400 });

  // 1) Verify chữ ký
  const toSign = objToQuery(sortObj(data));
  const calc = await hmacSHA256Hex(checksumKey, toSign);

  // 1.1) Ghi log mọi webhook (kể cả khi signature sai) – KHÔNG làm hỏng flow nếu bảng chưa có
  try {
    await sb.from("payos_logs").insert({
      payload,
      meta: { toSign, signature, calc, matched: calc === signature },
    });
  } catch (e) {
    console.error("payos_logs insert error:", (e as any)?.message || e);
  }

  if (calc !== signature) return new Response("Invalid signature", { status: 400 });

  // 2) Map trạng thái chuẩn
  const payment_status = mapPaymentStatus(payload);

  // 3) Tham chiếu đơn
  const { idNum, salCode } = extractOrderRef(payload);
  if (!idNum && !salCode) {
    console.warn("Webhook: missing order reference", { data });
    return new Response("OK", { status: 200 }); // vẫn trả 200 để PayOS không retry vô hạn
  }

  // 4) Chuẩn bị dữ liệu ghi DB
  const amount_vnd = Math.round(Number(data?.amount ?? 0));
  const ref = data?.reference ?? data?.txnId ?? null;
  const nowIso = new Date().toISOString();

  try {
    if (payment_status) {
      // (tuỳ chọn) Trừ kho (idempotent)
      if (payment_status === "paid" && idNum) {
        const { error: eStock } = await sb.rpc("consume_stock_for_order", { p_order_id: idNum });
        if (eStock && !/ALREADY_CONSUMED/i.test(String(eStock.message || ""))) {
          console.error("consume_stock_for_order error:", eStock);
        }
      }

      // payments -> upsert idempotent (ưu tiên theo order_id nếu có)
      const payRow: any = {
        amount_vnd: Number.isFinite(amount_vnd) ? amount_vnd : 0,
        method: "bank",
        status: payment_status,
        gateway: "payos",
        ref,
        paid_at: payment_status === "paid" ? nowIso : null,
      };
      if (idNum) payRow.order_id = idNum;
      if (salCode) payRow.order_code = String(salCode);

      const upsertRes = await sb
        .from("payments")
        .upsert(payRow, { onConflict: idNum ? "order_id" : "order_code" });
      if (upsertRes.error) throw upsertRes.error;

      // orders -> cập nhật trạng thái + method
      let upd = sb.from("orders").update({
        payment_status,
        payment_method: "bank",
        paid_at: payment_status === "paid" ? nowIso : null,
      });
      upd = idNum ? upd.eq("id", idNum) : upd.eq("order_code", String(salCode));
      const { error: eUpd } = await upd;
      if (eUpd) throw eUpd;
    } else {
      // Không xác định trạng thái 'paid/canceled/expired' → chỉ log lại
      try {
        await sb.from("payos_logs").insert({ payload, meta: { note: "non-mapped event" } });
      } catch {}
    }

    return new Response("OK", { status: 200 });
  } catch (e: any) {
    console.error("DB update error:", e?.message || e);
    // vẫn trả 200 để PayOS không retry liên tục
    return new Response("OK", { status: 200 });
  }
});
