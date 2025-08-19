// lib/storage.ts
import { supabase } from "./supabase";

/** URL ảnh public (có transform resize/optimize), có fallback nếu thiếu. */
export function urlForDish(path?: string | null) {
  if (!path) {
    // fallback khi chưa có ảnh
    return "https://images.unsplash.com/photo-1551218808-94e220e084d2?q=80&w=1200&auto=format&fit=crop";
  }
  return supabase.storage.from("dishes").getPublicUrl(path, {
    transform: { width: 1200, quality: 80, resize: "cover" },
  }).data.publicUrl;
}

/** Tạo signed URL (nếu dùng bucket private). Không cần cho bucket public. */
export async function signedUrlFrom(bucket: string, path: string, expiresSec = 3600) {
  const { data, error } = await supabase.storage.from(bucket)
    .createSignedUrl(path, expiresSec, { transform: { width: 512, height: 512, resize: "cover" } });
  if (error) throw error;
  return data.signedUrl;
}
