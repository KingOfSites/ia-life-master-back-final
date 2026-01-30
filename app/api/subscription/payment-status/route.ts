import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { paymentClient } from "@/lib/mercadopago";
import { prisma } from "@/lib/prisma";
import { mapMpPaymentStatus } from "@/lib/payment-status";

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

// GET - Verificar status do pagamento e atualizar assinatura se necessário
export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const paymentId = searchParams.get("paymentId");
        const subscriptionId = searchParams.get("subscriptionId");

        // Se não tiver paymentId, tentar buscar pela subscriptionId
        if (!paymentId && subscriptionId) {
            // Buscar o pagamento mais recente da assinatura
            const latestPayment = await prisma.payment.findFirst({
                where: {
                    subscriptionId: subscriptionId,
                    status: "pending",
                },
                orderBy: {
                    createdAt: "desc",
                },
                include: { subscription: true },
            });

            if (latestPayment) {
                // Buscar status atualizado no Mercado Pago
                const payment = await paymentClient.get({ id: latestPayment.mpPaymentId });
                
                // Atualizar status
                await prisma.payment.update({
                    where: { id: latestPayment.id },
                    data: {
                        status: mapMpPaymentStatus(payment.status),
                        amount: payment.transaction_amount || 0,
                    },
                });

                // Se aprovado, ativar assinatura
                if (payment.status === "approved" && latestPayment.subscription && latestPayment.subscription.status !== "active") {
                    const now = new Date();
                    const periodEnd = new Date(now);
                    
                    if (latestPayment.subscription.billingPeriod === "monthly") {
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                    } else {
                        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                    }

                    await prisma.subscription.update({
                        where: { id: latestPayment.subscription.id },
                        data: {
                            status: "active",
                            currentPeriodEnd: periodEnd,
                        },
                    });
                }

                return NextResponse.json({
                    paymentId: payment.id,
                    status: payment.status,
                    statusDetail: payment.status_detail,
                    subscriptionStatus: latestPayment.subscription?.status || null,
                });
            }
        }

        if (!paymentId) {
            return NextResponse.json(
                { error: "paymentId ou subscriptionId é obrigatório" },
                { status: 400 }
            );
        }

        // Buscar pagamento no Mercado Pago
        let payment = await paymentClient.get({ id: paymentId });

        // Em ambiente de desenvolvimento, se o pagamento estiver pendente há mais de 2 segundos, auto-aprovar
        const isDevelopment = process.env.NODE_ENV !== "production" || process.env.MP_ACCESS_TOKEN?.includes("TEST");
        if (isDevelopment && payment.status === "pending") {
            const paymentRecord = await prisma.payment.findUnique({
                where: { mpPaymentId: String(paymentId) },
                include: { subscription: true },
            });

            if (paymentRecord) {
                const createdAt = paymentRecord.createdAt;
                const now = new Date();
                const secondsSinceCreation = (now.getTime() - createdAt.getTime()) / 1000;

                // Se passou mais de 2 segundos desde a criação, auto-aprovar
                if (secondsSinceCreation > 2) {
                    console.log("[PAYMENT_STATUS] Development: Auto-approving pending payment after delay");
                    
                    // Simular status approved
                    payment = {
                        ...payment,
                        status: "approved",
                    } as any;

                    // Atualizar no banco (mapear approved → paid)
                    await prisma.payment.update({
                        where: { id: paymentRecord.id },
                        data: {
                            status: mapMpPaymentStatus("approved"),
                        },
                    });

                    // Ativar assinatura se necessário
                    if (paymentRecord.subscription && paymentRecord.subscription.status !== "active") {
                        const periodEnd = new Date();
                        if (paymentRecord.subscription.billingPeriod === "monthly") {
                            periodEnd.setMonth(periodEnd.getMonth() + 1);
                        } else {
                            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                        }

                        await prisma.subscription.update({
                            where: { id: paymentRecord.subscription.id },
                            data: {
                                status: "active",
                                currentPeriodEnd: periodEnd,
                            },
                        });
                    }
                }
            }
        }

        // Buscar pagamento no banco de dados
        const paymentRecord = await prisma.payment.findUnique({
            where: { mpPaymentId: String(paymentId) },
            include: { subscription: true },
        });

        // Atualizar status do pagamento no banco
        if (paymentRecord) {
            const oldStatus = paymentRecord.status;
            await prisma.payment.update({
                where: { id: paymentRecord.id },
                data: {
                    status: mapMpPaymentStatus(payment.status),
                    amount: payment.transaction_amount || 0,
                },
            });
            
            console.log("[PAYMENT_STATUS] Payment status updated:", {
                paymentId: paymentId,
                oldStatus,
                newStatus: payment.status,
            });

            // Se o pagamento foi aprovado e a assinatura ainda não está ativa, ativar
            if (payment.status === "approved" && paymentRecord.subscription && paymentRecord.subscription.status !== "active") {
                console.log("[PAYMENT_STATUS] Payment approved, activating subscription:", paymentRecord.subscription.id);
                const now = new Date();
                const periodEnd = new Date(now);
                
                if (paymentRecord.subscription.billingPeriod === "monthly") {
                    periodEnd.setMonth(periodEnd.getMonth() + 1);
                } else {
                    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                }

                await prisma.subscription.update({
                    where: { id: paymentRecord.subscription.id },
                    data: {
                        status: "active",
                        currentPeriodEnd: periodEnd,
                        mpSubscriptionId: payment.id?.toString() || null,
                    },
                });

                // Aplicar recompensa de indicação se houver
                if (paymentRecord.subscription.referralCode) {
                    const referral = await prisma.referral.findFirst({
                        where: {
                            referredId: userId,
                            referralCode: paymentRecord.subscription.referralCode,
                            rewardApplied: false,
                        },
                    });

                    if (referral) {
                        const rewardAmount = (payment.transaction_amount || 0) * 0.1;
                        
                        await prisma.user.update({
                            where: { id: referral.referrerId },
                            data: {
                                referralRewards: {
                                    increment: Math.round(rewardAmount * 100),
                                },
                            },
                        });

                        await prisma.referral.update({
                            where: { id: referral.id },
                            data: {
                                rewardApplied: true,
                                rewardAmount: rewardAmount,
                            },
                        });
                    }
                }
            } else if ((payment.status === "rejected" || payment.status === "cancelled") && paymentRecord.subscription) {
                // Se o pagamento foi rejeitado ou cancelado, cancelar a assinatura
                await prisma.subscription.update({
                    where: { id: paymentRecord.subscription.id },
                    data: {
                        status: "cancelled",
                    },
                });
            }
        }

        return NextResponse.json({
            paymentId: payment.id,
            status: payment.status,
            statusDetail: payment.status_detail,
            subscriptionStatus: paymentRecord?.subscription?.status || null,
        });
    } catch (error: any) {
        console.error("[PAYMENT_STATUS] GET error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao verificar status do pagamento" },
            { status: 500 }
        );
    }
}

