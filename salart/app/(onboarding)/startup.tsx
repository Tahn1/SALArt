import React, { useEffect, useRef } from "react";
import {
  View,
  Animated,
  StyleSheet,
  Dimensions,
  useColorScheme,
  Easing,
  ImageSourcePropType,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { hasOnboardedUser } from "../../lib/onboardingUser";
import { setOnboarded } from "../../lib/onboarding";
const { width } = Dimensions.get("window");

const DUR_LOGO = 2000;
const DUR_TAGLINE = 1000;
const HOLD_BEFORE_NAV = 3000; 

export default function Startup() {
  const isDark = useColorScheme() === "dark";
  const BG = isDark ? "#2B241F" : "#F8F4EF";
  const logoSrc: ImageSourcePropType = isDark
    ? require("../../assets/logo-white.png")
    : require("../../assets/logo.png");

  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const taglineFade = useRef(new Animated.Value(0)).current;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didNavigate = useRef(false);

  // (tuỳ chọn) Đặt cờ đã xem startup — không ảnh hưởng nếu bạn muốn startup hiện mỗi lần
  useEffect(() => {
    (async () => {
      try { await setOnboarded(true); } catch {}
    })();
  }, []);

  const navigateOnce = (path: string) => {
    if (didNavigate.current) return;
    didNavigate.current = true;
    router.replace(path);
  };

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: DUR_LOGO,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: DUR_LOGO,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(taglineFade, {
        toValue: 1,
        duration: DUR_TAGLINE,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      timeoutRef.current = setTimeout(async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const sess = data.session;
          if (!sess) {
            navigateOnce("/login");
            return;
          }
          const isUserOnboarded = await hasOnboardedUser(sess.user.id);
          navigateOnce(isUserOnboarded ? "/" : "/onboarding");
        } catch {
          navigateOnce("/login"); // fallback an toàn
        }
      }, HOLD_BEFORE_NAV);
    });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [fade, scale, taglineFade]);

  return (
    <View style={[styles.wrap, { backgroundColor: BG }]}>
      <Animated.Image
        source={logoSrc}
        style={[styles.logo, { opacity: fade, transform: [{ scale }] }]}
        resizeMode="contain"
      />
      <Animated.Text
        style={[
          styles.tagline,
          { opacity: taglineFade, color: isDark ? "#EDEAE6" : "#6B615C" },
        ]}
      >
        Bữa ngon – dấu chân xanh.
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: { width: Math.min(width * 0.38, 240), aspectRatio: 1.8 },
  tagline: { marginTop: 10, fontSize: 24, letterSpacing: 0.2 },
});
