import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import { paymentClient } from "@/lib/mercadopago";
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

// POST - Criar pagamento PIX
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const body = await req.json();
        const { subscriptionId } = body;

        if (!subscriptionId) {
            return NextResponse.json(
                { error: "subscriptionId é obrigatório" },
                { status: 400 }
            );
        }

        // Buscar assinatura
        const subscription = await prisma.subscription.findUnique({
            where: { id: subscriptionId },
        });

        if (!subscription) {
            return NextResponse.json(
                { error: "Assinatura não encontrada" },
                { status: 404 }
            );
        }

        if (subscription.userId !== userId) {
            return NextResponse.json(
                { error: "Não autorizado" },
                { status: 403 }
            );
        }

        // Buscar usuário
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            return NextResponse.json(
                { error: "Usuário não encontrado" },
                { status: 404 }
            );
        }

        // Calcular valor do pagamento (em centavos)
        const PLAN_PRICES = {
            basic: { monthly: 2990, yearly: 19900 },
            complete: { monthly: 4990, yearly: 39900 },
        };

        const basePrice = PLAN_PRICES[subscription.planType as keyof typeof PLAN_PRICES][subscription.billingPeriod as "monthly" | "yearly"];
        
        // Aplicar desconto de indicação se houver
        let discount = 0;
        if (subscription.referralCode) {
            discount = Math.round(basePrice * 0.1);
        }
        const finalPrice = basePrice - discount;

        // Criar pagamento PIX no Mercado Pago
        const paymentData = {
            transaction_amount: finalPrice / 100,
            description: `Assinatura ${subscription.planType === "basic" ? "Básico" : "Completo"} - ${subscription.billingPeriod === "monthly" ? "Mensal" : "Anual"}`,
            payment_method_id: "pix",
            payer: {
                email: user.email,
                first_name: user.name?.split(" ")[0] || "",
                last_name: user.name?.split(" ").slice(1).join(" ") || "",
                identification: {
                    type: "CPF",
                    number: "", // Pode ser coletado no frontend se necessário
                },
            },
            external_reference: `sub_${subscription.id}`,
            metadata: {
                subscriptionId: subscription.id,
                userId,
            },
        };

        const payment = await paymentClient.create({ body: paymentData });

        // Salvar ou atualizar pagamento no banco (usar upsert para evitar duplicatas)
        await prisma.payment.upsert({
            where: { mpPaymentId: String(payment.id) },
            update: {
                status: mapMpPaymentStatus(payment.status),
                amount: payment.transaction_amount || 0,
                paymentMethod: payment.payment_method_id || null,
                paymentType: payment.payment_type_id || null,
            },
            create: {
                subscriptionId: subscription.id,
                mpPaymentId: String(payment.id),
                mpPreferenceId: null,
                amount: payment.transaction_amount || 0,
                currency: payment.currency_id || "BRL",
                status: mapMpPaymentStatus(payment.status),
                paymentMethod: payment.payment_method_id || null,
                paymentType: payment.payment_type_id || null,
            },   
        });

        // Assinatura aguardando pagamento PIX (webhook atualizará: approved → active, cancelled → cancelled, expired → expired)
        await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: "pending_payment" },
        });

        // Em ambiente de desenvolvimento/sandbox, auto-aprovar pagamentos PIX pendentes
        const isDevelopment = process.env.NODE_ENV !== "production" || process.env.MP_ACCESS_TOKEN?.includes("TEST");
        if (isDevelopment && payment.status === "pending") {
            console.log("[PAYMENT_PIX] Development mode: Auto-approving pending PIX payment");
            
            // Simular aprovação após 3 segundos (PIX geralmente leva mais tempo)
            setTimeout(async () => {
                try {
                    // Atualizar status do pagamento para approved
                    await prisma.payment.update({
                        where: { mpPaymentId: String(payment.id) },
                        data: {
                            status: mapMpPaymentStatus("approved"),
                        },
                    });

                    // Ativar assinatura
                    const now = new Date();
                    const periodEnd = new Date(now);
                    
                    if (subscription.billingPeriod === "monthly") {
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                    } else {
                        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                    }

                    await prisma.subscription.update({
                        where: { id: subscription.id },
                        data: {
                            status: "active",
                            currentPeriodEnd: periodEnd,
                            mpSubscriptionId: payment.id?.toString() || null,
                        },
                    });

                    console.log("[PAYMENT_PIX] Development: Subscription auto-activated:", subscription.id);
                } catch (err) {
                    console.error("[PAYMENT_PIX] Development: Error auto-approving:", err);
                }
            }, 3000);
        }

        // Se aprovado, ativar assinatura
        if (payment.status === "approved") {
            const now = new Date();
            const periodEnd = new Date(now);
            
            if (subscription.billingPeriod === "monthly") {
                periodEnd.setMonth(periodEnd.getMonth() + 1);
            } else {
                periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            }

            await prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    status: "active",
                    currentPeriodEnd: periodEnd,
                    mpSubscriptionId: payment.id?.toString() || null,
                },
            });

            // Aplicar recompensa de indicação se houver
            if (subscription.referralCode) {
                const referral = await prisma.referral.findFirst({
                    where: {
                        referredId: userId,
                        referralCode: subscription.referralCode,
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
        } else if (payment.status === "rejected" || payment.status === "cancelled") {
            await prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    status: "cancelled",
                },
            });
        }

        // Retornar dados do PIX
        return NextResponse.json({
            paymentId: payment.id,
            status: payment.status,
            pixCode: payment.point_of_interaction?.transaction_data?.qr_code || null,
            pixCodeBase64: payment.point_of_interaction?.transaction_data?.qr_code_base64 || null,
            ticketUrl: payment.point_of_interaction?.transaction_data?.ticket_url || null,
            subscription: {
                id: subscription.id,
                status: payment.status === "approved" ? "active" : subscription.status,
            },
        });
    } catch (error: any) {
        console.error("[PAYMENT_PIX] POST error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao criar pagamento PIX" },
            { status: 500 }
        );
    }
}

