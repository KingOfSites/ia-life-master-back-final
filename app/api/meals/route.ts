import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

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

	const meals = await prisma.meal.findMany({
		where: { userId },
		include: { foods: true },
		orderBy: { createdAt: "desc" },
	});

	return NextResponse.json(meals);
}

export async function POST(req: Request) {
	const userId = getUserIdFromAuth(req);
	if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

	const { mealType, imageUri, foods } = (await req.json()) as CreateMealBody;

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

	const meal = await prisma.meal.create({
		data: {
			userId,
			mealType: mealType || null,
			imageUri: imageUri || null,
			foods: { create: preparedFoods },
		},
		include: { foods: true },
	});

	return NextResponse.json(meal, { status: 201 });
}

