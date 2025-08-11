import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";

export default function AuthLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: "#121212" }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#121212" },
        }}
      />
    </View>
  );
}
