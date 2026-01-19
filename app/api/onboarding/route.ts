import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import jwt from "jsonwebtoken"
import { createPlanForDate } from "../plan/helpers"

export const runtime = "nodejs"

type DecodedToken = {
  userId: string
}

console.log("🟥 ONBOARDING ROUTE CARREGADA")

function getUserId(req: Request): string | null {
  const auth = req.headers.get("authorization")
  if (!auth) return null

  const token = auth.replace("Bearer ", "")

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET!
    ) as DecodedToken

  return decoded.userId
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  console.log("🟥 POST /api/onboarding RECEBIDO")
  const userId = getUserId(req)
  console.log("🟥 USER ID:", userId)

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const data = await req.json()
  console.log("🟥 BODY RECEBIDO:", data)

  const onboarding = await prisma.onboarding.upsert({
    where: { userId },
    update: {
      goals: JSON.stringify(data.goals),
      blockers: JSON.stringify(data.blockers),
      experience: data.experience,
      activityLevel: data.activityLevel,
      gender: data.gender,
      age: Number(data.age),
      workoutsPerWeek: Number(data.workoutsPerWeek),
      goalPrimary: data.goalPrimary ?? null,
      targetWeight: data.targetWeight ? Number(data.targetWeight) : null,
      weeklyLossKg: data.weeklyLossKg ? Number(data.weeklyLossKg) : null,
      weeklyLossIntensity: data.weeklyLossIntensity ?? null,
      heightCm: data.heightCm ? Number(data.heightCm) : null,
      weightKg: data.weightKg ? Number(data.weightKg) : null,
    } as any,
    create: {
      userId,
      goals: JSON.stringify(data.goals),
      blockers: JSON.stringify(data.blockers),
      experience: data.experience,
      activityLevel: data.activityLevel,
      gender: data.gender,
      age: Number(data.age),
      workoutsPerWeek: Number(data.workoutsPerWeek),
      goalPrimary: data.goalPrimary ?? null,
      targetWeight: data.targetWeight ? Number(data.targetWeight) : null,
      weeklyLossKg: data.weeklyLossKg ? Number(data.weeklyLossKg) : null,
      weeklyLossIntensity: data.weeklyLossIntensity ?? null,
      heightCm: data.heightCm ? Number(data.heightCm) : null,
      weightKg: data.weightKg ? Number(data.weightKg) : null,
    } as any,
  })

  // gera plano automático para o dia após salvar onboarding
  try {
    await createPlanForDate({ userId, onboarding, date: new Date() })
  } catch (err) {
    console.warn("Falha ao gerar plano automático pós-onboarding", err)
  }

  return NextResponse.json(onboarding)
}

export async function GET(req: Request) {
  const userId = getUserId(req)

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const onboarding = await prisma.onboarding.findUnique({
    where: { userId },
    include: {
      // cast para evitar erro caso o client ainda não tenha sido regenerado
      user: {
        select: { name: true, email: true, currentStreak: true } as any,
      },
    } as any,
  })

  return NextResponse.json(onboarding)
}
