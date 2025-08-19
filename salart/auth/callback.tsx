// app/auth/callback.tsx
import React, { useEffect, useRef, useState } from "react";
import * as Linking from "expo-linking";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";

export default function AuthCallback() {
  const [busy, setBusy] = useState(true);
  const handledOnce = useRef(false);

  useEffect(() => {
    const handleUrl = async (incomingUrl?: string | null) => {
      if (handledOnce.current) return;
      handledOnce.current = true;

      try {
        // Lấy URL: ưu tiên incomingUrl (event), fallback initialURL
        const url = incomingUrl ?? (await Linking.getInitialURL());
        if (!url) {
          router.replace("/login");
          return;
        }

        const { queryParams } = Linking.parse(url);
        const access_token = (queryParams?.access_token as string) || "";
        const refresh_token = (queryParams?.refresh_token as string) || "";

        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });

          // ✅ Không tự kiểm tra onboard ở đây.
          // Root gate (app/_layout.tsx) sẽ đọc hasOnboardedUserLocal để quyết định
          // vào (tabs) hay /onboarding.
          router.replace("/");
        } else {
          router.replace("/login");
        }
      } catch {
        router.replace("/login");
      } finally {
        setBusy(false);
      }
    };

    // 1) Xử lý link khởi động app
    handleUrl(null);

    // 2) Xử lý link khi app đang mở
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));
    return () => sub.remove();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#121212",
      }}
    >
      <ActivityIndicator />
    </View>
  );
}
