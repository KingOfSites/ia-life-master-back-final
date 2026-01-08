import { prisma } from "@/lib/prisma";

type OnboardingData = {
  goalPrimary?: string | null;
  goals?: string | null;
  workoutsPerWeek?: number | null;
  experience?: string | null;
  activityLevel?: string | null;
  weightKg?: number | null;
};

export const normalizeDate = (value?: string | Date | null): Date => {
  const d = value ? new Date(value) : new Date();
  const normalized = new Date(d);
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

const calcTargets = (onboarding: OnboardingData | null | undefined) => {
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
  // Fatores de atividade
  // -------------------------
  const activityFactorMap: Record<string, number> = {
    sedentary: 1.2,
    regular: 1.45,
    heavy: 1.6,
  };

  const activityFactor = activityFactorMap[activityLevel] ?? 1.4;

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
    calories += 250;

    if (weight && targetWeight && targetWeight > weight) {
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
  // Macros (aprox.)
  // -------------------------
  const proteinPerKg =
    goal === "gain" ? 1.8 : 2.0;

  const protein = weight
    ? Math.round(weight * proteinPerKg)
    : Math.round((calories * 0.3) / 4);

  const carbs = Math.round((calories * 0.4) / 4);
  const fat = Math.round((calories * 0.3) / 9);

  return { calories, protein, carbs, fat };
};


const buildMeals = (
  totalCalories: number,
  targetProtein: number,
  targetCarbs: number,
  targetFat: number,
  variationSeed: number,
  mealsPerDay?: number | null,
) => {
  const base = totalCalories || 2000;
  const mealsCountRaw = typeof mealsPerDay === "number" ? mealsPerDay : null;
  const mealsCount = mealsCountRaw ? Math.max(3, Math.min(6, Math.round(mealsCountRaw))) : 6;

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
  

  const descSets = [
    {
      cafe: "Ovos + aveia + fruta; café ou chá sem açúcar.",
      lanche1: "Iogurte + castanhas; ou queijo branco + fruta.",
      almoco: "Proteína magra, arroz integral/batata, legumes e salada.",
      lanche2: "Sanduíche integral com frango/atum; ou shake proteico.",
      jantar: "Proteína leve + legumes; carbo moderado se treinar à noite.",
      ceia: "Iogurte/queijo + fruta vermelha ou castanhas.",
    },
    {
      cafe: "Tapioca com ovo/queijo + fruta cítrica.",
      lanche1: "Barra proteica ou iogurte + sementes.",
      almoco: "Carne magra/peixe, fonte de carboidrato (arroz/batata/mandioca) e salada colorida.",
      lanche2: "Fruta + pasta de amendoim; ou wrap de frango.",
      jantar: "Peixe/frango + legumes salteados; pouco carbo.",
      ceia: "Leite/veg + cacau ou kefir + canela.",
    },
    {
      cafe: "Pão integral + cottage/peito de peru + fruta.",
      lanche1: "Mix de nuts ou ovo cozido + fruta.",
      almoco: "Proteína, grão (feijão/grão-de-bico) e folhas.",
      lanche2: "Iogurte grego + granola moderada.",
      jantar: "Omelete de claras/ovos + legumes; salada.",
      ceia: "Chá + fonte proteica leve.",
    },
  ];

  const ratio = ratioPresets[variationSeed % ratioPresets.length];
  const desc = descSets[variationSeed % descSets.length];

  const split = [
    { title: "Café da manhã", ratio: ratio[0], startTime: "07:00", endTime: "07:30", description: desc.cafe },
    { title: "Lanche da manhã", ratio: ratio[1], startTime: "10:00", endTime: "10:15", description: desc.lanche1 },
    { title: "Almoço", ratio: ratio[2], startTime: "12:30", endTime: "13:00", description: desc.almoco },
    { title: "Lanche da tarde", ratio: ratio[3], startTime: "16:00", endTime: "16:20", description: desc.lanche2 },
    { title: "Jantar", ratio: ratio[4], startTime: "19:30", endTime: "20:00", description: desc.jantar },
    { title: "Ceia (opcional)", ratio: ratio[5], startTime: "22:00", endTime: "22:15", description: desc.ceia },
  ];

  const indicesByCount: Record<number, number[]> = {
    6: [0, 1, 2, 3, 4, 5],
    5: [0, 1, 2, 3, 4],
    4: [0, 2, 3, 4],
    3: [0, 2, 4],
  };

  const indices = indicesByCount[mealsCount] ?? indicesByCount[6];
  const filtered = split.filter((_, idx) => indices.includes(idx));
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

const buildWorkouts = (onboarding: OnboardingData | null | undefined, workoutsPerDay?: number | null) => {
  // Se workoutsPerDay for fornecido, usa ele; caso contrário usa workoutsPerWeek do onboarding
  const workoutsCount = workoutsPerDay ?? onboarding?.workoutsPerWeek ?? 3;
  const focusBase = ["Força", "Cardio", "Mobilidade"];
  const schedule: Array<{ title: string; focus?: string; startTime: string; endTime: string; intensity?: string }> = [];

  const timePreference =
    onboarding?.experience === "iniciante" ? { start: "07:30", end: "08:10" } : { start: "18:30", end: "19:15" };

  for (let i = 0; i < workoutsCount; i++) {
    const focus = focusBase[i % focusBase.length];
    schedule.push({
      title: `Treino de ${focus.toLowerCase()}`,
      focus,
      startTime: timePreference.start,
      endTime: timePreference.end,
      intensity: onboarding?.activityLevel ?? "moderado",
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
}) {
  const { userId, date, onboarding: onboardingInput, mealsPerDay, workoutsPerDay } = options;
  const targetDate = normalizeDate(date);

  const onboarding =
    onboardingInput ??
    (await prisma.onboarding.findUnique({
      where: { userId },
    }));

  const goalLabel = pickGoalLabel(onboarding as any);
  const { calories, protein, carbs, fat } = calcTargets(onboarding as any);

  // seed de variação diária (0-6) baseado no dia da semana
  const variationSeed = targetDate.getDay();

  const meals = buildMeals(calories, protein, carbs, fat, variationSeed, mealsPerDay);
  const workouts = buildWorkouts(onboarding as any, workoutsPerDay);

  return { targetDate, goalLabel, calories, meals, workouts };
}

export async function createPlanForDate(options: {
  userId: string;
  date?: string | Date | null;
  onboarding?: OnboardingData | null;
  mealsPerDay?: number | null;
  workoutsPerDay?: number | null;
}) {
  const { userId, date, onboarding: onboardingInput, mealsPerDay, workoutsPerDay } = options;
  const { targetDate, goalLabel, calories, meals, workouts } = await generatePlanDraftForDate({
    userId,
    date,
    onboarding: onboardingInput,
    mealsPerDay,
    workoutsPerDay,
  });

  await prisma.planDay.deleteMany({ where: { userId, date: targetDate } });

  const plan = await prisma.planDay.create({
    data: {
      userId,
      date: targetDate,
      goal: goalLabel,
      totalCalories: calories,
      meals: { create: meals },
      workouts: { create: workouts },
    },
    include: { meals: true, workouts: true },
  });

  return plan;
}

