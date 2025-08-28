// app/(auth)/login.tsx  (hoặc đúng đường dẫn file Login của bạn)
import { Link, router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { Image as ExpoImage } from "expo-image";          // << THÊM: dùng để prefetch ảnh
import { supabase } from "../../lib/supabase";

const colors = {
  bg: "#121212",
  card: "#1E1E1E",
  text: "#E5E5E5",
  sub: "#9AA0A6",
  primary: "#E5E5E5",
  button: "#2A2A2A",
  accent: "#E6E6E6",
  border: "#2F2F2F",
};

const SS_EMAIL_KEY = "login_email";
const SS_PASS_KEY = "login_pass";

/** ====== KHAI BÁO DANH SÁCH ẢNH HOME CẦN PRELOAD ======
 * Điền đúng các URL ảnh hero/banner mà màn Home đang dùng
 * (VD: ảnh từ Supabase Storage hoặc CDN). Có thể để rỗng nếu chưa có.
 */
const HOME_IMAGES: string[] = [
  // "https://.../storage/v1/object/public/hero/hero1.jpg",
  // "https://.../storage/v1/object/public/hero/hero2.jpg",
];

/** Prefetch ảnh Home (không throw lỗi để không chặn đăng nhập) */
async function preloadHomeAssets() {
  if (!HOME_IMAGES.length) return;
  await Promise.allSettled(HOME_IMAGES.map((u) => ExpoImage.prefetch(u)));
}

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [savedEmail, savedPass] = await Promise.all([
          SecureStore.getItemAsync(SS_EMAIL_KEY),
          SecureStore.getItemAsync(SS_PASS_KEY),
        ]);
        if (savedEmail) setEmail(savedEmail);
        if (savedPass) {
          setPass(savedPass);
          setRemember(true);
        }
      } catch {}
    })();
  }, []);

  function isValidEmail(s: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  async function handleLogin() {
    const e = email.trim().toLowerCase();
    if (!e || !pass) {
      return Alert.alert("Thiếu thông tin", "Vui lòng nhập Email và Mật khẩu.");
    }
    if (!isValidEmail(e)) {
      return Alert.alert("Email không hợp lệ", "Vui lòng kiểm tra lại định dạng email.");
    }

    try {
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: e,
        password: pass,
      });

      if (error) {
        if (/confirm|not.*confirmed|xác nhận/i.test(error.message)) {
          return Alert.alert(
            "Chưa xác nhận email",
            "Vui lòng mở email đã được gửi sau khi đăng ký và bấm vào liên kết xác nhận."
          );
        }
        if (/invalid.*login|invalid.*credentials|mật khẩu/i.test(error.message)) {
          return Alert.alert("Sai thông tin", "Email hoặc mật khẩu chưa đúng.");
        }
        return Alert.alert("Đăng nhập thất bại", error.message);
      }

      // Lưu/clear ghi nhớ tài khoản
      try {
        if (remember) {
          await SecureStore.setItemAsync(SS_EMAIL_KEY, e);
          await SecureStore.setItemAsync(SS_PASS_KEY, pass);
        } else {
          await SecureStore.deleteItemAsync(SS_EMAIL_KEY);
          await SecureStore.deleteItemAsync(SS_PASS_KEY);
        }
      } catch {}

      // ==== QUAN TRỌNG: Preload ảnh Home trước khi điều hướng ====
      await preloadHomeAssets();

      // Điều hướng sang root (RootLayout sẽ route tiếp tùy phase)
      router.replace("/");

    } catch (err: any) {
      Alert.alert("Lỗi không xác định", err?.message ?? "Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPass() {
    const e = email.trim().toLowerCase();
    if (!isValidEmail(e)) {
      return Alert.alert("Nhập email", "Nhập email của bạn để nhận liên kết đặt lại mật khẩu.");
    }
    try {
      setBusy(true);
      const { error } = await supabase.auth.resetPasswordForEmail(e);
      if (error) return Alert.alert("Không gửi được", error.message);
      Alert.alert("Đã gửi", "Kiểm tra email của bạn để đặt lại mật khẩu.");
    } catch (err: any) {
      Alert.alert("Lỗi", err?.message ?? "Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, flexGrow: 1 }}>
        <View style={{ alignItems: "center", marginTop: 28, marginBottom: 20 }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "700" }}>
            Đăng nhập
          </Text>
          <View style={{ width: 50, height: 3, backgroundColor: colors.border, marginTop: 10, borderRadius: 999 }} />
        </View>

        <View style={{ gap: 14 }}>
          <Field>
            <Label>Email</Label>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#6B7280"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="email"
              style={{ color: colors.text, fontSize: 16 }}
              returnKeyType="next"
            />
          </Field>

          <Field>
            <Label>Mật khẩu</Label>
            <View style={{ position: "relative" }}>
              <TextInput
                value={pass}
                onChangeText={setPass}
                secureTextEntry={!showPass}
                placeholder="••••••••"
                placeholderTextColor="#6B7280"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="password"
                style={{ color: colors.text, fontSize: 16, paddingRight: 64 }}
                returnKeyType="go"
                onSubmitEditing={() => !busy && handleLogin()}
              />
              <Pressable
                onPress={() => setShowPass((s) => !s)}
                android_ripple={{ color: "#333", borderless: true }}
                style={{ position: "absolute", right: 0, top: 0, bottom: 0, justifyContent: "center", paddingHorizontal: 8 }}
              >
                <Text style={{ color: colors.accent, fontWeight: "600" }}>
                  {showPass ? "ẨN" : "HIỆN"}
                </Text>
              </Pressable>
            </View>
          </Field>

          <Pressable
            onPress={() => setRemember((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}
            android_ripple={{ color: "#333" }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                borderWidth: 2,
                borderColor: remember ? colors.accent : colors.border,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: remember ? "#3B3B3B" : "transparent",
              }}
            >
              {remember ? (
                <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors.accent }} />
              ) : null}
            </View>
            <Text style={{ color: colors.sub }}>Ghi nhớ đăng nhập</Text>
          </Pressable>

          <Pressable
            onPress={handleForgotPass}
            style={{ alignSelf: "flex-end", marginTop: 8 }}
            android_ripple={{ color: "#333" }}
          >
            <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}>
              Quên mật khẩu?
            </Text>
          </Pressable>
        </View>

        <Pressable
          disabled={busy}
          onPress={handleLogin}
          android_ripple={{ color: "#333" }}
          style={{
            marginTop: 24,
            backgroundColor: colors.button,
            paddingVertical: 14,
            borderRadius: 16,
            alignItems: "center",
            borderWidth: 1,
            borderColor: colors.border,
            opacity: busy ? 0.6 : 1,
          }}
        >
          <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 16 }}>
            {busy ? "ĐANG XỬ LÝ..." : "ĐĂNG NHẬP"}
          </Text>
        </Pressable>

        <View style={{ alignItems: "center", marginTop: 18 }}>
          <Text style={{ color: colors.sub }}>
            Chưa có tài khoản?{" "}
            <Link href="/signup" style={{ color: colors.accent, fontWeight: "600" }}>
              Đăng ký
            </Link>
          </Text>
        </View>

        <Text style={{ color: colors.sub, fontSize: 11, marginTop: 12, textAlign: "center" }}>
          * Mật khẩu được lưu trong SecureStore trên thiết bị của bạn (tuỳ chọn “Ghi nhớ đăng nhập”).
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---------- small UI helpers ---------- */
function Field({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {children}
    </View>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: colors.sub, marginBottom: 6 }}>{children}</Text>;
}
