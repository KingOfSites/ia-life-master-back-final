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

		// Validação mínima - apenas provider e providerId são realmente obrigatórios
		if (!provider || !providerId) {
			return NextResponse.json(
				{ error: "Provider e providerId são obrigatórios" },
				{ status: 400 }
			);
		}

		// Para Apple: email e nome são obrigatórios (mensagens amigáveis)
		if (provider === "apple") {
			// Log para debug
			console.log("[OAUTH] Apple - dados recebidos:", { 
				email: email ? "presente" : "ausente", 
				name: name ? `"${name}"` : "ausente",
				providerId 
			});
			
			if (!email || (typeof email === "string" && email.trim() === "")) {
				return NextResponse.json(
					{ error: "Por favor, informe seu e-mail" },
					{ status: 400 }
				);
			}
			
			// Validar nome: aceitar se for string não vazia e não for providerId ou fallback
			const nameStr = typeof name === "string" ? name.trim() : "";
			if (!nameStr || nameStr === "" || nameStr === "Usuário Apple" || nameStr === providerId) {
				console.log("[OAUTH] Apple - nome inválido:", { nameStr, providerId });
				return NextResponse.json(
					{ error: "Por favor, informe seu nome" },
					{ status: 400 }
				);
			}
		}

		// Normalizar valores - Google pode ter fallback, Apple já validado acima
		const normalizedEmail = provider === "apple" ? email! : (email || `${providerId}@oauth.temp`);
		const normalizedName = provider === "apple" ? name! : (name || "Usuário");

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
			// Usuário existe com este provider
			// REGRA APPLE: Nome só vem na primeira vez, nunca sobrescrever se já existe
			const updateData: any = {
				email: finalEmail, // Atualizar email caso tenha mudado
				profileImage: profileImage || user.profileImage,
			};

			// Para Apple: só atualizar nome se o usuário NÃO tem nome E o nome veio agora
			if (provider === "apple") {
				if (!user.name && name && name.trim() && name !== "Usuário Apple" && name !== providerId) {
					updateData.name = name.trim();
				}
				// Se já tem nome, não tocar (Apple não envia mais)
			} else {
				// Para Google: sempre atualizar se vier
				if (finalName && finalName.trim()) {
					updateData.name = finalName.trim();
				}
			}

			user = await prisma.user.update({
				where: { id: user.id },
				data: updateData,
			});
		} else {
			// Verificar se existe usuário com este email
			const existingByEmail = await prisma.user.findUnique({
				where: { email: finalEmail },
			});

			if (existingByEmail) {
				// Se o usuário existe com email mas sem provider, vincular o OAuth
				if (!existingByEmail.provider || !existingByEmail.providerId) {
					const updateData: any = {
						provider,
						providerId,
						profileImage: profileImage || existingByEmail.profileImage,
					};

					// REGRA APPLE: Só atualizar nome se o usuário NÃO tem nome E o nome veio agora
					if (provider === "apple") {
						if (!existingByEmail.name && name && name.trim() && name !== "Usuário Apple" && name !== providerId) {
							updateData.name = name.trim();
						} else {
							// Manter o nome existente
							updateData.name = existingByEmail.name;
						}
					} else {
						// Para Google: usar o nome que veio ou manter o existente
						updateData.name = finalName || existingByEmail.name;
					}

					user = await prisma.user.update({
						where: { id: existingByEmail.id },
						data: updateData,
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
				// Para Apple: garantir que o nome não seja o providerId
				let userName: string;
				if (provider === "apple") {
					if (name && name.trim() && name !== "Usuário Apple" && name !== providerId) {
						userName = name.trim();
					} else {
						userName = "Usuário"; // Fallback seguro
					}
				} else {
					// Para Google: usar o nome que veio ou fallback
					userName = finalName && finalName.trim() ? finalName.trim() : "Usuário";
				}

				user = await prisma.user.create({
					data: {
						name: userName,
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


