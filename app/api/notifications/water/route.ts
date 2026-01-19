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

// POST - Agendar notificações de água (a cada hora)
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const body = await req.json();
        const startHour = body.startHour || 8; // Começar às 8h
        const endHour = body.endHour || 22; // Terminar às 22h
        const intervalHours = body.intervalHours || 1; // A cada 1 hora

        // Cancelar notificações de água anteriores não enviadas
        // Verificar se o modelo Notification existe no Prisma Client
        if (!prisma.notification) {
            console.error("[NOTIFICATIONS] Prisma Client não tem modelo Notification. Execute 'npx prisma generate'.");
            return NextResponse.json(
                { error: "Modelo de notificação não disponível. Execute 'npx prisma generate' no backend." },
                { status: 500 }
            );
        }

        try {
            await prisma.notification.updateMany({
                where: {
                    userId,
                    type: "water",
                    sent: false,
                    cancelled: false,
                },
                data: {
                    cancelled: true,
                    cancelledAt: new Date(),
                },
            });
        } catch (error: any) {
            // Se o modelo não existir, apenas logar e continuar
            if (error.message?.includes("notification") || error.message?.includes("Notification")) {
                console.warn("[NOTIFICATIONS] Modelo Notification não encontrado. Execute 'npx prisma generate'.");
            } else {
                throw error;
            }
        }

        const notifications = [];
        const now = new Date();
        const today = new Date(now);
        today.setHours(startHour, 0, 0, 0);

        // Criar notificações para hoje (apenas horas futuras)
        for (let hour = startHour; hour <= endHour; hour += intervalHours) {
            const notificationTime = new Date(today);
            notificationTime.setHours(hour, 0, 0, 0);

            // Só criar se for no futuro
            if (notificationTime > now) {
                try {
                    const notification = await prisma.notification.create({
                        data: {
                            userId,
                            type: "water",
                            title: "Hora de beber água! 💧",
                            body: "Lembre-se de manter-se hidratado. Beba um copo de água agora!",
                            scheduledFor: notificationTime,
                        },
                    });

                    notifications.push(notification);
                } catch (error: any) {
                    console.error("[NOTIFICATIONS] Erro ao criar notificação:", error);
                    // Continuar mesmo se houver erro
                }
            }
        }

        // Criar notificações para os próximos 7 dias
        for (let day = 1; day <= 7; day++) {
            const futureDate = new Date(today);
            futureDate.setDate(futureDate.getDate() + day);

            for (let hour = startHour; hour <= endHour; hour += intervalHours) {
                const notificationTime = new Date(futureDate);
                notificationTime.setHours(hour, 0, 0, 0);

                try {
                    const notification = await prisma.notification.create({
                        data: {
                            userId,
                            type: "water",
                            title: "Hora de beber água! 💧",
                            body: "Lembre-se de manter-se hidratado. Beba um copo de água agora!",
                            scheduledFor: notificationTime,
                        },
                    });

                    notifications.push(notification);
                } catch (error: any) {
                    console.error("[NOTIFICATIONS] Erro ao criar notificação:", error);
                    // Continuar mesmo se houver erro
                }
            }
        }

        return NextResponse.json({ 
            message: "Notificações de água agendadas",
            count: notifications.length,
            notifications 
        });
    } catch (error: any) {
        console.error("[NOTIFICATIONS] WATER error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao agendar notificações de água" },
            { status: 500 }
        );
    }
}

