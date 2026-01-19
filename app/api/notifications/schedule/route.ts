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

// POST - Agendar notificações para refeições e treinos do dia
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const body = await req.json();
        const date = body.date ? new Date(body.date) : new Date();
        date.setHours(0, 0, 0, 0);

        // Buscar plano do dia
        const planDay = await prisma.planDay.findUnique({
            where: {
                userId_date: {
                    userId,
                    date,
                },
            },
            include: {
                meals: true,
                workouts: true,
            },
        });

        if (!planDay) {
            return NextResponse.json({ message: "Nenhum plano encontrado para este dia" });
        }

        const notifications = [];

        // Agendar notificações para refeições (15 minutos antes)
        for (const meal of planDay.meals) {
            const mealTime = new Date(date);
            const [hours, minutes] = meal.startTime.split(":").map(Number);
            mealTime.setHours(hours, minutes, 0, 0);

            const reminderTime = new Date(mealTime);
            reminderTime.setMinutes(reminderTime.getMinutes() - 15);

            // Só criar se a notificação for no futuro
            if (reminderTime > new Date()) {
                // Cancelar notificações anteriores para esta refeição
                await prisma.notification.updateMany({
                    where: {
                        userId,
                        relatedId: meal.id,
                        relatedType: "meal",
                        cancelled: false,
                    },
                    data: {
                        cancelled: true,
                        cancelledAt: new Date(),
                    },
                });

                const notification = await prisma.notification.create({
                    data: {
                        userId,
                        type: "meal",
                        title: `Refeição: ${meal.title}`,
                        body: meal.description || `Hora da sua refeição: ${meal.title}`,
                        scheduledFor: reminderTime,
                        relatedId: meal.id,
                        relatedType: "meal",
                    },
                });

                notifications.push(notification);
            }
        }

        // Agendar notificações para treinos (30 minutos antes)
        for (const workout of planDay.workouts) {
            const workoutTime = new Date(date);
            const [hours, minutes] = workout.startTime.split(":").map(Number);
            workoutTime.setHours(hours, minutes, 0, 0);

            const reminderTime = new Date(workoutTime);
            reminderTime.setMinutes(reminderTime.getMinutes() - 30);

            // Só criar se a notificação for no futuro
            if (reminderTime > new Date()) {
                // Cancelar notificações anteriores para este treino
                await prisma.notification.updateMany({
                    where: {
                        userId,
                        relatedId: workout.id,
                        relatedType: "workout",
                        cancelled: false,
                    },
                    data: {
                        cancelled: true,
                        cancelledAt: new Date(),
                    },
                });

                const notification = await prisma.notification.create({
                    data: {
                        userId,
                        type: "workout",
                        title: `Treino: ${workout.title}`,
                        body: workout.focus 
                            ? `Hora do seu treino: ${workout.title} - Foco: ${workout.focus}`
                            : `Hora do seu treino: ${workout.title}`,
                        scheduledFor: reminderTime,
                        relatedId: workout.id,
                        relatedType: "workout",
                    },
                });

                notifications.push(notification);
            }
        }

        return NextResponse.json({ 
            message: "Notificações agendadas",
            count: notifications.length,
            notifications 
        });
    } catch (error: any) {
        console.error("[NOTIFICATIONS] SCHEDULE error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao agendar notificações" },
            { status: 500 }
        );
    }
}


