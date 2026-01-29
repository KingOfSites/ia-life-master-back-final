import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import { preApprovalPlanClient, preApprovalClient } from "@/lib/mercadopago";

// Cancelar preapproval no MP ao cancelar assinatura
async function cancelPreapprovalInMP(mpSubscriptionId: string | null) {
    if (!mpSubscriptionId) return;
    try {
        await preApprovalClient.update({
            id: mpSubscriptionId,
            body: { status: "cancelled" },
        });
    } catch (err) {
        console.error("[SUBSCRIPTION] Erro ao cancelar preapproval no MP:", err);
    }
}
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// Preços dos planos (em centavos) — R$ 1,00 para testes
const PLAN_PRICES = {
    basic: {
        monthly: 100, // R$ 1,00 (teste)
        yearly: 100, // R$ 1,00 (teste)
    },
    complete: {
        monthly: 100, // R$ 1,00 (teste)
        yearly: 100, // R$ 1,00 (teste)
    },
};

// Desconto por indicação (em porcentagem)
const REFERRAL_DISCOUNT_PERCENT = 10;

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

// GET - Buscar assinatura atual
export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { userId },
            include: {
                payments: {
                    orderBy: { createdAt: "desc" },
                    take: 5,
                },
            },
        });

        if (!subscription) {
            return NextResponse.json({ subscription: null });
        }

        return NextResponse.json({ subscription });
    } catch (error: any) {
        console.error("[SUBSCRIPTION] GET error:", error);
        return NextResponse.json(
            { error: "Erro ao buscar assinatura" },
            { status: 500 }
        );
    }
}

// POST - Criar/Atualizar assinatura
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const body = await req.json();
        const { planType, billingPeriod, referralCode, cardTokenId } = body;

        if (!planType || !billingPeriod) {
            return NextResponse.json(
                { error: "planType e billingPeriod são obrigatórios" },
                { status: 400 }
            );
        }

        if (!["basic", "complete"].includes(planType)) {
            return NextResponse.json(
                { error: "planType inválido" },
                { status: 400 }
            );
        }

        if (!["monthly", "yearly"].includes(billingPeriod)) {
            return NextResponse.json(
                { error: "billingPeriod inválido" },
                { status: 400 }
            );
        }

        // Buscar usuário
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
        }

        // Verificar código de indicação se fornecido
        let discount = 0;
        let referrerId: string | null = null;
        if (referralCode) {
            const referrer = await prisma.user.findUnique({
                where: { referralCode },
            });
            if (referrer && referrer.id !== userId) {
                referrerId = referrer.id;
                // Aplicar desconto de 10%
                const basePrice = PLAN_PRICES[planType as keyof typeof PLAN_PRICES][billingPeriod as "monthly" | "yearly"];
                discount = Math.round(basePrice * (REFERRAL_DISCOUNT_PERCENT / 100));
            }
        }

        // Calcular preço final
        const basePrice = PLAN_PRICES[planType as keyof typeof PLAN_PRICES][billingPeriod as "monthly" | "yearly"];
        const finalPrice = basePrice - discount;

        // Verificar se já existe assinatura
        const existingSubscription = await prisma.subscription.findUnique({
            where: { userId },
        });

        // Criar ou atualizar assinatura no banco
        const subscription = await prisma.subscription.upsert({
            where: { userId },
            update: {
                planType,
                billingPeriod,
                status: "pending",
                referralCode: referralCode || null,
            },
            create: {
                userId,
                planType,
                billingPeriod,
                status: "pending",
                referralCode: referralCode || null,
            },
        });

        // Assinatura recorrente (Preapproval): criar plano e preapproval no Mercado Pago
        const frontendUrl = process.env.FRONTEND_URL || process.env.BACKEND_URL || "https://ia-life-master-back-final-production.up.railway.app";
        const amountReais = finalPrice / 100;
        const isMonthly = billingPeriod === "monthly";

        const planBody = {
            reason: `Plano ${planType === "basic" ? "Básico" : "Completo"} - ${isMonthly ? "Mensal" : "Anual"}`,
            auto_recurring: {
                frequency: isMonthly ? 1 : 12,
                frequency_type: "months",
                transaction_amount: amountReais,
                currency_id: "BRL",
                billing_day: 10,
                billing_day_proportional: true,
            },
            payment_methods_allowed: {
                payment_types: [{ id: "credit_card" }],
                payment_methods: [],
            },
            back_url: `${frontendUrl}/payment-success?subscriptionId=${subscription.id}`,
        };

        const plan = await preApprovalPlanClient.create({ body: planBody });
        const planId = (plan as any).id;
        if (!planId) {
            throw new Error("Falha ao criar plano de assinatura no Mercado Pago");
        }

        const preapprovalBody: Record<string, unknown> = {
            preapproval_plan_id: planId,
            reason: planBody.reason,
            external_reference: subscription.id,
            payer_email: user.email,
            back_url: `${frontendUrl}/payment-success?subscriptionId=${subscription.id}`,
        };
        if (cardTokenId && typeof cardTokenId === "string" && cardTokenId.trim()) {
            preapprovalBody.card_token_id = cardTokenId.trim();
            // Obrigatório para autorizar a assinatura imediatamente com o cartão (checkout transparente)
            preapprovalBody.status = "authorized";
        }

        let preapproval: any;
        try {
            preapproval = await preApprovalClient.create({ body: preapprovalBody });
        } catch (mpErr: any) {
            const msg = mpErr?.message || String(mpErr);
            const cause = mpErr?.cause?.message ?? (typeof mpErr?.cause === "object" ? JSON.stringify(mpErr.cause) : "");
            console.error("[SUBSCRIPTION] Preapproval MP error:", msg, cause || mpErr?.cause);
            return NextResponse.json(
                { error: msg || "Erro ao autorizar assinatura com cartão. Verifique os dados do cartão e tente novamente." },
                { status: 500 }
            );
        }
        const initPoint = (preapproval as any).init_point;
        const mpPreapprovalId = (preapproval as any).id;

        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                mpPreferenceId: planId,
                mpSubscriptionId: mpPreapprovalId || null,
            },
        });

        if (referrerId && referralCode) {
            await prisma.referral.upsert({
                where: {
                    referrerId_referredId: { referrerId, referredId: userId },
                },
                update: {},
                create: { referrerId, referredId: userId, referralCode },
            });
        }

        const preapprovalStatus = (preapproval as any).status;
        return NextResponse.json({
            preferenceId: planId,
            initPoint: initPoint || null,
            sandboxInitPoint: initPoint || null,
            subscriptionId: subscription.id,
            status: preapprovalStatus || null,
        });
    } catch (error: any) {
        console.error("[SUBSCRIPTION] POST error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao criar assinatura" },
            { status: 500 }
        );
    }
}

// DELETE - Cancelar assinatura
export async function DELETE(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { userId },
        });

        if (!subscription) {
            return NextResponse.json(
                { error: "Assinatura não encontrada" },
                { status: 404 }
            );
        }

        await cancelPreapprovalInMP(subscription.mpSubscriptionId);

        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                status: "cancelled",
                cancelAtPeriodEnd: false,
            },
        });

        return NextResponse.json({ message: "Assinatura cancelada com sucesso" });
    } catch (error: any) {
        console.error("[SUBSCRIPTION] DELETE error:", error);
        return NextResponse.json(
            { error: "Erro ao cancelar assinatura" },
            { status: 500 }
        );
    }
}

