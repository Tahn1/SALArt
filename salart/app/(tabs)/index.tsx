import React from "react";
import { View, Text, StyleSheet, Dimensions, Pressable, StatusBar } from "react-native";
import Animated from "react-native-reanimated";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ĐƯỜNG DẪN ẢNH (đặt trong app/assets/)
import hero1 from "../../assets/home/home1.png";
import hero2 from "../../assets/home/home2.png";
import profileImg from "../../assets/avatars/profile.png";
import stickerImg from "../../assets/avatars/3d_avatar_22.png";

const { width: W, height: H } = Dimensions.get("window");

export default function Home() {
  const insets = useSafeAreaInsets();
  const TAB_PLATE_H = 110 + (insets.bottom || 0); // chiều cao nền tab bar to hơn
  const STICKER_BOTTOM = TAB_PLATE_H + 14;        // sticker luôn nằm trên tab bar

  return (
    <View style={styles.root}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* 2 trang full-screen, snap đúng chiều cao màn hình, không bounce ⇒ ảnh liền mạch */}
      <Animated.ScrollView
        style={{ flex: 1 }}
        pagingEnabled
        snapToInterval={H}
        decelerationRate="fast"
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
      >
        {/* Trang 1 */}
        <View style={{ height: H }}>
          <Image source={hero1} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        </View>

        {/* Trang 2 */}
        <View style={{ height: H }}>
          <Image source={hero2} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        </View>
      </Animated.ScrollView>

      {/* Overlay: luôn hiện trên cả 2 ảnh */}
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

        {/* Sticker tròn góc trái dưới (neo theo bottom để không bị tab bar che) */}
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
  root: { flex: 1, backgroundColor: "#FFFFFF" },
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
