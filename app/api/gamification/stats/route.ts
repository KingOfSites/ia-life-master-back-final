import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";

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

        // Usar valores padrão se os campos não existirem ainda
        const currentStreak = (user as any).currentStreak || 0;
        const bestStreak = (user as any).bestStreak || 0;
        const totalMeals = (user as any).totalMeals || 0;
        const totalCalories = (user as any).totalCalories || 0;
        const level = (user as any).level || 1;
        const experience = (user as any).experience || 0;

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

