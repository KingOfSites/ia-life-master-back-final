import { openai } from "@/lib/openai";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";

// Configurar timeout maior para requisições complexas (4 minutos)
export const maxDuration = 240;
export const runtime = "nodejs";

type ChatMessage = {
	role: "user" | "assistant" | "system";
	content: string;
};

type ChatAction = {
	type:
		| "add_meals"
		| "add_workout"
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

const getWeekDates = (): string[] => {
	const today = new Date();
	const dayOfWeek = today.getDay(); // 0 = domingo, 1 = segunda, etc.
	const monday = new Date(today);
	monday.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)); // Segunda-feira da semana
	
	const dates: string[] = [];
	for (let i = 0; i < 7; i++) {
		const date = new Date(monday);
		date.setDate(monday.getDate() + i);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		dates.push(`${year}-${month}-${day}`);
	}
	return dates;
};

const getCustomPeriodDates = (type: "days" | "weeks" | "months", value: number): string[] => {
	const today = new Date();
	const dates: string[] = [];
	
	if (type === "days") {
		for (let i = 0; i < value; i++) {
			const date = new Date(today);
			date.setDate(today.getDate() + i);
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const day = String(date.getDate()).padStart(2, "0");
			dates.push(`${year}-${month}-${day}`);
		}
	} else if (type === "weeks") {
		const totalDays = value * 7;
		for (let i = 0; i < totalDays; i++) {
			const date = new Date(today);
			date.setDate(today.getDate() + i);
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const day = String(date.getDate()).padStart(2, "0");
			dates.push(`${year}-${month}-${day}`);
		}
	} else {
		// months
		const endDate = new Date(today);
		endDate.setMonth(today.getMonth() + value);
		const currentDate = new Date(today);
		while (currentDate < endDate) {
			const year = currentDate.getFullYear();
			const month = String(currentDate.getMonth() + 1).padStart(2, "0");
			const day = String(currentDate.getDate()).padStart(2, "0");
			dates.push(`${year}-${month}-${day}`);
			currentDate.setDate(currentDate.getDate() + 1);
		}
	}
	return dates;
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

		// Sistema de bloqueio por assinatura desabilitado temporariamente
		// TODO: Reativar verificação de entitlements quando necessário

		const { messages, sessionId, title, dietPeriod, customPeriod, mealToReplace, workoutToReplace } = (await req.json()) as {
			messages?: ChatMessage[];
			sessionId?: string | null;
			title?: string | null;
			dietPeriod?: "day" | "week" | "custom";
			customPeriod?: { type: "days" | "weeks" | "months"; value: number };
			mealToReplace?: string | null;
			workoutToReplace?: string | null;
		};

		if (!messages || messages.length === 0) {
			return NextResponse.json(
				{ error: "Nenhuma mensagem enviada" },
				{ status: 400 },
			);
		}

		const trimmedMessages = messages.slice(-20); // limita contexto
		const lastUser = [...trimmedMessages].reverse().find((m) => m.role === "user")?.content ?? "";
		
		// Detectar se o usuário pediu tanto refeições quanto treinos
		const wantsBothMealsAndWorkouts = /(?:dieta|refei[cç][aã]o|card[aá]pio|alimenta[cç][aã]o).*(?:treino|exerc[ií]cio|treinar|muscula[cç][aã]o)|(?:treino|exerc[ií]cio|treinar|muscula[cç][aã]o).*(?:dieta|refei[cç][aã]o|card[aá]pio|alimenta[cç][aã]o)/i.test(lastUser);
		
		// Detectar número específico de refeições pedido pelo usuário (3-6)
		// Padrões: "5 refeições", "com 5 refeições", "quero 6 refeições", "fazer 4 refeições", etc.
		const mealsCountPatterns = [
			/(?:com|de|ter|fazer|faz|incluir|inclua|quero|preciso|gerar|gera|montar|monta|preparar|prepara)\s*(\d+)\s*(?:refei[cç][aã]o|refei[cç][oõ]es)/i,
			/(\d+)\s*(?:refei[cç][aã]o|refei[cç][oõ]es)/i,
			/(?:refei[cç][aã]o|refei[cç][oõ]es).*?(\d+)/i,
		];
		let requestedMealsCount: number | null = null;
		for (const pattern of mealsCountPatterns) {
			const match = lastUser.match(pattern);
			if (match) {
				const num = parseInt(match[1], 10);
				if (num >= 3 && num <= 6) {
					requestedMealsCount = num;
					break;
				}
			}
		}
		const validMealsCount = requestedMealsCount;
		
		// Detectar número específico de treinos pedido pelo usuário (1-5)
		// Padrões: "3 treinos", "com 3 treinos", "quero 2 treinos", "fazer 4 treinos", etc.
		const workoutsCountPatterns = [
			/(?:com|de|ter|fazer|faz|incluir|inclua|quero|preciso|gerar|gera|montar|monta|preparar|prepara)\s*(\d+)\s*(?:treino|treinos|exerc[ií]cio|exerc[ií]cios)/i,
			/(\d+)\s*(?:treino|treinos|exerc[ií]cio|exerc[ií]cios)/i,
			/(?:treino|treinos|exerc[ií]cio|exerc[ií]cios).*?(\d+)/i,
		];
		let requestedWorkoutsCount: number | null = null;
		for (const pattern of workoutsCountPatterns) {
			const match = lastUser.match(pattern);
			if (match) {
				const num = parseInt(match[1], 10);
				if (num >= 1 && num <= 5) {
					requestedWorkoutsCount = num;
					break;
				}
			}
		}
		const validWorkoutsCount = requestedWorkoutsCount;
		
		// Log de detecção para debug
		if (validMealsCount || validWorkoutsCount) {
			console.log(`[CHAT/BACKEND] Detected counts - Meals: ${validMealsCount || 'none'}, Workouts: ${validWorkoutsCount || 'none'}, User message: "${lastUser.substring(0, 100)}"`);
		}
		
		// Detectar se está ajustando uma refeição ou treino específico
		const isAdjustingSingleMeal = /ajust.*refei[cç][aã]o.*substitu.*apenas|substitu.*apenas.*refei[cç][aã]o/i.test(lastUser);
		const isAdjustingSingleWorkout = /ajust.*treino.*substitu.*apenas|substitu.*apenas.*treino/i.test(lastUser);
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

		// Detectar se é uma requisição complexa (múltiplas refeições + treinos, ou para semana)
		// Requisição complexa: semana + refeições + treinos, ou múltiplas refeições + múltiplos treinos
		const isWeekOrLongPeriod = dietPeriod === "week" || 
									(dietPeriod === "custom" && customPeriod && (customPeriod.type === "weeks" || customPeriod.value > 7));
		
		const isComplexRequest = (
			// Semana/período longo com refeições e treinos (mesmo que números baixos)
			(isWeekOrLongPeriod && wantsBothMealsAndWorkouts) ||
			// Múltiplas refeições (5+) ou múltiplos treinos (3+)
			(validMealsCount && validMealsCount >= 5) ||
			(validWorkoutsCount && validWorkoutsCount >= 3) ||
			// Qualquer combinação de refeições + treinos com números específicos
			(validMealsCount && validWorkoutsCount) ||
			// Semana com qualquer refeição ou treino
			(isWeekOrLongPeriod && (wantsBothMealsAndWorkouts || /(?:refei[cç][aã]o|treino)/i.test(lastUser)))
		);
		
		// Requisição muito complexa: semana + múltiplas refeições + múltiplos treinos
		const isVeryComplexRequest = isWeekOrLongPeriod && wantsBothMealsAndWorkouts && validMealsCount && validWorkoutsCount;
		
		// Aumentar max_tokens para requisições complexas
		// 6000 tokens para muito complexas, 4000 para complexas, 2000 para normais
		const maxTokens = isVeryComplexRequest ? 6000 : isComplexRequest ? 4000 : 2000;
		
		const completion = await openai().chat.completions.create({
			model: "gpt-4o-mini",
			temperature: 0.2,
			max_tokens: maxTokens,
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
							"Retorne SEMPRE um JSON válido no formato: {\"reply\":\"...\",\"actions\":[{\"type\":\"add_meals|add_workout|open_routine|open_nutrition|open_barcode_scanner|open_plan|log_meal\",\"label\":\"...\",\"params\":{}}]}",
							"actions é opcional, mas quando fizer sentido inclua 1–3 ações conectáveis ao app.",
							"TIPOS DE ACTION DISPONÍVEIS:",
							"- add_meals: Adiciona/substitui refeições na rotina. Use quando criar uma dieta/cardápio.",
							"- add_workout: Adiciona/substitui treinos na rotina. Use quando criar um treino.",
							"IMPORTANTE: Se o usuário pedir TANTO refeições QUANTO treinos na mesma mensagem (ex: '3 treinos e 2 refeições', 'crie uma dieta e um treino'), você DEVE gerar AMBAS as actions: uma 'add_meals' E uma 'add_workout'. Não gere apenas uma delas.",
							"- open_routine: Abre a tela de rotina.",
							"- open_nutrition: Abre a tela de nutrição.",
							"- open_barcode_scanner: Abre o scanner de código de barras.",
							"QUANDO CRIAR UMA DIETA/CARDÁPIO:",
							"1. Responda com as refeições no formato:",
							"   - Café da manhã (horário): descrição",
							"   - Lanche da manhã (horário): descrição",
							"   - Almoço (horário): descrição",
							"   - Lanche da tarde (horário): descrição",
							"   - Jantar (horário): descrição",
							"   - Ceia (horário): descrição",
							"2. Você DEVE gerar de 3 a 6 refeições por dia. O sistema suporta ATÉ 6 refeições. Se o usuário pedir '6 refeições', você DEVE incluir TODAS as 6: Café da manhã, Lanche da manhã, Almoço, Lanche da tarde, Jantar E Ceia. Se o usuário pedir um número específico (ex: '5 refeições', '6 refeições'), gere EXATAMENTE esse número SEM FALHAR.",
							"3. SEMPRE inclua uma action do tipo 'add_meals' com label 'Adicionar à Rotina'",
							"4. No params da action, inclua um array 'meals' com cada refeição contendo:",
							"   {title: 'Café da manhã', description: '...', startTime: '08:00', endTime: '08:30', calories: número, protein: número, carbs: número, fat: número}",
							"5. Tipos de refeições disponíveis: 'Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia'",
							"   IMPORTANTE: Para 6 refeições, você DEVE incluir TODAS as 6: Café da manhã, Lanche da manhã, Almoço, Lanche da tarde, Jantar E Ceia. Não pare em 5 refeições.",
							"6. CARDÁPIO VARIADO - Use uma grande variedade de alimentos e preparações (MÍNIMO 20 opções por tipo de refeição):",
							"   CAFÉ DA MANHÃ (20+ opções): Ovos mexidos com espinafre, ovos pochê, ovos cozidos, omelete de claras, omelete com queijo, aveia cozida com banana, aveia overnight com frutas, aveia com mel e canela, tapioca com ovo e queijo, tapioca com frango desfiado, tapioca com banana e canela, pão integral com cottage e peito de peru, pão integral com abacate e ovo, pão integral com requeijão, pão de forma com ovo e queijo, panqueca proteica de aveia e banana, panqueca de banana, waffle integral com frutas, crepioca com recheio doce, crepioca com recheio salgado, smoothie bowl de açaí, smoothie bowl de frutas, açaí com granola, iogurte grego com granola e mel, iogurte natural com frutas, pão de queijo com café, torrada francesa, pão doce integral, cereal integral com leite, mingau de aveia.",
							"   LANCHE DA MANHÃ (20+ opções): Iogurte grego com morangos, iogurte natural com granola, iogurte com sementes de chia, iogurte com frutas vermelhas, banana com canela, maçã verde, pera com canela, uvas verdes, mix de frutas frescas, mix de nuts (castanhas, amêndoas, nozes), castanhas do Pará, amêndoas, nozes, barra proteica caseira, barra proteica industrializada, ovo cozido, ovo de codorna, queijo minas, queijo cottage, queijo branco, smoothie verde (espinafre + banana), smoothie de frutas, biscoito integral com pasta de amendoim, torrada com homus, torrada com requeijão light, frutas secas (damasco, uva passa), sementes de girassol, sementes de abóbora, mix de sementes.",
							"   ALMOÇO (20+ opções): Frango grelhado com ervas, frango assado, frango à parmegiana light, frango xadrez, peito de frango desfiado, salmão grelhado, salmão ao forno, atum grelhado, tilápia grelhada, merluza assada, sardinha grelhada, carne grelhada (picanha magra, contrafilé, alcatra), carne assada, carne moída com abóbora, carne de panela, arroz integral, arroz branco, arroz de couve-flor, batata-doce assada, batata comum assada, purê de batata-doce, purê de batata comum, macarrão integral, macarrão com molho de tomate, quinoa cozida, mandioca cozida, purê de mandioca, brócolis no vapor, couve-flor grelhada, abobrinha grelhada, berinjela assada, abóbora assada, aspargos grelhados, couve refogada, espinafre refogado, salada de folhas verdes, salada de tomate e pepino, salada de rúcula, salada de agrião, salada de repolho roxo, salada de beterraba, feijão preto, feijão carioca, grão-de-bico, lentilha, feijão-fradinho.",
							"   LANCHE DA TARDE (20+ opções): Sanduíche integral com frango grelhado, sanduíche integral com atum, sanduíche integral com peito de peru, sanduíche integral com ovo, wrap de frango com vegetais, wrap de atum, wrap vegetariano, shake proteico de chocolate, shake proteico de baunilha, shake proteico com banana, shake de frutas, iogurte grego com granola, iogurte grego com mel, fruta com pasta de amendoim, banana com pasta de amendoim, maçã com pasta de amendoim, torrada com abacate amassado, torrada com homus, torrada com requeijão, biscoito de arroz com pasta de amendoim, biscoito integral com requeijão light, barra proteica, mix de frutas secas, smoothie de frutas vermelhas, smoothie verde, iogurte com frutas, queijo minas com mel, torrada com cream cheese, wrap de salmão, panqueca doce.",
							"   JANTAR (20+ opções): Salmão grelhado com ervas, salmão ao forno, peixe grelhado (tilápia, merluza), peixe assado, frango grelhado, frango ao forno, frango xadrez com legumes, omelete de claras com espinafre, omelete com legumes, omelete de 2-3 ovos, atum grelhado, atum ao forno, sopa de legumes com frango, sopa de legumes com peixe, salada completa com grão-de-bico, salada completa com atum, salada completa com frango, salada de folhas com proteína, purê de abóbora, purê de batata-doce, arroz de couve-flor, legumes salteados (brócolis, couve-flor, abobrinha), legumes grelhados, legumes no vapor, legumes assados, salada de rúcula com tomate, salada de agrião, salada de alface com pepino, couve refogada, espinafre refogado, abóbora assada, abobrinha grelhada, berinjela assada, aspargos grelhados, peito de peru grelhado, ovo mexido com legumes.",
							"   CEIA (20+ opções): Iogurte grego com frutas vermelhas, iogurte natural com mel, iogurte com granola, queijo cottage com morangos, queijo cottage com mel, queijo minas, chá de camomila com castanhas, chá de hortelã com amêndoas, chá verde com nozes, chá de erva-doce, chá de gengibre, leite morno com mel, leite morno com cacau em pó, leite morno com canela, kefir natural, kefir com frutas, frutas vermelhas (morango, framboesa, mirtilo), mix de sementes (chia, linhaça, girassol), castanhas do Pará, amêndoas, nozes, chá de camomila, chá de hortelã, chá de ervas, leite com mel e canela, iogurte com sementes de chia, queijo branco com mel, frutas secas, chá de gengibre com mel.",
							"   IMPORTANTE: Varie MUITO os alimentos, preparações e combinações. Não repita as mesmas refeições. Use diferentes tipos de proteínas, carboidratos, legumes e preparações (grelhado, assado, cozido, salteado, no vapor, refogado, etc.). Para cada dia da semana, escolha combinações DIFERENTES das listas acima.",
							"6. SE FOR DIETA PARA A SEMANA (dietPeriod === 'week'):",
							"   - Gere refeições DIFERENTES para cada dia da semana (segunda a domingo)",
							"   - Varie os alimentos, preparações e combinações para cada dia",
							"   - IMPORTANTE: Se o usuário pedir um número específico de refeições (ex: '6 refeições'), TODOS os 7 dias devem ter EXATAMENTE esse mesmo número de refeições. Não varie a quantidade entre os dias.",
							"   - No params da action, inclua um array 'weeklyMeals' com 7 objetos, um para cada dia:",
							"     [{date: 'YYYY-MM-DD', meals: [...]}, {date: 'YYYY-MM-DD', meals: [...]}, ...]",
							"   - Cada dia deve ter alimentos e preparações diferentes, mas o NÚMERO de refeições deve ser o MESMO em todos os dias",
							"QUANDO CRIAR UM TREINO:",
							"1. Responda com os treinos no formato curto",
							"2. Você pode gerar de 1 a 5 treinos por dia. Se o usuário pedir um número específico (ex: '3 treinos', '2 treinos'), gere EXATAMENTE esse número. NÃO gere mais do que o solicitado. Se pediu 2 treinos, gere 2, não 3. Se pediu 3 treinos, gere 3, não 4.",
							"3. SEMPRE inclua uma action do tipo 'add_workout' com label 'Adicionar à Rotina'",
							"4. Para UM DIA: No params da action, inclua um array 'workouts' com cada treino contendo:",
							"   {title: 'Nome do treino', focus: 'CONTEÚDO COMPLETO DO TREINO (aquecimento, exercícios principais, desaceleração, etc.)', startTime: '18:00', endTime: '19:00', intensity: 'moderada'}",
							"   IMPORTANTE: O campo 'focus' deve conter TODAS as informações detalhadas do treino (aquecimento, exercícios principais, séries, repetições, desaceleração, alongamento, etc.), não apenas o título do foco. Inclua tudo que o usuário precisa saber para executar o treino.",
							"5. Para A SEMANA INTEIRA: No params da action, inclua um array 'weeklyWorkouts' com 7 objetos, um para cada dia:",
							"   [{date: 'YYYY-MM-DD', workouts: [...]}, {date: 'YYYY-MM-DD', workouts: [...]}, ...]",
							"   - Cada dia deve ter treinos diferentes, mas o NÚMERO de treinos deve ser o MESMO em todos os dias",
							"   - CRÍTICO E OBRIGATÓRIO: Se o usuário pedir um número específico de treinos (ex: '3 treinos'), TODOS os 7 dias devem ter EXATAMENTE esse mesmo número de treinos. NÃO varie a quantidade entre os dias. NÃO gere 2 treinos em um dia e 3 em outro. TODOS os dias devem ter a MESMA quantidade.",
							userContextText ? userContextText : "",
							routineContextText ? routineContextText : "",
							wantsTodayDiet ? "IMPORTANTE: O usuário pediu dieta para HOJE. Siga o formato curto obrigatório e SEMPRE inclua a action 'add_meals'." : "",
							dietPeriod === "week" ? `IMPORTANTE: O usuário pediu dieta para A SEMANA INTEIRA. Gere refeições DIFERENTES para cada dia (segunda a domingo), variando alimentos e preparações. Use o formato 'weeklyMeals' no params da action. Datas da semana: ${getWeekDates().join(", ")}. Cada objeto no array weeklyMeals deve ter: {date: 'YYYY-MM-DD', meals: [...]}. ${validMealsCount ? `CRÍTICO: TODOS os 7 dias devem ter EXATAMENTE ${validMealsCount} refeições cada. Não varie a quantidade entre os dias.` : ''}` : "",
							dietPeriod === "week" && wantsBothMealsAndWorkouts ? `IMPORTANTE: O usuário pediu treino para A SEMANA INTEIRA. Gere treinos DIFERENTES para cada dia (segunda a domingo), variando os tipos de treino. Use o formato 'weeklyWorkouts' no params da action 'add_workout'. Datas da semana: ${getWeekDates().join(", ")}. Cada objeto no array weeklyWorkouts deve ter: {date: 'YYYY-MM-DD', workouts: [...]}. ${validWorkoutsCount ? `CRÍTICO ABSOLUTO: TODOS os 7 dias devem ter EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada. NÃO varie a quantidade entre os dias. NÃO gere ${validWorkoutsCount - 1} treinos em alguns dias e ${validWorkoutsCount} em outros. Verifique cada dia antes de finalizar: dia 1 = ${validWorkoutsCount} treinos, dia 2 = ${validWorkoutsCount} treinos, dia 3 = ${validWorkoutsCount} treinos, dia 4 = ${validWorkoutsCount} treinos, dia 5 = ${validWorkoutsCount} treinos, dia 6 = ${validWorkoutsCount} treinos, dia 7 = ${validWorkoutsCount} treinos.` : ''}` : "",
							dietPeriod === "week" && /treino|exerc[ií]cio|treinar|muscula[cç][aã]o/i.test(lastUser) && !/(?:dieta|refei[cç][aã]o|card[aá]pio)/i.test(lastUser) ? `IMPORTANTE: O usuário pediu treino para A SEMANA INTEIRA. Gere treinos DIFERENTES para cada dia (segunda a domingo), variando os tipos de treino. Use o formato 'weeklyWorkouts' no params da action 'add_workout'. Datas da semana: ${getWeekDates().join(", ")}. Cada objeto no array weeklyWorkouts deve ter: {date: 'YYYY-MM-DD', workouts: [...]}. ${validWorkoutsCount ? `CRÍTICO ABSOLUTO: TODOS os 7 dias devem ter EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada. NÃO varie a quantidade entre os dias. NÃO gere ${validWorkoutsCount - 1} treinos em alguns dias e ${validWorkoutsCount} em outros. Verifique cada dia antes de finalizar: dia 1 = ${validWorkoutsCount} treinos, dia 2 = ${validWorkoutsCount} treinos, dia 3 = ${validWorkoutsCount} treinos, dia 4 = ${validWorkoutsCount} treinos, dia 5 = ${validWorkoutsCount} treinos, dia 6 = ${validWorkoutsCount} treinos, dia 7 = ${validWorkoutsCount} treinos.` : ''}` : "",
							dietPeriod === "custom" && customPeriod ? `IMPORTANTE: O usuário pediu dieta para ${customPeriod.value} ${customPeriod.type === "days" ? (customPeriod.value === 1 ? "dia" : "dias") : customPeriod.type === "weeks" ? (customPeriod.value === 1 ? "semana" : "semanas") : (customPeriod.value === 1 ? "mês" : "meses")}. Gere refeições DIFERENTES para cada dia, variando alimentos e preparações. Use o formato 'weeklyMeals' no params da action. Datas do período: ${getCustomPeriodDates(customPeriod.type, customPeriod.value).join(", ")}. Cada objeto no array weeklyMeals deve ter: {date: 'YYYY-MM-DD', meals: [...]}` : "",
							dietPeriod === "day" ? (mealToReplace ? `CRÍTICO: O usuário pediu para substituir APENAS o "${mealToReplace}". Você DEVE:
1. Gerar APENAS UMA refeição no array 'meals' da action 'add_meals' com title="${mealToReplace}"
2. Na sua resposta de texto, mostrar APENAS essa refeição substituída, não todas as refeições do dia
3. Não liste outras refeições (café da manhã, almoço, etc.) - apenas o ${mealToReplace.toLowerCase()} que está sendo substituído
4. Esta refeição substituirá apenas o ${mealToReplace.toLowerCase()} existente, não todas as refeições do dia.` : "IMPORTANTE: O usuário pediu dieta para HOJE. Siga o formato curto obrigatório e SEMPRE inclua a action 'add_meals'.") : "",
							dietPeriod === "day" && workoutToReplace ? `CRÍTICO: O usuário pediu para substituir APENAS o treino "${workoutToReplace}". Você DEVE:
1. Gerar APENAS UM treino no array 'workouts' da action 'add_workout' com title="${workoutToReplace}"
2. Na sua resposta de texto, mostrar APENAS esse treino substituído, não todos os treinos do dia
3. Não liste outros treinos - apenas o treino "${workoutToReplace}" que está sendo substituído
4. Este treino substituirá apenas o treino "${workoutToReplace}" existente, não todos os treinos do dia.` : "",
							dietPeriod === "day" && workoutToReplace === null ? `IMPORTANTE: O usuário pediu treino para HOJE e quer SUBSTITUIR TODOS os treinos. Gere MÚLTIPLOS treinos (2-5 treinos) no array 'workouts' da action 'add_workout' para substituir todos os treinos existentes do dia.` : "",
							validMealsCount && validWorkoutsCount && !mealToReplace && !workoutToReplace ? `🚨🚨🚨 CRÍTICO ABSOLUTO - LEIA COM MUITA ATENÇÃO: O usuário pediu EXATAMENTE ${validMealsCount} refeições E EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''}. Você DEVE gerar AMBAS as actions: 'add_meals' com EXATAMENTE ${validMealsCount} refeições E 'add_workout' com EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''}. NÃO gere menos. NÃO gere mais. ${validMealsCount === 4 ? 'Para 4 refeições, inclua: 1) Café da manhã, 2) Almoço, 3) Lanche da tarde, 4) Jantar.' : validMealsCount === 3 ? 'Para 3 refeições, inclua: 1) Café da manhã, 2) Almoço, 3) Jantar.' : ''} ${dietPeriod === "week" || dietPeriod === "custom" ? `CRÍTICO: Se for para múltiplos dias, TODOS os dias devem ter EXATAMENTE ${validMealsCount} refeições E EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada.` : ''}` : "",
							validMealsCount && !mealToReplace ? `🚨 CRÍTICO E OBRIGATÓRIO - LEIA COM ATENÇÃO: O usuário pediu EXATAMENTE ${validMealsCount} refeições. Você DEVE gerar ${validMealsCount} refeições no array 'meals' da action 'add_meals'. NÃO gere menos que ${validMealsCount}. NÃO pare antes de gerar todas as ${validMealsCount} refeições. Use os tipos de refeições disponíveis: 'Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia'. ${validMealsCount === 6 ? 'Para 6 refeições, você DEVE incluir TODAS as 6 SEM EXCEÇÃO: 1) Café da manhã, 2) Lanche da manhã, 3) Almoço, 4) Lanche da tarde, 5) Jantar, 6) Ceia. NÃO pare em 4 ou 5 refeições. Gere as 6 COMPLETAS.' : validMealsCount === 5 ? 'Para 5 refeições, inclua: 1) Café da manhã, 2) Lanche da manhã, 3) Almoço, 4) Lanche da tarde, 5) Jantar.' : validMealsCount === 4 ? 'Para 4 refeições, inclua: 1) Café da manhã, 2) Almoço, 3) Lanche da tarde, 4) Jantar.' : 'Para 3 refeições, inclua: 1) Café da manhã, 2) Almoço, 3) Jantar.'} ${dietPeriod === "week" || dietPeriod === "custom" ? `CRÍTICO: Se for para múltiplos dias (semana ou período customizado), TODOS os dias devem ter EXATAMENTE ${validMealsCount} refeições cada. Não varie a quantidade entre os dias.` : ''}` : "",
							validWorkoutsCount && !workoutToReplace ? `🚨 CRÍTICO E OBRIGATÓRIO - LEIA COM MUITA ATENÇÃO: O usuário pediu EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''}. Você DEVE gerar EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} no array 'workouts' da action 'add_workout'. NÃO gere menos que ${validWorkoutsCount}. NÃO gere mais que ${validWorkoutsCount}. Se o usuário pediu ${validWorkoutsCount} treinos, gere EXATAMENTE ${validWorkoutsCount}, nem mais nem menos. ${dietPeriod === "week" || dietPeriod === "custom" ? `CRÍTICO ABSOLUTO: Se for para múltiplos dias (semana ou período customizado), TODOS os dias devem ter EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada. NÃO varie a quantidade entre os dias. NÃO gere ${validWorkoutsCount - 1} treinos em alguns dias e ${validWorkoutsCount} em outros. NÃO gere ${validWorkoutsCount + 1} treinos em alguns dias. TODOS os dias devem ter EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada, sem exceção.` : ''}` : "",
							wantsBothMealsAndWorkouts ? "IMPORTANTE: O usuário pediu TANTO refeições QUANTO treinos. Você DEVE gerar AMBAS as actions: 'add_meals' E 'add_workout'. Não gere apenas uma delas." : "",
							isAdjustingSingleMeal ? "IMPORTANTE: O usuário está ajustando UMA REFEIÇÃO ESPECÍFICA. Gere APENAS UMA refeição no array 'meals' da action 'add_meals'. Esta refeição substituirá apenas a refeição mencionada, não todas as refeições do dia." : "",
							isAdjustingSingleWorkout ? "IMPORTANTE: O usuário está ajustando UM TREINO ESPECÍFICO. Gere APENAS UM treino no array 'workouts' da action 'add_workout'. Este treino substituirá apenas o treino mencionado, não todos os treinos do dia." : "",
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
		
		// Log detalhado das ações geradas e validação/correção
		if (actions && Array.isArray(actions)) {
			actions.forEach((action, idx) => {
				if (action.type === "add_meals") {
					if (action.params?.meals) {
						const mealsCount = Array.isArray(action.params.meals) ? action.params.meals.length : 0;
						console.log(`[CHAT/BACKEND] Action ${idx} (add_meals): ${mealsCount} meals generated`);
						if (validMealsCount && mealsCount !== validMealsCount) {
							console.warn(`[CHAT/BACKEND] WARNING: Expected ${validMealsCount} meals but got ${mealsCount}. Correcting...`);
							// Corrigir: manter apenas o número solicitado
							if (mealsCount > validMealsCount) {
								action.params.meals = action.params.meals.slice(0, validMealsCount);
								console.log(`[CHAT/BACKEND] CORRECTED: Reduced meals from ${mealsCount} to ${validMealsCount}`);
							} else if (mealsCount < validMealsCount) {
								console.error(`[CHAT/BACKEND] ERROR: Only ${mealsCount} meals generated but ${validMealsCount} requested. Cannot auto-fix, but logging error.`);
							}
						}
					}
					if (action.params?.weeklyMeals) {
						console.log(`[CHAT/BACKEND] Action ${idx} (add_meals): ${action.params.weeklyMeals.length} days with weekly meals`);
						action.params.weeklyMeals.forEach((day: any, i: number) => {
							const mealsCount = Array.isArray(day.meals) ? day.meals.length : 0;
							if (validMealsCount && mealsCount !== validMealsCount) {
								console.warn(`[CHAT/BACKEND] WARNING: Day ${i + 1} (${day.date}) expected ${validMealsCount} meals but got ${mealsCount}. Correcting...`);
								// Corrigir: manter apenas o número solicitado
								if (mealsCount > validMealsCount) {
									day.meals = day.meals.slice(0, validMealsCount);
									console.log(`[CHAT/BACKEND] CORRECTED: Day ${i + 1} reduced meals from ${mealsCount} to ${validMealsCount}`);
								} else if (mealsCount < validMealsCount) {
									console.error(`[CHAT/BACKEND] ERROR: Day ${i + 1} only has ${mealsCount} meals but ${validMealsCount} requested. Cannot auto-fix, but logging error.`);
								}
							}
						});
					}
				}
				if (action.type === "add_workout") {
					if (action.params?.workouts) {
						const workoutsCount = Array.isArray(action.params.workouts) ? action.params.workouts.length : 0;
						console.log(`[CHAT/BACKEND] Action ${idx} (add_workout): ${workoutsCount} workouts generated`);
						if (validWorkoutsCount && workoutsCount !== validWorkoutsCount) {
							console.warn(`[CHAT/BACKEND] WARNING: Expected ${validWorkoutsCount} workouts but got ${workoutsCount}. Correcting...`);
							// Corrigir: manter apenas o número solicitado
							if (workoutsCount > validWorkoutsCount) {
								action.params.workouts = action.params.workouts.slice(0, validWorkoutsCount);
								console.log(`[CHAT/BACKEND] CORRECTED: Reduced workouts from ${workoutsCount} to ${validWorkoutsCount}`);
							} else if (workoutsCount < validWorkoutsCount) {
								console.error(`[CHAT/BACKEND] ERROR: Only ${workoutsCount} workouts generated but ${validWorkoutsCount} requested. Cannot auto-fix, but logging error.`);
							}
						}
					}
					if (action.params?.weeklyWorkouts) {
						console.log(`[CHAT/BACKEND] Action ${idx} (add_workout): ${action.params.weeklyWorkouts.length} days with weekly workouts`);
						action.params.weeklyWorkouts.forEach((day: any, i: number) => {
							const workoutsCount = Array.isArray(day.workouts) ? day.workouts.length : 0;
							if (validWorkoutsCount && workoutsCount !== validWorkoutsCount) {
								console.warn(`[CHAT/BACKEND] WARNING: Day ${i + 1} (${day.date}) expected ${validWorkoutsCount} workouts but got ${workoutsCount}. Correcting...`);
								// Corrigir: manter apenas o número solicitado
								if (workoutsCount > validWorkoutsCount) {
									day.workouts = day.workouts.slice(0, validWorkoutsCount);
									console.log(`[CHAT/BACKEND] CORRECTED: Day ${i + 1} reduced workouts from ${workoutsCount} to ${validWorkoutsCount}`);
								} else if (workoutsCount < validWorkoutsCount) {
									console.error(`[CHAT/BACKEND] ERROR: Day ${i + 1} only has ${workoutsCount} workouts but ${validWorkoutsCount} requested. Cannot auto-fix, but logging error.`);
								}
							}
						});
					}
				}
			});
		}

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

