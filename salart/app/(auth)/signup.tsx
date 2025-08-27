import { Link } from "expo-router";
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
  const [dobText, setDobText] = useState(""); // MM/DD/YYYY
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);

  // ✅ trạng thái đã gửi mail xác nhận
  const [sent, setSent] = useState(false);

  function formatDobDigits(input: string) {
    const digits = input.replace(/\D/g, "").slice(0, 8);
    const mm = digits.slice(0, 2);
    const dd = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    if (digits.length <= 2) return mm;
    if (digits.length <= 4) return `${mm}/${dd}`;
    return `${mm}/${dd}/${yyyy}`;
  }

  function parseDob(str: string): Date | null {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
    if (!m) return null;
    const [_, mmS, ddS, yyyyS] = m;
    const mm = Number(mmS);
    const dd = Number(ddS);
    const yyyy = Number(yyyyS);
    if (mm < 1 || mm > 12) return null;
    if (yyyy < 1900) return null;
    const d = new Date(yyyy, mm - 1, dd);
    if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
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
      // ĐƯỜNG DẪN CALLBACK (không cần group trong path)
      const redirectTo = Linking.createURL("/auth/callback"); // ví dụ: salart://auth/callback
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: pass,
        options: {
          data: { firstName, lastName, gender, dob: dobISO },
          emailRedirectTo: redirectTo,
        },
      });

      if (error) {
        Alert.alert("Lỗi đăng ký", error.message);
        return;
      }

      // ❌ Đừng điều hướng về /login ở đây
      setSent(true);
    } catch (e: any) {
      Alert.alert("Lỗi không xác định", e?.message ?? "Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  // ====== UI khi đã gửi email xác nhận ======
  if (sent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800", textAlign: "center" }}>
          Kiểm tra email để xác nhận
        </Text>
        <Text style={{ color: colors.sub, marginTop: 10, textAlign: "center" }}>
          Chúng tôi đã gửi liên kết xác nhận đến{" "}
          <Text style={{ color: colors.accent, fontWeight: "700" }}>{email.trim()}</Text>.
          Hãy mở email và bấm vào liên kết để hoàn tất đăng ký.
        </Text>

        <Pressable
          onPress={() => Linking.openURL("mailto:")}
          style={{
            marginTop: 20, backgroundColor: colors.button, paddingVertical: 12, paddingHorizontal: 18,
            borderRadius: 12, borderWidth: 1, borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.accent, fontWeight: "700" }}>Mở ứng dụng Email</Text>
        </Pressable>

        <Text style={{ color: colors.sub, marginTop: 16 }}>
          Đã xác nhận?{" "}
          <Link href="/login" style={{ color: colors.accent, fontWeight: "700" }}>
            Về đăng nhập
          </Link>
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <View style={{ alignItems: "center", marginTop: 8, marginBottom: 12 }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "700" }}>Tạo tài khoản</Text>
          <View style={{ width: 50, height: 3, backgroundColor: colors.border, marginTop: 10, borderRadius: 999 }} />
        </View>

        <Field label="Họ">
          <TextInput value={lastName} onChangeText={setLastName} placeholder="Nguyễn" placeholderTextColor="#6B7280" style={inputStyle} />
        </Field>

        <Field label="Tên">
          <TextInput value={firstName} onChangeText={setFirstName} placeholder="An" placeholderTextColor="#6B7280" style={inputStyle} />
        </Field>

        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.sub, marginBottom: 8 }}>Giới tính</Text>
          <View style={{ flexDirection: "row", gap: 22 }}>
            <Radio label="Nữ" selected={gender === "female"} onPress={() => setGender("female")} />
            <Radio label="Nam" selected={gender === "male"} onPress={() => setGender("male")} />
          </View>
        </View>

        <Field label="Ngày sinh (MM/DD/YYYY)">
          <TextInput
            value={dobText}
            onChangeText={(t) => setDobText(formatDobDigits(t))}
            keyboardType="number-pad"
            placeholder="MM/DD/YYYY"
            placeholderTextColor="#6B7280"
            maxLength={10}
            style={inputStyle}
          />
          {!!dobText && !dobISO && <Text style={{ color: "#F87171", marginTop: 6, fontSize: 12 }}>Ngày sinh không hợp lệ.</Text>}
        </Field>

        <Field label="Email">
          <TextInput value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
            placeholder="you@example.com" placeholderTextColor="#6B7280" style={inputStyle} />
        </Field>

        <Field label="Mật khẩu">
          <TextInput value={pass} onChangeText={setPass} secureTextEntry placeholder="••••••••" placeholderTextColor="#6B7280" style={inputStyle} />
        </Field>

        <Field label="Nhập lại mật khẩu">
          <TextInput value={pass2} onChangeText={setPass2} secureTextEntry placeholder="••••••••" placeholderTextColor="#6B7280" style={inputStyle} />
        </Field>

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
            <Link href="/login" style={{ color: colors.accent, fontWeight: "600" }}>Đăng nhập</Link>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ----------------- Components ----------------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, marginTop: 12, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ color: colors.sub, marginBottom: 6 }}>{label}</Text>
      {children}
    </View>
  );
}

function Radio({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} android_ripple={{ color: "#333", borderless: true }} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 20, height: 20, borderRadius: 999, borderWidth: 2, borderColor: selected ? "#E6E6E6" : colors.border, alignItems: "center", justifyContent: "center" }}>
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: "#E6E6E6" }} /> : null}
      </View>
      <Text style={{ color: colors.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

const inputStyle = { color: colors.text, fontSize: 16 } as const;
