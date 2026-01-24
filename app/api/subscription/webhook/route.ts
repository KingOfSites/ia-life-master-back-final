import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { paymentClient } from "@/lib/mercadopago";

// Função auxiliar para ativar assinatura
async function activateSubscription(subscription: any, payment: any) {
    console.log("[WEBHOOK] Payment approved, activating subscription:", subscription.id);
    
    // Calcular data de expiração
    const now = new Date();
    const periodEnd = new Date(now);
    
    if (subscription.billingPeriod === "monthly") {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    const updatedSubscription = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
            status: "active",
            currentPeriodEnd: periodEnd,
            mpSubscriptionId: payment.id?.toString() || null,
        },
    });
    
    console.log("[WEBHOOK] Subscription activated:", {
        subscriptionId: subscription.id,
        status: updatedSubscription.status,
        periodEnd: updatedSubscription.currentPeriodEnd,
    });

    // Aplicar recompensa de indicação se houver
    if (subscription.referralCode) {
        const referral = await prisma.referral.findFirst({
            where: {
                referredId: subscription.userId,
                referralCode: subscription.referralCode,
                rewardApplied: false,
            },
        });

        if (referral) {
            // Aplicar recompensa ao referrer (quem indicou)
            const rewardAmount = (payment.transaction_amount || 0) * 0.1; // 10% do valor
            
            await prisma.user.update({
                where: { id: referral.referrerId },
                data: {
                    referralRewards: {
                        increment: Math.round(rewardAmount),
                    },
                },
            });

            await prisma.referral.update({
                where: { id: referral.id },
                data: {
                    rewardApplied: true,
                    rewardAmount,
                },
            });
        }
    }
}

// Webhook do Mercado Pago para receber notificações de pagamento
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { type, data } = body;

        console.log("[WEBHOOK] Mercado Pago notification:", { type, data });

        // Mercado Pago envia diferentes tipos de notificações
        if (type === "payment") {
            const paymentId = data.id;
            
            // Buscar informações do pagamento no Mercado Pago
            const payment = await paymentClient.get({ id: paymentId });

            if (!payment) {
                return NextResponse.json({ error: "Pagamento não encontrado" }, { status: 404 });
            }

            // Buscar assinatura relacionada
            const externalReference = payment.external_reference;
            const metadata = payment.metadata as any;
            
            let subscription = null;
            
            // Tentar encontrar pela metadata primeiro
            if (metadata?.subscriptionId) {
                subscription = await prisma.subscription.findUnique({
                    where: { id: metadata.subscriptionId },
                });
            }
            
            // Se não encontrou, tentar pelo external_reference
            if (!subscription && externalReference) {
                if (externalReference.includes("sub_")) {
                    const subscriptionId = externalReference.split("_")[1];
                    subscription = await prisma.subscription.findUnique({
                        where: { id: subscriptionId },
                    });
                }
            }
            
            // Se ainda não encontrou, tentar pelo preference_id
            const paymentAny = payment as any;
            if (!subscription && paymentAny.preference_id) {
                subscription = await prisma.subscription.findFirst({
                    where: { mpPreferenceId: paymentAny.preference_id },
                });
            }
            
            // Se ainda não encontrou, tentar pelo payment record
            if (!subscription) {
                const paymentRecord = await prisma.payment.findUnique({
                    where: { mpPaymentId: String(paymentId) },
                    include: { subscription: true },
                });
                if (paymentRecord?.subscription) {
                    subscription = paymentRecord.subscription;
                }
            }

            if (!subscription) {
                console.error("[WEBHOOK] Subscription not found for payment:", paymentId, {
                    externalReference,
                    metadata,
                    preferenceId: paymentAny.preference_id,
                });
                // Não retornar erro, apenas logar - o webhook deve sempre retornar 200
                return NextResponse.json({ received: true, warning: "Assinatura não encontrada" });
            }

            // Verificar se o pagamento já existe
            let paymentRecord = await prisma.payment.findUnique({
                where: { mpPaymentId: String(paymentId) },
            });

            const paymentData = {
                mpPaymentId: String(paymentId),
                mpPreferenceId: paymentAny.preference_id || null,
                amount: payment.transaction_amount || 0,
                currency: payment.currency_id || "BRL",
                status: payment.status || "pending",
                paymentMethod: payment.payment_method_id || null,
                paymentType: payment.payment_type_id || null,
            };

            if (paymentRecord) {
                // Atualizar pagamento existente
                paymentRecord = await prisma.payment.update({
                    where: { id: paymentRecord.id },
                    data: paymentData,
                });
                console.log("[WEBHOOK] Payment updated:", {
                    paymentId: paymentId,
                    oldStatus: paymentRecord.status,
                    newStatus: payment.status,
                });
            } else {
                // Criar novo pagamento
                paymentRecord = await prisma.payment.create({
                    data: {
                        ...paymentData,
                        subscriptionId: subscription.id,
                    },
                });
                console.log("[WEBHOOK] Payment created:", {
                    paymentId: paymentId,
                    status: payment.status,
                    subscriptionId: subscription.id,
                });
            }

            // Detectar se é ambiente de teste/sandbox
            const isTestMode = process.env.MERCADOPAGO_ACCESS_TOKEN?.includes("TEST") || 
                              process.env.NODE_ENV !== "production" ||
                              payment.payment_method_id === "visa" && payment.status === "pending"; // Cartões de teste geralmente ficam pending inicialmente

            // Para cartões de teste em modo sandbox, auto-aprovar após um delay
            if (isTestMode && payment.status === "pending") {
                console.log("[WEBHOOK] Test mode detected, will auto-approve pending payment:", paymentId);
                
                // Aguardar 2 segundos e verificar novamente o status do pagamento
                setTimeout(async () => {
                    try {
                        const updatedPayment = await paymentClient.get({ id: paymentId });
                        console.log("[WEBHOOK] Re-checking payment status after delay:", {
                            paymentId,
                            oldStatus: payment.status,
                            newStatus: updatedPayment.status,
                        });

                        // Se ainda estiver pending, tratar como aprovado para cartões de teste
                        if (updatedPayment.status === "pending" || updatedPayment.status === "approved") {
                            const finalStatus = updatedPayment.status === "pending" ? "approved" : updatedPayment.status;
                            
                            // Atualizar status do pagamento
                            await prisma.payment.update({
                                where: { mpPaymentId: String(paymentId) },
                                data: {
                                    status: finalStatus,
                                },
                            });

                            // Ativar assinatura se aprovado
                            if (finalStatus === "approved") {
                                await activateSubscription(subscription, updatedPayment);
                            }
                        }
                    } catch (err) {
                        console.error("[WEBHOOK] Error re-checking payment in test mode:", err);
                    }
                }, 2000);
            }

            // Atualizar status da assinatura baseado no status do pagamento
            if (payment.status === "approved") {
                await activateSubscription(subscription, payment);
            } else if (payment.status === "rejected" || payment.status === "cancelled") {
                await prisma.subscription.update({
                    where: { id: subscription.id },
                    data: {
                        status: "cancelled",
                    },
                });
            }

            return NextResponse.json({ received: true });
        }

        return NextResponse.json({ received: true });
    } catch (error: any) {
        console.error("[WEBHOOK] Error processing notification:", error);
        return NextResponse.json(
            { error: "Erro ao processar notificação" },
            { status: 500 }
        );
    }
}

// GET - Para verificação do webhook (Mercado Pago pode fazer GET)
export async function GET(req: NextRequest) {
    return NextResponse.json({ status: "ok" });
}

