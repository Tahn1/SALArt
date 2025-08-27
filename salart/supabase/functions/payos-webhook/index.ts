// supabase/functions/payos-webhook/index.ts
// Secrets: PAYOS_CHECKSUM_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Turn off Verify JWT for this function.

import { createClient } from "npm:@supabase/supabase-js@2";

/* ===== Helpers ===== */
function sortObj(obj: Record<string, any>) {
  return Object.keys(obj || {}).sort().reduce((acc: any, k) => (acc[k] = obj[k], acc), {});
}
function objToQuery(obj: Record<string, any>) {
  return Object.keys(obj || {})
    .filter((k) => obj[k] !== undefined)
    .map((k) => {
      let v = obj[k];
      if (Array.isArray(v)) v = JSON.stringify(v.map((it) => (typeof it === "object" ? sortObj(it) : it)));
      else if (v && typeof v === "object") v = JSON.stringify(sortObj(v));
      else if (v === null || v === "null" || v === "undefined") v = "";
      return `${k}=${v}`;
    })
    .join("&");
}
async function hmacSHA256Hex(key: string, data: string) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lấy id đơn; hỗ trợ orderCode biến thể (base*1000+suffix) và bóc "SAL_000123" trong description */
function getOrderId(body: any): number | null {
  const d = body?.data ?? {};
  const raw = d?.orderCode ?? d?.order_id ?? d?.code;
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n > 100000 ? Math.floor(n / 1000) : n;
  }
  const desc = String(d?.description ?? body?.description ?? "");
  const m = desc.match(/SAL_(\d{6})/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Map trạng thái về paid/canceled/expired (rộng tay để không miss) */
function mapPaymentStatus(body: any): "paid" | "canceled" | "expired" | null {
  const d = body?.data ?? {};
  const codeRaw = String(d?.code ?? d?.returnCode ?? d?.errorCode ?? body?.code ?? "").trim();
  const code = codeRaw === "0" ? "00" : codeRaw;
  const status = String(d?.status ?? body?.status ?? body?.event ?? d?.transactionStatus ?? "").toLowerCase();
  const desc   = String(d?.desc ?? body?.desc ?? "").toLowerCase();
  const okFlag = body?.success === true || d?.success === true;

  if (code === "00" || okFlag || /paid|success|completed|succeeded/.test(status) || /thanh\s*cong/.test(desc)) return "paid";
  if (/cancel/.test(status) || /h[uư]y/.test(desc)) return "canceled";
  if (/expire/.test(status) || /h[eế]t\s*h[ạa]n/.test(desc)) return "expired";
  return null;
}

function pickAmountVnd(data: any): number {
  const cands = [data?.amount, data?.amountPaid, data?.amount_paid, data?.totalAmount, data?.transAmount];
  for (const v of cands) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return 0;
}

/* ===== Supabase client ===== */
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/* ===== Handler ===== */
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let payload: any;
  try { payload = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const checksumKey = Deno.env.get("PAYOS_CHECKSUM_KEY");
  if (!checksumKey) return new Response("Missing PAYOS_CHECKSUM_KEY", { status: 500 });

  const signature = payload?.signature ?? payload?.dataSignature;
  const data = payload?.data;
  if (!signature || !data) return new Response("Missing signature/data", { status: 400 });

  // verify
  const toSign = objToQuery(sortObj(data));
  const calc = await hmacSHA256Hex(checksumKey, toSign);

  // log chữ ký
  try { await sb.from("payos_logs").insert({ payload, meta: { toSign, signature, calc, matched: calc === signature } }); } catch {}

  if (calc !== signature) return new Response("Invalid signature", { status: 400 });

  const payment_status = mapPaymentStatus(payload);
  const orderId = getOrderId(payload);
  const amount_vnd = pickAmountVnd(data);
  const ref = data?.reference ?? data?.txnId ?? data?.transactionId ?? null;
  const nowIso = new Date().toISOString();

  // log mapped
  try { await sb.from("payos_logs").insert({ payload, meta: { note: "mapped", mapped_status: payment_status, orderId } }); } catch {}

  if (!orderId) {
    try { await sb.from("payos_logs").insert({ payload, meta: { note: "missing-order-id" } }); } catch {}
    return new Response("OK", { status: 200 });
  }

  try {
    /* 1) PAYMENTS: UPDATE trước, nếu 0 dòng → INSERT (không cần unique(order_id)) */
    const toWrite = {
      order_id: orderId,
      amount_vnd,
      method: "bank" as const,
      status: (payment_status ?? "pending") as "pending"|"paid"|"canceled"|"expired",
      gateway: "payos",
      ref,
      paid_at: payment_status === "paid" ? nowIso : null,
    };

    const upd = await sb
      .from("payments")
      .update(toWrite)
      .eq("order_id", orderId)
      .select("order_id");

    if (upd.error) throw upd.error;

    if (!upd.data || upd.data.length === 0) {
      const ins = await sb.from("payments").insert(toWrite).select("order_id");
      if (ins.error) throw ins.error;
    }

    /* 2) ORDERS: nếu đã map được trạng thái thì cập nhật */
    if (payment_status) {
      if (payment_status === "paid") {
        const { error: eStock } = await sb.rpc("consume_stock_for_order", { p_order_id: orderId });
        if (eStock && !/ALREADY_CONSUMED/i.test(String(eStock.message || ""))) {
          console.error("consume_stock_for_order error:", eStock);
        }
      }

      const { data: rows, error: eUpd } = await sb
        .from("orders")
        .update({
          payment_status,
          payment_method: "bank",
          paid_at: payment_status === "paid" ? nowIso : null,
        })
        .eq("id", orderId)
        .select("id");
      if (eUpd) throw eUpd;

      if (!rows || rows.length === 0) {
        try { await sb.from("payos_logs").insert({ payload, meta: { note: "no-order-updated-id", id: orderId } }); } catch {}
      }
    } else {
      try { await sb.from("payos_logs").insert({ payload, meta: { note: "non-mapped event" } }); } catch {}
    }

    return new Response("OK", { status: 200 });
  } catch (e: any) {
    console.error("DB update error:", e?.message || e);
    return new Response("OK", { status: 200 });
  }
});
