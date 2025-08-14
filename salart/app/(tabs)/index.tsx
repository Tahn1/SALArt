import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  StatusBar,
  useColorScheme,
} from "react-native";
import { Image } from "expo-image";
import Svg, { Defs, Mask, Rect, Text as SvgText } from "react-native-svg";

const { width } = Dimensions.get("window");

const P = {
  cream: "#F8F4EF",
  ink: "#2B241F",
  sub: "#6B615C",
  white: "#FFFFFF",
  border: "#E6E0D6",
};

export default function HomeScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const C = {
    bg: isDark ? "#0C0C0C" : P.cream,
    sub: isDark ? "#B7B7B7" : P.sub,
    border: isDark ? "#1E1E1E" : P.border,
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

      {/* HERO trước để logo cut-out nhìn xuyên */}
      <View style={styles.heroWrap}>
        <Image
          source={require("../../assets/onboarding/slide4.jpg")}
          style={[styles.hero, { borderColor: C.border }]}
          contentFit="cover"
          transition={300}
        />
        <Text style={[styles.caption, { color: C.sub }]}>Nurture Inside Out</Text>
      </View>

      {/* Logo SALART “đục lỗ thật” */}
      <View style={styles.logoOverlay} pointerEvents="none">
        <SalartLogoCutout bg={C.bg} />
      </View>
    </SafeAreaView>
  );
}

const SalartLogoCutout: React.FC<{ bg: string }> = ({ bg }) => {
  const W = 150, H = 44, FS = 30;
  return (
    <Svg width={W} height={H}>
      <Defs>
        <Mask id="cut">
          {/* Trắng: giữ lại; Đen: đục lỗ */}
          <Rect width={W} height={H} fill="#fff" />
          <SvgText
            x={0}
            y={32}
            fontSize={FS}
            fontWeight="700"
            fill="#000"
            letterSpacing="2"
          >
            SALART
          </SvgText>
        </Mask>
      </Defs>
      {/* Tấm nền màu nền màn hình, bị đục theo chữ => chữ trong suốt */}
      <Rect width={W} height={H} fill={bg} mask="url(#cut)" />
    </Svg>
  );
};

const HERO_W = Math.min(width * 0.86, 340);
const HERO_AR = 0.62;
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center" },
  heroWrap: { flex: 1, width: "100%", alignItems: "center" },
  hero: {
    width: HERO_W,
    height: HERO_W / HERO_AR,
    borderWidth: 1,
    borderRadius: 0,
  },
  caption: { marginTop: 10, fontSize: 14, letterSpacing: 0.2 },
  logoOverlay: { position: "absolute", top: 6, left: 18 },
});
