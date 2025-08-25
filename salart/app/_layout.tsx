// app/_layout.tsx
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, Redirect, useSegments } from "expo-router";
import { supabase } from "../lib/supabase";
import { hasOnboardedUserLocal } from "../lib/onboardingUser.local";

type Phase = "loading" | "anon" | "needsOnb" | "authed";

export default function RootLayout() {
  const segments = useSegments();
  const first = (segments[0] as string | undefined) ?? undefined;
  const isGroup = !!first && first.startsWith("(");

  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let unsub: any;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const sess = data.session;

      if (!sess) {
        setPhase("anon");
      } else {
        const ok = await hasOnboardedUserLocal(sess.user.id);
        setPhase(ok ? "authed" : "needsOnb");
      }

      unsub = supabase.auth.onAuthStateChange(async (_e, s) => {
        if (!s?.user) { setPhase("anon"); return; }
        const ok = await hasOnboardedUserLocal(s.user.id);
        setPhase(ok ? "authed" : "needsOnb");
      });
    })();

    return () => {
      try { unsub?.data?.subscription?.unsubscribe?.(); } catch {}
      try { unsub?.subscription?.unsubscribe?.(); } catch {}
    };
  }, []);

  // ======= GATE =======
  if (phase === "loading") {
    return <View style={{ flex: 1, backgroundColor: "#F8F4EF" }} />;
  }

  // CHƯA đăng nhập -> chỉ cho nhóm (onboarding)/(auth)
  if (phase === "anon") {
    if (first === "(onboarding)" || first === "(auth)") {
      return <Stack screenOptions={{ headerShown: false }} />;
    }
    return <Redirect href="/startup" />;
  }

  // ĐÃ đăng nhập nhưng CHƯA onboard
  if (phase === "needsOnb") {
    if (first === "(onboarding)") {
      return <Stack screenOptions={{ headerShown: false }} />;
    }
    return <Redirect href="/onboarding" />;
  }

  // ĐÃ đăng nhập & ĐÃ onboard
  if (phase === "authed") {
    // ✅ Cho phép (tabs) và BẤT KỲ route không phải group (vd. /bill/[id], /pay/[id])
    if (first === "(tabs)" || !isGroup) {
      return <Stack screenOptions={{ headerShown: false }} />;
    }
    // Các group khác -> ép về trang chủ
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
