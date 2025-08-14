// lib/onboarding.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "salart:device_onboarded:v1";
// cache trong bộ nhớ để tránh đọc trễ sau khi vừa set
let cached: boolean | null = null;

/** Đã xem màn Startup trên thiết bị? */
export async function hasOnboarded(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const v = await AsyncStorage.getItem(KEY);
    cached = v === "1";
    return cached;
  } catch {
    return false;
  }
}

/** Đặt cờ đã xem Startup */
export async function setOnboarded(value: boolean = true): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, value ? "1" : "0");
    cached = value; // cập nhật ngay cache để root gate đọc được liền
  } catch {}
}
