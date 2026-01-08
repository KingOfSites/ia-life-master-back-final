import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Correções pontuais (Open Food Facts pode ter itens com rótulo incorreto).
// Mantemos por barcode para ser determinístico.
const BARCODE_OVERRIDES: Record<
  string,
  {
    nameContains?: string[];
    servingMl?: number;
    perServing: { calories: number; protein: number; carbs: number; fat: number };
  }
> = {
  // Red Bull The Sea Blue Edition Sugarfree Juneberry (lata 250ml)
  // Rótulo esperado: ~10 kcal e ~2g carbo por lata.
  "611269002249": {
    nameContains: ["red bull", "sugarfree"],
    servingMl: 250,
    perServing: { calories: 10, protein: 0, carbs: 2, fat: 0 },
  },
};

type OffProduct = {
  product?: {
    product_name?: string;
    serving_size?: string;
    quantity?: string;
    product_quantity?: number;
    product_quantity_unit?: string;
    nutriments?: Record<string, any>;
  };
  status?: number;
  status_verbose?: string;
};

const parseServing = (servingSize?: string | null) => {
  if (!servingSize) return { unit: "g", quantity: 100 };
  const s = servingSize.toLowerCase();
  // Prioriza o número que vem JUNTO da unidade (ex.: "1 bottle (591 ml)" -> 591 ml)
  const toNum = (v: string) => parseFloat(v.replace(",", "."));
  const flOzToMl = (oz: number) => oz * 29.5735;

  const mlMatch = s.match(/([\d.,]+)\s*(ml)\b/);
  if (mlMatch) return { unit: "ml", quantity: toNum(mlMatch[1]) };

  const clMatch = s.match(/([\d.,]+)\s*(cl)\b/);
  if (clMatch) return { unit: "ml", quantity: Math.round(toNum(clMatch[1]) * 10) };

  const dlMatch = s.match(/([\d.,]+)\s*(dl)\b/);
  if (dlMatch) return { unit: "ml", quantity: Math.round(toNum(dlMatch[1]) * 100) };

  // fl oz (muito comum em bebidas importadas): "18.5 fl oz"
  const flOzMatch = s.match(/([\d.,]+)\s*(fl\s?oz)\b/);
  if (flOzMatch) return { unit: "ml", quantity: Math.round(flOzToMl(toNum(flOzMatch[1]))) };

  // oz (fallback)
  const ozMatch = s.match(/([\d.,]+)\s*(oz)\b/);
  if (ozMatch) return { unit: "ml", quantity: Math.round(flOzToMl(toNum(ozMatch[1]))) };

  // litro / l (evita confundir com palavras)
  const lMatch = s.match(/([\d.,]+)\s*(l|litro|litros)\b/);
  if (lMatch) return { unit: "ml", quantity: Math.round(toNum(lMatch[1]) * 1000) };

  const gMatch = s.match(/([\d.,]+)\s*(g)\b/);
  const mgMatch = s.match(/([\d.,]+)\s*(mg)\b/);
  if (gMatch) return { unit: "g", quantity: toNum(gMatch[1]) };
  if (mgMatch) return { unit: "g", quantity: Math.round(toNum(mgMatch[1]) / 1000) };

  const matchNumber = s.match(/([\d.,]+)/);
  const qty = matchNumber ? toNum(matchNumber[1]) : 100;

  if (s.includes("scoop")) return { unit: "scoop", quantity: qty };
  if (s.includes("unit") || s.includes("unid") || s.includes("unidade")) return { unit: "unit", quantity: qty };

  // fallback: gramas
  return { unit: "g", quantity: qty };
};

const pickPer100CaloriesKcal = (nutr: Record<string, any>, preferMl: boolean) => {
  const kcal = preferMl ? nutr["energy-kcal_100ml"] ?? nutr["energy-kcal_100g"] : nutr["energy-kcal_100g"] ?? nutr["energy-kcal_100ml"];
  if (kcal != null && !Number.isNaN(Number(kcal))) return Number(kcal);

  // Open Food Facts: energy_100g geralmente é kJ (não kcal)
  const kj = preferMl
    ? nutr["energy-kj_100ml"] ?? nutr["energy-kj_100g"] ?? nutr["energy_100g"]
    : nutr["energy-kj_100g"] ?? nutr["energy-kj_100ml"] ?? nutr["energy_100g"];
  if (kj != null && !Number.isNaN(Number(kj))) {
    return Math.round((Number(kj) / 4.184) * 10) / 10; // kJ -> kcal (1 casa)
  }

  return null;
};

const pickServingCaloriesKcal = (nutr: Record<string, any>) => {
  const kcal = nutr["energy-kcal_serving"];
  if (kcal != null && !Number.isNaN(Number(kcal))) return Number(kcal);

  const kj = nutr["energy-kj_serving"] ?? nutr["energy_serving"];
  if (kj != null && !Number.isNaN(Number(kj))) {
    return Math.round((Number(kj) / 4.184) * 10) / 10;
  }

  return null;
};

const mapOffToNutrition = (data: OffProduct, barcode: string) => {
  const product = data.product ?? {};
  const nutr = product.nutriments ?? {};

  const servingSize =
    product.serving_size ||
    product.quantity ||
    (product.product_quantity && product.product_quantity_unit
      ? `${product.product_quantity}${product.product_quantity_unit}`
      : "100g");
  const servingParsed = parseServing(servingSize);
  const preferMl = servingParsed.unit === "ml";

  // Open Food Facts: macros por 100g (para líquidos costuma representar por 100ml também)
  const per100Calories = pickPer100CaloriesKcal(nutr, preferMl);
  const per100Protein = preferMl
    ? (nutr["proteins_100ml"] != null ? Number(nutr["proteins_100ml"]) : nutr["proteins_100g"] != null ? Number(nutr["proteins_100g"]) : null)
    : (nutr["proteins_100g"] != null ? Number(nutr["proteins_100g"]) : nutr["proteins_100ml"] != null ? Number(nutr["proteins_100ml"]) : null);
  const per100Carbs = preferMl
    ? (nutr["carbohydrates_100ml"] != null ? Number(nutr["carbohydrates_100ml"]) : nutr["carbohydrates_100g"] != null ? Number(nutr["carbohydrates_100g"]) : null)
    : (nutr["carbohydrates_100g"] != null ? Number(nutr["carbohydrates_100g"]) : nutr["carbohydrates_100ml"] != null ? Number(nutr["carbohydrates_100ml"]) : null);
  const per100Fat = preferMl
    ? (nutr["fat_100ml"] != null ? Number(nutr["fat_100ml"]) : nutr["fat_100g"] != null ? Number(nutr["fat_100g"]) : null)
    : (nutr["fat_100g"] != null ? Number(nutr["fat_100g"]) : nutr["fat_100ml"] != null ? Number(nutr["fat_100ml"]) : null);

  // Valores por porção (quando o rótulo é por lata/unidade)
  const perServingCalories = pickServingCaloriesKcal(nutr);
  const perServingProtein = nutr["proteins_serving"] != null ? Number(nutr["proteins_serving"]) : null;
  const perServingCarbs = nutr["carbohydrates_serving"] != null ? Number(nutr["carbohydrates_serving"]) : null;
  const perServingFat = nutr["fat_serving"] != null ? Number(nutr["fat_serving"]) : null;

  // try to parse numeric grams from serving size (e.g., "30g")
  const portion = servingParsed.quantity || 100;
  const factor = portion / 100;

  // Preferência: se existir dado por porção, usa ele. Caso contrário, deriva do per100.
  const hasServing =
    perServingCalories != null ||
    perServingProtein != null ||
    perServingCarbs != null ||
    perServingFat != null;

  const calories = hasServing
    ? (perServingCalories != null ? Math.round(Number(perServingCalories)) : null)
    : per100Calories != null
      ? Math.round(Number(per100Calories) * factor)
      : null;

  const protein = hasServing
    ? (perServingProtein != null ? Math.round(Number(perServingProtein)) : null)
    : per100Protein != null
      ? Math.round(Number(per100Protein) * factor)
      : null;

  const carbs = hasServing
    ? (perServingCarbs != null ? Math.round(Number(perServingCarbs)) : null)
    : per100Carbs != null
      ? Math.round(Number(per100Carbs) * factor)
      : null;

  const fat = hasServing
    ? (perServingFat != null ? Math.round(Number(perServingFat)) : null)
    : per100Fat != null
      ? Math.round(Number(per100Fat) * factor)
      : null;

  const mapped: any = {
    source: "barcode",
    barcode,
    name: product.product_name || "Produto sem nome",
    servingSize,
    servingParsed,
    calories,
    protein,
    carbs,
    fat,
    basis: hasServing ? "serving" : "per100",
    perServing: hasServing
      ? {
          calories: perServingCalories ?? null,
          protein: perServingProtein ?? null,
          carbs: perServingCarbs ?? null,
          fat: perServingFat ?? null,
        }
      : null,
    per100: {
      calories: per100Calories ?? null,
      protein: per100Protein ?? null,
      carbs: per100Carbs ?? null,
      fat: per100Fat ?? null,
    },
    raw: product,
  };

  // Aplica override se existir e bater com o contexto (nome + porção)
  const ov = BARCODE_OVERRIDES[barcode];
  if (ov) {
    const name = String(mapped.name || "").toLowerCase();
    const okName =
      !ov.nameContains || ov.nameContains.every((s) => name.includes(String(s).toLowerCase()));
    const okServing =
      !ov.servingMl ||
      (mapped?.servingParsed?.unit === "ml" && Number(mapped?.servingParsed?.quantity) === ov.servingMl);

    if (okName && okServing) {
      mapped.basis = "serving";
      mapped.perServing = { ...ov.perServing };
      mapped.calories = ov.perServing.calories;
      mapped.protein = ov.perServing.protein;
      mapped.carbs = ov.perServing.carbs;
      mapped.fat = ov.perServing.fat;
      // recalcula per100 a partir da porção, para consistência
      if (ov.servingMl && ov.servingMl > 0) {
        const factor100 = 100 / ov.servingMl;
        mapped.per100 = {
          calories: Math.round(ov.perServing.calories * factor100 * 10) / 10,
          protein: Math.round(ov.perServing.protein * factor100 * 10) / 10,
          carbs: Math.round(ov.perServing.carbs * factor100 * 10) / 10,
          fat: Math.round(ov.perServing.fat * factor100 * 10) / 10,
        };
      }
      mapped.override = { applied: true, reason: "barcode_override" };
    }
  }

  return mapped;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code") || searchParams.get("barcode");

  if (!code) {
    return NextResponse.json({ error: "Informe ?code=barcode" }, { status: 400 });
  }

  try {
    const resp = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`, {
      cache: "no-store",
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return NextResponse.json({ error: "Falha ao consultar Open Food Facts", details: txt }, { status: 502 });
    }

    const data = (await resp.json()) as OffProduct;
    if (data.status !== 1 || !data.product) {
      return NextResponse.json(
        { error: "Produto não encontrado no Open Food Facts", status: data.status, status_verbose: data.status_verbose },
        { status: 404 },
      );
    }

    const mapped = mapOffToNutrition(data, code);
    return NextResponse.json(mapped);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Erro ao consultar Open Food Facts", details: err?.message },
      { status: 500 },
    );
  }
}

