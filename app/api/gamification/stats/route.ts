import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import { levelFromExperience, xpTotalForLevel } from "@/lib/gamification";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

function getUserIdFromToken(req: NextRequest): string | null {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) return null;

    const token = auth.slice(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        return decoded.userId;
    } catch {
        return null;
    }
}

// GET - Obter estatísticas do usuário para ranking
export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
        }

        const currentStreak = (user as any).currentStreak || 0;
        const bestStreak = (user as any).bestStreak || 0;
        const totalMeals = (user as any).totalMeals || 0;
        const totalCalories = (user as any).totalCalories || 0;
        const experience = Math.max(0, (user as any).experience ?? 0);
        const level = levelFromExperience(experience);
        const nextLevelTotalXp = xpTotalForLevel(level + 1);
        // Para a barra de progresso: "X / Y pontos" onde Y = total de XP para atingir o próximo nível
        const nextLevelPoints = nextLevelTotalXp;
        const progressInLevel = nextLevelTotalXp > 0 ? Math.max(0, Math.min(1, experience / nextLevelTotalXp)) : 0;

        // Calcular dias ativos
        const daysSinceJoin = Math.floor(
            (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Contar badges desbloqueadas
        const unlockedBadges = await prisma.userBadge.count({
            where: { userId, unlocked: true },
        });

        // Contar conquistas
        const totalAchievements = await prisma.achievement.count({
            where: { userId },
        });

        // Calcular score total (para ranking)
        const score = 
            (currentStreak * 10) +
            (bestStreak * 5) +
            (totalMeals * 2) +
            (unlockedBadges * 50) +
            (totalAchievements * 25) +
            (level * 100);

        return NextResponse.json({
            currentStreak,
            bestStreak,
            totalMeals,
            totalCalories,
            level,
            experience,
            nextLevelPoints,
            progressInLevel,
            daysSinceJoin,
            unlockedBadges,
            totalAchievements,
            score,
        });
    } catch (error: any) {
        console.error("[STATS] GET error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao buscar estatísticas" },
            { status: 500 }
        );
    }
}

