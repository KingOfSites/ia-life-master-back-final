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

// Função para garantir que as badges existam no banco
async function ensureBadgesExist() {
    const existingBadgesCount = await prisma.badge.count();
    
    // Se já existem badges, não precisa criar
    if (existingBadgesCount > 0) {
        return;
    }

    console.log("🌱 Criando badges automaticamente...");

    const badgeGroups = [
        {
            baseName: "Streak",
            category: "streak",
            icon: "flame",
            color: "#F59E0B",
            levels: [
                { level: 1, requirement: 1, description: "Complete 1 dia consecutivo", rarity: "common" },
                { level: 2, requirement: 7, description: "Complete 7 dias consecutivos", rarity: "rare" },
                { level: 3, requirement: 30, description: "Complete 30 dias consecutivos", rarity: "epic" },
                { level: 4, requirement: 100, description: "Complete 100 dias consecutivos", rarity: "legendary" },
                { level: 5, requirement: 365, description: "Complete 365 dias consecutivos", rarity: "legendary" },
            ],
        },
        {
            baseName: "Refeições",
            category: "meals",
            icon: "restaurant",
            color: "#10B981",
            levels: [
                { level: 1, requirement: 1, description: "Registre sua primeira refeição", rarity: "common" },
                { level: 2, requirement: 10, description: "Registre 10 refeições", rarity: "common" },
                { level: 3, requirement: 50, description: "Registre 50 refeições", rarity: "rare" },
                { level: 4, requirement: 100, description: "Registre 100 refeições", rarity: "epic" },
                { level: 5, requirement: 500, description: "Registre 500 refeições", rarity: "legendary" },
                { level: 6, requirement: 1000, description: "Registre 1000 refeições", rarity: "legendary" },
            ],
        },
        {
            baseName: "Calorias",
            category: "calories",
            icon: "battery-charging",
            color: "#10B981",
            levels: [
                { level: 1, requirement: 1000, description: "Registre 1.000 calorias", rarity: "common" },
                { level: 2, requirement: 10000, description: "Registre 10.000 calorias", rarity: "rare" },
                { level: 3, requirement: 50000, description: "Registre 50.000 calorias", rarity: "epic" },
                { level: 4, requirement: 100000, description: "Registre 100.000 calorias", rarity: "legendary" },
                { level: 5, requirement: 500000, description: "Registre 500.000 calorias", rarity: "legendary" },
            ],
        },
        {
            baseName: "Treinos",
            category: "workouts",
            icon: "barbell",
            color: "#EF4444",
            levels: [
                { level: 1, requirement: 1, description: "Complete seu primeiro treino", rarity: "common" },
                { level: 2, requirement: 5, description: "Complete 5 treinos", rarity: "common" },
                { level: 3, requirement: 25, description: "Complete 25 treinos", rarity: "rare" },
                { level: 4, requirement: 50, description: "Complete 50 treinos", rarity: "epic" },
                { level: 5, requirement: 100, description: "Complete 100 treinos", rarity: "legendary" },
                { level: 6, requirement: 250, description: "Complete 250 treinos", rarity: "legendary" },
            ],
        },
        {
            baseName: "Proteína",
            category: "protein",
            icon: "nutrition",
            color: "#DC2626",
            levels: [
                { level: 1, requirement: 100, description: "Consuma 100g de proteína", rarity: "common" },
                { level: 2, requirement: 1000, description: "Consuma 1.000g de proteína", rarity: "rare" },
                { level: 3, requirement: 5000, description: "Consuma 5.000g de proteína", rarity: "epic" },
                { level: 4, requirement: 10000, description: "Consuma 10.000g de proteína", rarity: "legendary" },
            ],
        },
        {
            baseName: "Carboidratos",
            category: "carbs",
            icon: "leaf",
            color: "#D97706",
            levels: [
                { level: 1, requirement: 500, description: "Consuma 500g de carboidratos", rarity: "common" },
                { level: 2, requirement: 5000, description: "Consuma 5.000g de carboidratos", rarity: "rare" },
                { level: 3, requirement: 25000, description: "Consuma 25.000g de carboidratos", rarity: "epic" },
            ],
        },
        {
            baseName: "Gorduras",
            category: "fat",
            icon: "water",
            color: "#2563EB",
            levels: [
                { level: 1, requirement: 200, description: "Consuma 200g de gordura", rarity: "common" },
                { level: 2, requirement: 2000, description: "Consuma 2.000g de gordura", rarity: "rare" },
                { level: 3, requirement: 10000, description: "Consuma 10.000g de gordura", rarity: "epic" },
            ],
        },
        {
            baseName: "Equilíbrio",
            category: "balance",
            icon: "balance",
            color: "#10B981",
            levels: [
                { level: 1, requirement: 1, description: "Registre refeições e treinos no mesmo dia", rarity: "common" },
                { level: 2, requirement: 7, description: "Registre refeições e treinos por 7 dias", rarity: "rare" },
                { level: 3, requirement: 30, description: "Registre refeições e treinos por 30 dias", rarity: "epic" },
            ],
        },
        {
            baseName: "Diversidade",
            category: "diversity",
            icon: "restaurant",
            color: "#10B981",
            levels: [
                { level: 1, requirement: 5, description: "Registre 5 tipos diferentes de refeições", rarity: "common" },
                { level: 2, requirement: 20, description: "Registre 20 tipos diferentes de refeições", rarity: "rare" },
                { level: 3, requirement: 50, description: "Registre 50 tipos diferentes de refeições", rarity: "epic" },
            ],
        },
        {
            baseName: "Consistência",
            category: "consistency",
            icon: "checkmark-circle",
            color: "#3B82F6",
            levels: [
                { level: 1, requirement: 3, description: "Registre refeições por 3 dias seguidos", rarity: "common" },
                { level: 2, requirement: 10, description: "Registre refeições por 10 dias seguidos", rarity: "rare" },
                { level: 3, requirement: 21, description: "Registre refeições por 21 dias seguidos", rarity: "epic" },
            ],
        },
    ];

    for (const group of badgeGroups) {
        const maxLevel = group.levels.length;
        
        for (const levelData of group.levels) {
            const badgeName = `${group.baseName} Nível ${levelData.level}`;
            
            await prisma.badge.upsert({
                where: { 
                    name: badgeName,
                },
                update: {
                    description: levelData.description,
                    requirement: levelData.requirement,
                    rarity: levelData.rarity,
                    maxLevel: maxLevel,
                },
                create: {
                    name: badgeName,
                    description: levelData.description,
                    icon: group.icon,
                    color: group.color,
                    category: group.category,
                    requirement: levelData.requirement,
                    rarity: levelData.rarity,
                    level: levelData.level,
                    maxLevel: maxLevel,
                },
            });
        }
    }

    console.log("✨ Badges criadas automaticamente!");
}

// GET - Listar badges do usuário
export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        // Garantir que as badges existam (cria automaticamente se não existirem)
        await ensureBadgesExist();

        // Buscar todas as badges disponíveis (ordenadas por categoria e nível)
        const allBadges = await prisma.badge.findMany({
            orderBy: [{ category: "asc" }, { level: "asc" }],
        });

        // Buscar badges do usuário
        const userBadges = await prisma.userBadge.findMany({
            where: { userId },
            include: { badge: true },
        });

        // Criar mapa de badges do usuário
        const userBadgeMap = new Map(userBadges.map(ub => [ub.badgeId, ub]));

        // Combinar badges com progresso do usuário
        const badgesWithProgress = allBadges.map(badge => {
            const userBadge = userBadgeMap.get(badge.id);
            return {
                id: badge.id,
                name: badge.name,
                description: badge.description,
                icon: badge.icon,
                color: badge.color,
                category: badge.category,
                requirement: badge.requirement,
                rarity: badge.rarity,
                level: badge.level,
                maxLevel: badge.maxLevel,
                progress: userBadge?.progress || 0,
                currentLevel: userBadge?.currentLevel || 0,
                unlocked: userBadge?.unlocked || false,
                unlockedAt: userBadge?.unlockedAt || null,
            };
        });

        return NextResponse.json({ badges: badgesWithProgress });
    } catch (error: any) {
        console.error("[BADGES] GET error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao buscar badges" },
            { status: 500 }
        );
    }
}


