import { prisma } from "@/lib/prisma";
import { openai } from "@/lib/openai";
import { Prisma } from "@prisma/client";

type OnboardingData = {
  goalPrimary?: string | null;
  goals?: string | null;
  workoutsPerWeek?: number | null;
  experience?: string | null;
  activityLevel?: string | null;
  weightKg?: number | null;
};

export const normalizeDate = (value?: string | Date | null): Date => {
  // IMPORTANT: strings no formato YYYY-MM-DD são interpretadas como UTC pelo JS (Date("2026-01-12") => 00:00Z),
  // o que pode "trocar o dia" em alguns fusos. Aqui tratamos YYYY-MM-DD como data LOCAL.
  const parseLocalYmd = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
    return new Date(y, mo, d);
  };

  const base =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? parseLocalYmd(value) ?? new Date(value)
        : new Date();

  const normalized = new Date(base);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

export const pickGoalLabel = (onboarding: OnboardingData | null | undefined) => {
  try {
    if (!onboarding?.goalPrimary && onboarding?.goals) {
      const parsed = JSON.parse(onboarding.goals);
      if (Array.isArray(parsed) && parsed.length) return parsed[0];
    }
  } catch {
    /* ignore JSON errors */
  }
  return onboarding?.goalPrimary ?? onboarding?.goals ?? "Plano personalizado";
};

/** Normaliza dietType para "vegan" | "vegetarian" | null (garante que rotina respeite vegano/vegetariano). */
export function normalizeDietType(raw?: string | null): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const d = raw.toLowerCase().trim();
  if (!d) return null;
  if (/vegan(o|a)?\b|^vegan$/.test(d)) return "vegan";
  if (/vegetarian(o|a)?\b|^vegetarian$|vegetariano|vegetariana/.test(d)) return "vegetarian";
  return null;
}

const normalizeGoal = (raw?: string | null) => {
  if (!raw) return "maintain";
  const g = raw.toLowerCase();
  const lossWords = [
    "perder",
    "loss",
    "lose",
    "lose_weight",
    "loseweight",
    "cut",
    "cutting",
    "emagrec",
    "seca",
    "defini",
  ];
  const gainWords = [
    "ganhar",
    "gain",
    "gain_mass",
    "gainmass",
    "massa",
    "hipertrof",
    "bulking",
    "bulk",
  ];
  if (lossWords.some((w) => g.includes(w))) return "loss";
  if (gainWords.some((w) => g.includes(w))) return "gain";
  return "maintain";
};

const normalizeActivity = (raw?: string | null) => {
  if (!raw) return "regular";
  const a = raw.toLowerCase();
  if (["sedentary", "sedentário", "sedentaria"].some((w) => a.includes(w))) return "sedentary";
  if (["heavy", "muito", "intenso"].some((w) => a.includes(w))) return "heavy";
  if (["active", "ativo", "ativa", "regular"].some((w) => a.includes(w))) return "regular";
  return "regular";
};

export const calcTargets = (onboarding: OnboardingData | null | undefined) => {
  const weight =
    onboarding?.weightKg && onboarding.weightKg > 0
      ? onboarding.weightKg
      : null;

  const height =
    onboarding && typeof (onboarding as any).heightCm === "number"
      ? (onboarding as any).heightCm
      : null;

  const age =
    onboarding && typeof (onboarding as any).age === "number"
      ? (onboarding as any).age
      : null;

  const gender =
    (onboarding as any)?.gender?.toLowerCase?.() === "female"
      ? "female"
      : "male";

  const goal = normalizeGoal(
    onboarding?.goalPrimary || (onboarding as any)?.goals
  );

  const targetWeight =
    onboarding && typeof (onboarding as any).targetWeight === "number" &&
    (onboarding as any).targetWeight > 0
      ? (onboarding as any).targetWeight
      : null;

  const weeklyLoss =
    onboarding && typeof (onboarding as any).weeklyLossKg === "number" &&
    (onboarding as any).weeklyLossKg > 0
      ? (onboarding as any).weeklyLossKg
      : null;

  const weeklyLossIntensity =
    (onboarding as any)?.weeklyLossIntensity || "recommended";

  const activityLevel = normalizeActivity(
    (onboarding as any)?.activityLevel
  );

  // -------------------------
  // Fatores de atividade (padrão MyFitnessPal / apps populares)
  // -------------------------
  const activityFactorMap: Record<string, number> = {
    sedentary: 1.2,
    regular: 1.55,   // moderadamente ativo
    heavy: 1.725,   // muito ativo
  };

  const activityFactor = activityFactorMap[activityLevel] ?? 1.375;

  // -------------------------
  // BMR (Mifflin-St Jeor)
  // -------------------------
  let bmr: number;

  if (weight && height && age) {
    bmr = Math.round(
      10 * weight +
        6.25 * height -
        5 * age +
        (gender === "female" ? -161 : 5)
    );
  } else if (weight) {
    // fallback realista diário
    bmr = Math.round(weight * 22);
  } else {
    bmr = 1600;
  }

  // -------------------------
  // TDEE
  // -------------------------
  let calories = Math.round(bmr * activityFactor);

  // -------------------------
  // Ajuste por objetivo
  // -------------------------
  if (goal === "gain") {
    // Baseline: +250 kcal
    calories += 250;

    // Usar velocidade de ganho (weeklyLossKg no onboarding) quando fornecida.
    // Faixa saudável: 0.2–0.7 kg/semana (~220–770 kcal/dia de excedente).
    const weeklyGain =
      weeklyLoss && weeklyLoss > 0 && weeklyLoss <= 2
        ? Math.min(Math.max(weeklyLoss, 0.2), 0.7)
        : null;
    if (weeklyGain) {
      const surplus = Math.round(weeklyGain * 1100); // ~1100 kcal/dia por 1 kg/sem
      calories += surplus;
    } else if (weight && targetWeight && targetWeight > weight) {
      const delta = targetWeight - weight;
      const extra = Math.min(Math.max(Math.round(delta * 60), 150), 400);
      calories += extra;
    }
  }

  if (goal === "loss") {
    const tdee = calories;

    // Déficit obrigatório por ritmo (produção):
    // - slow: 15%
    // - recommended: 25% (ideal)
    // - fast: 30% (curto prazo)
    const intensityMap: Record<string, number> = {
      slow: 0.15,
      recommended: 0.25,
      fast: 0.3,
    };

    const deficitPercent = intensityMap[weeklyLossIntensity] ?? 0.25;
    let targetCalories = Math.round(tdee * (1 - deficitPercent));

    // Só considera weeklyLossKg como "kg/semana" se for um valor realista (<= 2kg/semana).
    // No app ele pode ser um slider 0-10 (escala), então ignoramos valores irreais.
    if (weeklyLoss && weeklyLoss > 0 && weeklyLoss <= 2) {
      const guidedDeficit = Math.round(weeklyLoss * 1100); // ~7700/7 ≈ 1100 kcal/dia por 1kg/sem
      targetCalories = Math.min(targetCalories, tdee - guidedDeficit);
    }

    calories = targetCalories;
  }

  // -------------------------
  // Limites de segurança
  // -------------------------
  calories = Math.max(calories, 1200);
  calories = Math.min(calories, 3500);

  // -------------------------
  // Macros: proteína por peso (padrão apps); resto = carbos + gordura, somando as calorias-alvo
  // Proteína: 1.6 g/kg em perda (preservar músculo), 1.2 em ganho, 1.3 em manter
  // -------------------------
  const proteinPerKg = goal === "gain" ? 1.2 : goal === "loss" ? 1.6 : 1.3;

  const protein = weight
    ? Math.round(weight * proteinPerKg)
    : Math.round((calories * 0.28) / 4);

  const proteinKcal = protein * 4;
  const remainingKcal = Math.max(0, calories - proteinKcal);
  // Dividir o restante entre carboidratos e gordura (50/50) para bater com as calorias totais
  const carbs = Math.round((remainingKcal * 0.5) / 4);
  const fat = Math.round((remainingKcal * 0.5) / 9);
  // Ajuste fino: garantir que proteína + carbos + gordura ≈ calorias (ajustar gordura se necessário)
  const currentTotal = protein * 4 + carbs * 4 + fat * 9;
  const fatAdjust = Math.round((calories - currentTotal) / 9);
  const finalFat = Math.max(20, fat + fatAdjust);

  return { calories, protein, carbs, fat: finalFat };
};

/**
 * Calcula targets usando IA da OpenAI
 * Retorna null se houver erro (para usar fallback matemático)
 */
export async function calcTargetsWithAI(
  onboarding: OnboardingData | null | undefined
): Promise<{ calories: number; protein: number; carbs: number; fat: number } | null> {
  try {
    if (!onboarding) {
      return null;
    }

    const weight = onboarding?.weightKg && onboarding.weightKg > 0 ? onboarding.weightKg : null;
    const height = onboarding && typeof (onboarding as any).heightCm === "number" ? (onboarding as any).heightCm : null;
    const age = onboarding && typeof (onboarding as any).age === "number" ? (onboarding as any).age : null;
    const gender = (onboarding as any)?.gender?.toLowerCase?.() === "female" ? "female" : "male";
    const goal = normalizeGoal(onboarding?.goalPrimary || (onboarding as any)?.goals);
    const activityLevel = normalizeActivity((onboarding as any)?.activityLevel);
    const targetWeight = onboarding && typeof (onboarding as any).targetWeight === "number" && (onboarding as any).targetWeight > 0 ? (onboarding as any).targetWeight : null;
    const weeklyLoss = onboarding && typeof (onboarding as any).weeklyLossKg === "number" && (onboarding as any).weeklyLossKg > 0 ? (onboarding as any).weeklyLossKg : null;
    const weeklyLossIntensity = (onboarding as any)?.weeklyLossIntensity || "recommended";

    const systemPrompt = `Você é um nutricionista especializado em calcular necessidades calóricas e macronutrientes.

Sua tarefa é calcular as necessidades diárias de calorias e macronutrientes (proteína, carboidratos, gorduras) baseado nos dados do usuário.

REGRAS OBRIGATÓRIAS:
1. Use a fórmula de Mifflin-St Jeor para calcular BMR (Taxa Metabólica Basal):
   - Homem: BMR = 10 × peso(kg) + 6.25 × altura(cm) - 5 × idade + 5
   - Mulher: BMR = 10 × peso(kg) + 6.25 × altura(cm) - 5 × idade - 161

2. Calcule TDEE (Gasto Energético Total Diário) - use os multiplicadores padrão (como MyFitnessPal):
   - Sedentário: TDEE = BMR × 1.2
   - Regular/Moderado: TDEE = BMR × 1.55
   - Muito ativo/Intenso: TDEE = BMR × 1.725

3. Ajuste por objetivo:
   - PERDER PESO (loss): Déficit a partir do TDEE.
     * Se houver "Perda semanal desejada" (kg/semana): déficit = kg/sem × 1100 kcal/dia (ex: 0.5 kg/sem ≈ 550 kcal, 1 kg/sem ≈ 1100 kcal).
     * Senão: déficit 20% (lento), 25% (recomendado) ou 30% (rápido). Calorias = TDEE - déficit.
   - GANHAR PESO (gain): TDEE + excedente. Base 250 kcal; ou excedente = ganho kg/sem × 1100 (faixa 0.2–0.7 kg/sem).
   - MANTER (maintain): Calorias = TDEE sem ajustes.

4. LIMITES DE SEGURANÇA: Calorias entre 1200 e 3500 kcal.

5. MACROS (devem SOMAR as calorias-alvo):
   - Proteína (g) = peso (kg) × fator: perder peso 1.6 g/kg, ganhar 1.2 g/kg, manter 1.3 g/kg. (Proteína em kcal = proteína × 4.)
   - Restante de calorias = calorias-alvo - (proteína × 4). Divida o restante 50% carboidratos e 50% gordura: carbs (g) = (restante × 0.5) / 4, fat (g) = (restante × 0.5) / 9.
   - Arredonde e ajuste gordura se necessário para que proteína×4 + carbs×4 + fat×9 = calorias-alvo.

6. Retorne APENAS um JSON válido no formato:
{
  "calories": número,
  "protein": número (em gramas),
  "carbs": número (em gramas),
  "fat": número (em gramas),
  "explanation": "breve explicação do cálculo"
}

IMPORTANTE: Todos os valores devem ser números inteiros (arredondados).`;

    const isGain = goal === "gain";
    const velocityLabel = isGain ? "Ganho semanal desejado" : "Perda semanal desejada";
    const intensityLabel = isGain ? "Intensidade de ganho" : "Intensidade de perda";

    const userPrompt = `Calcule as necessidades nutricionais para:
- Peso: ${weight || "não informado"} kg
- Altura: ${height || "não informado"} cm
- Idade: ${age || "não informado"} anos
- Gênero: ${gender === "female" ? "feminino" : "masculino"}
- Objetivo: ${goal === "loss" ? "perder peso" : goal === "gain" ? "ganhar peso" : "manter peso"}
- Nível de atividade: ${activityLevel}
- Peso desejado: ${targetWeight || "não informado"} kg
- ${velocityLabel}: ${weeklyLoss ?? "não informado"} kg/semana
- ${intensityLabel}: ${weeklyLossIntensity}

Calcule e retorne o JSON com calories, protein, carbs, fat e explanation.`;

    const completion = await openai().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.0, // Temperatura zero para máxima consistência
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const reply = completion.choices[0].message?.content ?? "";
    if (!reply) {
      console.error("[AI-TARGETS] Resposta vazia da OpenAI");
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(reply);
    } catch (error) {
      console.error("[AI-TARGETS] Erro ao parsear JSON da OpenAI:", error);
      return null;
    }

    // Validar e normalizar valores
    const calories = Math.max(1200, Math.min(3500, Math.round(parsed.calories || 2000)));
    const protein = Math.round(parsed.protein || 150);
    const carbs = Math.round(parsed.carbs || 200);
    const fat = Math.round(parsed.fat || 65);

    console.log("[AI-TARGETS] Cálculo via IA:", { calories, protein, carbs, fat, explanation: parsed.explanation });

    return { calories, protein, carbs, fat };
  } catch (error) {
    console.error("[AI-TARGETS] Erro ao calcular com IA:", error);
    return null; // Retorna null para usar fallback matemático
  }
}


/** Conjuntos de refeições vegetarianas (sem carne/peixe; pode ter ovos e laticínios) para rotina gerada pelo botão "Gerar rotina alimentar". */
const descSetsVegetarian = [
  { cafe: "Aveia overnight com frutas, chia e mel ou panqueca de aveia e banana com mel.", lanche1: "Iogurte grego + castanhas do Pará; ou queijo branco + fruta.", almoco: "Grão-de-bico refogado com legumes, arroz integral e salada de folhas verdes.", lanche2: "Sanduíche integral com homus e vegetais; ou shake proteico de chocolate.", jantar: "Omelete de ovos com espinafre e queijo + legumes salteados; salada.", ceia: "Iogurte grego + frutas vermelhas ou castanhas." },
  { cafe: "Tapioca com queijo e tomate + fruta cítrica.", lanche1: "Barra proteica ou iogurte + sementes.", almoco: "Lentilha com legumes, arroz integral e salada colorida.", lanche2: "Fruta + pasta de amendoim; ou wrap de homus com vegetais.", jantar: "Omelete com legumes e queijo; salada verde.", ceia: "Leite + cacau ou iogurte com canela." },
  { cafe: "Pão integral + cottage + tomate + fruta.", lanche1: "Mix de nuts ou ovo cozido + fruta.", almoco: "Feijão preto com abóbora, arroz integral, couve refogada e salada.", lanche2: "Iogurte grego + granola moderada.", jantar: "Omelete de claras com espinafre e queijo; salada.", ceia: "Chá + queijo branco ou iogurte." },
  { cafe: "Panqueca de aveia e banana + mel ou frutas vermelhas.", lanche1: "Smoothie verde (espinafre + banana) ou mix de frutas secas.", almoco: "Quinoa com grão-de-bico, legumes no vapor e salada de rúcula.", lanche2: "Hummus com palitos de vegetais ou torrada integral com abacate.", jantar: "Tofu grelhado com legumes e purê de abóbora; salada.", ceia: "Chá de camomila + amêndoas ou queijo cottage com morangos." },
  { cafe: "Aveia overnight com frutas e chia ou crepioca doce com banana.", lanche1: "Maçã com pasta de amendoim ou iogurte natural com granola.", almoco: "Falafel com homus, arroz integral, feijão e salada de folhas.", lanche2: "Biscoito de arroz com pasta de amendoim ou smoothie com banana.", jantar: "Berinjela à parmegiana (queijo), purê de batata-doce e salada de rúcula.", ceia: "Leite morno com mel ou iogurte grego com nozes." },
  { cafe: "Omelete de 2-3 ovos com espinafre e queijo, torrada integral e suco de laranja.", lanche1: "Banana com canela ou iogurte com sementes de linhaça e mel.", almoco: "Grão-de-bico ao curry, arroz integral e salada de tomate e pepino.", lanche2: "Sanduíche de pão integral com queijo e alface ou wrap vegetariano com homus.", jantar: "Sopa de lentilha e legumes ou salada completa com grão-de-bico e tahine.", ceia: "Chá verde + castanhas do Pará ou iogurte com frutas vermelhas." },
  { cafe: "Açaí bowl com granola e frutas ou pão integral com ovo mexido e tomate.", lanche1: "Pera ou uvas com queijo minas ou barra de proteína.", almoco: "Abóbora assada com grão-de-bico, arroz e couve refogada.", lanche2: "Biscoito integral com requeijão light ou smoothie de frutas.", jantar: "Risoto de cogumelos, legumes no vapor e salada.", ceia: "Chá de ervas + mix de sementes ou leite com cacau." },
  { cafe: "Waffle integral com frutas e mel ou crepioca com queijo e tomate.", lanche1: "Iogurte grego com morangos e granola ou mix de frutas secas.", almoco: "Strogonoff de grão-de-bico, arroz integral e salada de alface e cenoura.", lanche2: "Torrada com abacate e ovo poché ou smoothie com frutas.", jantar: "Tofu ao molho de soja, purê de abóbora e salada de agrião.", ceia: "Chá de hortelã + amêndoas ou iogurte natural com mel." },
  { cafe: "Panqueca de banana e aveia com mel ou pão integral com homus e pepino.", lanche1: "Mamão com chia ou iogurte com granola e frutas vermelhas.", almoco: "Lentilha com abóbora e arroz, couve refogada e salada.", lanche2: "Biscoito de arroz com pasta de amendoim ou wrap de homus.", jantar: "Cogumelos salteados com arroz integral e salada de pepino.", ceia: "Chá de gengibre + nozes ou queijo cottage com mel." },
  { cafe: "Aveia cozida com banana, canela e mel ou tapioca com queijo e orégano.", lanche1: "Maçã verde ou pera com canela ou iogurte com linhaça e mel.", almoco: "Feijão preto com batata-doce e couve, arroz integral e salada.", lanche2: "Sanduíche de pão integral com homus e alface ou smoothie.", jantar: "Omelete de claras com espinafre e queijo, salada verde e purê de abóbora.", ceia: "Chá de camomila + castanhas ou leite morno com mel e canela." },
];

/** Conjuntos de refeições veganas (sem nenhum produto animal) para rotina gerada pelo botão "Gerar rotina alimentar". */
const descSetsVegan = [
  { cafe: "Aveia overnight com frutas, chia e mel (leite vegetal).", lanche1: "Iogurte vegetal + castanhas do Pará; ou fruta com pasta de amendoim.", almoco: "Grão-de-bico refogado com legumes, arroz integral e salada.", lanche2: "Sanduíche integral com homus e vegetais; ou smoothie com banana.", jantar: "Tofu grelhado com legumes e purê de abóbora; salada.", ceia: "Iogurte vegetal + frutas vermelhas ou castanhas." },
  { cafe: "Tapioca com homus e tomate + fruta.", lanche1: "Barra de frutas e nuts ou iogurte vegetal + sementes.", almoco: "Lentilha com legumes, arroz integral e salada colorida.", lanche2: "Fruta + pasta de amendoim; ou wrap de homus com vegetais.", jantar: "Grão-de-bico com espinafre e arroz; salada.", ceia: "Leite vegetal morno com cacau e canela." },
  { cafe: "Pão integral com homus e pepino + fruta.", lanche1: "Mix de nuts ou fruta seca + fruta.", almoco: "Feijão preto com abóbora, arroz integral, couve e salada.", lanche2: "Iogurte vegetal + granola.", jantar: "Berinjela assada com tomate e manjericão; purê de batata-doce.", ceia: "Chá + mix de sementes ou iogurte vegetal." },
  { cafe: "Panqueca de aveia e banana (sem ovo) + mel.", lanche1: "Smoothie verde (espinafre, banana, leite vegetal) ou mix de frutas secas.", almoco: "Quinoa com grão-de-bico e legumes; salada de rúcula.", lanche2: "Hummus com palitos de vegetais ou torrada com abacate.", jantar: "Tempeh com legumes salteados e purê de abóbora.", ceia: "Chá de camomila + amêndoas ou pudim de chia vegano." },
  { cafe: "Aveia overnight com frutas e chia (leite vegetal).", lanche1: "Maçã com pasta de amendoim ou iogurte vegetal com granola.", almoco: "Falafel com homus e salada; arroz integral.", lanche2: "Biscoito de arroz com pasta de amendoim ou smoothie de banana.", jantar: "Curry de grão-de-bico com arroz e legumes.", ceia: "Leite vegetal morno com mel ou iogurte vegetal com nozes." },
  { cafe: "Smoothie bowl de açaí com granola e banana.", lanche1: "Banana com canela ou iogurte vegetal com linhaça e mel.", almoco: "Grão-de-bico ao curry, arroz integral e salada de tomate e pepino.", lanche2: "Sanduíche de homus com vegetais ou wrap de falafel.", jantar: "Sopa de lentilha e legumes ou salada de quinoa com abacate.", ceia: "Chá verde + castanhas ou iogurte vegetal com frutas." },
  { cafe: "Pão integral com abacate e tomate ou bowl de frutas com granola.", lanche1: "Pera ou uvas ou mix de nuts.", almoco: "Abóbora assada com grão-de-bico, arroz e couve.", lanche2: "Biscoito integral com homus ou smoothie de frutas.", jantar: "Risoto de cogumelos ou legumes assados com ervas.", ceia: "Chá de ervas + mix de sementes ou leite vegetal com cacau." },
  { cafe: "Waffle de aveia com frutas e mel ou crepioca doce com banana.", lanche1: "Iogurte vegetal com morangos e granola.", almoco: "Strogonoff de cogumelos ou grão-de-bico, arroz e salada.", lanche2: "Torrada com abacate ou smoothie com frutas.", jantar: "Tofu ao molho de soja e gergelim, legumes e salada.", ceia: "Chá de hortelã + amêndoas ou chocolate quente com leite vegetal." },
  { cafe: "Panqueca de banana vegana com mel ou pão com homus e pepino.", lanche1: "Mamão com linhaça ou iogurte vegetal com granola.", almoco: "Lentilha com abóbora e arroz; salada de folhas.", lanche2: "Biscoito de arroz com pasta de amendoim ou wrap de homus.", jantar: "Cogumelos recheados com espinafre; purê de batata-doce.", ceia: "Chá de gengibre + nozes ou vitamina de abacate vegana." },
  { cafe: "Aveia cozida com banana e canela (leite vegetal).", lanche1: "Maçã ou pera com canela ou iogurte vegetal com mel.", almoco: "Feijão preto com batata-doce e couve; arroz e salada.", lanche2: "Sanduíche de homus com vegetais ou smoothie.", jantar: "Escondidinho de lentilha com batata-doce; salada.", ceia: "Chá de camomila + castanhas ou leite vegetal com mel." },
];

/** Conjunto padrão (com carne/peixe) - usado só quando dietType não é vegano nem vegetariano. */
const descSetsDefault = [
  { cafe: "Ovos mexidos com espinafre + aveia + fruta; café ou chá sem açúcar.", lanche1: "Iogurte grego + castanhas do Pará; ou queijo branco + fruta.", almoco: "Frango grelhado, arroz integral, brócolis no vapor e salada de folhas verdes.", lanche2: "Sanduíche integral com frango desfiado; ou shake proteico de chocolate.", jantar: "Salmão grelhado + legumes salteados; carbo moderado se treinar à noite.", ceia: "Iogurte grego + frutas vermelhas ou castanhas." },
  { cafe: "Tapioca com ovo/queijo + fruta cítrica.", lanche1: "Barra proteica ou iogurte + sementes.", almoco: "Carne magra/peixe, fonte de carboidrato (arroz/batata/mandioca) e salada colorida.", lanche2: "Fruta + pasta de amendoim; ou wrap de frango.", jantar: "Peixe/frango + legumes salteados; pouco carbo.", ceia: "Leite/veg + cacau ou kefir + canela." },
  { cafe: "Pão integral + cottage/peito de peru + fruta.", lanche1: "Mix de nuts ou ovo cozido + fruta.", almoco: "Proteína, grão (feijão/grão-de-bico) e folhas.", lanche2: "Iogurte grego + granola moderada.", jantar: "Omelete de claras/ovos + legumes; salada.", ceia: "Chá + fonte proteica leve." },
  { cafe: "Panqueca proteica (ovo + aveia + banana) + mel ou frutas vermelhas.", lanche1: "Smoothie verde (espinafre + banana + proteína em pó) ou mix de frutas secas.", almoco: "Frango grelhado/peixe assado, quinoa ou batata-doce, brócolis e abobrinha grelhada.", lanche2: "Hummus com palitos de vegetais ou torrada integral com abacate e ovo.", jantar: "Salmão/atum grelhado, purê de abóbora e aspargos ou couve refogada.", ceia: "Chá de camomila + amêndoas ou queijo cottage com morangos." },
  { cafe: "Aveia overnight (aveia + iogurte + frutas + chia) ou crepioca com recheio de frango desfiado.", lanche1: "Maçã com pasta de amendoim ou iogurte natural com granola caseira.", almoco: "Carne moída magra, arroz integral ou macarrão integral, feijão e salada de folhas verdes.", lanche2: "Biscoito de arroz com pasta de amendoim ou shake de whey protein com banana.", jantar: "Peito de frango ao molho de tomate, purê de batata-doce e salada de rúcula.", ceia: "Leite morno com mel ou iogurte grego com nozes." },
  { cafe: "Omelete de 2-3 ovos com espinafre e queijo, torrada integral e suco de laranja natural.", lanche1: "Banana com canela ou iogurte com sementes de linhaça e mel.", almoco: "Peixe assado (salmão/atum), arroz integral, feijão preto e salada de tomate e pepino.", lanche2: "Sanduíche de pão integral com peito de peru, queijo e alface ou wrap de frango com vegetais.", jantar: "Sopa de legumes com frango desfiado ou salada completa com grão-de-bico e atum.", ceia: "Chá verde + castanhas do Pará ou iogurte com frutas vermelhas." },
  { cafe: "Açaí bowl com granola, frutas e mel ou pão de forma integral com ovo mexido e tomate.", lanche1: "Pera ou uvas com queijo minas ou barra de proteína caseira.", almoco: "Carne assada (patinho/alcatra), purê de batata ou mandioca, couve refogada e salada de beterraba.", lanche2: "Biscoito integral com requeijão light ou smoothie de frutas com proteína.", jantar: "Salmão ao forno com ervas, arroz de couve-flor e legumes no vapor.", ceia: "Chá de ervas + mix de sementes ou leite com cacau em pó." },
  { cafe: "Waffle integral com frutas e mel ou crepioca com ovo, queijo e tomate.", lanche1: "Iogurte grego com morangos e granola ou mix de frutas secas e castanhas.", almoco: "Frango à parmegiana light, macarrão integral e salada de alface e cenoura ralada.", lanche2: "Torrada com abacate amassado e ovo poché ou shake de proteína com frutas.", jantar: "Peixe grelhado (tilápia/merluza), purê de abóbora e salada de agrião.", ceia: "Chá de hortelã + amêndoas ou iogurte natural com mel." },
  { cafe: "Panqueca de banana e aveia com mel ou pão integral com cream cheese e salmão defumado.", lanche1: "Mamão com sementes de chia ou iogurte com granola e frutas vermelhas.", almoco: "Carne de panela, arroz integral, feijão carioca e salada de repolho e cenoura.", lanche2: "Biscoito de arroz com pasta de amendoim ou wrap de atum com vegetais.", jantar: "Frango grelhado com legumes e purê de batata-doce.", ceia: "Chá verde + castanhas ou iogurte com frutas vermelhas." },
];

const buildMeals = (
  totalCalories: number,
  targetProtein: number,
  targetCarbs: number,
  targetFat: number,
  variationSeed: number,
  mealsPerDay?: number | null,
  dietType?: string | null,
) => {
  const base = totalCalories || 2000;
  const mealsCountRaw = typeof mealsPerDay === "number" && mealsPerDay > 0 ? mealsPerDay : null;
  const mealsCount = mealsCountRaw ? Math.max(2, Math.min(6, Math.round(mealsCountRaw))) : 6;
  // Usar normalizeDietType como única fonte de verdade — nunca usar conjunto com carne para vegano/vegetariano
  const normalizedDiet = normalizeDietType(dietType);
  const useVegan = normalizedDiet === "vegan";
  const useVegetarian = normalizedDiet === "vegetarian";
  const descSetsToUse = useVegan ? descSetsVegan : useVegetarian ? descSetsVegetarian : descSetsDefault;
  if ((dietType || "").trim() && !useVegan && !useVegetarian) {
    console.error(`[PLAN] buildMeals - dietType ignorado (não é vegano/vegetariano): "${dietType}" -> normalized: ${normalizedDiet ?? "null"}`);
  }
  console.error(`[PLAN] buildMeals - mealsPerDay: ${mealsPerDay}, dietType: "${dietType ?? ""}", normalized: "${normalizedDiet ?? ""}", useVegan: ${useVegan}, useVegetarian: ${useVegetarian}, set: ${useVegan ? "vegan" : useVegetarian ? "vegetarian" : "default"}`);

  // pequenas variações de divisão por dia (seed 0-6)
  const ratioPresets = [
    // cutting equilibrado
    [0.18, 0.07, 0.30, 0.08, 0.22, 0.05],
  
    // cutting com jantar menor
    [0.20, 0.07, 0.32, 0.08, 0.20, 0.03],
  
    // cutting agressivo (sem ceia)
    [0.20, 0.08, 0.34, 0.08, 0.22, 0.00],
  
    // cutting para quem treina cedo
    [0.22, 0.08, 0.32, 0.07, 0.23, 0.00],
  
    // cutting mais distribuído
    [0.19, 0.08, 0.31, 0.09, 0.23, 0.05],
  ];

  const ratio = ratioPresets[variationSeed % ratioPresets.length];

  const split = [
    { 
      title: "Café da manhã", 
      ratio: ratio[0], 
      startTime: "07:00", 
      endTime: "07:30", 
      description: descSetsToUse[(variationSeed * 2 + 0) % descSetsToUse.length].cafe 
    },
    { 
      title: "Lanche da manhã", 
      ratio: ratio[1], 
      startTime: "10:00", 
      endTime: "10:15", 
      description: descSetsToUse[(variationSeed * 3 + 1) % descSetsToUse.length].lanche1 
    },
    { 
      title: "Almoço", 
      ratio: ratio[2], 
      startTime: "12:30", 
      endTime: "13:00", 
      description: descSetsToUse[(variationSeed * 5 + 2) % descSetsToUse.length].almoco 
    },
    { 
      title: "Lanche da tarde", 
      ratio: ratio[3], 
      startTime: "16:00", 
      endTime: "16:20", 
      description: descSetsToUse[(variationSeed * 7 + 3) % descSetsToUse.length].lanche2 
    },
    { 
      title: "Jantar", 
      ratio: ratio[4], 
      startTime: "19:30", 
      endTime: "20:00", 
      description: descSetsToUse[(variationSeed * 11 + 4) % descSetsToUse.length].jantar 
    },
    { 
      title: "Ceia (opcional)", 
      ratio: ratio[5], 
      startTime: "22:00", 
      endTime: "22:15", 
      description: descSetsToUse[(variationSeed * 13 + 5) % descSetsToUse.length].ceia 
    },
  ];

  const indicesByCount: Record<number, number[]> = {
    6: [0, 1, 2, 3, 4, 5],
    5: [0, 1, 2, 3, 4],
    4: [0, 2, 3, 4],
    3: [0, 2, 4],
    2: [2, 4], // Almoço e Jantar (índices 2 e 4)
  };

  const indices = indicesByCount[mealsCount] ?? indicesByCount[6];
  const filtered = split.filter((_, idx) => indices.includes(idx));
  
  console.error(`[PLAN] buildMeals - Selected indices for ${mealsCount} meals: ${indices.join(", ")}, filtered count: ${filtered.length}`);
  console.error(`[PLAN] buildMeals - Meals to return: ${filtered.map(m => m.title).join(", ")}`);
  const firstDesc = filtered[0]?.description ?? "";
  if (useVegetarian || useVegan) {
    if (/frango|carne|peixe|atum|salmão|strogonoff de frango/i.test(firstDesc))
      console.error(`[PLAN] buildMeals - AVISO: dietType vegetariano/vegano mas descrição contém carne/peixe: ${firstDesc.slice(0, 80)}...`);
  }
  const ratioSum = filtered.reduce((acc, it) => acc + (it.ratio ?? 0), 0) || 1;

  return filtered.map((item) => {
    const r = (item.ratio ?? 0) / ratioSum;
    const calories = Math.round(base * r);
    const protein = Math.round(targetProtein * r);
    const carbs = Math.round(targetCarbs * r);
    const fat = Math.round(targetFat * r);

    return {
      title: item.title,
      description: `${item.description} • ${calories} kcal · Proteína ${protein}g · Carboidrato ${carbs}g · Gordura ${fat}g`,
      startTime: item.startTime,
      endTime: item.endTime,
      calories,
      protein,
      carbs,
      fat,
      source: "plan",
      sourceMeta: null,
    };
  });
};

const buildWorkouts = (onboarding: OnboardingData | null | undefined, workoutsPerDay?: number | null, variationSeed: number = 0) => {
  // Se workoutsPerDay for fornecido, usa ele; caso contrário usa workoutsPerWeek do onboarding
  const workoutsCount = workoutsPerDay ?? onboarding?.workoutsPerWeek ?? 3;
  const focusBase = ["Força", "Cardio", "Mobilidade"];
  const schedule: Array<{ title: string; focus?: string; startTime: string; endTime: string; intensity?: string }> = [];

  // Definir horários base baseado na experiência
  // Verificar tanto em português quanto em inglês
  const experience = String(onboarding?.experience || "").toLowerCase();
  const isBeginnerExperience = ["iniciante", "beginner", "nunca", "never"].some((exp) => experience.includes(exp));
  const baseTimePreference = isBeginnerExperience 
    ? { start: "07:30", end: "08:10" } 
    : { start: "18:30", end: "19:15" };

  // Função para distribuir horários ao longo do dia quando há múltiplos treinos
  const getWorkoutTime = (index: number, total: number) => {
    if (total === 1) {
      // Se há apenas 1 treino, usar o horário base
      return { start: baseTimePreference.start, end: baseTimePreference.end };
    }

    // Distribuir treinos ao longo do dia
    // Para iniciantes: manhã (06:00 - 12:00)
    // Para outros: tarde/noite (14:00 - 21:00)
    const isBeginner = isBeginnerExperience;
    
    if (isBeginner) {
      // Manhã: 06:00, 08:00, 10:00, 12:00
      const morningSlots = ["06:00", "08:00", "10:00", "12:00"];
      const startTime = morningSlots[index % morningSlots.length];
      const [hours, minutes] = startTime.split(":").map(Number);
      const duration = 40; // 40 minutos de duração
      let endHours = hours;
      let endMinutes = minutes + duration;
      if (endMinutes >= 60) {
        endHours += Math.floor(endMinutes / 60);
        endMinutes = endMinutes % 60;
      }
      const endTime = `${endHours.toString().padStart(2, "0")}:${endMinutes.toString().padStart(2, "0")}`;
      return { start: startTime, end: endTime };
    } else {
      // Tarde/Noite: 14:00, 16:00, 18:00, 20:00
      const afternoonSlots = ["14:00", "16:00", "18:00", "20:00"];
      const startTime = afternoonSlots[index % afternoonSlots.length];
      const [hours, minutes] = startTime.split(":").map(Number);
      const duration = 45; // 45 minutos de duração
      let endHours = hours;
      let endMinutes = minutes + duration;
      if (endMinutes >= 60) {
        endHours += Math.floor(endMinutes / 60);
        endMinutes = endMinutes % 60;
      }
      const endTime = `${endHours.toString().padStart(2, "0")}:${endMinutes.toString().padStart(2, "0")}`;
      return { start: startTime, end: endTime };
    }
  };

  const intensityLabel = (() => {
    const a = String(onboarding?.activityLevel || "").toLowerCase();
    if (["sedentary", "sedentário", "sedentaria"].some((w) => a.includes(w))) return "leve";
    if (["heavy", "muito", "intenso"].some((w) => a.includes(w))) return "alta";
    if (["active", "ativo", "ativa", "regular"].some((w) => a.includes(w))) return "moderada";
    return "moderada";
  })();

  // Múltiplas variações de treinos para cada tipo (similar ao descSets das refeições)
  const workoutVariations = {
    força: [
      [
        "Foco: Força (full body)",
        "Aquecimento: 5–8 min + mobilidade leve",
        "Agachamento: 3× 8–12",
        "Supino/Flexão: 3× 8–12",
        "Remada: 3× 10–12",
        "Prancha: 3× 30–45s",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (torso e pernas)",
        "Aquecimento: 5–10 min dinâmico",
        "Agachamento com barra: 4× 6–10",
        "Desenvolvimento: 3× 8–10",
        "Leg press: 3× 10–15",
        "Rosca direta: 3× 10–12",
        "Alongamento: 5–8 min",
      ],
      [
        "Foco: Força (upper body)",
        "Aquecimento: 5 min mobilidade",
        "Supino reto: 4× 6–10",
        "Remada curvada: 4× 8–12",
        "Desenvolvimento com halteres: 3× 10–12",
        "Tríceps pulley: 3× 12–15",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (lower body)",
        "Aquecimento: 8–10 min",
        "Agachamento livre: 4× 8–12",
        "Levantamento terra: 3× 6–8",
        "Leg press: 4× 10–15",
        "Panturrilha: 4× 15–20",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Força (full body funcional)",
        "Aquecimento: 5–7 min",
        "Agachamento goblet: 3× 12–15",
        "Flexão de braço: 3× 10–15",
        "Remada unilateral: 3× 10–12 cada",
        "Prancha lateral: 3× 30–60s",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (push/pull)",
        "Aquecimento: 5–8 min",
        "Supino inclinado: 4× 8–10",
        "Remada alta: 3× 10–12",
        "Desenvolvimento: 3× 8–12",
        "Rosca martelo: 3× 10–15",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (core + pernas)",
        "Aquecimento: 5 min",
        "Agachamento búlgaro: 3× 10–12 cada",
        "Prancha: 4× 45–60s",
        "Abdominal: 3× 15–20",
        "Elevação pélvica: 3× 12–15",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (compostos)",
        "Aquecimento: 8–10 min",
        "Agachamento: 5× 5",
        "Supino: 5× 5",
        "Remada: 4× 6–8",
        "Prancha: 3× 60s",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Força (hipertrofia)",
        "Aquecimento: 5–7 min",
        "Agachamento: 4× 10–12",
        "Supino: 4× 10–12",
        "Remada: 4× 10–12",
        "Tríceps: 3× 12–15",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (resistência)",
        "Aquecimento: 5 min",
        "Agachamento: 3× 15–20",
        "Flexão: 3× 15–20",
        "Remada: 3× 15–20",
        "Prancha: 3× 45s",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (potência)",
        "Aquecimento: 10 min",
        "Agachamento com salto: 4× 5",
        "Supino explosivo: 4× 5",
        "Remada explosiva: 3× 6",
        "Prancha: 3× 30s",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Força (isometria)",
        "Aquecimento: 5 min",
        "Agachamento isométrico: 3× 45s",
        "Flexão isométrica: 3× 30s",
        "Prancha: 4× 60s",
        "Prancha lateral: 3× 30s cada",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Força (circuito)",
        "Aquecimento: 5 min",
        "Circuito 3x: Agachamento (12), Flexão (12), Remada (12), Prancha (30s)",
        "Descanso: 60s entre circuitos",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (superior)",
        "Aquecimento: 5–7 min",
        "Supino: 4× 8–10",
        "Remada: 4× 8–10",
        "Desenvolvimento: 3× 10–12",
        "Rosca + Tríceps: 3× 12–15",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (inferior)",
        "Aquecimento: 8 min",
        "Agachamento: 5× 8–10",
        "Leg press: 4× 12–15",
        "Extensão de perna: 3× 12–15",
        "Panturrilha: 4× 15–20",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Força (full body avançado)",
        "Aquecimento: 10 min",
        "Agachamento: 4× 6–8",
        "Supino: 4× 6–8",
        "Remada: 4× 6–8",
        "Desenvolvimento: 3× 8–10",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Força (calistenia)",
        "Aquecimento: 5 min",
        "Flexão: 4× 12–15",
        "Agachamento: 4× 15–20",
        "Barra fixa: 3× 8–12",
        "Prancha: 4× 45s",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (funcional)",
        "Aquecimento: 5–7 min",
        "Agachamento com peso: 4× 10–12",
        "Remada com halteres: 4× 10–12",
        "Desenvolvimento: 3× 10–12",
        "Prancha: 3× 45s",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (split A)",
        "Aquecimento: 5 min",
        "Agachamento: 5× 8–10",
        "Supino: 4× 8–10",
        "Remada: 4× 8–10",
        "Prancha: 3× 45s",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Força (split B)",
        "Aquecimento: 5 min",
        "Levantamento terra: 4× 6–8",
        "Desenvolvimento: 4× 8–10",
        "Remada alta: 3× 10–12",
        "Prancha lateral: 3× 30s",
        "Alongamento: 5 min",
      ],
    ],
    cardio: [
      [
        "Foco: Cardio",
        "Aquecimento: 5–10 min caminhada/corrida leve",
        "Principal: 20–30 min moderado (ou 10× 1min forte / 1min leve)",
        "Desaceleração: 5 min leve",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (corrida contínua)",
        "Aquecimento: 5 min caminhada",
        "Principal: 25–35 min corrida constante",
        "Desaceleração: 5 min caminhada",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Cardio (intervalado)",
        "Aquecimento: 5 min leve",
        "Principal: 8× 2min forte / 2min leve",
        "Desaceleração: 5 min leve",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (ciclismo)",
        "Aquecimento: 5 min leve",
        "Principal: 30–40 min moderado",
        "Desaceleração: 5 min leve",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (caminhada)",
        "Aquecimento: 3 min",
        "Principal: 40–50 min caminhada rápida",
        "Desaceleração: 3 min",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (HIIT)",
        "Aquecimento: 5 min",
        "Principal: 8× 30s máximo / 90s descanso",
        "Desaceleração: 5 min leve",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (escada)",
        "Aquecimento: 5 min",
        "Principal: 20–25 min subida/descida",
        "Desaceleração: 5 min",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (natação)",
        "Aquecimento: 5 min leve",
        "Principal: 20–30 min nado contínuo",
        "Desaceleração: 5 min leve",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (elíptico)",
        "Aquecimento: 5 min",
        "Principal: 25–35 min moderado",
        "Desaceleração: 5 min",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (remo)",
        "Aquecimento: 5 min",
        "Principal: 20–30 min remo contínuo",
        "Desaceleração: 5 min",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (dança)",
        "Aquecimento: 5 min",
        "Principal: 30–40 min dança aeróbica",
        "Desaceleração: 5 min",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (circuito)",
        "Aquecimento: 5 min",
        "Principal: 3x circuito (burpee, mountain climber, jumping jack) 30s cada",
        "Desaceleração: 5 min",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (esteira)",
        "Aquecimento: 5 min caminhada",
        "Principal: 25–35 min corrida",
        "Desaceleração: 5 min caminhada",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (outdoor)",
        "Aquecimento: 5 min",
        "Principal: 30–40 min corrida/caminhada ao ar livre",
        "Desaceleração: 5 min",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (baixo impacto)",
        "Aquecimento: 5 min",
        "Principal: 30–40 min caminhada rápida",
        "Desaceleração: 5 min",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Cardio (endurance)",
        "Aquecimento: 5 min",
        "Principal: 40–50 min ritmo constante",
        "Desaceleração: 5 min",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Cardio (fartlek)",
        "Aquecimento: 5 min",
        "Principal: 25 min alternando ritmos",
        "Desaceleração: 5 min",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (tempo run)",
        "Aquecimento: 5 min",
        "Principal: 20–25 min ritmo forte constante",
        "Desaceleração: 5 min",
        "Alongamento: 5 min",
      ],
      [
        "Foco: Cardio (recuperação)",
        "Aquecimento: 3 min",
        "Principal: 20–25 min muito leve",
        "Desaceleração: 3 min",
        "Alongamento: 8 min",
      ],
      [
        "Foco: Cardio (longo)",
        "Aquecimento: 5 min",
        "Principal: 50–60 min ritmo confortável",
        "Desaceleração: 5 min",
        "Alongamento: 8 min",
      ],
    ],
    mobilidade: [
      [
        "Foco: Mobilidade",
        "Aquecimento: 3–5 min movimentos articulares",
        "Rotina: 15–25 min (quadril, coluna torácica, ombros)",
        "Respiração: lenta e controlada",
        "Final: 3–5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (quadril)",
        "Aquecimento: 3 min",
        "Rotina: 20 min foco em quadril (pigeon, butterfly, hip circles)",
        "Respiração: profunda",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (coluna)",
        "Aquecimento: 3 min",
        "Rotina: 20 min foco em coluna (cat-cow, twists, extensões)",
        "Respiração: sincronizada",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (ombros)",
        "Aquecimento: 3 min",
        "Rotina: 20 min foco em ombros (pendulum, wall slides, band work)",
        "Respiração: controlada",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (full body)",
        "Aquecimento: 5 min",
        "Rotina: 25 min mobilidade geral",
        "Respiração: profunda e lenta",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (yoga flow)",
        "Aquecimento: 3 min",
        "Rotina: 20–25 min sequência de yoga",
        "Respiração: ujjayi",
        "Final: 5 min savasana",
      ],
      [
        "Foco: Mobilidade (alongamento)",
        "Aquecimento: 3 min",
        "Rotina: 20 min alongamento estático",
        "Respiração: lenta",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (dinâmica)",
        "Aquecimento: 3 min",
        "Rotina: 20 min movimentos dinâmicos",
        "Respiração: ritmada",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (tornozelos)",
        "Aquecimento: 3 min",
        "Rotina: 15 min foco em tornozelos e pés",
        "Respiração: normal",
        "Final: 3 min relaxamento",
      ],
      [
        "Foco: Mobilidade (pescoço)",
        "Aquecimento: 2 min",
        "Rotina: 15 min foco em pescoço e cervical",
        "Respiração: suave",
        "Final: 3 min relaxamento",
      ],
      [
        "Foco: Mobilidade (reabilitação)",
        "Aquecimento: 3 min",
        "Rotina: 20 min movimentos suaves",
        "Respiração: controlada",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (flexibilidade)",
        "Aquecimento: 5 min",
        "Rotina: 25 min alongamento profundo",
        "Respiração: profunda",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (ativa)",
        "Aquecimento: 3 min",
        "Rotina: 20 min mobilidade ativa",
        "Respiração: normal",
        "Final: 3 min relaxamento",
      ],
      [
        "Foco: Mobilidade (passiva)",
        "Aquecimento: 3 min",
        "Rotina: 20 min mobilidade passiva",
        "Respiração: lenta",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (matinal)",
        "Aquecimento: 2 min",
        "Rotina: 15 min rotina matinal",
        "Respiração: profunda",
        "Final: 3 min relaxamento",
      ],
      [
        "Foco: Mobilidade (noturna)",
        "Aquecimento: 3 min",
        "Rotina: 20 min rotina noturna relaxante",
        "Respiração: muito lenta",
        "Final: 5 min relaxamento profundo",
      ],
      [
        "Foco: Mobilidade (pré-treino)",
        "Aquecimento: 2 min",
        "Rotina: 15 min preparação para treino",
        "Respiração: normal",
        "Final: 2 min",
      ],
      [
        "Foco: Mobilidade (pós-treino)",
        "Aquecimento: 2 min",
        "Rotina: 20 min recuperação",
        "Respiração: profunda",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (pilates)",
        "Aquecimento: 3 min",
        "Rotina: 25 min exercícios de pilates",
        "Respiração: controlada",
        "Final: 5 min relaxamento",
      ],
      [
        "Foco: Mobilidade (tai chi)",
        "Aquecimento: 3 min",
        "Rotina: 20 min movimentos de tai chi",
        "Respiração: sincronizada",
        "Final: 5 min meditação",
      ],
    ],
  };

  const workoutDetails = (focus: string, seed: number) => {
    const focusLower = focus.toLowerCase();
    if (focusLower === "cardio") {
      const variations = workoutVariations.cardio;
      return variations[seed % variations.length].join("\n");
    }
    if (focusLower === "mobilidade") {
      const variations = workoutVariations.mobilidade;
      return variations[seed % variations.length].join("\n");
    }
    // Força (default)
    const variations = workoutVariations.força;
    return variations[seed % variations.length].join("\n");
  };

  for (let i = 0; i < workoutsCount; i++) {
    const focus = focusBase[i % focusBase.length];
    // Usar variationSeed + índice com offset maior para garantir diferentes variações para cada treino
    // Multiplicar por um número maior para garantir mais variação entre treinos
    const workoutSeed = (variationSeed * 3 + i * 5) % 100;
    // Obter horário distribuído para este treino específico
    const workoutTime = getWorkoutTime(i, workoutsCount);
    schedule.push({
      title: `Treino de ${focus.toLowerCase()}`,
      focus: workoutDetails(focus, workoutSeed),
      startTime: workoutTime.start,
      endTime: workoutTime.end,
      intensity: intensityLabel,
    });
  }

  return schedule;
};

export async function generatePlanDraftForDate(options: {
  userId: string;
  date?: string | Date | null;
  onboarding?: OnboardingData | null;
  mealsPerDay?: number | null;
  workoutsPerDay?: number | null;
  variationOffset?: number; // Offset adicional para forçar variação
}) {
  const { userId, date, onboarding: onboardingInput, mealsPerDay, workoutsPerDay, variationOffset = 0 } = options;
  const targetDate = normalizeDate(date);

  const onboarding =
    onboardingInput ??
    (await prisma.onboarding.findUnique({
      where: { userId },
    }));

  const goalLabel = pickGoalLabel(onboarding as any);
  
  // Tentar calcular com IA primeiro, usar fallback matemático se falhar
  let targets = await calcTargetsWithAI(onboarding as any);
  if (!targets) {
    console.log("[PLAN] Usando cálculo matemático (fallback)");
    targets = calcTargets(onboarding as any);
  } else {
    console.log("[PLAN] Usando cálculo via IA");
  }
  const { calories, protein, carbs, fat } = targets;

  // seed de variação diária (0-6) baseado no dia da semana
  // Adicionar offset para forçar variação quando substituir refeição
  // Usar módulo maior para permitir mais variação
  const baseSeed = targetDate.getDay();
  const variationSeed = (baseSeed + variationOffset) % 20; // Aumentado de 7 para 20 para mais variação

  const rawDiet = (onboarding as any)?.dietType ?? null;
  const dietType = normalizeDietType(rawDiet);
  console.log(`[PLAN] ========== generatePlanDraftForDate ==========`);
  console.log(`[PLAN] dietType raw: ${rawDiet ?? "null"} -> normalized: ${dietType ?? "none"}`);
  console.log(`[PLAN] Calling buildMeals with mealsPerDay: ${mealsPerDay}, dietType: ${dietType || "none"}`);
  const meals = buildMeals(calories, protein, carbs, fat, variationSeed, mealsPerDay, dietType);
  console.log(`[PLAN] buildMeals returned ${meals.length} meals`);
  console.log(`[PLAN] Meals titles: ${meals.map(m => m.title).join(", ")}`);
  const workouts = buildWorkouts(onboarding as any, workoutsPerDay, variationSeed);
  console.log(`[PLAN] =============================================`);

  return { targetDate, goalLabel, calories, meals, workouts };
}

export async function createPlanForDate(options: {
  userId: string;
  date?: string | Date | null;
  onboarding?: OnboardingData | null;
  mealsPerDay?: number | null;
  workoutsPerDay?: number | null;
  replaceWhat?: "all" | "meals" | "workouts";
}) {
  const { userId, date, onboarding: onboardingInput, mealsPerDay, workoutsPerDay, replaceWhat = "all" } = options;
  console.log(`[PLAN] createPlanForDate called with: mealsPerDay=${mealsPerDay}, workoutsPerDay=${workoutsPerDay}, replaceWhat=${replaceWhat}`);
  const targetDate = normalizeDate(date);
  
  // Buscar plano existente
  const existingPlan = await prisma.planDay.findFirst({
    where: { userId, date: targetDate },
    include: { meals: true, workouts: true },
  });

  // Gerar novo plano baseado no que precisa ser substituído
  // IMPORTANTE: Se replaceWhat não for fornecido E existe plano, assumir "all" para substituir tudo
  // Se replaceWhat não for fornecido E não existe plano, assumir "all" também
  const effectiveReplaceWhat = replaceWhat || "all";
  const shouldReplaceMeals = effectiveReplaceWhat === "all" || effectiveReplaceWhat === "meals";
  const shouldReplaceWorkouts = effectiveReplaceWhat === "all" || effectiveReplaceWhat === "workouts";
  
  console.log(`[PLAN] createPlanForDate - replaceWhat: ${replaceWhat}, effectiveReplaceWhat: ${effectiveReplaceWhat}, shouldReplaceMeals: ${shouldReplaceMeals}, shouldReplaceWorkouts: ${shouldReplaceWorkouts}`);
  
  let newMeals: any[] = [];
  let newWorkouts: any[] = [];
  let goalLabel: string | null = null;
  let calories: number | null = null;

  // Se precisa substituir algo, gerar o draft
  if (shouldReplaceMeals || shouldReplaceWorkouts) {
    console.log(`[PLAN] ========== GENERATING DRAFT ==========`);
    console.log(`[PLAN] shouldReplaceMeals: ${shouldReplaceMeals}, mealsPerDay: ${mealsPerDay} (type: ${typeof mealsPerDay})`);
    console.log(`[PLAN] shouldReplaceWorkouts: ${shouldReplaceWorkouts}, workoutsPerDay: ${workoutsPerDay} (type: ${typeof workoutsPerDay})`);
    
    // Usar offset maior quando substituir para garantir variação (especialmente para refeições e treinos)
    // Se está substituindo, adicionar um offset baseado na data, hora atual e no tipo de substituição
    // Isso garante que as refeições sejam diferentes a cada substituição
    const variationOffset = existingPlan 
      ? Math.floor((Date.now() % 10000) / 100) + (shouldReplaceWorkouts ? 50 : 0) + (shouldReplaceMeals ? 25 : 0) + Math.floor(targetDate.getTime() % 100)
      : 0;
    
    const draft = await generatePlanDraftForDate({
      userId,
      date,
      onboarding: onboardingInput,
      mealsPerDay: shouldReplaceMeals ? mealsPerDay : undefined,
      workoutsPerDay: shouldReplaceWorkouts ? workoutsPerDay : undefined,
      variationOffset,
    });
    newMeals = shouldReplaceMeals ? draft.meals : [];
    newWorkouts = shouldReplaceWorkouts ? draft.workouts : [];
    goalLabel = draft.goalLabel;
    calories = draft.calories;
    console.log(`[PLAN] Draft generated - ${newMeals.length} meals, ${newWorkouts.length} workouts`);
    console.log(`[PLAN] ======================================`);
  }

  // Se existe plano, atualizar
  if (existingPlan) {
    console.log(`[PLAN] ========== EXISTING PLAN FOUND ==========`);
    console.log(`[PLAN] Existing plan: ${existingPlan.meals.length} meals, ${existingPlan.workouts.length} workouts`);
    console.log(`[PLAN] replaceWhat: ${replaceWhat}, effectiveReplaceWhat: ${effectiveReplaceWhat}`);
    console.log(`[PLAN] shouldReplaceMeals: ${shouldReplaceMeals}, shouldReplaceWorkouts: ${shouldReplaceWorkouts}`);
    console.log(`[PLAN] mealsPerDay: ${mealsPerDay}, workoutsPerDay: ${workoutsPerDay}`);
    console.log(`[PLAN] newMeals.length: ${newMeals.length}, newWorkouts.length: ${newWorkouts.length}`);
    
    // Se há novas refeições/treinos para criar E existe plano, SEMPRE substituir (a menos que replaceWhat seja explicitamente diferente)
    // Se replaceWhat não foi fornecido mas há mealsPerDay/workoutsPerDay, assumir que quer substituir
    if (!replaceWhat && (mealsPerDay || workoutsPerDay)) {
      console.log(`[PLAN] WARNING: replaceWhat not provided but mealsPerDay/workoutsPerDay provided, assuming replace="all"`);
      // Já está definido acima como "all", mas vamos garantir
    }
    
    // FORÇAR substituição se há novas refeições/treinos para criar
    if (newMeals.length > 0 || newWorkouts.length > 0) {
      console.log(`[PLAN] FORCING replacement because we have new items to create`);
      // Garantir que shouldReplaceMeals e shouldReplaceWorkouts estão corretos
      if (newMeals.length > 0) {
        console.log(`[PLAN] FORCING shouldReplaceMeals = true because newMeals.length = ${newMeals.length}`);
        // Não podemos reatribuir const, então vamos garantir na lógica abaixo
      }
    }
    
    // Calcular calorias totais (novas + existentes se não substituiu tudo)
    let finalCalories = calories;
    if (!shouldReplaceMeals && existingPlan.meals.length > 0) {
      const existingCalories = existingPlan.meals.reduce((sum: number, m: any) => sum + (m.calories || 0), 0);
      finalCalories = (finalCalories || 0) + existingCalories;
    } else if (shouldReplaceMeals && calories) {
      finalCalories = calories;
    } else if (existingPlan.totalCalories) {
      finalCalories = existingPlan.totalCalories;
    }

    // Usar transação para garantir que deleção e criação aconteçam de forma atômica
    console.log(`[PLAN] ========== STARTING REPLACEMENT TRANSACTION ==========`);
    console.log(`[PLAN] Plan ID: ${existingPlan.id}`);
    console.log(`[PLAN] replaceWhat: ${replaceWhat}, effectiveReplaceWhat: ${effectiveReplaceWhat}`);
    console.log(`[PLAN] shouldReplaceMeals: ${shouldReplaceMeals}, shouldReplaceWorkouts: ${shouldReplaceWorkouts}`);
    console.log(`[PLAN] Existing: ${existingPlan.meals.length} meals, ${existingPlan.workouts.length} workouts`);
    console.log(`[PLAN] New: ${newMeals.length} meals, ${newWorkouts.length} workouts`);
    console.log(`[PLAN] =====================================================`);
    
    const plan = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // IMPORTANTE: Deletar PRIMEIRO, antes de criar novos itens
      // Verificar quantos itens existem ANTES de deletar
      console.log(`[PLAN] ========== INSIDE TRANSACTION ==========`);
      console.log(`[PLAN] shouldReplaceMeals: ${shouldReplaceMeals}, newMeals.length: ${newMeals.length}`);
      console.log(`[PLAN] shouldReplaceWorkouts: ${shouldReplaceWorkouts}, newWorkouts.length: ${newWorkouts.length}`);
      
      // SEMPRE deletar se shouldReplaceMeals for true OU se há novas refeições para criar
      const mustDeleteMeals = shouldReplaceMeals || newMeals.length > 0;
      const mustDeleteWorkouts = shouldReplaceWorkouts || newWorkouts.length > 0;
      
      console.log(`[PLAN] mustDeleteMeals: ${mustDeleteMeals}, mustDeleteWorkouts: ${mustDeleteWorkouts}`);
      
      if (mustDeleteMeals) {
        const existingMealsCount = await tx.planMeal.count({ where: { planDayId: existingPlan.id } });
        console.log(`[PLAN] Checking for meals to delete: ${existingMealsCount} existing meals`);
        if (existingMealsCount > 0) {
          console.log(`[PLAN] DELETING ${existingMealsCount} existing meals for plan ${existingPlan.id}`);
          const deletedMeals = await tx.planMeal.deleteMany({ where: { planDayId: existingPlan.id } });
          console.log(`[PLAN] DELETED ${deletedMeals.count} meals`);
          
          // Verificar se realmente deletou
          const remainingMeals = await tx.planMeal.count({ where: { planDayId: existingPlan.id } });
          console.log(`[PLAN] Remaining meals after deletion: ${remainingMeals}`);
          if (remainingMeals > 0) {
            console.error(`[PLAN] ERROR: Still have ${remainingMeals} meals after deletion!`);
          }
        } else {
          console.log(`[PLAN] No existing meals to delete for plan ${existingPlan.id}`);
        }
      } else {
        console.log(`[PLAN] NOT deleting meals because mustDeleteMeals is ${mustDeleteMeals}`);
      }
      
      if (mustDeleteWorkouts) {
        const existingWorkoutsCount = await tx.planWorkout.count({ where: { planDayId: existingPlan.id } });
        if (existingWorkoutsCount > 0) {
          console.log(`[PLAN] Deleting ${existingWorkoutsCount} existing workouts for plan ${existingPlan.id}`);
          const deletedWorkouts = await tx.planWorkout.deleteMany({ where: { planDayId: existingPlan.id } });
          console.log(`[PLAN] Deleted ${deletedWorkouts.count} workouts`);
          
          // Verificar se realmente deletou
          const remainingWorkouts = await tx.planWorkout.count({ where: { planDayId: existingPlan.id } });
          console.log(`[PLAN] Remaining workouts after deletion: ${remainingWorkouts}`);
        } else {
          console.log(`[PLAN] No existing workouts to delete for plan ${existingPlan.id}`);
        }
      }

      // Atualizar plano existente e criar novos itens DENTRO da mesma transação
      // Só criar se houver novos itens para criar
      const updateData: any = {
        goal: goalLabel || existingPlan.goal,
        totalCalories: finalCalories || existingPlan.totalCalories,
      };
      
      if (newMeals.length > 0) {
        updateData.meals = { create: newMeals };
      }
      if (newWorkouts.length > 0) {
        updateData.workouts = { create: newWorkouts };
      }
      
      console.log(`[PLAN] Updating plan with ${newMeals.length} new meals and ${newWorkouts.length} new workouts`);
      const updatedPlan = await tx.planDay.update({
        where: { id: existingPlan.id },
        data: updateData,
        include: { meals: true, workouts: true },
      });
      
      console.log(`[PLAN] Plan updated. Final count: ${updatedPlan.meals.length} meals, ${updatedPlan.workouts.length} workouts`);
      return updatedPlan;
    });
    
    console.log(`[PLAN] Transaction completed. Plan updated with ${plan.meals.length} total meals and ${plan.workouts.length} total workouts`);

    return plan;
  } else {
    // Criar novo plano
    const plan = await prisma.planDay.create({
      data: {
        userId,
        date: targetDate,
        goal: goalLabel,
        totalCalories: calories,
        meals: { create: newMeals },
        workouts: { create: newWorkouts },
      },
      include: { meals: true, workouts: true },
    });

    return plan;
  }
}

