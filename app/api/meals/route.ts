import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import crypto from "crypto";

export const runtime = "nodejs";

type IncomingFood = {
	food_name: string;
	serving_size?: string;
	calories?: number;
	carbohydrates?: number;
	protein?: number;
	fat?: number;
	fiber?: number;
	sugar?: number;
	sodium?: number;
	potassium?: number;
	vitamin_c?: number | null;
	confidence?: number | null;
};

type CreateMealBody = {
	mealType?: string | null;
	imageUri?: string | null;
    imageId?: string | null;
    source?: string | null; // ex.: "image_scan", "manual"
    forcedCalories?: number | null;
    totalCalories?: number | null;
	foods: IncomingFood[];
};

const getUserIdFromAuth = (req: Request): string | null => {
	const auth = req.headers.get("authorization") || req.headers.get("Authorization");
	if (!auth || !auth.startsWith("Bearer ")) return null;
	const token = auth.replace("Bearer ", "").trim();
	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET! || "") as {
			userId?: string;
		};
		return decoded.userId ?? null;
	} catch {
		return null;
	}
};

export async function GET(req: Request) {
	const userId = getUserIdFromAuth(req);
	if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

	const url = new URL(req.url);
	const favoritesOnly = url.searchParams.get("favorites") === "true";

	const where: any = { userId };
	if (favoritesOnly) {
		where.isFavorite = true;
	}

	const meals = await prisma.meal.findMany({
		where,
		include: { foods: true },
		orderBy: { createdAt: "desc" },
	});

	return NextResponse.json(meals);
}

export async function POST(req: Request) {
	const userId = getUserIdFromAuth(req);
	if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

	const { mealType, imageUri, foods, source, forcedCalories, totalCalories, imageId } =
		(await req.json()) as CreateMealBody;

	if (!foods || !Array.isArray(foods) || foods.length === 0) {
		return NextResponse.json({ error: "Campo 'foods' é obrigatório" }, { status: 400 });
	}

	const preparedFoods = foods.map((f) => ({
		foodName: f.food_name,
		servingSize: f.serving_size ?? null,
		calories: f.calories ?? null,
		carbohydrates: f.carbohydrates ?? null,
		protein: f.protein ?? null,
		fat: f.fat ?? null,
		fiber: f.fiber ?? null,
		sugar: f.sugar ?? null,
		sodium: f.sodium ?? null,
		potassium: f.potassium ?? null,
		vitaminC: f.vitamin_c ?? null,
		confidence: f.confidence ?? null,
	}));

    const computedTotalCalories = preparedFoods.reduce((sum, f) => {
        const c = typeof f.calories === "number" ? f.calories : 0;
        return sum + c;
    }, 0);

    const forced = forcedCalories != null ? Math.max(0, Math.round(Number(forcedCalories))) : null;
    const total =
        totalCalories != null
            ? Math.max(0, Math.round(Number(totalCalories)))
            : forced != null
                ? forced
                : Math.round(computedTotalCalories);

	// Atualizar streak quando a refeição é criada a partir de foto ou código de barras
	let updatedStreak = null;
	if (source === "image_scan" || source === "barcode") {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		
		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { currentStreak: true, lastStreakDate: true },
		});
		
		if (user) {
			const lastStreakDate = user.lastStreakDate
				? new Date(user.lastStreakDate)
				: null;
			if (lastStreakDate) {
				lastStreakDate.setHours(0, 0, 0, 0);
			}
			
			const daysDiff = lastStreakDate
				? Math.floor((today.getTime() - lastStreakDate.getTime()) / (1000 * 60 * 60 * 24))
				: null;
			
			let newStreak = user.currentStreak;
			if (!lastStreakDate || daysDiff === null) {
				// Primeira vez - streak = 1
				newStreak = 1;
			} else if (daysDiff === 0) {
				// Mesmo dia - não aumenta o streak
				newStreak = user.currentStreak;
			} else if (daysDiff === 1) {
				// Dia consecutivo - aumenta o streak
				newStreak = user.currentStreak + 1;
			} else {
				// Quebrou o streak - recomeça em 1
				newStreak = 1;
			}
			
			await prisma.user.update({
				where: { id: userId },
				data: {
					currentStreak: newStreak,
					lastStreakDate: today,
					bestStreak: Math.max(user.currentStreak, newStreak),
					totalMeals: { increment: 1 },
				},
			});
			
			updatedStreak = newStreak;
		}
	}

	// Atualizar total de calorias
	const caloriesToAdd = preparedFoods.reduce((sum, f) => sum + (f.calories || 0), 0);
	if (caloriesToAdd > 0) {
		await prisma.user.update({
			where: { id: userId },
			data: {
				totalCalories: { increment: caloriesToAdd },
			},
		});
	}

	const meal = await prisma.meal.create({
		data: {
			userId,
			mealType: mealType || null,
			imageUri: imageUri || null,
            imageId: imageId || crypto.randomUUID(),
            source: source || "manual",
            forcedCalories: forced,
            totalCalories: total,
			isFavorite: false, // SEMPRE false por padrão - só fica favorita se o usuário marcar explicitamente
			foods: { create: preparedFoods },
		},
		include: { foods: true },
	});

	// Validar badges e conquistas automaticamente após criar refeição
	// A validação completa com sistema de níveis será feita pelo endpoint /gamification/validate
	// que é chamado automaticamente quando o usuário acessa a tela de gamificação

	return NextResponse.json({ meal, streak: updatedStreak }, { status: 201 });
}

export async function DELETE(req: Request) {
	const userId = getUserIdFromAuth(req);
	if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

	const { searchParams } = new URL(req.url);
	const id = searchParams.get("id");
	if (!id) return NextResponse.json({ error: "Informe ?id=mealId" }, { status: 400 });

	// garante que só apaga do próprio usuário
	const deleted = await prisma.meal.deleteMany({
		where: { id, userId },
	});

	if (!deleted.count) {
		return NextResponse.json({ error: "Refeição não encontrada" }, { status: 404 });
	}

	return NextResponse.json({ ok: true });
}

type UpdateMealBody = {
	mealType?: string | null;
	imageUri?: string | null;
	imageId?: string | null;
	source?: string | null;
	forcedCalories?: number | null;
	totalCalories?: number | null;
	foods: IncomingFood[];
};

export async function PATCH(req: Request) {
	const userId = getUserIdFromAuth(req);
	if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

	const { searchParams } = new URL(req.url);
	const id = searchParams.get("id");
	if (!id) return NextResponse.json({ error: "Informe ?id=mealId" }, { status: 400 });

	const body = (await req.json()) as Partial<UpdateMealBody>;
	const foods = body.foods;
	if (!foods || !Array.isArray(foods) || foods.length === 0) {
		return NextResponse.json({ error: "Campo 'foods' é obrigatório" }, { status: 400 });
	}

	const existing = await prisma.meal.findFirst({
		where: { id, userId },
		select: { id: true },
	});
	if (!existing) {
		return NextResponse.json({ error: "Refeição não encontrada" }, { status: 404 });
	}

	const preparedFoods = foods.map((f) => ({
		foodName: f.food_name,
		servingSize: f.serving_size ?? null,
		calories: f.calories ?? null,
		carbohydrates: f.carbohydrates ?? null,
		protein: f.protein ?? null,
		fat: f.fat ?? null,
		fiber: f.fiber ?? null,
		sugar: f.sugar ?? null,
		sodium: f.sodium ?? null,
		potassium: f.potassium ?? null,
		vitaminC: f.vitamin_c ?? null,
		confidence: f.confidence ?? null,
	}));

	const computedTotalCalories = preparedFoods.reduce((sum, f) => {
		const c = typeof f.calories === "number" ? f.calories : 0;
		return sum + c;
	}, 0);

	const forced =
		body.forcedCalories != null ? Math.max(0, Math.round(Number(body.forcedCalories))) : null;
	const total =
		body.totalCalories != null
			? Math.max(0, Math.round(Number(body.totalCalories)))
			: forced != null
				? forced
				: Math.round(computedTotalCalories);

	const meal = await prisma.$transaction(async (tx) => {
		await tx.mealFood.deleteMany({ where: { mealId: id } });
		return await tx.meal.update({
			where: { id },
			data: {
				mealType: body.mealType ?? null,
				imageUri: body.imageUri ?? undefined,
				imageId: body.imageId ?? undefined,
				source: body.source ?? undefined,
				forcedCalories: forced,
				totalCalories: total,
				foods: { create: preparedFoods },
			},
			include: { foods: true },
		});
	});

	return NextResponse.json(meal);
}

