import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { generatePlanDraftForDate, normalizeDate } from "../helpers";

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
  try {
    const userId = getUserIdFromAuth(req);
    if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const date = body?.date ? String(body.date) : null;
    const range = body?.range; // "day" | "week" | undefined
    const mealsPerDay = typeof body?.mealsPerDay === "number" ? body.mealsPerDay : null;
    const workoutsPerDay = typeof body?.workoutsPerDay === "number" ? body.workoutsPerDay : null;
    const variationOffset = typeof body?.variationOffset === "number" ? body.variationOffset : 0; // Offset para forçar variação

    // Se for semana, gerar preview para todos os 7 dias
    if (range === "week" && date) {
      const startDate = normalizeDate(date);
      const days: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        days.push(d);
      }

      const weekPlans = [];
      for (const day of days) {
        try {
          const { targetDate, goalLabel, calories, meals, workouts } = await generatePlanDraftForDate({
            userId,
            date: day,
            mealsPerDay,
            workoutsPerDay,
            variationOffset,
          });
          weekPlans.push({
            date: targetDate.toISOString().slice(0, 10),
            goal: goalLabel,
            totalCalories: calories,
            meals,
            workouts,
          });
        } catch (error: any) {
          console.error(`[PLAN] Error generating preview for day ${day.toISOString()}:`, error);
          // Continuar com os outros dias mesmo se um falhar
        }
      }

      return NextResponse.json({
        range: "week",
        days: weekPlans,
      });
    }

    // Se for dia único (ou não especificado), retornar apenas um dia
    const { targetDate, goalLabel, calories, meals, workouts } = await generatePlanDraftForDate({
      userId,
      date: date ? normalizeDate(date) : undefined,
      mealsPerDay,
      workoutsPerDay,
      variationOffset,
    });

    return NextResponse.json({
      range: "day",
      date: targetDate.toISOString().slice(0, 10),
      goal: goalLabel,
      totalCalories: calories,
      meals,
      workouts,
    });
  } catch (error: any) {
    console.error("[PLAN] Error in preview route:", error);
    if (error?.code === "P1001") {
      return NextResponse.json(
        { error: "Erro de conexão com o banco de dados. Verifique se o servidor está acessível." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error?.message || "Erro ao gerar prévia do plano" },
      { status: 500 }
    );
  }
}


