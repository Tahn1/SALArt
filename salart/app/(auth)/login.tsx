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
import { supabase } from "../../lib/supabase";
import { hasOnboarded } from "../../lib/onboarding";

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

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  // Nạp thông tin đã lưu (nếu có)
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

  async function handleLogin() {
    if (!email.trim() || !pass) {
      return Alert.alert("Thiếu thông tin", "Vui lòng nhập Email và Mật khẩu.");
    }
    try {
      setBusy(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pass,
      });

      if (error) {
        if (/confirm|not.*confirmed|xác nhận/i.test(error.message)) {
          return Alert.alert(
            "Chưa xác nhận email",
            "Vui lòng mở email đã được gửi sau khi đăng ký và bấm vào liên kết xác nhận."
          );
        }
        return Alert.alert("Đăng nhập thất bại", error.message);
      }

      // Lưu / xoá ghi nhớ đăng nhập
      try {
        if (remember) {
          await SecureStore.setItemAsync(SS_EMAIL_KEY, email.trim().toLowerCase());
          await SecureStore.setItemAsync(SS_PASS_KEY, pass);
        } else {
          await SecureStore.deleteItemAsync(SS_EMAIL_KEY);
          await SecureStore.deleteItemAsync(SS_PASS_KEY);
        }
      } catch {}

      // Điều hướng theo trạng thái onboarding
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && !(await hasOnboarded(user.id))) {
        return router.replace("/onboarding");
      }
      router.replace("/home");
    } catch (e: any) {
      Alert.alert("Lỗi không xác định", e?.message ?? "Vui lòng thử lại.");
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
          {/* Email */}
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

          {/* Mật khẩu + HIỆN/ẨN */}
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

          {/* Ghi nhớ đăng nhập */}
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
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: colors.accent,
                  }}
                />
              ) : null}
            </View>
            <Text style={{ color: colors.sub }}>Ghi nhớ đăng nhập</Text>
          </Pressable>
        </View>

        {/* Đăng nhập */}
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

        {/* Nhắc bảo mật nhỏ */}
        <Text style={{ color: colors.sub, fontSize: 11, marginTop: 12, textAlign: "center" }}>
          * Mật khẩu được mã hoá cục bộ bằng SecureStore trên thiết bị của bạn.
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
