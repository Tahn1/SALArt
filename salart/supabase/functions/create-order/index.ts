// supabase/functions/create-order/index.ts
// Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Item = { dish_id: number; servings: number };

serve(async (req) => {
  try {
    // 1) ENV từ secrets
    const supabaseUrl  = Deno.env.get("https://lrqigquiefqhjewwobwq.supabase.co")!;
    const anonKey      = Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxycWlncXVpZWZxaGpld3dvYndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5Mjc3NDEsImV4cCI6MjA3MDUwMzc0MX0.jrIJ6N_IILpbYpCf3RlsDutyF--vhCbaWs_kd0DWLRw")!;
    const serviceKey   = Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxycWlncXVpZWZxaGpld3dvYndxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDkyNzc0MSwiZXhwIjoyMDcwNTAzNzQxfQ.f_5WP7tm1_H3YMy6K6cVMOvpm0jDA0mjFXU6IoQuUws")!;

    // 2) Lấy JWT của KHÁCH từ header Authorization
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "Missing Authorization header" }, 401);

    // 3) Lấy user hiện tại từ JWT (anon client + token của khách)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    // 4) Body: { items: [{dish_id, servings}, ...] }
    const { items } = await req.json().catch(() => ({ items: null }));
    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: "items must be non-empty array" }, 400);
    }
    for (const it of items as Item[]) {
      if (typeof it?.dish_id !== "number" || typeof it?.servings !== "number" || it.servings <= 0) {
        return json({ error: `Invalid item: ${JSON.stringify(it)}` }, 400);
      }
    }

    // 5) Server client (SERVICE ROLE) để gọi RPC vượt RLS ghi
    const server = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await server.rpc("place_multi_order", {
      p_user: user.id,
      p_items: items,
      p_reason: "order",
    });
    if (error) return json({ error: error.message }, 400);

    return json({ order_id: data }, 200);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // CORS đơn giản cho mobile/web dev
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}
