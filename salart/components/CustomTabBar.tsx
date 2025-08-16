import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Animated } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const C = { white: "#fff", brown: "#522504", ink: "#1d130b" };
const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "home-outline",
  menu: "restaurant-outline",
  garden: "leaf-outline",
  orders: "bag-outline",
  profile: "chatbubble-ellipses-outline",
};

export default function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const inset = useSafeAreaInsets();
  const plateH = 110 + (inset.bottom || 0);

  // nâng icon khi active
  const lifts = useRef(Object.fromEntries(state.routes.map(r => [r.key, new Animated.Value(0)]))).current;
  useEffect(() => {
    state.routes.forEach((route, i) => {
      Animated.timing(lifts[route.key], {
        toValue: state.index === i ? -40 : 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
    });
  }, [state.index]);

  return (
    <View style={[styles.wrap, { height: plateH, paddingBottom: Math.max(inset.bottom * 0.35, 8) }]}>
      <View style={styles.plate} />
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const iconName = ICONS[route.name] ?? "ellipse-outline";

          const onPress = () => {
            const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!isFocused && !e.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Pressable key={route.key} onPress={onPress} style={styles.item} android_ripple={{ color: "#eee", borderless: true }}>
              <Animated.View style={{ alignItems: "center", transform: [{ translateY: lifts[route.key] }], zIndex: 2 }}>
                {isFocused ? (
                  <>
                    <View style={styles.halo} />
                    <View style={styles.activeIconWrap}>
                      <Ionicons name={iconName as any} size={26} color={C.white} />
                    </View>
                  </>
                ) : (
                  <View style={styles.iconWrap}>
                    <Ionicons name={iconName as any} size={26} color={C.ink} />
                  </View>
                )}
              </Animated.View>

              {/* label: đẩy lên & thêm căn lề, không sát viền */}
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
  wrap: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 12, // đệm 2 bên lớn hơn
  },
  plate: {
    position: "absolute",
    left: 1, right: 1, 
    top: 0, bottom: 0,
    backgroundColor: C.white,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
    zIndex: 0,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 18, // đệm trong hàng để item ngoài rìa không chạm mép
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    height: "100%",
    paddingBottom: 10,
  },

  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },

  halo: {
    position: "absolute",
    top: -28,
    width: 72, height: 72, borderRadius: 36,
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
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.brown,
    alignItems: "center", justifyContent: "center",
  },


  label: {
    fontSize: 14,
    marginTop: 28, 
    color: C.brown,
    textAlign: "center",
    paddingHorizontal: 2,
  },
  labelOn: { opacity: 1, fontWeight: "600" },
  labelOff: { opacity: 0 },
});
