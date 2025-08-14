// lib/onboardingUser.ts
import { supabase } from "./supabase";

type ProfileRow = {
  id: string;
  onboarded: boolean | null;
};

/**
 * Kiểm tra user đã hoàn tất onboarding (cờ trong bảng `profiles`) hay chưa.
 * - Trả về `true` nếu có hàng và `onboarded = true`
 * - Trả về `false` nếu chưa có hàng, `onboarded = false`, hoặc lỗi đọc
 */
export async function hasOnboardedUser(userId: string): Promise<boolean> {
  if (!userId) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select<"onboarded", ProfileRow>("onboarded")
    .eq("id", userId)
    .maybeSingle(); // null nếu chưa có hàng

  if (error) {
    // Không chặn luồng — coi như chưa onboard, nhưng log để dễ debug
    console.warn("[hasOnboardedUser] read error:", error);
    return false;
  }

  return !!data?.onboarded;
}

/**
 * Đặt cờ đã onboarding cho user.
 * - Sẽ tạo hàng nếu chưa tồn tại (upsert).
 * - Ném lỗi nếu upsert thất bại (để UI có thể hiển thị Alert).
 */
export async function setOnboardedUser(userId: string): Promise<void> {
  if (!userId) throw new Error("Missing userId");

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, onboarded: true }, { onConflict: "id" });

  if (error) {
    // Gợi ý: kiểm tra RLS/Policy nếu gặp lỗi 401/403
    console.error("[setOnboardedUser] upsert error:", error);
    throw error;
  }
}
