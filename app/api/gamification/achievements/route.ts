import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

function getUserIdFromToken(req: NextRequest): string | null {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) return null;

    const token = auth.slice(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        return decoded.userId;
    } catch {
        return null;
    }
}

// GET - Listar conquistas do usuário
export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const achievements = await prisma.achievement.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 50, // Últimas 50 conquistas
        });

        return NextResponse.json({ achievements });
    } catch (error: any) {
        console.error("[ACHIEVEMENTS] GET error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao buscar conquistas" },
            { status: 500 }
        );
    }
}


