import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { createPlanForDate, normalizeDate } from "./helpers";

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

export async function GET(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const week = searchParams.get("week") === "true";

  if (week) {
    const start = normalizeDate(dateParam || undefined);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const plans = await prisma.planDay.findMany({
      where: { userId, date: { gte: start, lte: end } },
      include: { meals: true, workouts: true },
      orderBy: { date: "asc" },
    });

    return NextResponse.json(plans);
  }

  const targetDate = normalizeDate(dateParam || undefined);

  const plan = await prisma.planDay.findFirst({
    where: { userId, date: targetDate },
    include: { meals: true, workouts: true },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(
    plan ?? {
      id: null,
      userId,
      date: targetDate,
      meals: [],
      workouts: [],
      goal: null,
      totalCalories: null,
    },
  );
}

export async function POST(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const range = body?.range;
  const mealsPerDay = body?.mealsPerDay;
  const workoutsPerDay = body?.workoutsPerDay;

  // gera semana inteira (7 dias) começando da data informada ou hoje
  if (range === "week") {
    const start = normalizeDate(body?.date);
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }

    const plans = [];
    for (const d of days) {
      const plan = await createPlanForDate({ userId, date: d, mealsPerDay, workoutsPerDay });
      plans.push(plan);
    }

    return NextResponse.json(plans, { status: 201 });
  }

  // gera apenas o dia informado (ou hoje)
  const plan = await createPlanForDate({ userId, date: body?.date, mealsPerDay, workoutsPerDay });
  return NextResponse.json(plan, { status: 201 });
}

export async function PATCH(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const { itemId, itemType, status, data } = body ?? {};

  if (!itemId || !itemType || !["meal", "workout"].includes(itemType)) {
    return NextResponse.json(
      { error: "Informe itemId e itemType ('meal' ou 'workout')." },
      { status: 400 },
    );
  }

  if (itemType === "meal") {
    const patch: any = {};
    if (status) patch.status = status;
    if (data && typeof data === "object") {
      if (typeof data.title === "string") patch.title = data.title;
      if (typeof data.startTime === "string") patch.startTime = data.startTime;
      if (typeof data.endTime === "string") patch.endTime = data.endTime;
      if (typeof data.notes === "string") patch.description = data.notes;
    }

    await prisma.planMeal.updateMany({
      where: { id: itemId, planDay: { userId } },
      data: Object.keys(patch).length ? patch : { status: status ?? "done" },
    });
  } else {
    const patch: any = {};
    if (status) patch.status = status;
    if (data && typeof data === "object") {
      if (typeof data.title === "string") patch.title = data.title;
      if (typeof data.startTime === "string") patch.startTime = data.startTime;
      if (typeof data.endTime === "string") patch.endTime = data.endTime;
      if (typeof data.notes === "string") patch.focus = data.notes;
    }

    await prisma.planWorkout.updateMany({
      where: { id: itemId, planDay: { userId } },
      data: Object.keys(patch).length ? patch : { status: status ?? "done" },
    });
  }

  return NextResponse.json({ ok: true });
}

