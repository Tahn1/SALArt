// app/(tabs)/_layout.tsx
import React, { useMemo } from "react";
import { Tabs, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CustomTabBar from "../../components/CustomTabBar";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();

  // Chiều cao "đĩa" TabBar theo thiết kế (không gồm safe area)
  const TAB_PLATE_BASE = 110;

  // Tính chiều cao TabBar kèm safe area bottom
  const tabBarHeight = useMemo(
    () => TAB_PLATE_BASE + (insets.bottom || 0),
    [insets.bottom]
  );

  // Đang ở group (tabs) và đứng ở màn gốc của 1 tab? (vd: /(tabs)/index, /(tabs)/menu, …)
  const isRootTab =
    segments.length === 2 && segments[0] === "(tabs)"; // ["(tabs)","index" | "menu" | "garden" | "cart" | "profile"]

  // Khi không ở root tab (vào màn con), ẩn TabBar & bỏ padding đáy
  const hideTabBar = !isRootTab;

  return (
    <Tabs
      id="rootTabs"
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        // Chừa đáy cho các màn trong tabs (nhưng nếu TabBar ẩn thì padding = 0)
        sceneContainerStyle: { paddingBottom: hideTabBar ? 0 : tabBarHeight },
        tabBarStyle: {
          height: tabBarHeight,
          backgroundColor: "transparent",
          borderTopWidth: 0,
          position: "absolute",
          elevation: 0,
          // Khi không ở root tab, dấu TabBar bằng display:none để không chiếm chỗ
          display: hideTabBar ? "none" : "flex",
        },
        tabBarHideOnKeyboard: true,
      }}
      // Truyền cả style xuống custom bar (để nhận display:none) + height để vẽ nền/plate đúng kích thước
      tabBar={(props) => (
        <CustomTabBar
          {...props}
          height={tabBarHeight}
          // gộp style có thể chứa display:none từ screenOptions
          style={props.style}
        />
      )}
    >
      <Tabs.Screen
        name="index"
        options={{ tabBarLabel: "Trang chủ", title: "Trang chủ" }}
      />
      <Tabs.Screen
        name="menu"
        options={{ tabBarLabel: "Thực đơn", title: "Thực đơn" }}
      />
      <Tabs.Screen
        name="garden"
        options={{ tabBarLabel: "Hành trình", title: "Hành trình" }}
      />
      <Tabs.Screen
        name="cart"
        options={{ tabBarLabel: "Giỏ hàng", title: "Giỏ hàng" }}
      />
      <Tabs.Screen
        name="profile"
        options={{ tabBarLabel: "WOWCARE", title: "WOWCARE" }}
      />
    </Tabs>
  );
}
