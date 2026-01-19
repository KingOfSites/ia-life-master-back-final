import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

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

export async function PATCH(req: Request) {
	const userId = getUserIdFromAuth(req);
	if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

	const body = await req.json();
	const { mealId, isFavorite } = body;

	if (!mealId || typeof isFavorite !== "boolean") {
		return NextResponse.json({ error: "mealId e isFavorite são obrigatórios" }, { status: 400 });
	}

	// Verificar se a refeição pertence ao usuário
	const meal = await prisma.meal.findFirst({
		where: { id: mealId, userId },
	});

	if (!meal) {
		return NextResponse.json({ error: "Refeição não encontrada" }, { status: 404 });
	}

	const updated = await prisma.meal.update({
		where: { id: mealId },
		data: { isFavorite },
		include: { foods: true },
	});

	return NextResponse.json({ success: true, meal: updated });
}


