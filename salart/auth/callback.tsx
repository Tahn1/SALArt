// app/auth/callback.tsx
import React, { useEffect, useRef, useState } from "react";
import * as Linking from "expo-linking";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { hasOnboarded } from "../../lib/onboarding";

export default function AuthCallback() {
  const [busy, setBusy] = useState(true);
  const handledOnce = useRef(false); // tránh xử lý trùng

  useEffect(() => {
    const handleUrl = async (incomingUrl: string | null) => {
      if (handledOnce.current) return;
      handledOnce.current = true;

      try {
        // Lấy params từ hash (#) và query (?) để an toàn cho mọi nền tảng
        const raw = incomingUrl ?? (await Linking.getInitialURL()) ?? "";
        const hash = raw.split("#")[1] ?? "";
        const queryPart = raw.split("?")[1]?.split("#")[0] ?? "";

        const hashParams = new URLSearchParams(hash);
        const queryParams = new URLSearchParams(queryPart);
        const get = (k: string) => hashParams.get(k) ?? queryParams.get(k);

        const access_token = get("access_token") ?? undefined;
        const refresh_token = get("refresh_token") ?? undefined;
        const error_desc = get("error_description") ?? get("error");

        if (error_desc) {
          // Có lỗi từ đường dẫn xác nhận → quay về login
          router.replace("/login");
          return;
        }

        if (access_token && refresh_token) {
          // Đăng nhập phiên từ link xác nhận
          await supabase.auth.setSession({ access_token, refresh_token });

          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (user && !(await hasOnboarded(user.id))) {
            router.replace("/onboarding");
          } else {
            router.replace("/home"); // đổi nếu route trang chính khác
          }
        } else {
          // Không có token trong URL: quay về login
          router.replace("/login");
        }
      } catch {
        router.replace("/login");
      } finally {
        setBusy(false);
      }
    };

    // Xử lý ngay URL hiện tại
    handleUrl(null);

    // Lắng nghe URL mới (nếu app đã mở sẵn)
    const sub = Linking.addEventListener("url", (e) => handleUrl(e.url));

    return () => {
      sub.remove();
    };
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
