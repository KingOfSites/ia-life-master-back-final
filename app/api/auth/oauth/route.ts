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
	accessToken?: string; // Para Google (web)
	idToken?: string; // Para Google (mobile) - mais seguro
	identityToken?: string; // Para Apple
}

export async function POST(req: NextRequest) {
	try {
		const body: OAuthPayload = await req.json();
		const { provider, providerId, email, name, profileImage, accessToken, idToken, identityToken } = body;

		// Validação básica
		if (!provider || !providerId) {
			return NextResponse.json(
				{ error: "Dados obrigatórios faltando: provider e providerId são obrigatórios" },
				{ status: 400 }
			);
		}

		// Para Apple, email pode ser privado relay, então aceitar mesmo se não vier
		// Para Google, email é obrigatório
		if (provider === "google" && !email) {
			return NextResponse.json(
				{ error: "Email é obrigatório para login com Google" },
				{ status: 400 }
			);
		}

		// Normalizar valores para Apple (Apple pode não enviar name/email em logins subsequentes)
		const normalizedEmail = email || (provider === "apple" ? `${providerId}@privaterelay.appleid.com` : "");
		const normalizedName = name || (provider === "apple" ? "Usuário Apple" : "Usuário");

		if (!normalizedEmail) {
			return NextResponse.json(
				{ error: "Email é obrigatório" },
				{ status: 400 }
			);
		}

		if (provider !== "google" && provider !== "apple") {
			return NextResponse.json(
				{ error: "Provedor inválido" },
				{ status: 400 }
			);
		}

		// Usar valores normalizados
		const finalEmail = normalizedEmail;
		const finalName = normalizedName;

		// Validar tokens do Google
		if (provider === "google") {
			// Priorizar idToken (mobile) sobre accessToken (web)
			const tokenToValidate = idToken || accessToken;
			
			if (tokenToValidate) {
				const validated = await validateGoogleToken(tokenToValidate);
				if (!validated || validated.id !== providerId) {
					return NextResponse.json(
						{ error: "Token do Google inválido ou não corresponde ao usuário" },
						{ status: 401 }
					);
				}
				// Usar dados validados do Google
				if (validated.email !== finalEmail) {
					console.warn("[OAUTH] Email do token diferente do enviado:", validated.email, finalEmail);
				}
			} else {
				// Em desenvolvimento, permitir sem token (mas logar aviso)
				if (process.env.NODE_ENV === "production") {
					return NextResponse.json(
						{ error: "Token do Google é obrigatório" },
						{ status: 401 }
					);
				}
				console.warn("[OAUTH] Google OAuth sem token (modo desenvolvimento)");
			}
		}

		// Validar token da Apple
		if (provider === "apple") {
			if (identityToken) {
				const validated = await validateAppleToken(identityToken);
				if (!validated || validated.sub !== providerId) {
					return NextResponse.json(
						{ error: "Token da Apple inválido ou não corresponde ao usuário" },
						{ status: 401 }
					);
				}
				// Se o email não foi fornecido, usar o do token (se disponível)
				if (validated.email && !finalEmail.includes("@privaterelay.appleid.com")) {
					// Apple pode não fornecer email em logins subsequentes
					// Se o email do token for válido, usar ele
					// Nota: validated.email pode ser usado aqui se necessário
				}
			} else {
				// Em desenvolvimento, permitir sem token (mas logar aviso)
				if (process.env.NODE_ENV === "production") {
					return NextResponse.json(
						{ error: "Token da Apple é obrigatório" },
						{ status: 401 }
					);
				}
				console.warn("[OAUTH] Apple OAuth sem token (modo desenvolvimento)");
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
					name: finalName || user.name,
					email: finalEmail, // Atualizar email caso tenha mudado
					profileImage: profileImage || user.profileImage,
				},
			});
		} else {
			// Verificar se existe usuário com este email
			const existingByEmail = await prisma.user.findUnique({
				where: { email: finalEmail },
			});

			if (existingByEmail) {
				// Se o usuário existe com email mas sem provider, vincular o OAuth
				if (!existingByEmail.provider || !existingByEmail.providerId) {
					user = await prisma.user.update({
						where: { id: existingByEmail.id },
						data: {
							provider,
							providerId,
							name: finalName || existingByEmail.name,
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
						name: finalName.trim(),
						email: finalEmail,
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


