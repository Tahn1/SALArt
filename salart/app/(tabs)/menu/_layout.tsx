import { Stack } from "expo-router";

export default function MenuStackLayout() {
  return (
    <Stack>
      {/* Danh sách món trong tab: ẩn header */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* Chi tiết món: hiện header back & tiêu đề món */}
      <Stack.Screen
        name="[id]"
        options={{
          headerShown: true,
          headerTitle: "",
          headerBackTitleVisible: false,
        }}
      />
    </Stack>
  );
}
