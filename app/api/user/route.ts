import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      profileImage: true,
      createdAt: true,
    },
  });

  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Buscar dados do onboarding também
  const onboarding = await prisma.onboarding.findUnique({
    where: { userId },
    select: {
      heightCm: true,
      weightKg: true,
      goalPrimary: true,
      age: true,
      birthDate: true,
    },
  });

  // Retornar data de nascimento completa se disponível, senão calcular a partir da idade
  let birthDateValue: string | null = null;
  if (onboarding?.birthDate) {
    birthDateValue = onboarding.birthDate.toISOString().split("T")[0];
  } else if (onboarding?.age) {
    // Fallback: calcular a partir da idade (1º de janeiro do ano)
    birthDateValue = new Date(new Date().getFullYear() - (onboarding.age || 0), 0, 1).toISOString().split("T")[0];
  }

  return NextResponse.json({
    ...user,
    phone: "", // Phone não está no schema do User
    birthDate: birthDateValue,
    height: onboarding?.heightCm ? `${onboarding.heightCm} cm` : null,
    weight: onboarding?.weightKg ? `${onboarding.weightKg} kg` : null,
    goal: onboarding?.goalPrimary || null,
    joinDate: user.createdAt.toISOString().split("T")[0],
    profileImage: user.profileImage || null,
  });
}

export async function PATCH(req: Request) {
  const userId = getUserIdFromAuth(req);
  if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const { name, email, phone, birthDate, height, weight, goal, profileImage } = body;

  // Atualizar dados do usuário
  const userUpdate: any = {};
  if (name !== undefined) userUpdate.name = String(name).trim();
  if (email !== undefined) userUpdate.email = String(email).trim();
  if (profileImage !== undefined) userUpdate.profileImage = profileImage ? String(profileImage).trim() : null;
  // phone não está no schema do User, pode ser adicionado depois

  if (Object.keys(userUpdate).length > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: userUpdate,
    });
  }

  // Atualizar dados do onboarding
  const onboardingUpdate: any = {};
  if (birthDate) {
    // Salvar a data de nascimento completa
    const birth = new Date(birthDate);
    onboardingUpdate.birthDate = birth;
    
    // Também calcular e atualizar a idade para compatibilidade
    const today = new Date();
    const age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      onboardingUpdate.age = age - 1;
    } else {
      onboardingUpdate.age = age;
    }
  }
  if (height) {
    // Extrair número de altura (ex: "175 cm" -> 175)
    const heightMatch = String(height).match(/(\d+)/);
    if (heightMatch) {
      onboardingUpdate.heightCm = Number(heightMatch[1]);
    }
  }
  if (weight) {
    // Extrair número de peso (ex: "70 kg" -> 70)
    const weightMatch = String(weight).match(/(\d+)/);
    if (weightMatch) {
      onboardingUpdate.weightKg = Number(weightMatch[1]);
    }
  }
  if (goal !== undefined) {
    onboardingUpdate.goalPrimary = String(goal).trim() || null;
  }

  if (Object.keys(onboardingUpdate).length > 0) {
    // Verificar se o onboarding já existe
    const existingOnboarding = await prisma.onboarding.findUnique({
      where: { userId },
    });

    if (existingOnboarding) {
      // Se existe, apenas atualizar
      await prisma.onboarding.update({
        where: { userId },
        data: onboardingUpdate,
      });
    } else {
      // Se não existe, criar com todos os campos obrigatórios
      await prisma.onboarding.create({
        data: {
          userId,
          ...onboardingUpdate,
          age: onboardingUpdate.age || 25, // Valor padrão se não fornecido
          goals: JSON.stringify([]),
          blockers: JSON.stringify([]),
          experience: "beginner",
          activityLevel: "moderate",
          gender: "other",
          workoutsPerWeek: 3,
        } as any,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

