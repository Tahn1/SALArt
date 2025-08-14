// lib/onboardingUser.local.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const key = (userId: string) => `salart:user_onboarded:v1:${userId}`;
let cache: Record<string, boolean> = {}; // cache nhẹ cho phiên hiện tại

export async function hasOnboardedUserLocal(userId: string): Promise<boolean> {
  if (!userId) return false;
  if (cache[userId] !== undefined) return cache[userId];
  try {
    const v = await AsyncStorage.getItem(key(userId));
    const ok = v === "1";
    cache[userId] = ok;
    return ok;
  } catch {
    return false;
  }
}

export async function setOnboardedUserLocal(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(key(userId), "1");
    cache[userId] = true;
  } catch {}
}
