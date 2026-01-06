import { openai } from "@/lib/openai";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";

type ChatMessage = {
	role: "user" | "assistant" | "system";
	content: string;
};

export async function POST(req: Request) {
	try {
		const auth = req.headers.get("authorization") || req.headers.get("Authorization");
		const token = auth?.startsWith("Bearer ") ? auth.replace("Bearer ", "").trim() : null;
		let userId: string | null = null;
		if (token) {
			try {
				const decoded = jwt.verify(token, process.env.JWT_SECRET! || "") as {
					userId?: string;
				};
				userId = decoded.userId ?? null;
			} catch {
				userId = null;
			}
		}

		const { messages, sessionId, title } = (await req.json()) as {
			messages?: ChatMessage[];
			sessionId?: string | null;
			title?: string | null;
		};

		if (!messages || messages.length === 0) {
			return NextResponse.json(
				{ error: "Nenhuma mensagem enviada" },
				{ status: 400 },
			);
		}

		const trimmedMessages = messages.slice(-20); // limita contexto

		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			temperature: 0.4,
			messages: [
				{
					role: "system",
					content:
						"Você é a IALI, assistente de nutrição e treinos. Responda sempre em português, com objetividade e tom acolhedor. Use bullets apenas quando fizer sentido e mantenha as respostas curtas.",
				},
				...trimmedMessages,
			],
		});

		const reply = completion.choices[0].message?.content?.trim() ?? "";

		// Persistência opcional (se estiver autenticado)
		if (userId) {
			// descobre ou cria sessão
			const session =
				(sessionId &&
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(await (prisma as any).chatSession.findFirst({
						where: { id: sessionId, userId },
					}))) ||
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(await (prisma as any).chatSession.create({
					data: {
						userId,
						title: title || null,
					},
				}));

			// pega as duas últimas mensagens (usuário e IA) para salvar
			const lastUserMessage = [...trimmedMessages]
				.reverse()
				.find((m) => m.role === "user");

			const toSave: ChatMessage[] = [];
			if (lastUserMessage) toSave.push(lastUserMessage);
			toSave.push({ role: "assistant", content: reply });

			if (toSave.length) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				await (prisma as any).chatMessage.createMany({
					data: toSave.map((m) => ({
						sessionId: session.id,
						role: m.role,
						content: m.content,
					})),
				});
			}
		}

		return NextResponse.json({ reply });
	} catch (error) {
		console.error("Erro em /api/chat:", error);
		return NextResponse.json(
			{ error: "Erro ao gerar resposta da IA" },
			{ status: 500 },
		);
	}
}

