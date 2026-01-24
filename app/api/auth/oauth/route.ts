import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import { validateGoogleToken, validateAppleToken } from "@/lib/oauth-validators";

export const runtime = "nodejs";

interface OAuthPayload {
	provider: "google" | "apple";
	providerId: string;
	email: string;
	name: string;
	profileImage?: string;
	// Tokens para validação
	accessToken?: string; // Para Google
	identityToken?: string; // Para Apple
}

export async function POST(req: NextRequest) {
	try {
		const body: OAuthPayload = await req.json();
		const { provider, providerId, email, name, profileImage, accessToken, identityToken } = body;

		if (!provider || !providerId || !email || !name) {
			return NextResponse.json(
				{ error: "Dados obrigatórios faltando" },
				{ status: 400 }
			);
		}

		if (provider !== "google" && provider !== "apple") {
			return NextResponse.json(
				{ error: "Provedor inválido" },
				{ status: 400 }
			);
		}

		// Validar tokens
		if (provider === "google" && accessToken) {
			const validated = await validateGoogleToken(accessToken);
			if (!validated || validated.id !== providerId) {
				return NextResponse.json(
					{ error: "Token do Google inválido ou não corresponde ao usuário" },
					{ status: 401 }
				);
			}
			// Usar dados validados do Google
			if (validated.email !== email) {
				console.warn("[OAUTH] Email do token diferente do enviado:", validated.email, email);
			}
		}

		if (provider === "apple" && identityToken) {
			const validated = await validateAppleToken(identityToken);
			if (!validated || validated.sub !== providerId) {
				return NextResponse.json(
					{ error: "Token da Apple inválido ou não corresponde ao usuário" },
					{ status: 401 }
				);
			}
			// Se o email não foi fornecido, usar o do token (se disponível)
			if (validated.email && !email.includes("@privaterelay.appleid.com")) {
				// Apple pode não fornecer email em logins subsequentes
				// Se o email do token for válido, usar ele
			}
		}

		// Verificar se o usuário já existe pelo providerId (prioridade)
		let user = await prisma.user.findFirst({
			where: {
				provider,
				providerId,
			},
		});

		if (user) {
			// Usuário existe com este provider, apenas atualizar dados
			user = await prisma.user.update({
				where: { id: user.id },
				data: {
					name: name || user.name,
					email, // Atualizar email caso tenha mudado
					profileImage: profileImage || user.profileImage,
				},
			});
		} else {
			// Verificar se existe usuário com este email
			const existingByEmail = await prisma.user.findUnique({
				where: { email },
			});

			if (existingByEmail) {
				// Se o usuário existe com email mas sem provider, vincular o OAuth
				if (!existingByEmail.provider || !existingByEmail.providerId) {
					user = await prisma.user.update({
						where: { id: existingByEmail.id },
						data: {
							provider,
							providerId,
							name: name || existingByEmail.name,
							profileImage: profileImage || existingByEmail.profileImage,
						},
					});
				} else {
					// Email já está vinculado a outro provider
					return NextResponse.json(
						{ error: "Este email já está cadastrado com outro método de login. Use o método original ou faça login com email e senha." },
						{ status: 409 }
					);
				}
			} else {
				// Criar novo usuário
				user = await prisma.user.create({
					data: {
						name: name.trim(),
						email,
						provider,
						providerId,
						profileImage: profileImage || null,
						password: null, // OAuth não precisa de senha
					},
				});
			}
		}

		// Gerar token JWT
		const secret = process.env.JWT_SECRET;
		if (!secret) {
			return NextResponse.json(
				{ error: "Servidor sem JWT_SECRET configurado" },
				{ status: 500 }
			);
		}

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
	} catch (error: any) {
		console.error("[OAUTH] Erro:", error);
		return NextResponse.json(
			{ error: error.message || "Erro ao autenticar" },
			{ status: 500 }
		);
	}
}


