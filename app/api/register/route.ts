import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

type RegisterPayload = {
	name?: string;
	email?: string;
	password?: string;
};

function getJwtSecret() {
	return process.env.JWT_SECRET || process.env.AUTH_SECRET;
}

export async function POST(req: Request) {
	const { name, email, password } = (await req.json()) as RegisterPayload;

	if (!name || !email || !password) {
		return NextResponse.json(
			{ error: "Nome, email e senha obrigatórios" },
			{ status: 400 },
		);
	}

	const existing = await prisma.user.findUnique({
		where: { email },
	});

	if (existing) {
		return NextResponse.json(
			{ error: "E-mail já cadastrado" },
			{ status: 409 },
		);
	}

	const secret = getJwtSecret();
	if (!secret) {
		return NextResponse.json(
			{ error: "Servidor sem JWT_SECRET configurado" },
			{ status: 500 },
		);
	}

	const hashed = await bcrypt.hash(password, 10);

	const user = await prisma.user.create({
		data: {
			name: name.trim(),
			email,
			password: hashed,
		},
	});

	const token = jwt.sign({ userId: user.id }, secret, {
		expiresIn: "7d",
	});

	return NextResponse.json({
		token,
		user: {
			id: user.id,
			name: user.name,
			email: user.email,
		},
	});
}


