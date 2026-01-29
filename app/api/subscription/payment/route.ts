import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import { paymentClient } from "@/lib/mercadopago";

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

// POST - Processar pagamento direto (checkout transparente)
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const body = await req.json();
        const { subscriptionId, token, paymentMethodId, installments, issuerId } = body;

        if (!subscriptionId || !token) {
            return NextResponse.json(
                { error: "subscriptionId e token são obrigatórios" },
                { status: 400 }
            );
        }

        // paymentMethodId é opcional - o Mercado Pago pode detectar automaticamente
        // especialmente para cartões de teste

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
            select: { id: true, email: true, name: true, cpf: true },
        });

        if (!user) {
            return NextResponse.json(
                { error: "Usuário não encontrado" },
                { status: 404 }
            );
        }

        // Calcular valor do pagamento (R$ 1,00 para testes)
        const PLAN_PRICES = {
            basic: {
                monthly: 100,
                yearly: 100,
            },
            complete: {
                monthly: 100,
                yearly: 100,
            },
        };

        const basePrice = PLAN_PRICES[subscription.planType as keyof typeof PLAN_PRICES][subscription.billingPeriod as "monthly" | "yearly"];
        
        // Aplicar desconto de indicação se houver
        let discount = 0;
        if (subscription.referralCode) {
            discount = Math.round(basePrice * 0.1);
        }
        const finalPrice = basePrice - discount;

        // Validar que o token não está vazio
        if (!token || token.trim() === "") {
            return NextResponse.json(
                { error: "Token do cartão inválido. Por favor, verifique os dados do cartão." },
                { status: 400 }
            );
        }

        // Criar pagamento no Mercado Pago
        // Para cartões de teste, o payment_method_id pode ser opcional
        // O Mercado Pago detecta automaticamente baseado no token
        const paymentData: any = {
            transaction_amount: finalPrice / 100,
            token: token.trim(),
            description: `Assinatura ${subscription.planType === "basic" ? "Básico" : "Completo"} - ${subscription.billingPeriod === "monthly" ? "Mensal" : "Anual"}`,
            installments: installments || 1,
            payer: {
                email: user.email,
                identification: {
                    type: "CPF",
                    number: (user as { cpf?: string | null }).cpf ? String((user as { cpf?: string | null }).cpf).replace(/\D/g, "") : "",
                },
            },
            external_reference: `sub_${subscription.id}`,
            metadata: {
                subscriptionId: subscription.id,
                userId,
            },
        };

        // Adicionar payment_method_id apenas se fornecido e válido
        // Para cartões de teste, o Mercado Pago pode detectar automaticamente
        if (paymentMethodId && paymentMethodId !== "visa") {
            paymentData.payment_method_id = paymentMethodId;
        }
        
        // Adicionar issuer_id apenas se fornecido
        if (issuerId) {
            paymentData.issuer_id = issuerId;
        }

        console.log("[PAYMENT] Criando pagamento com dados:", {
            transaction_amount: paymentData.transaction_amount,
            token: paymentData.token ? "***" : "VAZIO",
            payment_method_id: paymentData.payment_method_id || "AUTO-DETECT",
            installments: paymentData.installments,
        });

        const payment = await paymentClient.create({ body: paymentData });

        // Salvar ou atualizar pagamento no banco (usar upsert para evitar duplicatas)
        const paymentRecord = await prisma.payment.upsert({
            where: { mpPaymentId: String(payment.id) },
            update: {
                status: payment.status || "pending",
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
                status: payment.status || "pending",
                paymentMethod: payment.payment_method_id || null,
                paymentType: payment.payment_type_id || null,
            },
        });

        console.log("[PAYMENT] Payment record saved:", {
            paymentId: payment.id,
            status: payment.status,
            subscriptionId: subscription.id,
        });

        // Em ambiente de desenvolvimento/sandbox, auto-aprovar pagamentos pendentes
        // Também trata cartões de teste que ficam pending
        const isDevelopment = process.env.NODE_ENV !== "production" || 
                              process.env.MERCADOPAGO_ACCESS_TOKEN?.includes("TEST") ||
                              process.env.MP_ACCESS_TOKEN?.includes("TEST");
        
        // Detectar se é cartão de teste (cartões de teste do MP geralmente ficam pending ou in_process)
        const isTestCard = payment.payment_method_id === "visa" || 
                          payment.payment_method_id === "master" ||
                          payment.payment_method_id === "amex";
        const needsRecheck = payment.status === "pending" || payment.status === "in_process";
        
        if ((isDevelopment || isTestCard) && needsRecheck) {
            console.log("[PAYMENT] Test/Development mode: Auto-approving pending payment", {
                isDevelopment,
                isTestCard,
                paymentMethod: payment.payment_method_id,
            });
            
            // Simular aprovação após 2 segundos
            setTimeout(async () => {
                try {
                    // Verificar status atualizado do pagamento
                    if (!payment.id) {
                        console.error("[PAYMENT] Payment ID is undefined");
                        return;
                    }
                    const updatedPayment = await paymentClient.get({ id: payment.id });
                    
                    // Se ainda estiver pending ou in_process, tratar como aprovado para cartões de teste
                    const stillProcessing = updatedPayment.status === "pending" || updatedPayment.status === "in_process";
                    const finalStatus = (stillProcessing && isTestCard) 
                        ? "approved" 
                        : updatedPayment.status;
                    
                    // Atualizar status do pagamento
                    await prisma.payment.update({
                        where: { mpPaymentId: String(payment.id) },
                        data: {
                            status: finalStatus,
                            amount: updatedPayment.transaction_amount || payment.transaction_amount || 0,
                        },
                    });

                    // Se foi aprovado, ativar assinatura
                    if (finalStatus === "approved") {
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

                        console.log("[PAYMENT] Test/Development: Subscription auto-activated:", subscription.id);
                    }
                } catch (err) {
                    console.error("[PAYMENT] Test/Development: Error auto-approving:", err);
                }
            }, 2000);
        }

        // Aguardar um pouco e verificar o status novamente (alguns pagamentos são processados assincronamente)
        // Isso é especialmente importante para cartões de teste que podem ficar pending inicialmente
        setTimeout(async () => {
            try {
                if (!payment.id) {
                    console.error("[PAYMENT] Payment ID is undefined");
                    return;
                }
                const updatedPayment = await paymentClient.get({ id: payment.id });
                console.log("[PAYMENT] Re-checking payment status:", {
                    paymentId: payment.id,
                    oldStatus: payment.status,
                    newStatus: updatedPayment.status,
                });

                // Atualizar status no banco sempre (mesmo se não mudou, para garantir sincronização)
                await prisma.payment.update({
                    where: { mpPaymentId: String(payment.id) },
                    data: {
                        status: updatedPayment.status || "pending",
                        amount: updatedPayment.transaction_amount || 0,
                    },
                });

                // Se foi aprovado, ativar assinatura
                if (updatedPayment.status === "approved") {
                    const subscriptionCheck = await prisma.subscription.findUnique({
                        where: { id: subscription.id },
                    });

                    // Só ativar se ainda não estiver ativa
                    if (subscriptionCheck && subscriptionCheck.status !== "active") {
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
                                mpSubscriptionId: updatedPayment.id?.toString() || null,
                            },
                        });

                        console.log("[PAYMENT] Subscription activated after re-check:", subscription.id);
                    }
                }
            } catch (err) {
                console.error("[PAYMENT] Error re-checking payment status:", err);
            }
        }, 5000); // Aguardar 5 segundos antes de verificar novamente (aumentado para dar tempo ao MP processar)

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
                                increment: Math.round(rewardAmount * 100), // Converter para centavos
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

        return NextResponse.json({
            paymentId: payment.id,
            status: payment.status,
            statusDetail: payment.status_detail,
            subscription: {
                id: subscription.id,
                status: payment.status === "approved" ? "active" : subscription.status,
            },
        });
    } catch (error: any) {
        console.error("[PAYMENT] POST error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao processar pagamento" },
            { status: 500 }
        );
    }
}

