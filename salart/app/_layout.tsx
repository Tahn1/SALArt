// app/_layout.tsx
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, Redirect, useSegments } from "expo-router";
import { supabase } from "../lib/supabase";
import { hasOnboardedUserLocal } from "../lib/onboardingUser.local"; // dùng LOCAL

type Phase = "loading" | "anon" | "needsOnb" | "authed";

export default function RootLayout() {
  const segments = useSegments();
  const group = (segments[0] as string | undefined) ?? undefined;

  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let unsub: any;
    (async () => {
      // đọc session hiện tại
      const { data } = await supabase.auth.getSession();
      const sess = data.session;

      if (!sess) {
        setPhase("anon");
      } else {
        const ok = await hasOnboardedUserLocal(sess.user.id);
        setPhase(ok ? "authed" : "needsOnb");
      }

      // lắng nghe thay đổi phiên
      unsub = supabase.auth.onAuthStateChange(async (_e, s) => {
        if (!s?.user) {
          setPhase("anon");
          return;
        }
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
  // loading: nền trống, không render con để tránh nháy Home
  if (phase === "loading") {
    return <View style={{ flex: 1, backgroundColor: "#F8F4EF" }} />;
  }

  // CHƯA đăng nhập -> cho phép hiển thị nhóm (onboarding) (startup)
  if (phase === "anon") {
    if (group === "(onboarding)" || group === "(auth)") {
      // đang ở đúng nhóm: render các màn startup/login
      return <Stack screenOptions={{ headerShown: false }} />;
    }
    // đang ở nhóm khác -> chuyển về startup
    return <Redirect href="/startup" />;
  }

  // ĐÃ đăng nhập nhưng CHƯA onboard (user)
  if (phase === "needsOnb") {
    if (group === "(onboarding)") {
      // đã ở đúng nhóm → hiển thị /onboarding
      return <Stack screenOptions={{ headerShown: false }} />;
    }
    // ép qua /onboarding
    return <Redirect href="/onboarding" />;
  }

  // ĐÃ đăng nhập & ĐÃ onboard -> nhóm (tabs)
  if (phase === "authed") {
    if (group === "(tabs)") {
      // đã ở tabs -> render Home/Tab
      return <Stack screenOptions={{ headerShown: false }} />;
    }
    // chuyển vào /
    return <Redirect href="/" />;
  }

  // fallback (không bao giờ tới)
  return <Stack screenOptions={{ headerShown: false }} />;
}
