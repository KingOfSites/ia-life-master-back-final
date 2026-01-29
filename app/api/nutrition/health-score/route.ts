import { openai } from "@/lib/openai";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

const HEALTH_SCORE_SYSTEM = `Você é um nutricionista. Avalie a qualidade nutricional e retorne APENAS um JSON válido, sem markdown, sem explicação extra.

Para "meal" (refeição individual): avalie proteína, fibra, açúcar, sódio, equilíbrio de macros. Refeições muito calóricas com pouca proteína/fibra ou muito açúcar/gordura saturada devem ter score menor. Escala 0-10.

Para "daily" (dia): avalie se o consumo do dia está alinhado às metas (quando fornecidas). Consumo equilibrado em relação às metas = score maior. Muito acima ou abaixo das metas = score menor. Escala 0-10.

Retorne exatamente: {"score": number, "message": "frase curta em português"}
- score: número entre 0 e 10 (use 1 casa decimal)
- message: uma frase curta e útil em português (ex.: "Bom equilíbrio de proteína e fibras." ou "Alto em açúcar; tente reduzir em refeições futuras.")`;

type Summary = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
};

type Targets = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

function getUserId(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET || "") as { userId?: string };
    return decoded.userId ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    getUserId(req); // opcional: pode exigir auth depois

    const body = await req.json().catch(() => ({}));
    const type = body?.type === "daily" ? "daily" : "meal";
    const summary: Summary = {
      calories: Number(body?.summary?.calories) || 0,
      protein: Number(body?.summary?.protein) || 0,
      carbs: Number(body?.summary?.carbs) || 0,
      fat: Number(body?.summary?.fat) || 0,
      fiber: Number(body?.summary?.fiber) || 0,
      sugar: Number(body?.summary?.sugar) || 0,
      sodium: Number(body?.summary?.sodium) || 0,
    };
    const targets: Targets | undefined = body?.targets
      ? {
          calories: Number(body.targets.calories) || 0,
          protein: Number(body.targets.protein) || 0,
          carbs: Number(body.targets.carbs) || 0,
          fat: Number(body.targets.fat) || 0,
        }
      : undefined;

    if (summary.calories === 0 && summary.protein === 0 && summary.carbs === 0 && summary.fat === 0) {
      return NextResponse.json({ score: 5, message: "Sem dados suficientes para avaliar." });
    }

    const userPrompt =
      type === "daily"
        ? `Avalie o DIA com consumo: ${JSON.stringify(summary)}. Metas do dia: ${targets ? JSON.stringify(targets) : "não fornecidas"}. Retorne JSON com score (0-10) e message.`
        : `Avalie esta REFEIÇÃO: ${JSON.stringify(summary)}. Retorne JSON com score (0-10) e message.`;

    const response = await openai().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: HEALTH_SCORE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 150,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return NextResponse.json({ error: "Resposta vazia da IA" }, { status: 502 });
    }

    let parsed: { score?: number; message?: string } = {};
    try {
      const raw = content.replace(/^```json\s*|\s*```$/g, "").trim();
      parsed = JSON.parse(raw) as { score?: number; message?: string };
    } catch {
      // Fallback se a IA não retornar JSON válido
      parsed = { score: 5, message: "Avaliação indisponível." };
    }
    const score = Math.max(0, Math.min(10, Number(parsed.score) ?? 5));
    const message = typeof parsed.message === "string" ? parsed.message : undefined;

    return NextResponse.json({ score: Math.round(score * 10) / 10, message });
  } catch (e) {
    console.error("[HEALTH-SCORE]", e);
    return NextResponse.json(
      { error: "Erro ao calcular pontuação" },
      { status: 500 }
    );
  }
}
