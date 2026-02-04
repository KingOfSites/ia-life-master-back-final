/**
 * Sistema de níveis e XP baseado em conquistas.
 * Cada conquista (badge desbloqueado) dá uma quantidade fixa de XP conforme a raridade.
 * O nível é calculado pela experiência total acumulada.
 */

/** XP concedido por raridade do badge ao desbloquear uma conquista */
export const XP_PER_RARITY: Record<string, number> = {
  common: 15,
  rare: 35,
  epic: 75,
  legendary: 150,
};

/** XP necessário no total para atingir cada nível (acumulado). Nível 1 = 0, nível 2 = 100, nível 3 = 250, etc. */
const XP_FOR_LEVEL: number[] = [0]; // índice 0 = nível 1
const XP_PER_LEVEL_BASE = 100;
for (let i = 1; i <= 100; i++) {
  XP_FOR_LEVEL.push(XP_FOR_LEVEL[i - 1] + XP_PER_LEVEL_BASE + (i - 1) * 25);
}

/**
 * Calcula o nível (1-based) a partir da experiência total.
 * Ex.: 0 XP = nível 1, 100 XP = nível 2, 250 XP = nível 3.
 */
export function levelFromExperience(experience: number): number {
  const exp = Math.max(0, Math.floor(experience));
  for (let level = XP_FOR_LEVEL.length; level >= 1; level--) {
    if (exp >= XP_FOR_LEVEL[level - 1]) return level;
  }
  return 1;
}

/**
 * XP necessário para subir do nível atual para o próximo.
 * Útil para exibir "X / Y XP" na barra de progresso.
 */
export function xpForNextLevel(currentLevel: number): number {
  if (currentLevel < 1 || currentLevel >= XP_FOR_LEVEL.length) return XP_PER_LEVEL_BASE;
  return XP_FOR_LEVEL[currentLevel] - XP_FOR_LEVEL[currentLevel - 1];
}

/**
 * XP total necessário para atingir um nível (para barra de progresso).
 */
export function xpTotalForLevel(level: number): number {
  if (level <= 1) return 0;
  return XP_FOR_LEVEL[level - 1] ?? 0;
}

/**
 * Retorna os pontos (XP) que uma conquista deve dar conforme a raridade do badge.
 */
export function getXpForRarity(rarity: string): number {
  const r = (rarity || "common").toLowerCase();
  return XP_PER_RARITY[r] ?? XP_PER_RARITY.common;
}

/**
 * Retorna o XP que um badge concede ao ser desbloqueado.
 * Usa xpReward do badge se estiver definido, senão usa o valor da raridade.
 */
export function getXpForBadge(badge: { xpReward?: number | null; rarity: string }): number {
  if (typeof badge.xpReward === "number" && badge.xpReward >= 0) {
    return badge.xpReward;
  }
  return getXpForRarity(badge.rarity);
}
