import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { supabase } from "../../lib/supabase";          // chỉnh đường dẫn nếu lib/supabase đặt nơi khác
import { addToCart } from "../../lib/cart";            // giữ nguyên như bạn đang dùng trong menu.tsx
import { sumExtras, IngredientNutri, GramMap } from "../../lib/nutrition";

type BaseTotals = { kcal: number; protein: number; fat: number; carbs: number };
type Rule = { step?: number; max?: number };

export default function DishDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dishId = Number(id);

  const [loading, setLoading] = useState(true);
  const [base, setBase] = useState<BaseTotals>({ kcal: 0, protein: 0, fat: 0, carbs: 0 });
  const [ingMap, setIngMap] = useState<Record<number, IngredientNutri>>({});
  const [inRecipe, setInRecipe] = useState<Array<{ ingredient_id: number; name: string; rule: Rule }>>([]);
  const [addons, setAddons] = useState<Array<{ ingredient_id: number; name: string; rule: Rule }>>([]);
  const [extrasByIng, setExtrasByIng] = useState<GramMap>({}); // chỉ _THÊM_, mặc định 0

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // 1) Lấy tổng DINH DƯỠNG MẶC ĐỊNH từ view dish_nutrition_default
        const { data: def } = await supabase
          .from("dish_nutrition_default")
          .select("kcal,protein,fat,carbs")
          .eq("dish_id", dishId)
          .maybeSingle();

        // 2) Lấy nguyên liệu trong công thức + dinh dưỡng per-100g
        const { data: di } = await supabase
          .from("dish_ingredients")
          .select(`
            ingredient_id, amount_g,
            ingredients ( name, kcal_100, protein_100, fat_100, carbs_100 )
          `)
          .eq("dish_id", dishId);

        // 3) (Tuỳ chọn) Lấy danh sách addon cho phép ngoài công thức
        const { data: add } = await supabase
          .from("dish_allowed_addons")
          .select(`
            ingredient_id, step_g, max_g,
            ingredients ( name, kcal_100, protein_100, fat_100, carbs_100 )
          `)
          .eq("dish_id", dishId);

        // build ingMap (per-100g)
        const map: Record<number, IngredientNutri> = {};
        (di ?? []).forEach((r: any) => {
          const i = r.ingredient_id;
          map[i] = {
            id: i,
            name: r.ingredients?.name,
            kcal: r.ingredients?.kcal_100,
            protein: r.ingredients?.protein_100,
            fat: r.ingredients?.fat_100,
            carbs: r.ingredients?.carbs_100,
          };
        });
        (add ?? []).forEach((r: any) => {
          const i = r.ingredient_id;
          if (!map[i]) {
            map[i] = {
              id: i,
              name: r.ingredients?.name,
              kcal: r.ingredients?.kcal_100,
              protein: r.ingredients?.protein_100,
              fat: r.ingredients?.fat_100,
              carbs: r.ingredients?.carbs_100,
            };
          }
        });

        // danh sách hiển thị
        setInRecipe((di ?? []).map((r: any) => ({
          ingredient_id: r.ingredient_id,
          name: r.ingredients?.name ?? `#${r.ingredient_id}`,
          rule: { step: 10, max: undefined }, // có thể đọc step_g/max_g từ dish_ingredients nếu bạn thêm cột
        })));
        setAddons((add ?? []).map((r: any) => ({
          ingredient_id: r.ingredient_id,
          name: r.ingredients?.name ?? `#${r.ingredient_id}`,
          rule: { step: Number(r.step_g ?? 10), max: r.max_g ? Number(r.max_g) : undefined },
        })));

        // base totals: ưu tiên lấy từ view; nếu không có view thì cộng tay từ di.amount_g
        if (def) {
          setBase({
            kcal: def.kcal ?? 0,
            protein: Number(def.protein ?? 0),
            fat: Number(def.fat ?? 0),
            carbs: Number(def.carbs ?? 0),
          });
        } else {
          // tự cộng từ công thức nếu bạn CHƯA tạo view dish_nutrition_default
          let kb = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
          (di ?? []).forEach((r: any) => {
            const g = Number(r.amount_g ?? 0) / 100;
            kb.kcal    += Math.round((r.ingredients?.kcal_100 ?? 0) * g);
            kb.protein += (r.ingredients?.protein_100 ?? 0) * g;
            kb.fat     += (r.ingredients?.fat_100 ?? 0) * g;
            kb.carbs   += (r.ingredients?.carbs_100 ?? 0) * g;
          });
          setBase({
            kcal: Math.round(kb.kcal),
            protein: +kb.protein.toFixed(1),
            fat: +kb.fat.toFixed(1),
            carbs: +kb.carbs.toFixed(1),
          });
        }

        setIngMap(map);
        setExtrasByIng({}); // tất cả = 0g khi mở màn
      } finally {
        setLoading(false);
      }
    })();
  }, [dishId]);

  const extras = useMemo(() => sumExtras(ingMap, extrasByIng), [ingMap, extrasByIng]);
  const grand: BaseTotals = useMemo(() => ({
    kcal: base.kcal + extras.kcal,
    protein: +(base.protein + extras.protein).toFixed(1),
    fat:     +(base.fat     + extras.fat    ).toFixed(1),
    carbs:   +(base.carbs   + extras.carbs  ).toFixed(1),
  }), [base, extras]);

  function bump(id: number, delta: number, rule: Rule) {
    const step = Number(rule.step ?? 10);
    let next = Math.max(0, (extrasByIng[id] ?? 0) + delta * step);
    if (rule.max != null) next = Math.min(next, Number(rule.max));
    setExtrasByIng(s => ({ ...s, [id]: next }));
  }

  if (loading) {
    return <View style={{ flex:1, alignItems:"center", justifyContent:"center" }}>
      <ActivityIndicator />
    </View>;
  }

  return (
    <View style={{ flex:1 }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom: 100 }}>
        <Text style={{ fontWeight:"800", fontSize:18, marginBottom:8 }}>Tổng dinh dưỡng</Text>
        <Text style={{ color:"#111827", marginBottom:16 }}>
          {grand.kcal} kcal • P {grand.protein}g • C {grand.carbs}g • F {grand.fat}g
        </Text>

        <Text style={{ fontWeight:"800", fontSize:16, marginBottom:6 }}>Trong công thức (có thể thêm)</Text>
        {inRecipe.map(row => (
          <Row key={row.ingredient_id}
               name={ingMap[row.ingredient_id]?.name ?? `#${row.ingredient_id}`}
               grams={extrasByIng[row.ingredient_id] ?? 0}
               onPlus={() => bump(row.ingredient_id, +1, row.rule)}
               onMinus={undefined}  // KHÔNG cho bớt
          />
        ))}

        {addons.length > 0 && (
          <>
            <Text style={{ fontWeight:"800", fontSize:16, marginVertical:6 }}>Ngoài công thức (thêm tùy chọn)</Text>
            {addons.map(row => (
              <Row key={row.ingredient_id}
                  name={ingMap[row.ingredient_id]?.name ?? `#${row.ingredient_id}`}
                  grams={extrasByIng[row.ingredient_id] ?? 0}
                  onPlus={() => bump(row.ingredient_id, +1, row.rule)}
                  onMinus={undefined}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* Footer CTA */}
      <View style={{ position:"absolute", left:0, right:0, bottom:0, padding:12, backgroundColor:"#fff", borderTopWidth:1, borderColor:"#e5e7eb" }}>
        <Pressable
          onPress={() => {
            addToCart({
              dish_id: dishId,
              qty: 1,
              custom: {
                extrasGrams: extrasByIng,   // chỉ phần THÊM
                totals: grand               // để hiển thị nhanh trong giỏ
              }
            });
            router.back();
          }}
          style={({ pressed }) => ({
            backgroundColor: pressed ? "#16a34a" : "#22c55e",
            paddingVertical: 14, borderRadius: 12, alignItems:"center"
          })}
        >
          <Text style={{ color:"#fff", fontWeight:"800" }}>
            Thêm vào giỏ • {grand.kcal} kcal
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Row(props: { name: string; grams: number; onPlus: ()=>void; onMinus?: ()=>void }) {
  return (
    <View style={{ paddingVertical:10, borderBottomWidth:1, borderColor:"#f3f4f6", flexDirection:"row", alignItems:"center", justifyContent:"space-between" }}>
      <View>
        <Text style={{ fontWeight:"600", color:"#111827" }}>{props.name}</Text>
        <Text style={{ color:"#6b7280" }}>+{props.grams} g</Text>
      </View>
      <View style={{ flexDirection:"row", gap:10 }}>
        {/* KHÔNG render nút trừ nếu không cho bớt */}
        {/* {props.onMinus && (
          <Pressable onPress={props.onMinus} style={{ backgroundColor:"#e5e7eb", paddingHorizontal:14, paddingVertical:8, borderRadius:10 }}>
            <Text style={{ fontWeight:"800" }}>–</Text>
          </Pressable>
        )} */}
        <Pressable onPress={props.onPlus} style={{ backgroundColor:"#111827", paddingHorizontal:16, paddingVertical:10, borderRadius:10 }}>
          <Text style={{ color:"#fff", fontWeight:"800" }}>+10g</Text>
        </Pressable>
      </View>
    </View>
  );
}
