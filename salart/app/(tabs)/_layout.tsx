import React from "react";
import { Tabs } from "expo-router";
import CustomTabBar from "../../components/CustomTabBar";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}
          tabBar={(props) => <CustomTabBar {...props} />}>
      <Tabs.Screen name="index"   options={{ title: "Trang chủ" }} />
      <Tabs.Screen name="menu"    options={{ title: "Thực đơn" }} />
      <Tabs.Screen name="garden"  options={{ title: "Hành trình" }} />
      <Tabs.Screen name="cart"  options={{ title: "Giỏ hàng" }} />
      <Tabs.Screen name="profile" options={{ title: "WOWCARE" }} />
    </Tabs>
  );
}
