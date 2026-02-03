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
		
		// Detectar se o usuário pediu tanto refeições quanto treinos (inclui plural: refeições, treinos; trocar/substituir)
		const wantsBothMealsAndWorkouts = /(?:dieta|refei[cç][aã]o|refei[cç][oõ]es|card[aá]pio|alimenta[cç][aã]o).*(?:treino|treinos|exerc[ií]cio|exerc[ií]cios|treinar|muscula[cç][aã]o)|(?:treino|treinos|exerc[ií]cio|exerc[ií]cios|treinar|muscula[cç][aã]o).*(?:dieta|refei[cç][aã]o|refei[cç][oõ]es|card[aá]pio|alimenta[cç][aã]o)/i.test(lastUser);
		
		// Detectar número específico de refeições pedido pelo usuário (qualquer número: 1 a 10)
		// Padrões: "5 refeições", "2 refeições", "com 1 refeição", "quero 6 refeições", etc.
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
				if (num >= 1 && num <= 10) {
					requestedMealsCount = num;
					break;
				}
			}
		}
		// Cardápio maior / completo: gerar 6 refeições (máximo)
		if (requestedMealsCount == null && /(?:card[aá]pio\s*(?:maior|completo|grande)|menu\s*(?:completo|maior|grande)|dieta\s*completa|refei[cç][oõ]es\s*completas|todas\s*as\s*refei[cç][oõ]es|6\s*refei[cç][oõ]es)/i.test(lastUser)) {
			requestedMealsCount = 6;
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
		// Usuário já disse "hoje" ou "para hoje" na mesma mensagem em que pediu refeições e/ou treinos
		const userSaidToday = /\b(para\s+)?hoje\b/i.test(lastUser);
		// Vegano/vegetariano: verificar em TODA a conversa (qualquer mensagem do usuário)
		// Assim que a pessoa disser que é vegana/vegetariana, a IA deve sempre usar só alimentação correspondente
		const allUserText = trimmedMessages
			.filter((m) => m.role === "user")
			.map((m) => (m.content || "").trim())
			.join(" ");
		const veganVegetarianPattern = /(?:sou|eu\s+sou|sou\s+uma?\s+|minha\s+dieta\s+é|sigo\s+(?:dieta\s+)?|sou\s+de\s+dieta\s+)?(vegano|vegana|vegetariano|vegetariana|vegetarian[ao])|sem\s+carne|sem\s+proteína\s+animal|plant[ae]?[\s\-]?based|não\s+como\s+carne/i;
		let wantsVeganOrVegetarian = veganVegetarianPattern.test(allUserText);
		// Se disse "vegano/vegana" especificamente, é vegan (sem ovos/laticínios); caso contrário vegetariano pode ter ovos e laticínios
		let userIsStrictlyVegan = /\bvegano\b|\bvegana\b|plant[ae]?[\s\-]?based|sem\s+nenhum\s+produto\s+animal/i.test(allUserText);

		let userContextText = "";
		if (userId) {
			try {
				const onboarding = await prisma.onboarding.findUnique({ where: { userId } });
				if (onboarding) {
					// Onboarding: tipo de dieta (vegano/vegetariano) vale para TODAS as respostas de alimentação
					const dietType = (onboarding.dietType || "").toLowerCase();
					if (dietType === "vegan" || dietType === "vegetarian") {
						wantsVeganOrVegetarian = true;
						userIsStrictlyVegan = dietType === "vegan";
					}
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
						`- Tipo de dieta (do onboarding): ${dietType === "vegan" ? "Vegano" : dietType === "vegetarian" ? "Vegetariano" : onboarding.dietType ?? "—"}`,
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
							"REGRA DE VARIEDADE (OBRIGATÓRIA): NUNCA repita a mesma refeição ou combinação. Para CADA refeição do cardápio você DEVE escolher uma opção DIFERENTE da lista. No MESMO dia: não use a mesma proteína principal em duas refeições (ex: se Almoço é frango grelhado, Jantar deve ser peixe, carne, ovo ou vegetariano - não frango de novo). Varie também preparações: grelhado, assado, cozido, salteado. Entre dias da semana: cada dia deve ter pratos e combinações totalmente diferentes.",
							"1. Responda com as refeições no formato:",
							"   - Café da manhã (horário): descrição",
							"   - Lanche da manhã (horário): descrição",
							"   - Almoço (horário): descrição",
							"   - Lanche da tarde (horário): descrição",
							"   - Jantar (horário): descrição",
							"   - Ceia (horário): descrição",
							"2. Você pode gerar de 1 a 6 refeições por dia (ou o número que o usuário pedir). Se o usuário pedir um número específico (ex: '2 refeições', '4 refeições', '6 refeições'), gere EXATAMENTE esse número SEM FALHAR. Se não especificar, use entre 3 e 6 conforme fizer sentido.",
							"3. SEMPRE inclua uma action do tipo 'add_meals' com label 'Adicionar à Rotina'",
							"4. No params da action, inclua um array 'meals' com cada refeição contendo:",
							"   {title: 'Café da manhã', description: '...', startTime: '08:00', endTime: '08:30', calories: número, protein: número, carbs: número, fat: número}",
							"5. Tipos de refeições disponíveis: 'Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia'. Use os que forem necessários para o número pedido (ex: 1 refeição = um tipo; 6 refeições = todos os 6).",
							"6. CARDÁPIO VARIADO - Use MUITA variedade. Escolha SEMPRE desta lista ampliada (150+ opções por tipo) para gerar refeições para as rotinas:",
							"   CAFÉ DA MANHÃ: Ovos mexidos com espinafre, ovos pochê, ovos cozidos, omelete de claras, omelete com queijo e tomate, omelete com cogumelos, aveia cozida com banana, aveia overnight com frutas, aveia com mel e canela, aveia com whey e frutas vermelhas, tapioca com ovo e queijo, tapioca com frango desfiado, tapioca com banana e canela, tapioca com cottage, pão integral com cottage e peito de peru, pão integral com abacate e ovo, pão integral com requeijão e tomate, pão de forma com ovo e queijo, pão sírio com homus e ovo, panqueca proteica de aveia e banana, panqueca de banana e canela, panqueca de aveia com mel, waffle integral com frutas, waffle com mel, crepioca com recheio doce, crepioca com queijo e tomate, smoothie bowl de açaí, smoothie bowl de frutas, açaí com granola e banana, iogurte grego com granola e mel, iogurte natural com frutas e mel, iogurte com chia e frutas vermelhas, pão de queijo com café, torrada francesa, pão doce integral com manteiga, cereal integral com leite, mingau de aveia com canela, mamão com granola e mel, melão com queijo branco, melancia com hortelã, vitamina de banana com aveia, vitamina de abacate, café com leite e pão integral, capuccino com torrada integral, bolo de caneca fit (aveia e banana), muffin integral de banana, cookie de aveia e banana, granola caseira com iogurte, müsli com leite e frutas, creme de amendoim com banana, pasta de amendoim com pão integral e banana, crepioca com frango e catupiry, tapioca com ovos e queijo coalho, pão integral com ovo pochê e rúcula, pão com cream cheese e salmão defumado, omelete de queijo e espinafre, ovos benedict light, bagel integral com cream cheese e salmão, panqueca americana com mel e frutas, french toast integral, croissant integral com presunto e queijo, bolo de cenoura fit, pão de batata doce com queijo, cuscuz com ovo e queijo, tapioca com atum e requeijão, smoothie de café com banana e aveia, bowl de granola com iogurte e frutas vermelhas, pão australiano com abacate e ovo, banana bread fit, torta de frango light, empada de frango integral.",
							"   LANCHE DA MANHÃ: Iogurte grego com morangos, iogurte natural com granola, iogurte com chia e mel, iogurte com frutas vermelhas, banana com canela, maçã verde, pera com canela, uvas verdes, kiwi, manga, mamão, melão, melancia, mix de frutas frescas, mix de nuts (castanhas, amêndoas, nozes), castanhas do Pará, amêndoas, nozes, macadâmia, barra proteica caseira, barra proteica industrializada, ovo cozido, ovo de codorna, queijo minas, queijo cottage com mel, queijo branco, queijo coalho light, smoothie verde (espinafre + banana), smoothie de frutas, smoothie de morango com aveia, biscoito integral com pasta de amendoim, torrada com homus, torrada com requeijão light, torrada com abacate, frutas secas (damasco, uva passa, tâmaras), sementes de girassol, sementes de abóbora, mix de sementes (chia, linhaça), palitinhos de cenoura com homus, pepino com sal e limão, tomate cereja com queijo, bolinho de chuva fit, cookie integral, brownie de batata-doce, cenoura baby com homus, aipo com pasta de amendoim, mix de berries (morango, mirtilo, framboesa), laranja, tangerina, mexerica, goiaba, abacaxi em cubos, coco fresco.",
							"   ALMOÇO: Frango grelhado com ervas, frango assado com limão, frango à parmegiana light, frango xadrez com legumes, peito de frango desfiado, frango ao curry, frango com brócolis, coxa de frango assada, salmão grelhado, salmão ao forno com ervas, salmão com aspargos, atum grelhado, atum ao forno, tilápia grelhada, tilápia à milanesa light, merluza assada, merluza ao molho de maracujá, sardinha grelhada, bacalhau ao forno, camarão grelhado, polvo grelhado, carne grelhada (picanha magra, contrafilé, alcatra), carne assada, carne moída com abóbora, carne de panela, bife acebolado, costela magra assada, fígado com cebola, moqueca de peixe, moqueca de camarão, strogonoff de frango light, arroz integral, arroz branco, arroz de couve-flor, arroz com brócolis, arroz negro, arroz arbório com legumes, batata-doce assada, batata comum assada, batata baroa, purê de batata-doce, purê de batata comum, purê de mandioquinha, macarrão integral, macarrão com molho de tomate, macarrão alho e óleo, espaguete com frango e legumes, quinoa cozida, quinoa com legumes, cuscuz marroquino, mandioca cozida, purê de mandioca, inhame assado, brócolis no vapor, couve-flor grelhada, couve-flor gratinada light, abobrinha grelhada, berinjela assada, abóbora assada, abóbora com frango, aspargos grelhados, couve refogada, espinafre refogado, repolho refogado, salada de folhas verdes, salada de tomate e pepino, salada de rúcula com parmesão, salada de agrião, salada de repolho roxo, salada de beterraba, salada caprese, salada de grão-de-bico, feijão preto, feijão carioca, feijão branco, grão-de-bico, lentilha, lentilha com legumes, feijão-fradinho, ervilha, vagem refogada, cenoura cozida, chuchu refogado, quiabo refogado, maxixe, couve à mineira, acelga refogada, frango ao molho mostarda e mel, frango com legumes no vapor, peixe ao molho de alcaparras, filé de frango à milanesa light, medalhão de frango com molho de ervas, lombo assado com batata, peru assado com salada, frango desfiado com abacate, salmão com crosta de gergelim, atum com gergelim e soja, camarão ao alho e óleo, risoto de frango com aspargos, risoto de cogumelos com frango, nhoque de batata doce com frango, canelone de frango com espinafre, lasanha de frango light, torta de frango com massa integral, frango com banana da terra, peixe com purê de inhame, bife de peru grelhado, almôndega de carne magra ao molho, escondidinho de carne com batata doce, bobó de frango, galinha ao curry com arroz, frango com quiabo, caldo de feijão com carne magra, sopa de frango com legumes, canja com arroz, creme de espinafre com frango, salada de frango com abacate, salada de salmão com quinoa, poke de atum com edamame, bowl de frango com arroz e legumes.",
							"   LANCHE DA TARDE: Sanduíche integral com frango grelhado, sanduíche integral com atum, sanduíche integral com peito de peru, sanduíche integral com ovo e alface, sanduíche de cottage com tomate, wrap de frango com vegetais, wrap de atum, wrap vegetariano com homus, wrap de salmão com cream cheese, shake proteico de chocolate, shake proteico de baunilha, shake proteico com banana, shake de frutas, shake verde com abacate, iogurte grego com granola, iogurte grego com mel e nozes, fruta com pasta de amendoim, banana com pasta de amendoim, maçã com pasta de amendoim, torrada com abacate amassado, torrada com homus, torrada com requeijão, torrada com cream cheese, biscoito de arroz com pasta de amendoim, biscoito integral com requeijão light, barra proteica, mix de frutas secas, smoothie de frutas vermelhas, smoothie verde, iogurte com frutas, queijo minas com mel, panqueca doce, bolo de fubá light, cookie de aveia, pipoca (sem excesso de manteiga), edamame com sal, hummus com palitos de vegetais, guacamole com chips de batata-doce, ceviche de tilápia, carpaccio de salmão, bruschetta integral, torrada com tomate e manjericão, pão de batata-doce com queijo, crepe de aveia com frutas, tapioca doce com banana e canela, açaí na tigela, bowl de frutas com granola.",
							"   JANTAR: Salmão grelhado com ervas, salmão ao forno, salmão com legumes, peixe grelhado (tilápia, merluza), peixe assado com limão, filé de peixe ao molho de maracujá, frango grelhado, frango ao forno, frango xadrez com legumes, frango com curry e legumes, omelete de claras com espinafre, omelete com legumes, omelete de 2-3 ovos com queijo, atum grelhado, atum ao forno, atum com salada, sopa de legumes com frango, sopa de abóbora, sopa de lentilha, sopa de feijão, canja, salada completa com grão-de-bico, salada completa com atum, salada completa com frango, salada de folhas com proteína, salada de quinoa com legumes, purê de abóbora, purê de batata-doce, arroz de couve-flor, legumes salteados (brócolis, couve-flor, abobrinha), legumes grelhados, legumes no vapor, legumes assados, salada de rúcula com tomate, salada de agrião, salada de alface com pepino, couve refogada, espinafre refogado, abóbora assada, abobrinha grelhada, berinjela assada, aspargos grelhados, peito de peru grelhado, ovo mexido com legumes, creme de espinafre com ovo poché, risoto de frango light, macarrão de abobrinha com molho de tomate, zoodle com frango, lasanha de berinjela light, torta de frango com massa de batata-doce, escondidinho de carne com batata-doce, bobó de camarão light, frango ao molho de laranja, peixe à grega, medalhão de salmão com vegetais, frango com cogumelos, camarão ao curry, carne moída com abobrinha, frango com purê de mandioquinha, salmão com legumes assados, atum com quinoa e abacate, sopa de frango com inhame, creme de abóbora com frango, frango em tiras com pimentão, peixe ao forno com tomate e manjericão, omelete recheada com frango e legumes, wrap de frango com salada, bowl de salmão com arroz e brócolis, frango com batata baroa assada, peixe com salada de grão-de-bico.",
							"   CEIA: Iogurte grego com frutas vermelhas, iogurte natural com mel, iogurte com granola, queijo cottage com morangos, queijo cottage com mel, queijo minas, queijo branco com mel, chá de camomila com castanhas, chá de hortelã com amêndoas, chá verde com nozes, chá de erva-doce, chá de gengibre, chá de canela, leite morno com mel, leite morno com cacau em pó, leite morno com canela, kefir natural, kefir com frutas, frutas vermelhas (morango, framboesa, mirtilo), mix de sementes (chia, linhaça, girassol), castanhas do Pará, amêndoas, nozes, chá de camomila, chá de hortelã, chá de ervas, leite com mel e canela, iogurte com sementes de chia, frutas secas, chá de gengibre com mel, banana com canela, maçã assada com canela, pera com queijo, uvas com queijo branco, smoothie de banana e aveia, vitamina de abacate, leite dourado (cúrcuma), chocolate quente fit, pudim de chia, mousse de maracujá light, gelatina com frutas, sorvete de banana (nice cream), picolé de frutas natural.",
							"   CRÍTICO - VARIEDADE: Para CADA refeição que você gerar, escolha uma opção DIFERENTE da lista acima. NÃO use 'frango grelhado' em duas refeições do mesmo dia. NÃO use 'aveia com banana' no café e 'aveia com mel' no lanche do mesmo dia - escolha categorias distintas (ex: café = panqueca, lanche = iogurte). Em um cardápio de 6 refeições no mesmo dia, você DEVE ter 6 descrições completamente diferentes, com proteínas e preparos variados (ex: ovos no café, iogurte no lanche manhã, frango no almoço, atum no lanche tarde, peixe no jantar, queijo na ceia).",
							"7. CARDÁPIO VEGANO E VEGETARIANO - Quando o usuário pedir dieta vegana ou vegetariana, use ESTAS opções (100+ refeições):",
							"   CAFÉ VEGANO/VEGETARIANO: Aveia cozida com banana e canela, aveia overnight com frutas e chia, aveia com mel e nozes, mingau de aveia vegano, tapioca com banana e canela, tapioca com pasta de amendoim, tapioca com homus e tomate, panqueca de aveia e banana (sem ovo), panqueca de banana vegana, waffle de aveia com frutas, crepioca doce com banana, smoothie bowl de açaí com granola, smoothie bowl de frutas vermelhas, açaí com granola e banana, iogurte vegetal (soja/coco/amêndoas) com granola, iogurte vegetal com frutas, iogurte vegetal com chia, pão integral com homus e pepino, pão integral com abacate e tomate, pão integral com pasta de amendoim e banana, pão sírio com homus e alface, torrada com abacate e limão, torrada com homus, cereal integral com leite vegetal, mamão com granola e mel, melancia com hortelã, vitamina de banana com aveia (leite vegetal), vitamina de abacate vegana, café com leite vegetal e pão integral, bolo de caneca vegano (aveia e banana), muffin de aveia e banana vegano, cookie de aveia vegano, granola com iogurte vegetal, müsli com leite de aveia, creme de amendoim com banana, pasta de amendoim com pão e banana, smoothie verde (espinafre, banana, leite vegetal), smoothie de morango com banana, creme de cacau com abacate, pudim de chia com leite vegetal, frutas frescas com sementes, mamão com linhaça, melão com sementes de girassol, goiaba com chia, abacaxi com hortelã, bowl de frutas com granola e mel.",
							"   LANCHE MANHÃ VEGANO: Iogurte vegetal com morangos, iogurte vegetal com granola, banana com pasta de amendoim, maçã com canela, pera, uvas, kiwi, manga, mamão, melão, melancia, mix de frutas, castanhas do Pará, amêndoas, nozes, castanha de caju, mix de nuts, barra de frutas secas, smoothie verde vegano, smoothie de frutas, biscoito integral com homus, torrada com abacate, frutas secas (damasco, tâmara, uva passa), sementes de girassol, sementes de abóbora, mix chia e linhaça, palitinhos de cenoura com homus, pepino com limão, tomate cereja com manjericão, cookie integral vegano, cenoura baby com homus, aipo com pasta de amendoim, mix de berries, laranja, tangerina, goiaba, abacaxi, coco fresco, edamame, bolinho de chuva vegano, banana assada com canela.",
							"   ALMOÇO VEGANO/VEGETARIANO: Grão-de-bico refogado com legumes, grão-de-bico ao curry, lentilha com legumes, lentilha ao curry, feijão preto com arroz e couve, feijão carioca com abóbora, falafel com homus e salada, falafel assado com tahine, tofu grelhado com legumes, tofu ao curry, tofu mexido com legumes, tempeh grelhado, tempeh ao molho de soja, seitán grelhado com ervas, hambúrguer de grão-de-bico, hambúrguer de lentilha, hambúrguer de feijão preto, hambúrguer de beterraba e quinoa, cogumelos salteados com alho, cogumelo shiitake grelhado, cogumelo paris ao molho, stroganoff de cogumelos, strogonoff de grão-de-bico, abóbora assada com grão-de-bico, berinjela à parmegiana (sem queijo ou com vegano), berinjela recheada com quinoa, berinjela grelhada com tahine, espaguete ao molho de tomate com lentilha, macarrão com legumes salteados, macarrão com pesto de manjericão (sem parmesão), macarrão com molho de castanha de caju, risoto de cogumelos, risoto de abóbora, risoto de aspargos, quinoa com legumes e castanhas, quinoa com abacate e feijão preto, cuscuz com grão-de-bico e legumes, tabule (trigo, pepino, tomate, hortelã), bowl de quinoa com grão-de-bico e tahine, bowl Buddha (arroz, legumes, tofu, tahine), salada de grão-de-bico com tahine, salada de lentilha com hortelã, salada de quinoa com abacate, salada de folhas com falafel, salada de tabule, sopa de lentilha, sopa de abóbora com gengibre, sopa de feijão com legumes, sopa de legumes e quinoa, moqueca de banana da terra (sem peixe), feijoada vegetariana (com legumes e tofu), arroz integral com feijão e couve, arroz com lentilha e cenoura, purê de batata-doce com grão-de-bico, legumes no vapor com tahine, brócolis grelhado com alho, couve-flor assada com curry, abobrinha recheada com quinoa, espinafre refogado com alho, couve refogada com limão, acelga com grão-de-bico.",
							"   LANCHE TARDE VEGANO: Sanduíche de homus com vegetais, wrap de falafel com tahine, wrap de grão-de-bico e abacate, wrap vegetariano com homus e pepino, smoothie de banana com pasta de amendoim, smoothie verde com espinafre e banana, iogurte vegetal com granola, torrada com abacate e tomate, torrada com homus, biscoito de arroz com pasta de amendoim, barra de frutas e nuts, mix de frutas secas, cookie de aveia vegano, pipoca, edamame com sal, homus com palitos de vegetais, guacamole com chips de batata-doce, bruschetta com tomate e manjericão, tapioca doce com banana e canela, açaí na tigela (sem leite condensado), bowl de frutas com granola, panqueca doce vegana, bolo de fubá vegano, banana com canela e aveia.",
							"   JANTAR VEGANO/VEGETARIANO: Tofu grelhado com brócolis, tofu ao molho de soja e gergelim, tempeh com legumes salteados, grão-de-bico com espinafre e arroz, lentilha com abóbora e arroz, omelete de grão-de-bico (besan), sopa de lentilha e legumes, sopa de abóbora cremosa vegana, sopa de feijão com couve, salada completa com grão-de-bico e tahine, salada de quinoa com abacate e feijão, legumes assados com ervas, purê de batata-doce com lentilha, berinjela assada com tomate e manjericão, cogumelos recheados com espinafre, macarrão de abobrinha com molho de tomate, zoodle com pesto de castanha, lasanha de berinjela vegana, escondidinho de lentilha com batata-doce, curry de grão-de-bico com arroz, curry de legumes com leite de coco, refogado de tofu com pimentão, feijão preto com batata-doce e couve, arroz integral com legumes e castanhas, quinoa com cogumelos e aspargos.",
							"   CEIA VEGANA: Iogurte vegetal com frutas, iogurte vegetal com mel e nozes, chá de camomila com castanhas, chá de hortelã com amêndoas, chá verde, leite vegetal morno com cacau e canela, banana com canela, maçã assada com canela, smoothie de banana e aveia (leite vegetal), vitamina de abacate vegana, chocolate quente com leite vegetal, pudim de chia vegano, frutas vermelhas, mix de sementes, castanhas, amêndoas, nozes, sorvete de banana (nice cream), picolé de frutas natural.",
							"   Se o usuário for VEGANO use APENAS opções sem nenhum produto animal. Se for VEGETARIANO pode incluir ovos e laticínios além das opções veganas.",
							wantsVeganOrVegetarian ? (userIsStrictlyVegan
								? "CRÍTICO - USUÁRIO VEGANO: Este usuário JÁ INFORMOU que é vegano em algum momento da conversa. SEMPRE, em QUALQUER dieta, cardápio ou sugestão de refeição, use EXCLUSIVAMENTE o CARDÁPIO VEGANO E VEGETARIANO (seção 7). NUNCA sugira carne, frango, peixe, ovos, laticínios ou qualquer produto animal. Não pergunte de novo; assuma que a alimentação é sempre vegana."
								: "CRÍTICO - USUÁRIO VEGETARIANO: Este usuário JÁ INFORMOU que é vegetariano em algum momento da conversa. SEMPRE, em QUALQUER dieta, cardápio ou sugestão de refeição, use EXCLUSIVAMENTE o CARDÁPIO VEGANO E VEGETARIANO (seção 7). Pode incluir ovos e laticínios. NUNCA sugira carne, frango ou peixe. Não pergunte de novo; assuma que a alimentação é sempre vegetariana.") : "",
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
							wantsTodayDiet ? "IMPORTANTE: O usuário pediu dieta para HOJE. Siga o formato curto obrigatório e SEMPRE inclua a action 'add_meals'. VARIE as refeições: cada uma deve ser uma opção diferente da lista (não repita frango em almoço e jantar, não repita aveia em café e lanche)." : "",
							dietPeriod === "week" ? `IMPORTANTE: O usuário pediu dieta para A SEMANA INTEIRA. Gere refeições DIFERENTES para cada dia (segunda a domingo), variando alimentos e preparações. Use o formato 'weeklyMeals' no params da action. Datas da semana: ${getWeekDates().join(", ")}. Cada objeto no array weeklyMeals deve ter: {date: 'YYYY-MM-DD', meals: [...]}. ${validMealsCount ? `CRÍTICO: TODOS os 7 dias devem ter EXATAMENTE ${validMealsCount} refeições cada. Não varie a quantidade entre os dias.` : ''}` : "",
							dietPeriod === "week" && wantsBothMealsAndWorkouts ? `IMPORTANTE: O usuário pediu treino para A SEMANA INTEIRA. Gere treinos DIFERENTES para cada dia (segunda a domingo), variando os tipos de treino. Use o formato 'weeklyWorkouts' no params da action 'add_workout'. Datas da semana: ${getWeekDates().join(", ")}. Cada objeto no array weeklyWorkouts deve ter: {date: 'YYYY-MM-DD', workouts: [...]}. ${validWorkoutsCount ? `CRÍTICO ABSOLUTO: TODOS os 7 dias devem ter EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada. NÃO varie a quantidade entre os dias. NÃO gere ${validWorkoutsCount - 1} treinos em alguns dias e ${validWorkoutsCount} em outros. Verifique cada dia antes de finalizar: dia 1 = ${validWorkoutsCount} treinos, dia 2 = ${validWorkoutsCount} treinos, dia 3 = ${validWorkoutsCount} treinos, dia 4 = ${validWorkoutsCount} treinos, dia 5 = ${validWorkoutsCount} treinos, dia 6 = ${validWorkoutsCount} treinos, dia 7 = ${validWorkoutsCount} treinos.` : ''}` : "",
							dietPeriod === "week" && /treino|exerc[ií]cio|treinar|muscula[cç][aã]o/i.test(lastUser) && !/(?:dieta|refei[cç][aã]o|card[aá]pio)/i.test(lastUser) ? `IMPORTANTE: O usuário pediu treino para A SEMANA INTEIRA. Gere treinos DIFERENTES para cada dia (segunda a domingo), variando os tipos de treino. Use o formato 'weeklyWorkouts' no params da action 'add_workout'. Datas da semana: ${getWeekDates().join(", ")}. Cada objeto no array weeklyWorkouts deve ter: {date: 'YYYY-MM-DD', workouts: [...]}. ${validWorkoutsCount ? `CRÍTICO ABSOLUTO: TODOS os 7 dias devem ter EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada. NÃO varie a quantidade entre os dias. NÃO gere ${validWorkoutsCount - 1} treinos em alguns dias e ${validWorkoutsCount} em outros. Verifique cada dia antes de finalizar: dia 1 = ${validWorkoutsCount} treinos, dia 2 = ${validWorkoutsCount} treinos, dia 3 = ${validWorkoutsCount} treinos, dia 4 = ${validWorkoutsCount} treinos, dia 5 = ${validWorkoutsCount} treinos, dia 6 = ${validWorkoutsCount} treinos, dia 7 = ${validWorkoutsCount} treinos.` : ''}` : "",
							dietPeriod === "custom" && customPeriod ? `IMPORTANTE: O usuário pediu dieta para ${customPeriod.value} ${customPeriod.type === "days" ? (customPeriod.value === 1 ? "dia" : "dias") : customPeriod.type === "weeks" ? (customPeriod.value === 1 ? "semana" : "semanas") : (customPeriod.value === 1 ? "mês" : "meses")}. Gere refeições DIFERENTES para cada dia, variando alimentos e preparações. Use o formato 'weeklyMeals' no params da action. Datas do período: ${getCustomPeriodDates(customPeriod.type, customPeriod.value).join(", ")}. Cada objeto no array weeklyMeals deve ter: {date: 'YYYY-MM-DD', meals: [...]}` : "",
							dietPeriod === "day" ? (mealToReplace ? `CRÍTICO: O usuário pediu para substituir APENAS o "${mealToReplace}". Você DEVE:
1. Gerar APENAS UMA refeição no array 'meals' da action 'add_meals' com title="${mealToReplace}"
2. Na sua resposta de texto, mostrar APENAS essa refeição substituída, não todas as refeições do dia
3. Não liste outras refeições (café da manhã, almoço, etc.) - apenas o ${mealToReplace.toLowerCase()} que está sendo substituído
4. Esta refeição substituirá apenas o ${mealToReplace.toLowerCase()} existente, não todas as refeições do dia.` : "IMPORTANTE: O usuário pediu dieta para HOJE. Siga o formato curto obrigatório e SEMPRE inclua a action 'add_meals'. VARIE: cada refeição com opção diferente (proteínas e preparos distintos no mesmo dia).") : "",
							dietPeriod === "day" && workoutToReplace ? `CRÍTICO: O usuário pediu para substituir APENAS o treino "${workoutToReplace}". Você DEVE:
1. Gerar APENAS UM treino no array 'workouts' da action 'add_workout' com title="${workoutToReplace}"
2. Na sua resposta de texto, mostrar APENAS esse treino substituído, não todos os treinos do dia
3. Não liste outros treinos - apenas o treino "${workoutToReplace}" que está sendo substituído
4. Este treino substituirá apenas o treino "${workoutToReplace}" existente, não todos os treinos do dia.` : "",
							dietPeriod === "day" && workoutToReplace === null ? `IMPORTANTE: O usuário pediu treino para HOJE e quer SUBSTITUIR TODOS os treinos. Gere MÚLTIPLOS treinos (2-5 treinos) no array 'workouts' da action 'add_workout' para substituir todos os treinos existentes do dia.` : "",
							validMealsCount && validWorkoutsCount && !mealToReplace && !workoutToReplace ? `🚨🚨🚨 CRÍTICO ABSOLUTO - LEIA COM MUITA ATENÇÃO: O usuário pediu EXATAMENTE ${validMealsCount} refeições E EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''}. Você DEVE gerar AMBAS as actions: 'add_meals' com EXATAMENTE ${validMealsCount} refeições E 'add_workout' com EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''}. NÃO gere menos. NÃO gere mais.  ${dietPeriod === "week" || dietPeriod === "custom" ? `CRÍTICO: Se for para múltiplos dias, TODOS os dias devem ter EXATAMENTE ${validMealsCount} refeições E EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada.` : ''}` : "",
							validMealsCount && !mealToReplace ? `🚨 CRÍTICO E OBRIGATÓRIO - LEIA COM ATENÇÃO: O usuário pediu EXATAMENTE ${validMealsCount} refeições. Você DEVE gerar ${validMealsCount} refeições no array 'meals' da action 'add_meals'. NÃO gere menos que ${validMealsCount}. NÃO pare antes de gerar todas as ${validMealsCount} refeições. Use os tipos de refeições disponíveis: 'Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia'. Gere EXATAMENTE esse número usando os tipos disponíveis na ordem que fizer sentido (Café da manhã, Lanche da manhã, Almoço, Lanche da tarde, Jantar, Ceia). ${dietPeriod === "week" || dietPeriod === "custom" ? `CRÍTICO: Se for para múltiplos dias (semana ou período customizado), TODOS os dias devem ter EXATAMENTE ${validMealsCount} refeições cada. Não varie a quantidade entre os dias.` : ''}` : "",
							validWorkoutsCount && !workoutToReplace ? `🚨 CRÍTICO E OBRIGATÓRIO - LEIA COM MUITA ATENÇÃO: O usuário pediu EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''}. Você DEVE gerar EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} no array 'workouts' da action 'add_workout'. NÃO gere menos que ${validWorkoutsCount}. NÃO gere mais que ${validWorkoutsCount}. Se o usuário pediu ${validWorkoutsCount} treinos, gere EXATAMENTE ${validWorkoutsCount}, nem mais nem menos. ${dietPeriod === "week" || dietPeriod === "custom" ? `CRÍTICO ABSOLUTO: Se for para múltiplos dias (semana ou período customizado), TODOS os dias devem ter EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada. NÃO varie a quantidade entre os dias. NÃO gere ${validWorkoutsCount - 1} treinos em alguns dias e ${validWorkoutsCount} em outros. NÃO gere ${validWorkoutsCount + 1} treinos em alguns dias. TODOS os dias devem ter EXATAMENTE ${validWorkoutsCount} treino${validWorkoutsCount > 1 ? 's' : ''} cada, sem exceção.` : ''}` : "",
							wantsBothMealsAndWorkouts ? "IMPORTANTE: O usuário pediu TANTO refeições QUANTO treinos. Você DEVE gerar AMBAS as actions: 'add_meals' E 'add_workout'. Não gere apenas uma delas." : "",
							wantsBothMealsAndWorkouts && userSaidToday ? "CRÍTICO: O usuário já disse 'hoje' ou 'para hoje'. NÃO pergunte 'para qual período' nem 'qual treino substituir'. Gere DIRETAMENTE as duas actions (add_meals e add_workout) para HOJE na sua resposta. Não inclua action diet_choice. Responda com o cardápio e os treinos já prontos para hoje." : "",
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

