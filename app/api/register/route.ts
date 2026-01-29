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
	try {
		const { name, email, password } = (await req.json()) as RegisterPayload;

		if (!name || !email || !password) {
			return NextResponse.json(
				{ error: "Nome, email e senha obrigatórios" },
				{ status: 400 },
			);
		}

		// Normalizar email (trim e lowercase)
		const trimmedEmail = email.trim().toLowerCase();

		// Validar formato de email básico
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(trimmedEmail)) {
			return NextResponse.json(
				{ error: "Por favor, insira um e-mail válido" },
				{ status: 400 },
			);
		}

		// Validar tamanho mínimo de senha
		if (password.length < 6) {
			return NextResponse.json(
				{ error: "Senha deve ter pelo menos 6 caracteres" },
				{ status: 400 },
			);
		}

		const existing = await prisma.user.findUnique({
			where: { email: trimmedEmail },
		});

		if (existing) {
			return NextResponse.json(
				{ error: "Esse e-mail já tem uma conta. Faça login na tela anterior ou use outro e-mail para se cadastrar." },
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
				email: trimmedEmail,
				password: hashed,
			},
		});

		// Token com expiração de 1 ano para manter usuário logado permanentemente
		const token = jwt.sign({ userId: user.id }, secret, {
			expiresIn: "365d",
		});

		return NextResponse.json({
			token,
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
			},
		});
	} catch (error: any) {
		console.error("[REGISTER] Erro completo:", {
			message: error.message,
			stack: error.stack,
			name: error.name,
		});
		return NextResponse.json(
			{
				error: error.message || "Erro ao cadastrar usuário",
				details: process.env.NODE_ENV === "development" ? error.stack : undefined,
			},
			{ status: 500 },
		);
	}
}


