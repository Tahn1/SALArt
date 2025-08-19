export type Per100 = { kcal?: number; protein?: number; fat?: number; carbs?: number; };
export type IngredientNutri = Per100 & { id: number };
export type GramMap = Record<number, number>; // ingredient_id -> grams (extras)

export function sumExtras(ingMap: Record<number, IngredientNutri>, grams: GramMap) {
  const acc = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const [idStr, g] of Object.entries(grams)) {
    const n = ingMap[+idStr]; if (!n || !g) continue;
    const f = g / 100;
    acc.kcal   += Math.round((n.kcal    ?? 0) * f);
    acc.protein+= (n.protein ?? 0) * f;
    acc.fat    += (n.fat     ?? 0) * f;
    acc.carbs  += (n.carbs   ?? 0) * f;
  }
  return {
    kcal: Math.round(acc.kcal),
    protein: +acc.protein.toFixed(1),
    fat:     +acc.fat.toFixed(1),
    carbs:   +acc.carbs.toFixed(1),
  };
}
