import { prisma } from "@/lib/prisma";

export type PlanType = "basic" | "complete";
export type SubscriptionStatus = "pending" | "active" | "cancelled" | "expired";

export interface UserEntitlements {
    hasActiveSubscription: boolean;
    planType: PlanType | null;
    status: SubscriptionStatus | null;
    canAccessChat: boolean;
    canAccessPersonalizedPlans: boolean;
    canAccessAdvancedAnalysis: boolean;
    canAccessBasicFeatures: boolean;
}

/**
 * Verifica os entitlements do usuário baseado na assinatura
 */
export async function getUserEntitlements(userId: string): Promise<UserEntitlements> {
    const subscription = await prisma.subscription.findUnique({
        where: { userId },
    });

    console.log("[ENTITLEMENTS] Subscription found:", {
        userId,
        subscriptionId: subscription?.id,
        planType: subscription?.planType,
        status: subscription?.status,
        currentPeriodEnd: subscription?.currentPeriodEnd,
    });

    const hasActiveSubscription = subscription?.status === "active";
    const planType = (subscription?.planType as PlanType) || null;
    const status = (subscription?.status as SubscriptionStatus) || null;

    // Verificar se a assinatura não expirou
    const isExpired = subscription?.currentPeriodEnd 
        ? new Date(subscription.currentPeriodEnd) < new Date()
        : false;

    const effectiveStatus = isExpired ? "expired" : status;
    const isActive = effectiveStatus === "active";

    const canAccessChat = isActive && planType === "complete";

    const entitlements = {
        hasActiveSubscription: isActive,
        planType: isActive ? planType : null,
        status: effectiveStatus,
        // Funcionalidades básicas: disponíveis para todos com assinatura ativa
        canAccessBasicFeatures: isActive,
        // Chat com IA: apenas plano completo
        canAccessChat,
        // Planos personalizados: apenas plano completo
        canAccessPersonalizedPlans: isActive && planType === "complete",
        // Análise avançada: apenas plano completo
        canAccessAdvancedAnalysis: isActive && planType === "complete",
    };

    console.log("[ENTITLEMENTS] Returning entitlements:", entitlements);

    return entitlements;
}

/**
 * Verifica se o usuário tem acesso a uma funcionalidade específica
 */
export async function checkEntitlement(
    userId: string,
    feature: "chat" | "personalized_plans" | "advanced_analysis" | "basic"
): Promise<boolean> {
    const entitlements = await getUserEntitlements(userId);
    
    switch (feature) {
        case "chat":
            return entitlements.canAccessChat;
        case "personalized_plans":
            return entitlements.canAccessPersonalizedPlans;
        case "advanced_analysis":
            return entitlements.canAccessAdvancedAnalysis;
        case "basic":
            return entitlements.canAccessBasicFeatures;
        default:
            return false;
    }
}

