import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { generatePlanDraftForDate, normalizeDate } from "../helpers";

export const runtime = "nodejs";

type DecodedToken = { userId?: string };
type Target = "meals" | "workouts" | "both";

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

async function regenerateOneDay(opts: {
  userId: string;
  date: Date;
  target: Target;
  mealsPerDay?: number | null;
  workoutsPerDay?: number | null;
}) {
  const { userId, date, target, mealsPerDay, workoutsPerDay } = opts;
  const { goalLabel, calories, meals, workouts } = await generatePlanDraftForDate({
    userId,
    date,
    mealsPerDay,
    workoutsPerDay,
  });

  // garante planDay do dia
  const planDay = await prisma.planDay.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId,
      date,
      goal: goalLabel,
      totalCalories: calories,
    },
    update: {
      goal: goalLabel,
      totalCalories: calories,
    },
  });

  const data: any = {};
  if (target === "meals" || target === "both") {
    data.meals = { deleteMany: {}, create: meals };
  }
  if (target === "workouts" || target === "both") {
    data.workouts = { deleteMany: {}, create: workouts };
  }

  const updated = await prisma.planDay.update({
    where: { id: planDay.id },
    data,
    include: { meals: true, workouts: true },
  });

  return updated;
}

export async function POST(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const dateParam = body?.date ? String(body.date) : null;
  const range = body?.range === "week" ? "week" : null;
  const target = (body?.target as Target) || "both";
  const mealsPerDay = typeof body?.mealsPerDay === "number" ? body.mealsPerDay : null;
  const workoutsPerDay = typeof body?.workoutsPerDay === "number" ? body.workoutsPerDay : null;

  if (!["meals", "workouts", "both"].includes(target)) {
    return NextResponse.json({ error: "target inválido (meals|workouts|both)" }, { status: 400 });
  }

  const start = normalizeDate(dateParam || undefined);

  if (range === "week") {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }

    const results = [];
    for (const d of days) {
      // eslint-disable-next-line no-await-in-loop
      const updated = await regenerateOneDay({
        userId,
        date: d,
        target,
        mealsPerDay,
        workoutsPerDay,
      });
      results.push(updated);
    }

    return NextResponse.json(results);
  }

  const updated = await regenerateOneDay({
    userId,
    date: start,
    target,
    mealsPerDay,
    workoutsPerDay,
  });

  return NextResponse.json(updated);
}


