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

// POST - Validar e desbloquear badges/conquistas
export async function POST(req: NextRequest) {
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

        // Contar treinos completados (status "done" no app)
        const totalWorkouts = await prisma.planWorkout.count({
            where: {
                planDay: { userId },
                status: "done",
            },
        });

        // Calcular macros totais das refeições
        const meals = await prisma.meal.findMany({
            where: { userId },
            include: { foods: true },
        });

        let totalProtein = 0;
        let totalCarbs = 0;
        let totalFat = 0;

        type MealWithFoods = (typeof meals)[0];
        meals.forEach((meal: MealWithFoods) => {
            meal.foods.forEach((food: MealWithFoods["foods"][0]) => {
                totalProtein += food.protein || 0;
                totalCarbs += food.carbohydrates || 0;
                totalFat += food.fat || 0;
            });
        });

        if (!user) {
            return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
        }

        // Buscar todas as badges
        const allBadges = await prisma.badge.findMany({
            orderBy: [{ category: "asc" }, { level: "asc" }],
        });
        type Badge = (typeof allBadges)[0];
        const userBadges = await prisma.userBadge.findMany({
            where: { userId },
        });

        type UserBadge = (typeof userBadges)[0];
        const userBadgeMap = new Map<string, UserBadge>(
            userBadges.map((ub: UserBadge) => [ub.badgeId, ub])
        );
        const unlockedBadges: string[] = [];
        const newAchievements: any[] = [];

        // Agrupar badges por categoria para sistema de níveis
        const badgesByCategory = new Map<string, typeof allBadges>();
        for (const badge of allBadges) {
            if (!badgesByCategory.has(badge.category)) {
                badgesByCategory.set(badge.category, []);
            }
            badgesByCategory.get(badge.category)!.push(badge);
        }

        // Função para calcular progresso por categoria
        const getProgressForCategory = async (category: string): Promise<number> => {
            switch (category) {
                case "streak":
                    return currentStreak;
                case "meals":
                    return totalMeals;
                case "calories":
                    return totalCalories;
                case "workouts":
                    return totalWorkouts;
                case "protein":
                    return Math.round(totalProtein);
                case "carbs":
                    return Math.round(totalCarbs);
                case "fat":
                    return Math.round(totalFat);
                case "balance": {
                    const daysWithMealsAndWorkouts = await prisma.planDay.findMany({
                        where: {
                            userId,
                            meals: { some: {} },
                            workouts: { some: { status: "done" } },
                        },
                        select: { date: true },
                        distinct: ["date"],
                    });
                    return daysWithMealsAndWorkouts.length;
                }
                case "diversity": {
                    const uniqueMealTypes = new Set(meals.map((m: MealWithFoods) => m.mealType).filter(Boolean));
                    const uniqueFoods = new Set(meals.flatMap((m: MealWithFoods) => m.foods.map((f: MealWithFoods["foods"][0]) => f.foodName.toLowerCase())));
                    return Math.max(uniqueMealTypes.size, uniqueFoods.size);
                }
                case "consistency": {
                    const mealsByDate = meals.reduce((acc: Record<string, MealWithFoods[]>, meal: MealWithFoods) => {
                        const date = new Date(meal.createdAt).toDateString();
                        if (!acc[date]) acc[date] = [];
                        acc[date].push(meal);
                        return acc;
                    }, {} as Record<string, MealWithFoods[]>);
                    
                    const sortedDates = Object.keys(mealsByDate).sort();
                    let consecutiveDays = 0;
                    let maxConsecutive = 0;
                    
                    for (let i = 0; i < sortedDates.length; i++) {
                        const date = sortedDates[i];
                        const prevDate = i > 0 ? sortedDates[i - 1] : null;
                        const dateObj = new Date(date);
                        const prevDateObj = prevDate ? new Date(prevDate) : null;
                        
                        if (!prevDateObj || 
                            Math.floor((dateObj.getTime() - prevDateObj.getTime()) / (1000 * 60 * 60 * 24)) === 1) {
                            consecutiveDays++;
                            maxConsecutive = Math.max(maxConsecutive, consecutiveDays);
                        } else {
                            consecutiveDays = 1;
                        }
                    }
                    return maxConsecutive;
                }
                default:
                    return 0;
            }
        };

        // Validar badges por categoria (sistema de níveis)
        for (const [category, categoryBadges] of badgesByCategory.entries()) {
            const progress = await getProgressForCategory(category);
            
            // Encontrar o nível máximo que pode ser desbloqueado
            let maxUnlockableLevel = 0;
            for (const badge of categoryBadges.sort((a: Badge, b: Badge) => a.level - b.level)) {
                if (progress >= badge.requirement) {
                    maxUnlockableLevel = Math.max(maxUnlockableLevel, badge.level);
                }
            }

            // Processar cada badge da categoria
            for (const badge of categoryBadges) {
                const shouldUnlock = progress >= badge.requirement && badge.level <= maxUnlockableLevel;
                const existingUserBadge = userBadges.find((ub: UserBadge) => ub.badgeId === badge.id);
                const currentLevel = existingUserBadge?.currentLevel || 0;
                const newLevel = shouldUnlock ? Math.max(currentLevel, badge.level) : currentLevel;
                const isNewUnlock = newLevel > currentLevel;

                // Criar ou atualizar UserBadge
                if (existingUserBadge) {
                    await prisma.userBadge.update({
                        where: { id: existingUserBadge.id },
                        data: {
                            progress,
                            currentLevel: newLevel,
                            unlocked: newLevel > 0,
                            unlockedAt: isNewUnlock && !existingUserBadge.unlockedAt ? new Date() : existingUserBadge.unlockedAt,
                        },
                    });
                } else {
                    await prisma.userBadge.create({
                        data: {
                            userId,
                            badgeId: badge.id,
                            progress,
                            currentLevel: newLevel,
                            unlocked: newLevel > 0,
                            unlockedAt: newLevel > 0 ? new Date() : null,
                        },
                    });
                }

                // Criar achievement apenas para novos desbloqueios
                if (isNewUnlock) {
                    unlockedBadges.push(badge.id);

                    const achievement = await prisma.achievement.create({
                        data: {
                            userId,
                            type: badge.category,
                            title: `${badge.name}`,
                            description: badge.description,
                            icon: badge.icon,
                            value: progress,
                            points: badge.rarity === "legendary" ? 100 : badge.rarity === "epic" ? 50 : badge.rarity === "rare" ? 25 : 10,
                        },
                    });

                    newAchievements.push(achievement);

                    // Adicionar experiência
                    const expGain = achievement.points;
                    const newExp = experience + expGain;
                    const expForNextLevel = level * 100;
                    const updatedUserLevel = newExp >= expForNextLevel ? level + 1 : level;

                    const updateData: any = {};
                    if ((user as any).experience !== undefined) updateData.experience = newExp;
                    if ((user as any).level !== undefined) updateData.level = updatedUserLevel;
                    if ((user as any).bestStreak !== undefined) updateData.bestStreak = Math.max(bestStreak, currentStreak);

                    if (Object.keys(updateData).length > 0) {
                        await prisma.user.update({
                            where: { id: userId },
                            data: updateData,
                        });
                    }
                }
            }
        }

        return NextResponse.json({
            unlockedBadges,
            newAchievements,
        });
    } catch (error: any) {
        console.error("[VALIDATE] POST error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao validar badges" },
            { status: 500 }
        );
    }
}

