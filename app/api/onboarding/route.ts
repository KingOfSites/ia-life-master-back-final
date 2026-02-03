import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import jwt from "jsonwebtoken"
import { createPlanForDate, normalizeDietType } from "../plan/helpers"

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

  // Construir objeto de update dinamicamente para evitar problemas com Prisma Client desatualizado
  const updateData: any = {
    goals: JSON.stringify(data.goals),
    blockers: JSON.stringify(data.blockers),
    experience: data.experience,
    activityLevel: data.activityLevel,
    gender: data.gender,
    age: Number(data.age),
    birthDate: data.birthDate ? new Date(data.birthDate) : null,
    workoutsPerWeek: Number(data.workoutsPerWeek),
    goalPrimary: data.goalPrimary ?? null,
    targetWeight: data.targetWeight ? Number(data.targetWeight) : null,
    weeklyLossKg: data.weeklyLossKg ? Number(data.weeklyLossKg) : null,
    weeklyLossIntensity: data.weeklyLossIntensity ?? null,
    heightCm: data.heightCm ? Number(data.heightCm) : null,
    weightKg: data.weightKg ? Number(data.weightKg) : null,
  }

  // Adicionar campos opcionais apenas se existirem no schema (evita erro se Prisma Client não foi regenerado)
  if (data.heardFrom !== undefined) updateData.heardFrom = data.heardFrom ?? null
  // dietType do cadastro: "vegan" | "vegetarian" | "classic" | "pescatarian" | "none" — vegano/vegetariano têm rotina sem carne; outros usam cardápio padrão
  if (data.dietType !== undefined) updateData.dietType = data.dietType ?? null
  if (data.whatWouldLikeToAchieve !== undefined) updateData.whatWouldLikeToAchieve = data.whatWouldLikeToAchieve ?? null
  if (data.referralCode !== undefined) updateData.referralCode = data.referralCode ?? null

  const createData: any = {
    userId,
    ...updateData,
  }

  const onboarding = await prisma.onboarding.upsert({
    where: { userId },
    update: updateData,
    create: createData,
  } as any)

  // Garantir dietType na geração: normalizar "vegetariano"/"vegano" para "vegetarian"/"vegan" (buildMeals usa isso)
  const rawDiet = data.dietType != null ? String(data.dietType).trim() : (onboarding as any)?.dietType ?? null
  const normalizedDiet = normalizeDietType(rawDiet)
  const dietForPlan = normalizedDiet ?? rawDiet
  const onboardingForPlan = {
    ...(onboarding as object),
    dietType: dietForPlan,
  }
  console.log("[ONBOARDING] dietType para rotina: raw=", rawDiet, "-> normalized=", normalizedDiet, "-> usado:", dietForPlan)

  // Gera a semana inteira (7 dias) já respeitando dietType (vegano/vegetariano/etc.)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  try {
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      await createPlanForDate({ userId, onboarding: onboardingForPlan, date: d })
    }
    console.log("[ONBOARDING] Rotina da semana gerada (dietType:", onboardingForPlan.dietType ?? "—", ")")
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
