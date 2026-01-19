import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { normalizeDate } from "../helpers";

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
  const { planDayId, date, title, category, startTime, endTime, notes } = body;

  if (!title || !category || !startTime || !endTime) {
    return NextResponse.json(
      { error: "Campos obrigatórios: title, category, startTime, endTime" },
      { status: 400 }
    );
  }

  let planDay: any = null;

  if (planDayId) {
    planDay = await prisma.planDay.findFirst({
      where: { id: planDayId, userId },
    });

    if (!planDay) {
      return NextResponse.json({ error: "Plano não encontrado" }, { status: 404 });
    }
  } else {
    const targetDate = normalizeDate(date);
    planDay = await prisma.planDay.findFirst({
      where: { userId, date: targetDate },
    });

    if (!planDay) {
      planDay = await prisma.planDay.create({
        data: {
          userId,
          date: targetDate,
          goal: null,
          totalCalories: null,
        },
      });
    }
  }

  const activity = await prisma.planActivity.create({
    data: {
      planDayId: planDay.id,
      title,
      category,
      startTime,
      endTime,
      notes: notes || null,
      status: "pending",
    },
  });

  return NextResponse.json(activity, { status: 201 });
}

export async function PATCH(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const { id, title, category, startTime, endTime, notes, status } = body;

  if (!id) {
    return NextResponse.json({ error: "ID da atividade é obrigatório" }, { status: 400 });
  }

  // Verificar se a atividade pertence ao usuário
  const activity = await prisma.planActivity.findFirst({
    where: { id, planDay: { userId } },
  });

  if (!activity) {
    return NextResponse.json({ error: "Atividade não encontrada" }, { status: 404 });
  }

  const updateData: any = {};
  if (title !== undefined) updateData.title = title;
  if (category !== undefined) updateData.category = category;
  if (startTime !== undefined) updateData.startTime = startTime;
  if (endTime !== undefined) updateData.endTime = endTime;
  if (notes !== undefined) updateData.notes = notes;
  if (status !== undefined) updateData.status = status;

  const updated = await prisma.planActivity.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID da atividade é obrigatório" }, { status: 400 });
  }

  // Verificar se a atividade pertence ao usuário
  const activity = await prisma.planActivity.findFirst({
    where: { id, planDay: { userId } },
  });

  if (!activity) {
    return NextResponse.json({ error: "Atividade não encontrada" }, { status: 404 });
  }

  await prisma.planActivity.delete({
    where: { id },
  });

  return NextResponse.json({ ok: true });
}

