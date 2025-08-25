// supabase/functions/demo-pay/index.ts
// Demo webhook: gọi POST để đánh dấu đơn "ĐÃ THANH TOÁN" + (tùy chọn) trừ kho.
// Bảo mật đơn giản bằng header x-demo-secret (đặt trong .env hoặc secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEMO_SECRET   = Deno.env.get("DEMO_WEBHOOK_SECRET") || ""; // tuỳ chọn

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Body = {
  order_id?: number | string;
  amount_vnd?: number;     // tuỳ chọn, nếu muốn cross-check
  force_method?: "bank_transfer" | "cod"; // tuỳ chọn
};

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Only POST", { status: 405 });
    }

    // Bảo vệ đơn giản cho demo (không bắt buộc)
    if (DEMO_SECRET) {
      const got = req.headers.get("x-demo-secret") || "";
      if (got !== DEMO_SECRET) {
        return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
      }
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const orderId = Number(body?.order_id);
    if (!Number.isFinite(orderId)) {
      return Response.json({ ok: false, error: "INVALID_ORDER_ID" }, { status: 400 });
    }

    // 1) Lấy trạng thái hiện tại
    const { data: o, error: e0 } = await admin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (e0) throw e0;
    if (!o) {
      return Response.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404 });
    }

    // Idempotent: nếu đã paid/paid_demo thì trả OK luôn
    const alreadyPaid = ["paid", "paid_demo"].includes(String(o.payment_status || ""));
    if (alreadyPaid) {
      return Response.json({ ok: true, already: true, status: o.payment_status });
    }

    // (Tuỳ chọn) Kiểm tra amount. Nếu DB bạn có cột total/grand_total thì bật đoạn dưới
    // const want = Number(body?.amount_vnd);
    // const total = Number(o?.grand_total_vnd ?? o?.total_vnd ?? 0);
    // if (want && total && want !== total) {
    //   return Response.json({ ok:false, error:"AMOUNT_MISMATCH", total }, { status: 400 });
    // }

    // 2) Đánh dấu đã thanh toán (demo)
    const method = body?.force_method || "bank_transfer";
    const { error: e1 } = await admin
      .from("orders")
      .update({
        payment_method: method,
        payment_status: "paid_demo",
        paid_at: new Date().toISOString(),
      })
      .eq("id", orderId);
    if (e1) throw e1;

    // 3) (Tuỳ chọn) Trừ kho theo đơn bằng RPC nếu bạn đã tạo
    //    Nếu chưa có function consume_stock_for_order(order_id bigint), bỏ qua block này.
    try {
      // idempotent: function của bạn nên tự bảo vệ nếu đã trừ trước đó
      await admin.rpc("consume_stock_for_order", { order_id: orderId });
    } catch (_e) {
      // cho demo: bỏ qua lỗi trừ kho
    }

    return Response.json({ ok: true, order_id: orderId, status: "paid_demo" });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
});
