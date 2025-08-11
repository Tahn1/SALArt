import { Link, router } from "expo-router";
import React, { useState } from "react";
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

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);

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

      router.replace("/home"); // đổi theo route chính của bạn
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
          <View style={{ backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.sub, marginBottom: 6 }}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#6B7280"
              keyboardType="email-address"
              autoCapitalize="none"
              style={{ color: colors.text, fontSize: 16 }}
            />
          </View>

          {/* Mật khẩu + HIỆN/ẨN */}
          <View style={{ backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.sub, marginBottom: 6 }}>Mật khẩu</Text>
            <View style={{ position: "relative" }}>
              <TextInput
                value={pass}
                onChangeText={setPass}
                secureTextEntry={!showPass}
                placeholder="••••••••"
                placeholderTextColor="#6B7280"
                style={{ color: colors.text, fontSize: 16, paddingRight: 64 }}
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
          </View>
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
