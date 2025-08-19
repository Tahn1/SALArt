// app/(tabs)/_layout.tsx
import React from "react";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CustomTabBar from "../../components/CustomTabBar";

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  // Chiều cao "đĩa" TabBar theo thiết kế của bạn (không gồm safe area)
  const TAB_PLATE_BASE = 110;
  const tabBarHeight = TAB_PLATE_BASE + (insets.bottom || 0);

  return (
    <Tabs
      initialRouteName="index"                  // Trang chủ
      screenOptions={{
        headerShown: false,
        // Cho RN biết chiều cao thật của TabBar để tự chừa đáy cho mọi scene
        sceneContainerStyle: { paddingBottom: tabBarHeight },
        tabBarStyle: {
          height: tabBarHeight,
          backgroundColor: "transparent",
          borderTopWidth: 0,
          position: "absolute",
          elevation: 0,
        },
        tabBarHideOnKeyboard: true,
      }}
      // Nếu bạn dùng CustomTabBar, truyền luôn height để vẽ đúng
      tabBar={(props) => <CustomTabBar {...props} height={tabBarHeight} />}
    >
      {/* Thứ tự hiển thị = thứ tự khai báo dưới đây */}
      <Tabs.Screen
        name="index"                            // ✅ phải là tên file: app/(tabs)/index.tsx
        options={{ tabBarLabel: "Trang chủ", title: "Trang chủ" }}
      />
      <Tabs.Screen
        name="menu"                             // app/(tabs)/menu.tsx
        options={{ tabBarLabel: "Thực đơn", title: "Thực đơn" }}
      />
      <Tabs.Screen
        name="garden"                           // app/(tabs)/garden.tsx
        options={{ tabBarLabel: "Hành trình", title: "Hành trình" }}
      />
      <Tabs.Screen
        name="cart"                             // app/(tabs)/cart.tsx
        options={{ tabBarLabel: "Giỏ hàng", title: "Giỏ hàng" }}
      />
      <Tabs.Screen
        name="profile"                          // app/(tabs)/profile.tsx
        options={{ tabBarLabel: "WOWCARE", title: "WOWCARE" }}
      />
    </Tabs>
  );
}
