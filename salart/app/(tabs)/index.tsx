import React from "react";
import { View, Text, StyleSheet, Dimensions, Pressable, StatusBar } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Asset } from "expo-asset";

import hero from "../../assets/home/home2.png";            // ✅ chỉ dùng 1 ảnh ổn định
import profileImg from "../../assets/avatars/profile.png";
import stickerImg from "../../assets/avatars/3d_avatar_22.png";

const { width: W, height: H } = Dimensions.get("window");

export default function Home() {
  const insets = useSafeAreaInsets();
  const TAB_PLATE_H = 110 + (insets.bottom || 0);
  const STICKER_BOTTOM = TAB_PLATE_H + 14;

  const [imgFailed, setImgFailed] = React.useState(false);

  // Prefetch ảnh để chắc chắn có sẵn (giảm flash)
  React.useEffect(() => {
    Asset.fromModule(hero).downloadAsync().catch(() => {});
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Khối hero 1 trang */}
      <View style={{ height: H }}>
        {/* Nền gradient để không bao giờ trắng */}
        <LinearGradient
          colors={["#0B0B0B", "#141414"]}
          style={StyleSheet.absoluteFill}
        />
        {/* Ảnh chính: nếu lỗi sẽ ẩn, để lộ gradient */}
        {!imgFailed && (
          <Image
            source={hero}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            priority="high"
            cachePolicy="immutable"
            transition={150}
            onError={() => setImgFailed(true)}
          />
        )}
      </View>

      {/* Overlay */}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {/* Tiêu đề góc trái trên */}
        <View style={{ position: "absolute", left: 24, top: Math.max(insets.top + 10, 90), width: W - 48 }}>
          <Text style={styles.title}>SALArt gần bạn</Text>
          <Text style={[styles.title, { marginTop: 6 }]}>Đặt Tiệc</Text>
        </View>

        {/* Avatar góc phải trên */}
        <View
          style={{
            position: "absolute",
            right: 24,
            top: Math.max(insets.top + 6, 84),
            width: 56,
            height: 56,
            borderRadius: 28,
            borderWidth: 3,
            borderColor: "#fff",
            overflow: "hidden",
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 5,
          }}
        >
          <Image source={profileImg} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        </View>

        {/* Sticker neo đáy, không bị tab bar che */}
        <Pressable
          style={{
            position: "absolute",
            left: 24,
            bottom: STICKER_BOTTOM,
            width: 50,
            height: 50,
          }}
        >
          <View
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 16,
              backgroundColor: "#fff",
              shadowColor: "#000",
              shadowOpacity: 0.12,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }}
          />
          <Image
            source={stickerImg}
            style={{ position: "absolute", width: 40, height: 40, left: 5, top: 5, borderRadius: 10 }}
            contentFit="cover"
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // nền tối để không lộ trắng khi đang load
  root: { flex: 1, backgroundColor: "#0B0B0B" },
  title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 50,
    textShadowColor: "rgba(0,0,0,0.30)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 4,
  },
});
