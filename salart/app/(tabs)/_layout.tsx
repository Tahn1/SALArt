// app/(tabs)/_layout.tsx
import React from "react";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CustomTabBar from "../../components/CustomTabBar";

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  // Chiều cao "đĩa" TabBar theo thiết kế (không gồm safe area)
  const TAB_PLATE_BASE = 110;
  const tabBarHeight = TAB_PLATE_BASE + (insets.bottom || 0);

  return (
    <Tabs
      id="rootTabs"
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        // Chừa đáy cho các màn trong tabs
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
      // Truyền cả `style` xuống custom bar để có thể nhận display:none
      tabBar={(props) => (
        <CustomTabBar {...props} height={tabBarHeight} style={props.style} />
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
