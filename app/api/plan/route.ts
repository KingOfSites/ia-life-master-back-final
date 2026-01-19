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
      include: { meals: true, workouts: true, activities: true },
      orderBy: { date: "asc" },
    });

    return NextResponse.json(plans);
  }

  const targetDate = normalizeDate(dateParam || undefined);

  const plan = await prisma.planDay.findFirst({
    where: { userId, date: targetDate },
    include: { meals: true, workouts: true, activities: true },
    orderBy: { date: "desc" },
  });

  // Log para debug - verificar se workouts têm focus
  if (plan?.workouts && plan.workouts.length > 0) {
    console.log("[PLAN] GET - Workouts with focus:", plan.workouts.map((w: any) => ({
      id: w.id,
      title: w.title,
      hasFocus: w.focus !== null && w.focus !== undefined,
      focusLength: w.focus?.length || 0,
      focusPreview: w.focus?.substring(0, 50) || "null/undefined"
    })));
  }

  return NextResponse.json(
    plan ?? {
      id: null,
      userId,
      date: targetDate,
      meals: [],
      workouts: [],
      activities: [],
      goal: null,
      totalCalories: null,
    },
  );
}

export async function POST(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // Removido: verificação de entitlements - todos podem gerar rotinas

  const body = await req.json().catch(() => ({} as any));
  const range = body?.range;
  const mealsPerDay = body?.mealsPerDay;
  const workoutsPerDay = body?.workoutsPerDay;
  const customPeriod = body?.customPeriod as { type: "days" | "weeks" | "months"; value: number } | undefined;
  const replaceWhat = body?.replaceWhat as "all" | "meals" | "workouts" | undefined;
  
  console.log(`[PLAN] POST /api/plan - Received: range=${range}, mealsPerDay=${mealsPerDay}, workoutsPerDay=${workoutsPerDay}, replaceWhat=${replaceWhat}`);

  // gera período customizado (dias, semanas ou meses)
  if (range === "custom" && customPeriod) {
    const start = normalizeDate(body?.date);
    const days: Date[] = [];
    
    if (customPeriod.type === "days") {
      for (let i = 0; i < customPeriod.value; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        days.push(d);
      }
    } else if (customPeriod.type === "weeks") {
      const totalDays = customPeriod.value * 7;
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        days.push(d);
      }
    } else {
      // months - limitado a 2 meses (60 dias) para evitar timeout
      const maxMonths = Math.min(customPeriod.value, 2);
      const endDate = new Date(start);
      endDate.setMonth(start.getMonth() + maxMonths);
      const currentDate = new Date(start);
      while (currentDate < endDate) {
        days.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }
      if (customPeriod.value > 2) {
        console.log(`[PLAN] Limiting to 2 months (${days.length} days) instead of ${customPeriod.value} months`);
      }
    }

    console.log(`[PLAN] Generating ${days.length} plans for custom period (${customPeriod.type}: ${customPeriod.value})`);
    const plans = [];
    const startTime = Date.now();
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      try {
        if (i % 10 === 0 || i === days.length - 1) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[PLAN] Progress: ${i + 1}/${days.length} plans created (${elapsed}s elapsed)`);
        }
        const plan = await createPlanForDate({ userId, date: d, mealsPerDay, workoutsPerDay, replaceWhat });
        plans.push(plan);
      } catch (error) {
        console.error(`[PLAN] Error creating plan for date ${d.toISOString()}:`, error);
        // Continua processando mesmo se um dia falhar
      }
    }
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[PLAN] Successfully generated ${plans.length}/${days.length} plans in ${totalTime}s`);

    return NextResponse.json(plans, { status: 201 });
  }

  // gera semana inteira (7 dias) começando da data informada ou hoje
  if (range === "week") {
    const start = normalizeDate(body?.date);
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }

    console.log(`[PLAN] Generating 7 plans for week`);
    const plans = [];
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const plan = await createPlanForDate({ userId, date: d, mealsPerDay, workoutsPerDay, replaceWhat });
      plans.push(plan);
    }
    console.log(`[PLAN] Successfully generated ${plans.length} plans for week`);

    return NextResponse.json(plans, { status: 201 });
  }

  // gera apenas o dia informado (ou hoje)
  const plan = await createPlanForDate({ userId, date: body?.date, mealsPerDay, workoutsPerDay, replaceWhat });
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
      // Aceitar macros para substituição completa da refeição
      if (typeof data.calories === "number") patch.calories = Math.round(data.calories);
      if (typeof data.protein === "number") patch.protein = Math.round(data.protein);
      if (typeof data.carbs === "number") patch.carbs = Math.round(data.carbs);
      if (typeof data.fat === "number") patch.fat = Math.round(data.fat);
      if (typeof data.description === "string") patch.description = data.description;
    }

    console.log("[PLAN] PATCH meal - itemId:", itemId, "patch data:", JSON.stringify(patch, null, 2));
    const result = await prisma.planMeal.updateMany({
      where: { id: itemId, planDay: { userId } },
      data: Object.keys(patch).length ? patch : { status: status ?? "done" },
    });
    console.log("[PLAN] PATCH meal - updated count:", result.count);
    
    if (result.count === 0) {
      console.error("[PLAN] PATCH meal - No items updated! itemId:", itemId, "userId:", userId);
      return NextResponse.json({ error: "Refeição não encontrada ou não pertence ao usuário" }, { status: 404 });
    }
  } else {
    const patch: any = {};
    if (status) patch.status = status;
    if (data && typeof data === "object") {
      if (typeof data.title === "string") patch.title = data.title;
      if (typeof data.startTime === "string") patch.startTime = data.startTime;
      if (typeof data.endTime === "string") patch.endTime = data.endTime;
      // Aceitar notes mesmo se for string vazia (pode ser necessário limpar o campo)
      if (data.notes !== undefined && typeof data.notes === "string") {
        patch.focus = data.notes;
        console.log("[PLAN] PATCH workout - Setting focus from notes:", {
          notesLength: data.notes.length,
          notesPreview: data.notes.substring(0, 100)
        });
      }
      if (typeof data.intensity === "string") patch.intensity = data.intensity;
      // Também aceitar intensity como null para limpar o campo
      if (data.intensity === null) patch.intensity = null;
    }

    console.log("[PLAN] PATCH workout - itemId:", itemId, "patch data:", JSON.stringify(patch, null, 2));
    const result = await prisma.planWorkout.updateMany({
      where: { id: itemId, planDay: { userId } },
      data: Object.keys(patch).length ? patch : { status: status ?? "done" },
    });
    console.log("[PLAN] PATCH workout - updated count:", result.count);
    
    if (result.count === 0) {
      console.error("[PLAN] PATCH workout - No items updated! itemId:", itemId, "userId:", userId);
      return NextResponse.json({ error: "Treino não encontrado ou não pertence ao usuário" }, { status: 404 });
    }

    // Se o treino foi marcado como "done", validar badges de gamificação
    // A validação será feita automaticamente quando o usuário acessar a tela de gamificação
    // ou pode ser chamada manualmente via endpoint /gamification/validate
    
    // Verificar se o focus foi realmente atualizado - buscar o item completo
    if (patch.focus !== undefined) {
      const updated = await prisma.planWorkout.findFirst({
        where: { id: itemId, planDay: { userId } },
        select: { 
          id: true,
          focus: true, 
          title: true,
          startTime: true,
          endTime: true,
          intensity: true
        }
      });
      console.log("[PLAN] PATCH workout - Verification after update:", {
        found: !!updated,
        id: updated?.id,
        focusLength: updated?.focus?.length || 0,
        focusPreview: updated?.focus?.substring(0, 100) || "undefined/null",
        focusIsNull: updated?.focus === null,
        focusIsUndefined: updated?.focus === undefined,
        title: updated?.title
      });
      
      // Se o focus não foi atualizado, tentar atualizar novamente
      if (updated && (updated.focus === null || updated.focus === undefined || updated.focus !== patch.focus)) {
        console.warn("[PLAN] PATCH workout - Focus not updated correctly! Retrying...");
        const retryResult = await prisma.planWorkout.updateMany({
          where: { id: itemId, planDay: { userId } },
          data: { focus: patch.focus },
        });
        console.log("[PLAN] PATCH workout - Retry result:", retryResult.count);
        
        // Verificar novamente
        const retryUpdated = await prisma.planWorkout.findFirst({
          where: { id: itemId, planDay: { userId } },
          select: { focus: true, title: true }
        });
        console.log("[PLAN] PATCH workout - After retry:", {
          focusLength: retryUpdated?.focus?.length || 0,
          focusPreview: retryUpdated?.focus?.substring(0, 100) || "undefined/null"
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get("itemId");
  const itemType = searchParams.get("itemType");

  if (!itemId || !itemType || !["meal", "workout"].includes(itemType)) {
    return NextResponse.json(
      { error: "Informe itemId e itemType ('meal' ou 'workout')" },
      { status: 400 },
    );
  }

  if (itemType === "meal") {
    const deleted = await prisma.planMeal.deleteMany({
      where: { id: itemId, planDay: { userId } },
    });
    if (!deleted.count) {
      return NextResponse.json({ error: "Refeição não encontrada" }, { status: 404 });
    }
  } else {
    const deleted = await prisma.planWorkout.deleteMany({
      where: { id: itemId, planDay: { userId } },
    });
    if (!deleted.count) {
      return NextResponse.json({ error: "Treino não encontrado" }, { status: 404 });
    }
  }

  return NextResponse.json({ ok: true });
}

