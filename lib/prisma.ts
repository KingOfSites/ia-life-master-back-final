import { PrismaClient } from "@prisma/client";

// Evita criar múltiplas instâncias em dev com hot-reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Configurar pool de conexões através da URL do banco
// Adicionar parâmetros de pool se não estiverem presentes na URL
function getDatabaseUrl(): string {
	const url = process.env.DATABASE_URL || "";
	
	// Se a URL já tiver parâmetros de pool, retornar como está
	if (url.includes("connection_limit") || url.includes("pool_timeout")) {
		return url;
	}
	
	// Adicionar parâmetros de pool para MySQL
	// connection_limit: número máximo de conexões no pool (padrão: número de CPUs * 2 + 1)
	// pool_timeout: tempo máximo para obter uma conexão do pool em segundos
	const separator = url.includes("?") ? "&" : "?";
	const poolParams = `${separator}connection_limit=20&pool_timeout=20`;
	
	return url + poolParams;
}

export const prisma =
	globalForPrisma.prisma ??
	new PrismaClient({
		log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error", "warn"],
		datasources: {
			db: {
				url: getDatabaseUrl(),
			},
		},
	});

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}

// Garantir que as conexões sejam fechadas adequadamente
process.on("beforeExit", async () => {
	await prisma.$disconnect();
});

process.on("SIGINT", async () => {
	await prisma.$disconnect();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	await prisma.$disconnect();
	process.exit(0);
});

