// lib/ui/useBottomSpace.ts
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

export function useBottomSpace(extra = 0) {
  const insets = useSafeAreaInsets();
  const tabH = useBottomTabBarHeight?.() ?? 0; // nếu không ở trong Tab, sẽ là 0
  return Math.max(tabH, insets.bottom) + extra;
}
const bottomSpace = useBottomSpace(16);
<FlatList
  contentContainerStyle={{ paddingBottom: bottomSpace }}
  scrollIndicatorInsets={{ bottom: bottomSpace }}
/>
