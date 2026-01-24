import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
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

export async function DELETE(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // apaga dependências (ordem importa por FKs sem cascade no User)
    await tx.nutritionFeedback.deleteMany({ where: { userId } });
    await tx.planDay.deleteMany({ where: { userId } }); // PlanMeal/PlanWorkout cascata via planDayId
    await tx.chatSession.deleteMany({ where: { userId } }); // ChatMessage cascata via sessionId
    await tx.meal.deleteMany({ where: { userId } }); // MealFood cascata via mealId
    await tx.foodLog.deleteMany({ where: { userId } });
    await tx.onboarding.deleteMany({ where: { userId } });

    await tx.user.delete({ where: { id: userId } });
  });

  return NextResponse.json({ ok: true });
}


