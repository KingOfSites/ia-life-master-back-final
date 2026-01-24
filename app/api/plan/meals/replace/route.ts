import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { normalizeDate } from "../../helpers";
import { Prisma } from "@prisma/client";

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

export async function POST(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const { planDayId, meals, date } = body ?? {};

  if (!Array.isArray(meals) || meals.length === 0) {
    return NextResponse.json(
      { error: "Informe meals (array de refeições)" },
      { status: 400 },
    );
  }

  let planDay: any = null;

  // Se planDayId foi fornecido, buscar o planDay existente
  if (planDayId) {
    planDay = await prisma.planDay.findFirst({
      where: { id: planDayId, userId },
      include: { meals: true },
    });

    if (!planDay) {
      return NextResponse.json({ error: "Plano não encontrado" }, { status: 404 });
    }
  } else {
    // Se não foi fornecido planDayId, criar ou buscar pelo date (ou hoje)
    const targetDate = normalizeDate(date);
    console.log("[PLAN/MEALS/REPLACE] Target date:", targetDate, "Date param:", date);
    
    planDay = await prisma.planDay.findFirst({
      where: { userId, date: targetDate },
      include: { meals: true },
    });

    // Se não existe, criar um novo planDay
    if (!planDay) {
      console.log("[PLAN/MEALS/REPLACE] Creating new planDay for date:", targetDate);
      planDay = await prisma.planDay.create({
        data: {
          userId,
          date: targetDate,
          goal: null,
          totalCalories: null,
        },
        include: { meals: true },
      });
    } else {
      console.log("[PLAN/MEALS/REPLACE] Found existing planDay:", planDay.id);
    }
  }
  
  console.log("[PLAN/MEALS/REPLACE] PlanDay ID:", planDay.id, "Meals to add:", meals.length);

  // Substituir todas as refeições: deletar as antigas e criar as novas
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Deletar todas as refeições existentes do planDay
    const deletedCount = await tx.planMeal.deleteMany({
      where: { planDayId: planDay.id },
    });
    console.log("[PLAN/MEALS/REPLACE] Deleted", deletedCount.count, "existing meals");

    // Criar as novas refeições
    const createdMeals = await tx.planMeal.createMany({
      data: meals.map((m: any) => ({
        planDayId: planDay.id,
        title: m.title || "Refeição",
        description: m.description || null,
        startTime: m.startTime || "08:00",
        endTime: m.endTime || m.startTime || "08:30",
        calories: typeof m.calories === "number" ? m.calories : null,
        protein: typeof m.protein === "number" ? m.protein : null,
        carbs: typeof m.carbs === "number" ? m.carbs : null,
        fat: typeof m.fat === "number" ? m.fat : null,
        status: m.status || "pending",
        source: m.source || "chat",
        sourceMeta: m.sourceMeta || null,
      })),
    });
    console.log("[PLAN/MEALS/REPLACE] Created", createdMeals.count, "new meals");
  });

  // Buscar o planDay atualizado
  const updated = await prisma.planDay.findUnique({
    where: { id: planDay.id },
    include: { meals: true, workouts: true },
  });

  console.log("[PLAN/MEALS/REPLACE] Final planDay:", {
    id: updated?.id,
    date: updated?.date,
    mealsCount: updated?.meals?.length,
    meals: updated?.meals?.map((m: any) => ({ id: m.id, title: m.title, startTime: m.startTime })),
  });

  return NextResponse.json(updated);
}

