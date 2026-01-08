import { openai } from "@/lib/openai";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";

type ChatMessage = {
	role: "user" | "assistant" | "system";
	content: string;
};

type ChatAction = {
	type:
		| "open_routine"
		| "open_nutrition"
		| "open_barcode_scanner"
		| "open_plan"
		| "log_meal";
	label: string;
	params?: Record<string, any>;
};

type ChatResponseAI = {
	reply: string;
	actions?: ChatAction[];
};

const normalizeDate = (value?: string | Date | null): Date => {
	const d = value ? new Date(value) : new Date();
	const normalized = new Date(d);
	normalized.setHours(0, 0, 0, 0);
	return normalized;
};

const stripMarkdown = (text: string) => {
	let t = (text || "").trim();
	// remove code fences
	t = t.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim());
	// remove headings
	t = t.replace(/^#{1,6}\s+/gm, "");
	// remove bold/italic markers
	t = t.replace(/\*\*(.*?)\*\*/g, "$1");
	t = t.replace(/\*(.*?)\*/g, "$1");
	t = t.replace(/__(.*?)__/g, "$1");
	t = t.replace(/_(.*?)_/g, "$1");
	// collapse extra blank lines
	t = t.replace(/\n{3,}/g, "\n\n");
	return t.trim();
};

const enforceMaxSize = (text: string, opts?: { maxChars?: number; maxLines?: number }) => {
	const maxChars = opts?.maxChars ?? 1400;
	const maxLines = opts?.maxLines ?? 20;

	let t = (text || "").trim();
	if (!t) return t;

	// lines first
	const lines = t.split("\n").map((l) => l.trimEnd());
	let limitedLines = lines;
	if (lines.length > maxLines) {
		limitedLines = lines.slice(0, maxLines);
		limitedLines.push("...");
		limitedLines.push("Se você quiser, eu detalho ou adapto com seus horários e preferências.");
	}
	t = limitedLines.join("\n").trim();

	// chars next
	if (t.length > maxChars) {
		t = t.slice(0, maxChars).trimEnd();
		t += "\n...\nSe você quiser, eu detalho ou adapto com seus horários e preferências.";
	}
	return t.trim();
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
		const lastUser = [...trimmedMessages].reverse().find((m) => m.role === "user")?.content ?? "";
		const wantsTodayDiet = /dieta|card[aá]pio|refei[cç][aã]o|plano/i.test(lastUser) && /\bhoje\b/i.test(lastUser);

		let userContextText = "";
		if (userId) {
			try {
				const onboarding = await prisma.onboarding.findUnique({ where: { userId } });
				if (onboarding) {
					userContextText = [
						"Perfil do usuário (use para personalizar):",
						`- Objetivo: ${onboarding.goalPrimary ?? "—"}`,
						`- Sexo: ${onboarding.gender ?? "—"}`,
						`- Idade: ${onboarding.age ?? "—"}`,
						`- Altura: ${onboarding.heightCm ?? "—"} cm`,
						`- Peso: ${onboarding.weightKg ?? "—"} kg`,
						`- Atividade: ${onboarding.activityLevel ?? "—"}`,
						`- Treinos/semana: ${onboarding.workoutsPerWeek ?? "—"}`,
						`- Experiência: ${onboarding.experience ?? "—"}`,
						`- Preferências/metas (goals): ${onboarding.goals ?? "—"}`,
						`- Restrições/dificuldades (blockers): ${onboarding.blockers ?? "—"}`,
					].join("\n");
				}
			} catch {
				userContextText = "";
			}
		}

		let routineContextText = "";
		if (userId) {
			try {
				const today = normalizeDate();
				const plan = await prisma.planDay.findFirst({
					where: { userId, date: today },
					include: { meals: true, workouts: true },
				});

				if (plan) {
					const meals = (plan.meals || [])
						.slice()
						.sort((a: any, b: any) => String(a.startTime || "").localeCompare(String(b.startTime || "")));
					const workouts = (plan.workouts || [])
						.slice()
						.sort((a: any, b: any) => String(a.startTime || "").localeCompare(String(b.startTime || "")));

					const mealsTxt = meals.length
						? meals
								.map((m: any) => {
									const parts = [
										`${m.startTime || "—"}-${m.endTime || "—"}`,
										m.title || "Refeição",
										m.calories != null ? `${m.calories} kcal` : null,
										m.protein != null ? `P ${m.protein}g` : null,
										m.carbs != null ? `C ${m.carbs}g` : null,
										m.fat != null ? `G ${m.fat}g` : null,
										m.status ? `(${m.status})` : null,
									].filter(Boolean);
									return `- ${parts.join(" · ")}`;
								})
								.join("\n")
						: "- (sem refeições no plano de hoje)";

					const workoutsTxt = workouts.length
						? workouts
								.map((w: any) => {
									const parts = [
										`${w.startTime || "—"}-${w.endTime || "—"}`,
										w.title || "Treino",
										w.focus ? `foco: ${w.focus}` : null,
										w.intensity ? `intensidade: ${w.intensity}` : null,
										w.status ? `(${w.status})` : null,
									].filter(Boolean);
									return `- ${parts.join(" · ")}`;
								})
								.join("\n")
						: "- (sem treinos no plano de hoje)";

					routineContextText = [
						"Rotina/Plano de HOJE (use para responder com consistência):",
						`- Data: ${today.toISOString().slice(0, 10)}`,
						`- Meta calórica do dia: ${plan.totalCalories ?? "—"} kcal`,
						"Refeições:",
						mealsTxt,
						"Treinos:",
						workoutsTxt,
					].join("\n");
				} else {
					routineContextText = "Rotina/Plano de HOJE: (nenhum plano encontrado para hoje)";
				}
			} catch {
				routineContextText = "";
			}
		}

		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			temperature: 0.2,
			response_format: { type: "json_object" },
			messages: [
				{
					role: "system",
					content:
						[
							"Você é a IALI, assistente de nutrição e treinos.",
							"Responda sempre em português (Brasil).",
							"Seja objetiva e direta. Evite textos longos.",
							"NÃO use Markdown. Nunca use **, #, ou blocos de código.",
							"Use no máximo 12–20 linhas no campo reply.",
							"Retorne SEMPRE um JSON válido no formato: {\"reply\":\"...\",\"actions\":[{\"type\":\"open_routine|open_nutrition|open_barcode_scanner|open_plan|log_meal\",\"label\":\"...\",\"params\":{}}]}",
							"actions é opcional, mas quando fizer sentido inclua 1–3 ações conectáveis ao app.",
							userContextText ? userContextText : "",
							routineContextText ? routineContextText : "",
							"Se o usuário pedir uma dieta/cardápio para HOJE: responda no formato curto abaixo, sem parágrafos longos:",
							"- Café da manhã (horário): ...",
							"- Almoço (horário): ...",
							"- Lanche (horário): ...",
							"- Jantar (horário): ...",
							"Finalize com 1 linha: 'Quer que eu ajuste para seu objetivo (perder/ganhar/manter) e quantidade de refeições?'",
							wantsTodayDiet ? "IMPORTANTE: O usuário pediu dieta para HOJE. Siga o formato curto obrigatório." : "",
						]
							.filter(Boolean)
							.join("\n"),
				},
				...trimmedMessages,
			],
		});

		const rawReply = completion.choices[0].message?.content?.trim() ?? "";
		let parsed: ChatResponseAI | null = null;
		try {
			parsed = JSON.parse(rawReply) as ChatResponseAI;
		} catch {
			parsed = null;
		}
		const replyTextRaw = parsed?.reply ?? rawReply;
		const reply = enforceMaxSize(stripMarkdown(String(replyTextRaw)), { maxChars: 1400, maxLines: 20 });
		const actions = Array.isArray(parsed?.actions) ? parsed!.actions!.slice(0, 3) : undefined;

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

			return NextResponse.json({ reply, actions, sessionId: session.id });
		}

		return NextResponse.json({ reply, actions });
	} catch (error) {
		console.error("Erro em /api/chat:", error);
		return NextResponse.json(
			{ error: "Erro ao gerar resposta da IA" },
			{ status: 500 },
		);
	}
}

