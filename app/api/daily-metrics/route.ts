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

function parseDate(dateStr: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) return null;
    const d = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
    return isNaN(d.getTime()) ? null : d;
}

// GET - Buscar métricas diárias: ?date=YYYY-MM-DD (um dia) ou ?from=YYYY-MM-DD&to=YYYY-MM-DD (intervalo)
export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const dateStr = searchParams.get("date");
        const fromStr = searchParams.get("from");
        const toStr = searchParams.get("to");

        if (dateStr) {
            const date = parseDate(dateStr);
            if (!date) {
                return NextResponse.json({ error: "Data inválida. Use YYYY-MM-DD." }, { status: 400 });
            }
            const row = await prisma.dailyMetric.findUnique({
                where: { userId_date: { userId, date } },
            });
            return NextResponse.json({
                date: dateStr,
                waterMl: row?.waterMl ?? 0,
                sleepHours: row?.sleepHours ?? 0,
                steps: row?.steps ?? 0,
            });
        }

        if (fromStr && toStr) {
            const from = parseDate(fromStr);
            const to = parseDate(toStr);
            if (!from || !to || from > to) {
                return NextResponse.json({ error: "Datas inválidas. Use from e to em YYYY-MM-DD." }, { status: 400 });
            }
            const rows = await prisma.dailyMetric.findMany({
                where: {
                    userId,
                    date: { gte: from, lte: to },
                },
                orderBy: { date: "asc" },
            });
            const list = rows.map((r) => ({
                date: r.date.toISOString().slice(0, 10),
                waterMl: r.waterMl,
                sleepHours: r.sleepHours,
                steps: r.steps ?? 0,
            }));
            return NextResponse.json({ metrics: list });
        }

        return NextResponse.json({ error: "Informe date ou from e to." }, { status: 400 });
    } catch (error: any) {
        console.error("[DAILY-METRICS] GET error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao buscar métricas" },
            { status: 500 }
        );
    }
}

// POST - Salvar/atualizar água, sono e passos do dia. Body: { date: "YYYY-MM-DD", waterMl?: number, sleepHours?: number, steps?: number }
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const body = await req.json();
        const dateStr = body?.date;
        if (!dateStr || typeof dateStr !== "string") {
            return NextResponse.json({ error: "Campo 'date' (YYYY-MM-DD) é obrigatório." }, { status: 400 });
        }

        const date = parseDate(dateStr);
        if (!date) {
            return NextResponse.json({ error: "Data inválida. Use YYYY-MM-DD." }, { status: 400 });
        }

        const waterMl = body.waterMl != null ? Math.max(0, Math.round(Number(body.waterMl))) : undefined;
        const sleepHours = body.sleepHours != null ? Math.max(0, Number(body.sleepHours)) : undefined;
        const steps = body.steps != null ? Math.max(0, Math.round(Number(body.steps))) : undefined;

        const existing = await prisma.dailyMetric.findUnique({
            where: { userId_date: { userId, date } },
        });

        const data: { waterMl?: number; sleepHours?: number; steps?: number } = {};
        if (waterMl !== undefined) data.waterMl = waterMl;
        if (sleepHours !== undefined) data.sleepHours = sleepHours;
        if (steps !== undefined) data.steps = steps;

        if (Object.keys(data).length === 0) {
            const row = existing;
            return NextResponse.json({
                date: dateStr,
                waterMl: row?.waterMl ?? 0,
                sleepHours: row?.sleepHours ?? 0,
                steps: row?.steps ?? 0,
            });
        }

        let row;
        if (existing) {
            row = await prisma.dailyMetric.update({
                where: { id: existing.id },
                data: {
                    ...(waterMl !== undefined && { waterMl }),
                    ...(sleepHours !== undefined && { sleepHours }),
                    ...(steps !== undefined && { steps }),
                },
            });
        } else {
            row = await prisma.dailyMetric.create({
                data: {
                    userId,
                    date,
                    waterMl: waterMl ?? 0,
                    sleepHours: sleepHours ?? 0,
                    steps: steps ?? 0,
                },
            });
        }

        return NextResponse.json({
            date: dateStr,
            waterMl: row.waterMl,
            sleepHours: row.sleepHours,
            steps: row.steps ?? 0,
        });
    } catch (error: any) {
        console.error("[DAILY-METRICS] POST error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao salvar métricas" },
            { status: 500 }
        );
    }
}
