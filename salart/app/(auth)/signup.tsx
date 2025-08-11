import { Link, router } from "expo-router";
import * as Linking from "expo-linking";
import React, { useMemo, useState } from "react";
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

type Gender = "male" | "female" | null;

export default function SignUpScreen() {
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [gender, setGender] = useState<Gender>(null);
  const [dobText, setDobText] = useState(""); // MM/DD/YYYY (gõ số auto chèn "/")
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);

  // --- DOB helpers ---
  function formatDobDigits(input: string) {
    // chỉ lấy số, tối đa 8 ký tự (MMDDYYYY)
    const digits = input.replace(/\D/g, "").slice(0, 8);
    const mm = digits.slice(0, 2);
    const dd = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    if (digits.length <= 2) return mm;
    if (digits.length <= 4) return `${mm}/${dd}`;
    return `${mm}/${dd}/${yyyy}`;
  }

  function parseDob(str: string): Date | null {
    // kỳ vọng "MM/DD/YYYY"
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
    if (!m) return null;
    const [_, mmS, ddS, yyyyS] = m;
    const mm = Number(mmS);
    const dd = Number(ddS);
    const yyyy = Number(yyyyS);
    if (mm < 1 || mm > 12) return null;
    if (yyyy < 1900) return null;
    const d = new Date(yyyy, mm - 1, dd);
    // kiểm tra đúng ngày/tháng
    if (
      d.getFullYear() !== yyyy ||
      d.getMonth() !== mm - 1 ||
      d.getDate() !== dd
    )
      return null;
    // không cho tương lai
    const today = new Date();
    if (d.getTime() > today.getTime()) return null;
    return d;
  }

  const dobISO = useMemo(() => {
    const d = parseDob(dobText);
    return d ? d.toISOString() : null;
  }, [dobText]);

  function validate() {
    if (!lastName.trim()) return "Vui lòng nhập Họ.";
    if (!firstName.trim()) return "Vui lòng nhập Tên.";
    if (!gender) return "Chọn giới tính.";
    if (!dobISO) return "Ngày sinh không hợp lệ (định dạng MM/DD/YYYY).";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "Email không hợp lệ.";
    if (pass.length < 6) return "Mật khẩu tối thiểu 6 ký tự.";
    if (pass !== pass2) return "Mật khẩu nhập lại không khớp.";
    return null;
  }

  async function handleSignUp() {
    const err = validate();
    if (err) return Alert.alert("Thiếu thông tin", err);

    try {
      setBusy(true);
      const redirectTo = Linking.createURL("/auth/callback"); // salart://auth/callback
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: pass,
        options: {
          data: {
            firstName,
            lastName,
            gender,
            dob: dobISO, // lưu ISO để backend đọc chuẩn
          },
          emailRedirectTo: redirectTo,
        },
      });

      if (error) {
        Alert.alert("Lỗi đăng ký", error.message);
        return;
      }

      // Thông báo và chuyển về màn đăng nhập "chờ xác nhận"
      Alert.alert(
        "Kiểm tra email",
        "Chúng tôi đã gửi email xác nhận. Vui lòng bấm vào liên kết trong email (trong thời hạn hiệu lực) để hoàn tất đăng ký."
      );
      router.replace("/login");
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
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
        <View style={{ alignItems: "center", marginTop: 8, marginBottom: 12 }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "700" }}>
            Tạo tài khoản
          </Text>
          <View
            style={{
              width: 50,
              height: 3,
              backgroundColor: colors.border,
              marginTop: 10,
              borderRadius: 999,
            }}
          />
        </View>

        {/* Họ */}
        <Field label="Họ">
          <TextInput
            value={lastName}
            onChangeText={setLastName}
            placeholder="Nguyễn"
            placeholderTextColor="#6B7280"
            style={inputStyle}
          />
        </Field>

        {/* Tên */}
        <Field label="Tên">
          <TextInput
            value={firstName}
            onChangeText={setFirstName}
            placeholder="An"
            placeholderTextColor="#6B7280"
            style={inputStyle}
          />
        </Field>

        {/* Giới tính */}
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.sub, marginBottom: 8 }}>Giới tính</Text>
          <View style={{ flexDirection: "row", gap: 22 }}>
            <Radio
              label="Nữ"
              selected={gender === "female"}
              onPress={() => setGender("female")}
            />
            <Radio
              label="Nam"
              selected={gender === "male"}
              onPress={() => setGender("male")}
            />
          </View>
        </View>

        {/* Ngày sinh (MM/DD/YYYY) – nhập số, auto chèn "/" */}
        <Field label="Ngày sinh (MM/DD/YYYY)">
          <TextInput
            value={dobText}
            onChangeText={(t) => setDobText(formatDobDigits(t))}
            keyboardType="number-pad"
            placeholder="MM/DD/YYYY"
            placeholderTextColor="#6B7280"
            maxLength={10} // 2 + 1 + 2 + 1 + 4
            style={inputStyle}
          />
          {!!dobText && !dobISO && (
            <Text style={{ color: "#F87171", marginTop: 6, fontSize: 12 }}>
              Ngày sinh không hợp lệ.
            </Text>
          )}
        </Field>

        {/* Email */}
        <Field label="Email">
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="you@example.com"
            placeholderTextColor="#6B7280"
            style={inputStyle}
          />
        </Field>

        {/* Mật khẩu */}
        <Field label="Mật khẩu">
          <TextInput
            value={pass}
            onChangeText={setPass}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor="#6B7280"
            style={inputStyle}
          />
        </Field>

        {/* Nhập lại mật khẩu */}
        <Field label="Nhập lại mật khẩu">
          <TextInput
            value={pass2}
            onChangeText={setPass2}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor="#6B7280"
            style={inputStyle}
          />
        </Field>

        {/* Nút Đăng ký */}
        <Pressable
          disabled={busy}
          onPress={handleSignUp}
          android_ripple={{ color: "#333" }}
          style={{
            marginTop: 18,
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
            {busy ? "ĐANG XỬ LÝ..." : "ĐĂNG KÝ"}
          </Text>
        </Pressable>

        <View style={{ alignItems: "center", marginTop: 16 }}>
          <Text style={{ color: colors.sub }}>
            Đã có tài khoản?{" "}
            <Link href="/login" style={{ color: colors.accent, fontWeight: "600" }}>
              Đăng nhập
            </Link>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ----------------- Components ----------------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginTop: 12,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.sub, marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );
}

function Radio({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: "#333", borderless: true }}
      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          borderWidth: 2,
          borderColor: selected ? "#E6E6E6" : colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              backgroundColor: "#E6E6E6",
            }}
          />
        ) : null}
      </View>
      <Text style={{ color: colors.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

const inputStyle = { color: colors.text, fontSize: 16 } as const;
