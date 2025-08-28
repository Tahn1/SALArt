// app/_layout.tsx
import React, { useEffect, useState } from "react";
import { View, Platform, StatusBar } from "react-native";
import { Stack, Redirect, useSegments, useRootNavigationState } from "expo-router";
import { supabase } from "../lib/supabase";
import { hasOnboardedUserLocal } from "../lib/onboardingUser.local";

type Phase = "loading" | "anon" | "needsOnb" | "authed";
const BG = "#0B0B0B"; // hoặc kem: "#F6F2EA"

export default function RootLayout() {
  const navState = useRootNavigationState();
  const segments = useSegments();
  const first = (segments[0] as string | undefined) ?? undefined;
  const isGroup = !!first && first.startsWith("(");

  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let sub:
      | {
          data?: { subscription?: { unsubscribe?: () => void } };
        }
      | undefined;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const sess = data.session;

      if (!sess) {
        setPhase("anon");
      } else {
        const ok = await hasOnboardedUserLocal(sess.user.id);
        setPhase(ok ? "authed" : "needsOnb");
      }

      sub = supabase.auth.onAuthStateChange(async (_e, s) => {
        if (!s?.user) return setPhase("anon");
        const ok = await hasOnboardedUserLocal(s.user.id);
        setPhase(ok ? "authed" : "needsOnb");
      });
    })();

    return () => sub?.data?.subscription?.unsubscribe?.();
  }, []);

  // 0) Router chưa sẵn sàng hoặc đang loading → ĐỪNG render Stack (tránh flicker)
  if (!navState?.key || phase === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <StatusBar backgroundColor={BG} barStyle="light-content" />
      </View>
    );
  }

  // 1) PHASE: anon → chỉ cho phép (auth), (onboarding), "auth/*", "startup"
  if (phase === "anon") {
    const allowAnon =
      first === "(auth)" || first === "(onboarding)" || first === "auth" || first === "startup";

    if (!allowAnon) {
      // CHẶN TỪ GỐC: không render Stack, redirect ngay → không kịp thấy Home
      return (
        <View style={{ flex: 1, backgroundColor: BG }}>
          <StatusBar backgroundColor={BG} barStyle="light-content" />
          <Redirect href="/startup" />
        </View>
      );
    }

    // Được phép → render Stack bình thường
    return (
      <View style={{ flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 0 : 0 }}>
        <StatusBar backgroundColor={BG} barStyle="light-content" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BG }, animation: "fade" }} />
      </View>
    );
  }

  // 2) PHASE: needsOnb → chỉ cho (onboarding)
  if (phase === "needsOnb") {
    if (first !== "(onboarding)") {
      return (
        <View style={{ flex: 1, backgroundColor: BG }}>
          <StatusBar backgroundColor={BG} barStyle="light-content" />
          <Redirect href="/onboarding" />
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <StatusBar backgroundColor={BG} barStyle="light-content" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BG }, animation: "fade" }} />
      </View>
    );
  }

  // 3) PHASE: authed → cho (tabs) hoặc route không group (e.g., /pay/123)
  if (phase === "authed") {
    if (first === "(tabs)" || !isGroup) {
      return (
        <View style={{ flex: 1, backgroundColor: BG }}>
          <StatusBar backgroundColor={BG} barStyle="light-content" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BG }, animation: "fade" }} />
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <StatusBar backgroundColor={BG} barStyle="light-content" />
        <Redirect href="/" />
      </View>
    );
  }

  // fallback
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar backgroundColor={BG} barStyle="light-content" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BG }, animation: "fade" }} />
    </View>
  );
}
