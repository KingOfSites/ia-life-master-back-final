import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

type DecodedToken = { userId?: string };

const getUserIdFromAuth = (req: Request): string | null => {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.replace("Bearer ", "").trim();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET! || "") as DecodedToken;
    return decoded.userId ?? null;
  } catch {
    return null;
  }
};

async function handleReplace(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const { mealId, photoAnalysis, photoMeal } = body ?? {};
  const payload = photoAnalysis ?? photoMeal;

  if (!mealId || !payload) {
    return NextResponse.json(
      { error: "Informe mealId e photoMeal/photoAnalysis { name, calories, protein, carbs, fat }" },
      { status: 400 },
    );
  }

  // garante que a refeição pertence ao usuário
  const meal = await prisma.planMeal.findFirst({
    where: { id: mealId, planDay: { userId } },
  });

  if (!meal) {
    return NextResponse.json({ error: "Refeição não encontrada para este usuário" }, { status: 404 });
  }

  const updated = await prisma.planMeal.update({
    where: { id: mealId },
    data: {
      title: payload.name ?? meal.title,
      description: payload.description ?? meal.description,
      calories: payload.calories ?? meal.calories,
      protein: payload.protein ?? meal.protein,
      carbs: payload.carbs ?? meal.carbs,
      fat: payload.fat ?? meal.fat,
      source: payload.source ?? "photo",
      sourceMeta: payload,
    } as any,
  });

  return NextResponse.json(updated);
}

export async function PATCH(req: Request) {
  return handleReplace(req);
}

export async function POST(req: Request) {
  return handleReplace(req);
}

