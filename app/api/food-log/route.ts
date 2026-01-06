import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

export async function GET(req: Request) {
	const userId = getUserIdFromAuth(req);
	if (!userId) {
		return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
	}

	const logs = await prisma.foodLog.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
	});

	return NextResponse.json(logs);
}

export async function POST(req: Request) {
	const userId = getUserIdFromAuth(req);
	if (!userId) {
		return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
	}

	const { foods, imageUri } = (await req.json()) as {
		foods?: unknown;
		imageUri?: string | null;
	};

	if (!foods || (Array.isArray(foods) && foods.length === 0)) {
		return NextResponse.json(
			{ error: "Campo 'foods' é obrigatório" },
			{ status: 400 },
		);
	}

	const created = await prisma.foodLog.create({
		data: {
			userId,
			foods,
			imageUri: imageUri || null,
		},
	});

	return NextResponse.json(created, { status: 201 });
}

