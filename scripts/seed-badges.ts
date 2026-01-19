import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Sistema de níveis: cada categoria tem múltiplos níveis progressivos
const badgeGroups = [
    // ========== STREAKS (5 níveis) ==========
    {
        baseName: "Streak",
        category: "streak",
        icon: "flame",
        color: "#F59E0B",
        levels: [
            { level: 1, requirement: 1, description: "Complete 1 dia consecutivo", rarity: "common" },
            { level: 2, requirement: 7, description: "Complete 7 dias consecutivos", rarity: "rare" },
            { level: 3, requirement: 30, description: "Complete 30 dias consecutivos", rarity: "epic" },
            { level: 4, requirement: 100, description: "Complete 100 dias consecutivos", rarity: "legendary" },
            { level: 5, requirement: 365, description: "Complete 365 dias consecutivos", rarity: "legendary" },
        ],
    },
    
    // ========== REFEIÇÕES (6 níveis) ==========
    {
        baseName: "Refeições",
        category: "meals",
        icon: "restaurant",
        color: "#10B981",
        levels: [
            { level: 1, requirement: 1, description: "Registre sua primeira refeição", rarity: "common" },
            { level: 2, requirement: 10, description: "Registre 10 refeições", rarity: "common" },
            { level: 3, requirement: 50, description: "Registre 50 refeições", rarity: "rare" },
            { level: 4, requirement: 100, description: "Registre 100 refeições", rarity: "epic" },
            { level: 5, requirement: 500, description: "Registre 500 refeições", rarity: "legendary" },
            { level: 6, requirement: 1000, description: "Registre 1000 refeições", rarity: "legendary" },
        ],
    },
    
    // ========== CALORIAS (5 níveis) ==========
    {
        baseName: "Calorias",
        category: "calories",
        icon: "battery-charging",
        color: "#10B981",
        levels: [
            { level: 1, requirement: 1000, description: "Registre 1.000 calorias", rarity: "common" },
            { level: 2, requirement: 10000, description: "Registre 10.000 calorias", rarity: "rare" },
            { level: 3, requirement: 50000, description: "Registre 50.000 calorias", rarity: "epic" },
            { level: 4, requirement: 100000, description: "Registre 100.000 calorias", rarity: "legendary" },
            { level: 5, requirement: 500000, description: "Registre 500.000 calorias", rarity: "legendary" },
        ],
    },
    
    // ========== TREINOS (6 níveis) ==========
    {
        baseName: "Treinos",
        category: "workouts",
        icon: "barbell",
        color: "#EF4444",
        levels: [
            { level: 1, requirement: 1, description: "Complete seu primeiro treino", rarity: "common" },
            { level: 2, requirement: 5, description: "Complete 5 treinos", rarity: "common" },
            { level: 3, requirement: 25, description: "Complete 25 treinos", rarity: "rare" },
            { level: 4, requirement: 50, description: "Complete 50 treinos", rarity: "epic" },
            { level: 5, requirement: 100, description: "Complete 100 treinos", rarity: "legendary" },
            { level: 6, requirement: 250, description: "Complete 250 treinos", rarity: "legendary" },
        ],
    },
    
    // ========== PROTEÍNA (4 níveis) ==========
    {
        baseName: "Proteína",
        category: "protein",
        icon: "nutrition",
        color: "#DC2626",
        levels: [
            { level: 1, requirement: 100, description: "Consuma 100g de proteína", rarity: "common" },
            { level: 2, requirement: 1000, description: "Consuma 1.000g de proteína", rarity: "rare" },
            { level: 3, requirement: 5000, description: "Consuma 5.000g de proteína", rarity: "epic" },
            { level: 4, requirement: 10000, description: "Consuma 10.000g de proteína", rarity: "legendary" },
        ],
    },
    
    // ========== CARBOIDRATOS (3 níveis) ==========
    {
        baseName: "Carboidratos",
        category: "carbs",
        icon: "leaf",
        color: "#D97706",
        levels: [
            { level: 1, requirement: 500, description: "Consuma 500g de carboidratos", rarity: "common" },
            { level: 2, requirement: 5000, description: "Consuma 5.000g de carboidratos", rarity: "rare" },
            { level: 3, requirement: 25000, description: "Consuma 25.000g de carboidratos", rarity: "epic" },
        ],
    },
    
    // ========== GORDURAS (3 níveis) ==========
    {
        baseName: "Gorduras",
        category: "fat",
        icon: "water",
        color: "#2563EB",
        levels: [
            { level: 1, requirement: 200, description: "Consuma 200g de gordura", rarity: "common" },
            { level: 2, requirement: 2000, description: "Consuma 2.000g de gordura", rarity: "rare" },
            { level: 3, requirement: 10000, description: "Consuma 10.000g de gordura", rarity: "epic" },
        ],
    },
    
    // ========== EQUILÍBRIO (3 níveis) ==========
    {
        baseName: "Equilíbrio",
        category: "balance",
        icon: "balance",
        color: "#10B981",
        levels: [
            { level: 1, requirement: 1, description: "Registre refeições e treinos no mesmo dia", rarity: "common" },
            { level: 2, requirement: 7, description: "Registre refeições e treinos por 7 dias", rarity: "rare" },
            { level: 3, requirement: 30, description: "Registre refeições e treinos por 30 dias", rarity: "epic" },
        ],
    },
    
    // ========== DIVERSIDADE (3 níveis) ==========
    {
        baseName: "Diversidade",
        category: "diversity",
        icon: "restaurant",
        color: "#10B981",
        levels: [
            { level: 1, requirement: 5, description: "Registre 5 tipos diferentes de refeições", rarity: "common" },
            { level: 2, requirement: 20, description: "Registre 20 tipos diferentes de refeições", rarity: "rare" },
            { level: 3, requirement: 50, description: "Registre 50 tipos diferentes de refeições", rarity: "epic" },
        ],
    },
    
    // ========== CONSISTÊNCIA (3 níveis) ==========
    {
        baseName: "Consistência",
        category: "consistency",
        icon: "checkmark-circle",
        color: "#3B82F6",
        levels: [
            { level: 1, requirement: 3, description: "Registre refeições por 3 dias seguidos", rarity: "common" },
            { level: 2, requirement: 10, description: "Registre refeições por 10 dias seguidos", rarity: "rare" },
            { level: 3, requirement: 21, description: "Registre refeições por 21 dias seguidos", rarity: "epic" },
        ],
    },
];

async function main() {
    console.log("🌱 Populando badges com sistema de níveis...");

    for (const group of badgeGroups) {
        const maxLevel = group.levels.length;
        
        for (const levelData of group.levels) {
            const badgeName = `${group.baseName} Nível ${levelData.level}`;
            
            await prisma.badge.upsert({
                where: { 
                    name: badgeName,
                },
                update: {
                    description: levelData.description,
                    requirement: levelData.requirement,
                    rarity: levelData.rarity,
                    maxLevel: maxLevel,
                },
                create: {
                    name: badgeName,
                    description: levelData.description,
                    icon: group.icon,
                    color: group.color,
                    category: group.category,
                    requirement: levelData.requirement,
                    rarity: levelData.rarity,
                    level: levelData.level,
                    maxLevel: maxLevel,
                },
            });
            console.log(`✅ Badge criada: ${badgeName} (${levelData.requirement})`);
        }
    }

    console.log("✨ Badges populadas com sucesso!");
}

main()
    .catch((e) => {
        console.error("❌ Erro ao popular badges:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
