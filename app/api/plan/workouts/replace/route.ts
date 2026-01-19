import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { normalizeDate } from "../../helpers";

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
  const { planDayId, workouts, date } = body ?? {};

  if (!Array.isArray(workouts) || workouts.length === 0) {
    return NextResponse.json(
      { error: "Informe workouts (array de treinos)" },
      { status: 400 },
    );
  }

  let planDay: any = null;

  // Se planDayId foi fornecido, buscar o planDay existente
  if (planDayId) {
    planDay = await prisma.planDay.findFirst({
      where: { id: planDayId, userId },
      include: { workouts: true },
    });

    if (!planDay) {
      return NextResponse.json({ error: "Plano não encontrado" }, { status: 404 });
    }
  } else {
    // Se não foi fornecido planDayId, criar ou buscar pelo date (ou hoje)
    const targetDate = normalizeDate(date);
    
    planDay = await prisma.planDay.findFirst({
      where: { userId, date: targetDate },
      include: { workouts: true },
    });

    // Se não existe, criar um novo planDay
    if (!planDay) {
      planDay = await prisma.planDay.create({
        data: {
          userId,
          date: targetDate,
          goal: null,
          totalCalories: null,
        },
        include: { workouts: true },
      });
    }
  }

  // Substituir todos os treinos: deletar os antigos e criar os novos
  await prisma.$transaction(async (tx) => {
    // Deletar todos os treinos existentes do planDay
    await tx.planWorkout.deleteMany({
      where: { planDayId: planDay.id },
    });

    // Criar os novos treinos
    await tx.planWorkout.createMany({
      data: workouts.map((w: any) => ({
        planDayId: planDay.id,
        title: w.title || "Treino",
        focus: w.focus || null,
        startTime: w.startTime || "08:00",
        endTime: w.endTime || w.startTime || "09:00",
        intensity: w.intensity || null,
        status: w.status || "pending",
      })),
    });
  });

  // Buscar o planDay atualizado
  const updated = await prisma.planDay.findUnique({
    where: { id: planDay.id },
    include: { meals: true, workouts: true },
  });

  return NextResponse.json(updated);
}

