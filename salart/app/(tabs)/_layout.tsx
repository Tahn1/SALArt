import React from "react";
import { Tabs } from "expo-router";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";

const P = {
  cream: "#F8F4EF",
  ink: "#2B241F",
  sub: "#6B615C",
  white: "#FFFFFF",
  border: "#E6E0D6",
};

export default function Layout() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const C = {
    bg: isDark ? "#0C0C0C" : P.cream,
    text: isDark ? "#EDEDED" : P.ink,
    sub: isDark ? "#B7B7B7" : P.sub,
    bar: isDark ? "#101010" : P.white,
    border: isDark ? "#1E1E1E" : P.border,
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: "none" }, // ẩn tab mặc định
      }}
      tabBar={(props) => <FloatingTabBar {...props} colors={C} />}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="gift" options={{ title: "Gift" }} />
      <Tabs.Screen name="menu" options={{ title: "Menu" }} />
      <Tabs.Screen name="orders" options={{ title: "Orders" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

// Thanh tab nổi tuỳ biến
const FloatingTabBar: React.FC<any> = ({ state, descriptors, navigation, colors }) => {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.tabWrap,
        { paddingBottom: Math.max(insets.bottom, 10) },
      ]}
    >
      <View
        style={[
          styles.tabBar,
          { backgroundColor: colors.bar, borderColor: colors.border },
        ]}
      >
        {state.routes.map((route: any, index: number) => {
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          // Center MENU (route "menu") dạng chữ
          if (route.name === "menu") {
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.menuCenter}
                android_ripple={{ color: "#DDD", borderless: false }}
              >
                <Text style={styles.menuText}>MENU</Text>
              </Pressable>
            );
          }

          // Avatar bên phải (route "profile")
          if (route.name === "profile") {
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.avatarBtn}
                android_ripple={{ color: "#DDD", borderless: false }}
              >
                <ExpoImage
                  source={require("../../assets/avatar.jpg")}
                  style={styles.avatar}
                  contentFit="cover"
                />
              </Pressable>
            );
          }

          // Các tab icon còn lại
          const icon = getIconFor(route.name);
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.navItem}
              android_ripple={{ color: "#DDD", borderless: true }}
            >
              {icon}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const getIconFor = (name: string) => {
  switch (name) {
    case "index":
      return <Ionicons name="home-outline" size={22} />;
    case "gift":
      return <Feather name="gift" size={22} />;
    case "orders":
      return <Ionicons name="bag-outline" size={22} />;
    default:
      return <Ionicons name="ellipse-outline" size={22} />;
  }
};

const styles = StyleSheet.create({
  tabWrap: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    alignItems: "center",
  },
  tabBar: {
    width: "90%",
    maxWidth: 360,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 28,
    paddingHorizontal: 14,
    paddingVertical: 12,
    elevation: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  navItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  menuCenter: {
    paddingHorizontal: 18,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  menuText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 2,
  },
  avatarBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
  },
  avatar: {
    width: "100%",
    height: "100%",
    borderRadius: 22,
  },
});
