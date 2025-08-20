import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Animated, ViewStyle } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCart } from "../lib/cart";

const C = { white: "#fff", brown: "#522504", ink: "#1d130b" };

// SVG icons
import HomeIcon from "../assets/icons/home.svg";
import MenuIcon from "../assets/icons/salad.svg";
import LeafIcon from "../assets/icons/leaf.svg";   // garden
import BagIcon from "../assets/icons/bag.svg";     // cart
import HeartIcon from "../assets/icons/heart.svg"; // profile

// Chỉ hiển thị các route dưới (khớp với (tabs)/_layout.tsx)
const VALID_ROUTES = ["index", "menu", "garden", "cart", "profile"] as const;

type Props = BottomTabBarProps & {
  style?: ViewStyle;   // (tùy) nếu Tabs có truyền xuống
  height?: number;     // chiều cao plate do _layout tính
};

export default function CustomTabBar({ state, descriptors, navigation, style, height }: Props) {
  const inset = useSafeAreaInsets();
  const plateH = typeof height === "number" ? height : 110 + (inset.bottom || 0);

  // ====== ẨN TAB BAR KHI Ở MÀN CHI TIẾT MÓN (menu/[id]) ======
  try {
    const navState = navigation.getState();        // state của BottomTabs
    const focusedTab = navState.routes?.[navState.index];
    if (focusedTab?.name === "menu") {
      // state con là Stack: index -> 'index' hoặc '[id]'
      const stackState: any = (focusedTab as any).state;
      const nestedName = stackState?.routes?.[stackState.index]?.name;
      // Ẩn nếu không phải trang 'index' của tab menu (vd: '[id]')
      if (nestedName && nestedName !== "index") return null;
    }
  } catch {}
  // Ngoài ra, nếu cha set display:'none' thì cũng ẩn
  if ((style as any)?.display === "none") return null;
  // ===========================================================

  // anim nâng icon
  const lifts = useRef(
    Object.fromEntries(state.routes.map((r) => [r.key, new Animated.Value(0)])) as Record<string, Animated.Value>
  ).current;

  useEffect(() => {
    state.routes.forEach((route, i) => {
      Animated.timing(lifts[route.key], {
        toValue: state.index === i ? -8 : 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
    });
  }, [state.index]);

  // Badge giỏ hàng
  const { items } = useCart();
  const cartQty = items.reduce((s, it) => s + it.qty, 0);

  const ICON_MAP: Record<string, React.ComponentType<any>> = {
    index: HomeIcon,
    menu: MenuIcon,
    garden: LeafIcon,
    cart: BagIcon,
    profile: HeartIcon,
  };

  return (
    <View
      style={[
        styles.wrap,
        { height: plateH, paddingBottom: Math.max(inset.bottom * 0.35, 8) },
        style, // vẫn cho phép nhận thêm style từ Tabs
      ]}
    >
      <View style={styles.plate} />
      <View style={styles.row}>
        {state.routes
          .filter((r) => VALID_ROUTES.includes(r.name as any))
          .map((route) => {
            // xác định focus theo route.key (không dùng index sau khi filter)
            const isFocused = state.routes[state.index]?.key === route.key;
            const Icon = ICON_MAP[route.name] ?? BagIcon;

            const onPress = () => {
              const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!isFocused && !e.defaultPrevented) navigation.navigate(route.name);
            };

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.item}
                android_ripple={{ color: "#eee", borderless: true }}
              >
                <Animated.View
                  style={{ alignItems: "center", transform: [{ translateY: lifts[route.key] }], zIndex: 2 }}
                >
                  <View style={styles.iconWrap}>
                    <Icon width={26} height={26} color={C.ink} style={{ opacity: isFocused ? 0 : 1 }} />
                  </View>

                  {isFocused && (
                    <>
                      <View pointerEvents="none" style={styles.halo} />
                      <View pointerEvents="none" style={styles.activeIconWrap}>
                        <Icon width={26} height={26} color={C.white} />
                      </View>
                    </>
                  )}

                  {/* BADGE cho tab cart */}
                  {route.name === "cart" && cartQty > 0 && (
                    <View
                      style={{
                        position: "absolute",
                        right: -2,
                        top: -4,
                        minWidth: 18,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: "#ef4444",
                        paddingHorizontal: 5,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>{cartQty}</Text>
                    </View>
                  )}
                </Animated.View>

                <Text
                  style={[styles.label, isFocused ? styles.labelOn : styles.labelOff]}
                  numberOfLines={1}
                  ellipsizeMode="clip"
                >
                  {descriptors[route.key]?.options?.title ?? route.name}
                </Text>
              </Pressable>
            );
          })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12 },
  plate: {
    position: "absolute",
    left: 1,
    right: 1,
    top: 0,
    bottom: 0,
    backgroundColor: C.white,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
    zIndex: 0,
  },
  row: { flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 18 },
  item: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%", paddingBottom: 10 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  halo: {
    position: "absolute",
    top: -28,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.white,
    shadowColor: "#000",
    shadowOpacity: 0.10,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 9,
  },
  activeIconWrap: {
    position: "absolute",
    top: -19,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.brown,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 13, marginTop: 28, color: C.brown, textAlign: "center", paddingHorizontal: 2 },
  labelOn: { opacity: 1, fontWeight: "600" },
  labelOff: { opacity: 0 },
});
