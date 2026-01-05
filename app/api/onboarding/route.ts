import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import jwt from "jsonwebtoken"

export const runtime = "nodejs"

type DecodedToken = {
  userId: string
}

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
  const userId = getUserId(req)

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const data = await req.json()

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
    },
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
    },
  })

  return NextResponse.json(onboarding)
}

export async function GET(req: Request) {
  const userId = getUserId(req)

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const onboarding = await prisma.onboarding.findUnique({
    where: { userId },
  })

  return NextResponse.json(onboarding)
}
