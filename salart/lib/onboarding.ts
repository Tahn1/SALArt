import AsyncStorage from "@react-native-async-storage/async-storage";

const key = (uid: string) => `onboarded:${uid}`;

export async function hasOnboarded(uid: string) {
  try {
    const v = await AsyncStorage.getItem(key(uid));
    return v === "1";
  } catch {
    return false;
  }
}

export async function setOnboarded(uid: string) {
  try {
    await AsyncStorage.setItem(key(uid), "1");
  } catch {}
}
