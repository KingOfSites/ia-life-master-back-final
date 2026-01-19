import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import jwt from "jsonwebtoken";
import { preferenceClient, generateReferenceId } from "@/lib/mercadopago";
import crypto from "crypto";
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// Preços dos planos (em centavos)
const PLAN_PRICES = {
    basic: {
        monthly: 1990, // R$ 19,90
        yearly: 19900, // R$ 199,00
    },
    complete: {
        monthly: 3990, // R$ 39,90
        yearly: 39900, // R$ 399,00
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
        const { planType, billingPeriod, referralCode } = body;

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

        // Criar preferência de pagamento no Mercado Pago
        const referenceId = generateReferenceId(userId, planType);
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";
        
        const preferenceData = {
            items: [
                {
                    title: `Plano ${planType === "basic" ? "Básico" : "Completo"} - ${billingPeriod === "monthly" ? "Mensal" : "Anual"}`,
                    quantity: 1,
                    unit_price: finalPrice / 100, // Converter centavos para reais
                    currency_id: "BRL",
                },
            ],
            payer: {
                email: user.email,
                name: user.name || undefined,
            },
            back_urls: {
                success: `${frontendUrl}/payment-success?subscriptionId=${subscription.id}`,
                failure: `${frontendUrl}/payment-failure?subscriptionId=${subscription.id}`,
                pending: `${frontendUrl}/payment-pending?subscriptionId=${subscription.id}`,
            },
            external_reference: referenceId,
            notification_url: `${backendUrl}/api/subscription/webhook`,
            metadata: {
                userId,
                subscriptionId: subscription.id,
                planType,
                billingPeriod,
                referralCode: referralCode || null,
                referrerId: referrerId || null,
            },
        };

        const preference = await preferenceClient.create({ body: preferenceData });

        // Atualizar assinatura com o ID da preferência
        await prisma.subscription.update({
            where: { id: subscription.id },
            data: { mpPreferenceId: preference.id },
        });

        // Se houver código de indicação válido, registrar a referência
        if (referrerId && referralCode) {
            await prisma.referral.upsert({
                where: {
                    referrerId_referredId: {
                        referrerId,
                        referredId: userId,
                    },
                },
                update: {},
                create: {
                    referrerId,
                    referredId: userId,
                    referralCode,
                },
            });
        }

        return NextResponse.json({
            preferenceId: preference.id,
            initPoint: preference.init_point,
            sandboxInitPoint: preference.sandbox_init_point,
            subscriptionId: subscription.id,
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

        // Cancelar imediatamente - revoga acesso na hora
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

