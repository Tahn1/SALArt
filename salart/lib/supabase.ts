// lib/supabase.ts
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extras =
  (Constants.expoConfig?.extra as any) ||
  (Constants.manifest?.extra as any) ||
  {};

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? extras.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extras.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Log ra console để bạn thấy ngay giá trị đang nạp
  console.error("Missing Supabase envs:", {
    SUPABASE_URL,
    SUPABASE_ANON_KEY_PRESENT: !!SUPABASE_ANON_KEY,
  });
  throw new Error("Supabase URL/ANON KEY chưa được cấu hình.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
