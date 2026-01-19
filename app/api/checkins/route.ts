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

// GET - Listar check-ins do usuário
export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const type = searchParams.get("type");
        const date = searchParams.get("date");
        const limit = parseInt(searchParams.get("limit") || "50");

        const where: any = { userId };

        if (type) {
            where.type = type;
        }

        if (date) {
            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(startDate);
            endDate.setHours(23, 59, 59, 999);

            where.createdAt = {
                gte: startDate,
                lte: endDate,
            };
        }

        const checkIns = await prisma.checkIn.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
        });

        return NextResponse.json({ checkIns });
    } catch (error: any) {
        console.error("[CHECKINS] GET error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao buscar check-ins" },
            { status: 500 }
        );
    }
}

// POST - Criar ou atualizar check-in
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const body = await req.json();
        const { type, relatedId, completed, skipped, skipReason } = body;

        if (!type) {
            return NextResponse.json(
                { error: "Campo 'type' é obrigatório" },
                { status: 400 }
            );
        }

        // Se for completar ou pular, verificar se já existe check-in hoje
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const existingCheckIn = await prisma.checkIn.findFirst({
            where: {
                userId,
                type,
                relatedId: relatedId || null,
                createdAt: {
                    gte: today,
                    lt: tomorrow,
                },
            },
        });

        let checkIn;

        if (existingCheckIn) {
            // Atualizar check-in existente
            checkIn = await prisma.checkIn.update({
                where: { id: existingCheckIn.id },
                data: {
                    completed: completed ?? existingCheckIn.completed,
                    completedAt: completed ? new Date() : existingCheckIn.completedAt,
                    skipped: skipped ?? existingCheckIn.skipped,
                    skipReason: skipReason || existingCheckIn.skipReason,
                },
            });
        } else {
            // Criar novo check-in
            checkIn = await prisma.checkIn.create({
                data: {
                    userId,
                    type,
                    relatedId: relatedId || null,
                    completed: completed ?? false,
                    completedAt: completed ? new Date() : null,
                    skipped: skipped ?? false,
                    skipReason: skipReason || null,
                },
            });
        }

        return NextResponse.json({ checkIn }, { status: existingCheckIn ? 200 : 201 });
    } catch (error: any) {
        console.error("[CHECKINS] POST error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao criar check-in" },
            { status: 500 }
        );
    }
}


