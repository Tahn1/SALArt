import React, { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from "../../lib/supabase";

export default function AuthCallback() {
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    (async () => {
      // Ví dụ link: salart://auth/callback#access_token=...&refresh_token=...
      const url = await Linking.getInitialURL();
      try {
        const hash = url?.split('#')[1] ?? '';
        const params = Object.fromEntries(new URLSearchParams(hash) as any);

        if (params['access_token'] && params['refresh_token']) {
          await supabase.auth.setSession({
            access_token: params['access_token'],
            refresh_token: params['refresh_token'],
          });
          router.replace('/home'); // đã đăng nhập xong
        } else {
          // Không có token (user chỉ confirm email trong web) -> quay về login
          router.replace('/login');
        }
      } catch {
        router.replace('/login');
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212' }}>
      <ActivityIndicator />
    </View>
  );
}
