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

// GET - Listar notificações do usuário
export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const upcoming = searchParams.get("upcoming") === "true";
        const limit = parseInt(searchParams.get("limit") || "50");

        const where: any = {
            userId,
            cancelled: false,
        };

        if (upcoming) {
            where.scheduledFor = { gte: new Date() };
            where.sent = false;
        }

        const notifications = await prisma.notification.findMany({
            where,
            orderBy: { scheduledFor: "asc" },
            take: limit,
        });

        return NextResponse.json({ notifications });
    } catch (error: any) {
        console.error("[NOTIFICATIONS] GET error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao buscar notificações" },
            { status: 500 }
        );
    }
}

// POST - Criar notificação
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const body = await req.json();
        const { type, title, body: bodyText, scheduledFor, relatedId, relatedType } = body;

        if (!type || !title || !bodyText || !scheduledFor) {
            return NextResponse.json(
                { error: "Campos obrigatórios: type, title, body, scheduledFor" },
                { status: 400 }
            );
        }

        const notification = await prisma.notification.create({
            data: {
                userId,
                type,
                title,
                body: bodyText,
                scheduledFor: new Date(scheduledFor),
                relatedId: relatedId || null,
                relatedType: relatedType || null,
            },
        });

        return NextResponse.json({ notification }, { status: 201 });
    } catch (error: any) {
        console.error("[NOTIFICATIONS] POST error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao criar notificação" },
            { status: 500 }
        );
    }
}

// DELETE - Cancelar notificação
export async function DELETE(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json({ error: "ID da notificação é obrigatório" }, { status: 400 });
        }

        await prisma.notification.update({
            where: { id },
            data: {
                cancelled: true,
                cancelledAt: new Date(),
            },
        });

        return NextResponse.json({ message: "Notificação cancelada" });
    } catch (error: any) {
        console.error("[NOTIFICATIONS] DELETE error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao cancelar notificação" },
            { status: 500 }
        );
    }
}


