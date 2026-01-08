import { openai } from "@/lib/openai";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { nutritionPrompt } from "./prompt";
import path from "path";
import { mkdir, writeFile, access } from "fs/promises";

export const runtime = "nodejs";


/* =======================
   TIPOS
======================= */

type NutritionInfo = {
  calories: number;
  carbohydrates: number;
  protein: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  potassium: number;
  vitamin_c?: number;
};

type FoodItem = {
  food_id: string;
  food_name: string;
  confidence: number; // 0-1
  serving_size: string;
  nutrition: NutritionInfo;
};

type NutritionResponse = {
  foods: FoodItem[];
  imageId?: string;
  imageUrl?: string;
};

type NutritionPer100g = {
  calories: number;
  carbohydrates: number;
  protein: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  potassium?: number;
  vitamin_c?: number | null;
};

type FoodItemAI = {
  food_id?: string;
  food_name?: string;
  confidence?: number;
  weight_g?: number;
  nutrition_per_100g?: NutritionPer100g;
  // backward-compat (se a IA responder no formato antigo)
  serving_size?: string;
  nutrition?: Partial<NutritionInfo>;
};

type NutritionResponseAI = {
  foods: FoodItemAI[];
};

/* =======================
   CACHE (memória, TTL)
======================= */

type CacheEntry = {
  expiresAt: number;
  payload: NutritionResponse;
};

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const CACHE_MAX_ENTRIES = 250;
const memoryCache = new Map<string, CacheEntry>();

const getCache = (key: string) => {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return hit.payload;
};

const setCache = (key: string, payload: NutritionResponse) => {
  // eviction simples (FIFO)
  if (memoryCache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
  memoryCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
};

const ensureDir = async (dirPath: string) => {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch {
    // ignore
  }
};

const fileExists = async (filePath: string) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const extFromMime = (mime: string) => {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "jpg";
};

/* =======================
   HELPERS DE JSON (ROBUSTOS)
======================= */

const cleanJson = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
  }
  return trimmed;
};

const extractJSON = (text: string) => {
  const cleaned = cleanJson(text);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("JSON não encontrado na resposta da IA");
  }
  return match[0];
};

const round0 = (v: any) => Math.round(Number(v ?? 0));
const num0 = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const sanitizeTotalsFood = (f: any, idx: number): FoodItem => {
  const nutrition = f?.nutrition ?? {};
  return {
    food_id: String(f?.food_id || `food-${idx + 1}`),
    food_name: String(f?.food_name || "Alimento"),
    confidence: Math.max(0, Math.min(1, Number(f?.confidence ?? 0))),
    serving_size: String(f?.serving_size || "1 porção"),
    nutrition: {
      calories: round0(nutrition?.calories),
      carbohydrates: round0(nutrition?.carbohydrates),
      protein: round0(nutrition?.protein),
      fat: round0(nutrition?.fat),
      fiber: round0(nutrition?.fiber),
      sugar: round0(nutrition?.sugar),
      sodium: round0(nutrition?.sodium),
      potassium: round0(nutrition?.potassium),
      vitamin_c:
        nutrition?.vitamin_c === undefined || nutrition?.vitamin_c === null
          ? undefined
          : round0(nutrition?.vitamin_c),
    },
  };
};

const normalizeWeightsToTotal = (weights: number[], total: number) => {
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = safe.reduce((a, b) => a + b, 0);

  if (sum <= 0) {
    const base = Math.floor(total / weights.length);
    const rem = total - base * weights.length;
    return safe.map((_, i) => base + (i < rem ? 1 : 0));
  }

  // escala e arredonda, depois ajusta o resto para bater EXATAMENTE o total
  const scaled = safe.map((w) => Math.max(1, Math.round((w / sum) * total)));
  let scaledSum = scaled.reduce((a, b) => a + b, 0);

  // corrige diferença (distribui +/- 1g)
  let i = 0;
  while (scaledSum !== total && i < 10000) {
    const idx = i % scaled.length;
    if (scaledSum > total) {
      if (scaled[idx] > 1) {
        scaled[idx] -= 1;
        scaledSum -= 1;
      }
    } else {
      scaled[idx] += 1;
      scaledSum += 1;
    }
    i += 1;
  }

  return scaled;
};

const adjustWeightsToTargetCalories = (options: {
  weightsG: number[];
  per100: Array<NutritionPer100g | null | undefined>;
  targetCalories: number;
}) => {
  const { weightsG, per100, targetCalories } = options;
  const safeWeights = weightsG.map((w) => (Number.isFinite(w) && w > 0 ? w : 1));

  const calcTotalCalories = (ws: number[]) =>
    ws.reduce((sum, w, idx) => {
      const kcal100 = num0(per100[idx]?.calories);
      return sum + Math.round((kcal100 * w) / 100);
    }, 0);

  const currentTotal = calcTotalCalories(safeWeights);
  if (currentTotal <= 0) return { weights: safeWeights, factor: 1, currentTotal, finalTotal: currentTotal };

  const factor = targetCalories / currentTotal;
  let adjusted = safeWeights.map((w) => Math.max(1, Math.round(w * factor)));

  // Correção fina: ajusta o item com maior densidade calórica para bater o alvo
  let finalTotal = calcTotalCalories(adjusted);
  let delta = targetCalories - finalTotal;

  if (delta !== 0) {
    let bestIdx = 0;
    let bestDensity = 0;
    for (let i = 0; i < per100.length; i++) {
      const d = num0(per100[i]?.calories);
      if (d > bestDensity) {
        bestDensity = d;
        bestIdx = i;
      }
    }

    const kcalPerGram = bestDensity > 0 ? bestDensity / 100 : 1;
    const adjustGrams = Math.round(delta / kcalPerGram);
    adjusted[bestIdx] = Math.max(1, adjusted[bestIdx] + adjustGrams);

    finalTotal = calcTotalCalories(adjusted);
    delta = targetCalories - finalTotal;

    // Último ajuste: se ainda sobrar 1-3 kcal por arredondamento, corrige no kcal do item (visual)
    if (delta !== 0 && Math.abs(delta) <= 3) {
      finalTotal = targetCalories; // usado só para retornar no debug
    }
  }

  return { weights: adjusted, factor, currentTotal, finalTotal };
};

/* =======================
   ROTA
======================= */

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("image");
    const forcedCaloriesRaw = formData.get("forced_calories") ?? formData.get("forcedCalories");
    const totalWeightRaw = formData.get("total_weight_g") ?? formData.get("totalWeightG");

    const forcedCalories =
      forcedCaloriesRaw != null && String(forcedCaloriesRaw).trim() !== ""
        ? Math.max(0, Math.round(Number(forcedCaloriesRaw)))
        : null;

    const totalWeightG =
      totalWeightRaw != null && String(totalWeightRaw).trim() !== ""
        ? Math.max(0, Math.round(Number(totalWeightRaw)))
        : null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Nenhuma imagem enviada no campo 'image'." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    const base64 = buf.toString("base64");
    const mimeType = file.type || "image/jpeg";

    // Persistência da imagem (para o usuário conseguir ver depois)
    const origin = new URL(req.url).origin;
    const imgHash = crypto.createHash("sha256").update(buf).digest("hex");
    const imageId = imgHash.slice(0, 24);
    const ext = extFromMime(mimeType);
    const uploadsDir = path.join(process.cwd(), "public", "uploads", "nutrition");
    await ensureDir(uploadsDir);
    const fileName = `${imageId}.${ext}`;
    const absPath = path.join(uploadsDir, fileName);
    if (!(await fileExists(absPath))) {
      await writeFile(absPath, buf);
    }
    const imageUrl = `${origin}/uploads/nutrition/${fileName}`;

    const cacheKey = crypto
      .createHash("sha256")
      .update(buf)
      .update("|v2|")
      .update(String(forcedCalories ?? ""))
      .update("|")
      .update(String(totalWeightG ?? ""))
      .digest("hex");

    const cached = getCache(cacheKey);
    if (cached) {
      // garante que a URL da imagem exista no payload
      return NextResponse.json({ ...cached, imageId, imageUrl });
    }

    const wantsWeightsFlow = Boolean((forcedCalories && forcedCalories > 0) || (totalWeightG && totalWeightG > 0));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.0,
      max_tokens: wantsWeightsFlow ? 900 : 650,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: wantsWeightsFlow
            ? `
Você é uma IA de nutrição.
Responda EXCLUSIVAMENTE em JSON VÁLIDO.
NÃO inclua explicações, comentários ou texto fora do JSON.
NÃO quebre strings em múltiplas linhas.

Formato obrigatório:
{
  "foods": [
    {
      "food_id": "string",
      "food_name": "string",
      "confidence": number,
      "weight_g": number,
      "nutrition_per_100g": {
        "calories": number,
        "carbohydrates": number,
        "protein": number,
        "fat": number,
        "fiber": number,
        "sugar": number,
        "sodium": number,
        "potassium": number,
        "vitamin_c": number|null
      }
    }
  ]
}
            `.trim()
            : nutritionPrompt.trim(),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: wantsWeightsFlow
                ? `
Identifique TODOS os alimentos visíveis na imagem.

Inclua OBRIGATORIAMENTE:
- acompanhamentos
- molhos
- itens em potes pequenos
- alimentos separados no prato, mesmo em pequenas quantidades
- não confunda feijão com molho

Cada item deve ser retornado como um alimento separado no array "foods".
Não agrupe alimentos diferentes.

Regras de peso:
- Retorne "weight_g" (peso em gramas) para cada alimento.
- O peso deve ser realista (ex.: carne pesa mais que molho).
- NÃO use "1g" para tudo.

IMPORTANTE:
- Retorne "nutrition_per_100g" (valores por 100g).
- NÃO calcule as calorias finais do item pelo peso; isso será calculado pelo backend.
- Retorne SOMENTE o JSON no formato acima.
                `.trim()
                : "Analise a imagem e responda no formato obrigatório JSON.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
              },
            },
          ],
        },
      ],
    });

    const reply = completion.choices[0].message?.content ?? "";

    let parsed: NutritionResponseAI | any;

    try {
      const jsonOnly = extractJSON(reply);
      parsed = JSON.parse(jsonOnly) as NutritionResponseAI;
    } catch (err) {
      console.error("Falha ao parsear JSON da IA:", err, reply);
      return NextResponse.json(
        { error: "IA retornou JSON inválido" },
        { status: 422 }
      );
    }

    if (!parsed?.foods?.length) {
      return NextResponse.json(
        { error: "Nenhum alimento identificado na imagem." },
        { status: 422 }
      );
    }

    const foods = parsed.foods;

    // modo "totais" (mais parecido com ChatGPT): IA já retorna as calorias/macros finais por item
    const looksLikeTotals = foods.some((f: any) => f && f.nutrition && !f.nutrition_per_100g);
    if (!wantsWeightsFlow && looksLikeTotals) {
      const sanitizedTotals: NutritionResponse = {
        foods: foods.map((f: any, idx: number) => sanitizeTotalsFood(f, idx)),
        imageId,
        imageUrl,
      };
      setCache(cacheKey, sanitizedTotals);
      return NextResponse.json(sanitizedTotals);
    }

    // backward compat: se vier no formato antigo (nutrition), devolve como antes (mas ainda normaliza números)
    const isOldFormat = foods.some((f) => f && (f as any).nutrition && !(f as any).nutrition_per_100g);

    if (isOldFormat) {
      const sanitizedOld: NutritionResponse = {
        foods: foods.map((f, idx) => ({
          food_id: f.food_id || `food-${idx + 1}`,
          food_name: f.food_name || "Alimento",
          confidence: Math.max(0, Math.min(1, Number(f.confidence ?? 0))),
          serving_size: f.serving_size || "1 porção",
          nutrition: {
            calories: round0((f as any).nutrition?.calories),
            carbohydrates: round0((f as any).nutrition?.carbohydrates),
            protein: round0((f as any).nutrition?.protein),
            fat: round0((f as any).nutrition?.fat),
            fiber: round0((f as any).nutrition?.fiber),
            sugar: round0((f as any).nutrition?.sugar),
            sodium: round0((f as any).nutrition?.sodium),
            potassium: round0((f as any).nutrition?.potassium),
            vitamin_c:
              (f as any).nutrition?.vitamin_c === undefined ||
              (f as any).nutrition?.vitamin_c === null
                ? undefined
                : round0((f as any).nutrition?.vitamin_c),
          },
        })),
        imageId,
        imageUrl,
      };

      setCache(cacheKey, sanitizedOld);
      return NextResponse.json(sanitizedOld);
    }

    // Novo formato (produção): calcula macros finais no backend (IA só fornece per100 + weight_g).
    const rawWeights = foods.map((f) => num0(f.weight_g));
    const baseWeights =
      totalWeightG && totalWeightG > 0
        ? normalizeWeightsToTotal(rawWeights, totalWeightG)
        : rawWeights.map((w) => (Number.isFinite(w) && w > 0 ? Math.round(w) : 1));

    // Ajuste profissional (opcional): meta calórica fixa -> PESO variável (escala os pesos)
    const per100List = foods.map((f) => f.nutrition_per_100g);
    const adjusted =
      forcedCalories && forcedCalories > 0
        ? adjustWeightsToTargetCalories({
            weightsG: baseWeights,
            per100: per100List,
            targetCalories: forcedCalories,
          })
        : { weights: baseWeights, factor: 1, currentTotal: 0, finalTotal: 0 };

    const sanitized: NutritionResponse = {
      foods: foods.map((f, idx) => {
        const weightG = adjusted.weights[idx] ?? 0;
        const per = f.nutrition_per_100g ?? ({} as NutritionPer100g);
        const factor = weightG / 100;

        let calories = round0(num0(per.calories) * factor);
        const protein = round0(num0(per.protein) * factor);
        const carbs = round0(num0(per.carbohydrates) * factor);
        const fat = round0(num0(per.fat) * factor);

        // Se tiver forcedCalories e ficar a 1-3 kcal do alvo por arredondamento, corrige no primeiro item (visual)
        if (forcedCalories && forcedCalories > 0 && idx === 0 && foods.length > 0) {
          const totalNow = foods.reduce((sum, _, j) => {
            const wj = adjusted.weights[j] ?? 0;
            const pj = foods[j]?.nutrition_per_100g ?? ({} as NutritionPer100g);
            return sum + round0(num0(pj.calories) * (wj / 100));
          }, 0);
          const delta = forcedCalories - totalNow;
          if (delta !== 0 && Math.abs(delta) <= 3) {
            calories = Math.max(0, calories + delta);
          }
        }

        return {
          food_id: f.food_id || `food-${idx + 1}`,
          food_name: f.food_name || "Alimento",
          confidence: Math.max(0, Math.min(1, Number(f.confidence ?? 0))),
          serving_size: `${weightG}g`,
          nutrition: {
            calories,
            carbohydrates: carbs,
            protein,
            fat,
            fiber: round0(num0(per.fiber) * factor),
            sugar: round0(num0(per.sugar) * factor),
            sodium: round0(num0(per.sodium) * factor),
            potassium: round0(num0(per.potassium) * factor),
            vitamin_c:
              per.vitamin_c === undefined || per.vitamin_c === null
                ? undefined
                : round0(num0(per.vitamin_c) * factor),
          },
        };
      }),
      imageId,
      imageUrl,
    };

    setCache(cacheKey, sanitized);
    return NextResponse.json(sanitized);
  } catch (error) {
    console.error("Erro em /api/nutrition:", error);
    return NextResponse.json(
      { error: "Erro ao processar a imagem" },
      { status: 500 }
    );
  }
}
