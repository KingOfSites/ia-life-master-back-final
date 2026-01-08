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
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const date = body?.date ? String(body.date) : null;
  const mealsPerDay = typeof body?.mealsPerDay === "number" ? body.mealsPerDay : null;
  const workoutsPerDay = typeof body?.workoutsPerDay === "number" ? body.workoutsPerDay : null;

  const { targetDate, goalLabel, calories, meals, workouts } = await generatePlanDraftForDate({
    userId,
    date: date ? normalizeDate(date) : undefined,
    mealsPerDay,
    workoutsPerDay,
  });

  return NextResponse.json({
    date: targetDate.toISOString().slice(0, 10),
    goal: goalLabel,
    totalCalories: calories,
    meals,
    workouts,
  });
}


