import React, { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { supabase } from "../lib/supabase";
import { hasOnboardedUserLocal } from "../lib/onboardingUser.local";

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [userOnb, setUserOnb] = useState<boolean | null>(null);

  useEffect(() => {
    let unsub: any;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      if (data.session?.user) {
        setUserOnb(await hasOnboardedUserLocal(data.session.user.id));
      }
      unsub = supabase.auth.onAuthStateChange(async (_e, s) => {
        setSession(s);
        if (s?.user) setUserOnb(await hasOnboardedUserLocal(s.user.id));
        else setUserOnb(null);
      });
      setLoading(false);
    })();
    return () => {
      try { unsub?.data?.subscription?.unsubscribe?.(); } catch {}
      try { unsub?.subscription?.unsubscribe?.(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const group = segments[0]; // "(onboarding)" | "(auth)" | "(tabs)" | undefined

    if (!session) {
      // Cho phép Startup/Login khi chưa đăng nhập
      if (group === "(onboarding)" || group === "(auth)") return;
      router.replace("/startup");
      return;
    }

    if (userOnb === false && group !== "(onboarding)") {
      router.replace("/onboarding");
      return;
    }
    if (userOnb && group !== "(tabs)") {
      router.replace("/");
      return;
    }
  }, [loading, session, userOnb, segments]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
