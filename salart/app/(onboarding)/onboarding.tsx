import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Dimensions,
  Pressable,
  Animated,
  Platform,
  StyleSheet,
  FlatList,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
// ✅ Dùng LOCAL thay vì DB
import {
  hasOnboardedUserLocal,
  setOnboardedUserLocal,
} from "../../lib/onboardingUser.local";

const { width, height } = Dimensions.get("window");

// 🎨 SALArt palette
const P = {
  cream: "#F8F4EF",
  ink: "#2B241F",
  sub: "#6B615C",
  leaf: "#2E7D32",
  border: "#E6E0D9",
  white: "#FFFFFF",
};

// Mờ ảnh rất nhẹ
const BLUR = Platform.select({ ios: 3, android: 2, default: 3 });

type Page = {
  image: any;
  focus:
    | "center"
    | "top center"
    | "right center"
    | "left center"
    | "bottom center";
  badge: string;
  title: string;
  desc: string;
};

const PAGES: Page[] = [
  {
    // ⚠️ Nếu assets nằm trong app/assets → dùng "../assets/..."
    image: require("../../assets/onboarding/slide1.jpg"),
    focus: "right center",
    badge: "Eat Green • Live Green • Stay Green",
    title: "Bữa ngon bên nhau",
    desc: "Không gian ấm áp, hương vị tươi lành – mỗi bữa ăn là một khoảnh khắc gắn kết.",
  },
  {
    image: require("../../assets/onboarding/slide2.jpg"),
    focus: "center",
    badge: "Fresh • Care • Daily",
    title: "Bếp xanh tận tâm",
    desc: "Chuẩn bị thủ công hằng ngày, lựa chọn nguyên liệu kỹ lưỡng cho sức khỏe & sự an tâm.",
  },
  {
    image: require("../../assets/onboarding/slide3.jpg"),
    focus: "right center",
    badge: "Sống xanh mỗi ngày",
    title: "Niềm vui từ vườn rau",
    desc: "Hành trình xanh bắt đầu từ những điều nhỏ nhất – gieo trồng, chăm sóc, sẻ chia.",
  },
  {
    image: require("../../assets/onboarding/slide4.jpg"),
    focus: "center",
    badge: "Color • Taste • Balance",
    title: "Thực đơn phong phú",
    desc: "Salad đa dạng theo khẩu vị – nhẹ nhàng, cân bằng mà vẫn trọn vị.",
  },
];

export default function Onboarding() {
  const [idx, setIdx] = useState(0);
  const [uid, setUid] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const listRef = useRef<FlatList>(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        router.replace("/login"); // chỉ dành cho người đã đăng nhập
        return;
      }
      setUid(user.id);

      // Nếu user đã onboard (LOCAL) -> về Home luôn
      const ok = await hasOnboardedUserLocal(user.id);
      if (ok) {
        router.replace("/");
        return;
      }

      Animated.timing(fade, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    })();
  }, []);

  const goNext = () => {
    if (idx < PAGES.length - 1)
      listRef.current?.scrollToIndex({ index: idx + 1, animated: true });
    else finish();
  };

const finish = async () => {
  if (!uid || submitting) return;
  try {
    setSubmitting(true);
    await setOnboardedUserLocal(uid);          
    await new Promise(r => setTimeout(r, 0));    
    router.replace("/");                         
  } catch (e: any) {
    Alert.alert("Lỗi", e?.message ?? "Không thể hoàn tất onboarding.");
  } finally {
    setSubmitting(false);
  }
};

  if (!uid) return <View style={{ flex: 1, backgroundColor: P.cream }} />;

  return (
    <Animated.View style={{ flex: 1, backgroundColor: P.cream, opacity: fade }}>
      <FlatList
        ref={listRef}
        data={PAGES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={(e) =>
          setIdx(Math.round(e.nativeEvent.contentOffset.x / width))
        }
        renderItem={({ item, index }) => (
          <Slide page={item} active={index === idx} />
        )}
      />

      {/* Progress + buttons */}
      <View style={{ position: "absolute", left: 22, right: 22, bottom: 24 }}>
        {/* progress thanh mảnh */}
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          {PAGES.map((_, i) => (
            <View
              key={i}
              style={{
                height: 6,
                flex: 1,
                maxWidth: 72,
                borderRadius: 999,
                backgroundColor: i <= idx ? P.leaf : "rgba(255,255,255,0.85)",
                borderWidth: i <= idx ? 0 : 1,
                borderColor: "rgba(255,255,255,0.95)",
              }}
            />
          ))}
        </View>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <BtnPlain
            title={idx < PAGES.length - 1 ? "BỎ QUA" : "BẮT ĐẦU"}
            onPress={finish}
          />
          <BtnFilled
            title={
              submitting
                ? "ĐANG LƯU..."
                : idx < PAGES.length - 1
                ? "TIẾP TỤC"
                : "HOÀN TẤT"
            }
            onPress={submitting ? undefined : goNext}
          />
        </View>
      </View>
    </Animated.View>
  );
}

/* ---------------- Slide (ảnh mờ nhẹ + gradient + typography) ---------------- */
function Slide({ page, active }: { page: Page; active: boolean }) {
  const badgeOp = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(8)).current;
  const titleOp = useRef(new Animated.Value(0)).current;
  const descOp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      Animated.sequence([
        Animated.timing(badgeOp, { toValue: 1, duration: 240, useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(titleY, { toValue: 0, duration: 380, useNativeDriver: true }),
          Animated.timing(titleOp, { toValue: 1, duration: 380, useNativeDriver: true }),
        ]),
        Animated.timing(descOp, { toValue: 1, duration: 240, useNativeDriver: true }),
      ]).start();
    } else {
      badgeOp.setValue(0);
      titleY.setValue(8);
      titleOp.setValue(0);
      descOp.setValue(0);
    }
  }, [active]);

  return (
    <View style={{ width, height }}>
      {/* Ảnh nền */}
      <Image
        source={page.image}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        contentPosition={page.focus} // ✅ "right center" / "left center" / "center"
        blurRadius={BLUR}
        transition={200}
      />

      {/* Gradient nhẹ */}
      <LinearGradient
        colors={[
          "rgba(0,0,0,0.12)",
          "rgba(0,0,0,0.06)",
          "rgba(248,244,239,0.84)",
        ]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Badge pill */}
      <Animated.View style={{ position: "absolute", top: 64, left: 22, right: 22, opacity: badgeOp }}>
        <View
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 14,
            paddingVertical: 8,
            backgroundColor: "rgba(255,255,255,0.96)",
            borderRadius: 999,
            borderWidth: 1,
            borderColor: P.border,
          }}
        >
          <Text style={{ color: P.leaf, fontWeight: "800", letterSpacing: 0.3 }}>
            {page.badge}
          </Text>
        </View>
      </Animated.View>

      {/* Card nội dung */}
      <View
        style={{
          position: "absolute",
          left: 22,
          right: 22,
          bottom: 112,
          borderRadius: 26,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: P.border,
          shadowColor: "#000",
          shadowOpacity: 0.10,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
          elevation: 3,
          backgroundColor: P.white,
        }}
      >
        <LinearGradient
          colors={["#FFFFFF", "#FBF7F2"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingVertical: 18, paddingHorizontal: 18 }}
        >
          <Animated.Text
            style={{
              color: P.ink,
              fontSize: 31,
              lineHeight: 36,
              fontWeight: "800",
              textAlign: "center",
              transform: [{ translateY: titleY }],
              opacity: titleOp,
              textShadowColor: "rgba(43,36,31,0.10)",
              textShadowRadius: 6,
              textShadowOffset: { width: 0, height: 2 },
            }}
          >
            {page.title}
          </Animated.Text>

          <View
            style={{
              alignSelf: "center",
              marginTop: 8,
              width: 64,
              height: 4,
              borderRadius: 999,
              backgroundColor: P.leaf,
            }}
          />

          <Animated.Text
            style={{
              color: P.sub,
              fontSize: 15.5,
              lineHeight: 23,
              textAlign: "center",
              marginTop: 10,
              opacity: descOp,
            }}
          >
            {page.desc}
          </Animated.Text>

          <View
            style={{
              marginTop: 14,
              height: 14,
              borderRadius: 12,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: P.border,
            }}
          >
            <LinearGradient
              colors={["#3A2F29", "#2F2621"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1 }}
            />
          </View>
        </LinearGradient>
      </View>
    </View>
  );
}

/* ------------- Buttons ------------- */
function BtnPlain({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: "#e9e3db" }}
      style={{
        flex: 1,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: "center",
        borderWidth: 1,
        borderColor: P.border,
        backgroundColor: P.white,
      }}
    >
      <Text style={{ color: P.ink, fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );
}
function BtnFilled({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: "#e0efe4" }}
      style={{
        flex: 1,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: "center",
        backgroundColor: P.leaf,
        borderWidth: 1,
        borderColor: "#1F5A25",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontWeight: "800", letterSpacing: 0.2 }}>
        {title}
      </Text>
    </Pressable>
  );
}
