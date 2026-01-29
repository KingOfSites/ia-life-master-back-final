import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { paymentClient, preApprovalClient, invoiceClient } from "@/lib/mercadopago";

const WEBHOOK_TS_TOLERANCE_SEC = 300; // 5 min

function validateWebhookSignature(
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string | number | undefined,
  secret: string | undefined
): { valid: boolean; reason?: string } {
  if (!secret) {
    console.warn("[WEBHOOK] MP_WEBHOOK_SECRET não configurado; assinatura não validada.");
    return { valid: true };
  }
  if (!xSignature) return { valid: false, reason: "Header x-signature ausente" };

  const parts = xSignature.split(",");
  let ts: string | null = null;
  let v1: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split("=").map((s) => s.trim());
    if (key === "ts") ts = value;
    else if (key === "v1") v1 = value;
  }

  if (!ts || !v1) return { valid: false, reason: "x-signature sem ts ou v1" };

  const tsNum = parseInt(ts, 10);
  if (Number.isNaN(tsNum)) return { valid: false, reason: "ts inválido" };

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > WEBHOOK_TS_TOLERANCE_SEC) {
    return { valid: false, reason: "ts fora da janela de tolerância (replay?)" };
  }

  const dataID = dataId == null ? "" : String(dataId);
  const dataIDNorm = /^[a-zA-Z0-9]+$/.test(dataID) ? dataID.toLowerCase() : dataID;

  const manifest = xRequestId
    ? `id:${dataIDNorm};request-id:${xRequestId};ts:${ts};`
    : `id:${dataIDNorm};ts:${ts};`;

  const computed = createHmac("sha256", secret).update(manifest).digest("hex");
  if (computed !== v1) return { valid: false, reason: "Assinatura HMAC não confere" };

  return { valid: true };
}

// ✅ NÃO sobrescreve mpSubscriptionId aqui (mpSubscriptionId = preapprovalId)
async function activateSubscription(subscription: any, payment: any) {
  console.log("[WEBHOOK] Payment approved, activating subscription:", subscription.id);

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
      // mpSubscriptionId: NÃO MEXE AQUI
    },
  });

  console.log("[WEBHOOK] Subscription activated:", {
    subscriptionId: subscription.id,
    status: updatedSubscription.status,
    periodEnd: updatedSubscription.currentPeriodEnd,
  });

  if (subscription.referralCode) {
    const referral = await prisma.referral.findFirst({
      where: {
        referredId: subscription.userId,
        referralCode: subscription.referralCode,
        rewardApplied: false,
      },
    });

    if (referral) {
      const rewardAmount = (payment.transaction_amount || 0) * 0.1;

      await prisma.user.update({
        where: { id: referral.referrerId },
        data: { referralRewards: { increment: Math.round(rewardAmount) } },
      });

      await prisma.referral.update({
        where: { id: referral.id },
        data: { rewardApplied: true, rewardAmount },
      });
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, data } = body;

    console.log("[WEBHOOK] Mercado Pago notification:", { type, data });

    // ✅ Validar assinatura apenas para payment (como você queria)
    if (type === "payment") {
      const xSignature = req.headers.get("x-signature");
      const xRequestId = req.headers.get("x-request-id");
      const dataId = data?.id;
      const secret = process.env.MP_WEBHOOK_SECRET;

      const { valid, reason } = validateWebhookSignature(xSignature, xRequestId, dataId, secret);
      if (!valid) {
        console.error("[WEBHOOK] Assinatura inválida:", reason);
        return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
      }
    }

    // -------------------------
    // PAYMENT
    // -------------------------
    if (type === "payment") {
      const paymentId = data?.id;
      if (!paymentId) return NextResponse.json({ received: true });

      const payment = await paymentClient.get({ id: paymentId });
      if (!payment) return NextResponse.json({ error: "Pagamento não encontrado" }, { status: 404 });

      const externalReference = payment.external_reference;
      const metadata = payment.metadata as any;
      const paymentAny = payment as any;

      let subscription: any = null;

      if (metadata?.subscriptionId) {
        subscription = await prisma.subscription.findUnique({ where: { id: metadata.subscriptionId } });
      }

      if (!subscription && externalReference?.includes("sub_")) {
        const subscriptionId = externalReference.split("_")[1];
        subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
      }

      if (!subscription && paymentAny.preference_id) {
        subscription = await prisma.subscription.findFirst({
          where: { mpPreferenceId: paymentAny.preference_id },
        });
      }

      if (!subscription) {
        const paymentRecordWithSub = await prisma.payment.findUnique({
          where: { mpPaymentId: String(paymentId) },
          include: { subscription: true },
        });
        subscription = paymentRecordWithSub?.subscription ?? null;
      }

      if (!subscription) {
        console.error("[WEBHOOK] Subscription not found for payment:", paymentId, {
          externalReference,
          metadata,
          preferenceId: paymentAny.preference_id,
        });
        return NextResponse.json({ received: true, warning: "Assinatura não encontrada" });
      }

      // upsert payment record
      const existing = await prisma.payment.findUnique({
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

      if (existing) {
        const oldStatus = existing.status;
        await prisma.payment.update({
          where: { id: existing.id },
          data: paymentData,
        });
        console.log("[WEBHOOK] Payment updated:", {
          paymentId,
          oldStatus,
          newStatus: payment.status,
        });
      } else {
        await prisma.payment.create({
          data: { ...paymentData, subscriptionId: subscription.id },
        });
        console.log("[WEBHOOK] Payment created:", {
          paymentId,
          status: payment.status,
          subscriptionId: subscription.id,
        });
      }

      // ✅ Ativar assinatura quando approved
      if (payment.status === "approved") {
        await activateSubscription(subscription, payment);
      }

      // ❌ NÃO cancelar assinatura aqui por rejected/cancelled (recorrente pode falhar sem cancelar a assinatura)
      // A assinatura deve ser cancelada via eventos de subscription/preapproval quando MP realmente cancelar.
      if (payment.status === "rejected" || payment.status === "cancelled") {
        console.warn("[WEBHOOK] Payment not approved (won't cancel subscription here):", {
          paymentId,
          status: payment.status,
          subscriptionId: subscription.id,
        });
      }

      return NextResponse.json({ received: true });
    }

    // -------------------------
    // SUBSCRIPTION PREAPPROVAL (checkout autorizou a assinatura)
    // -------------------------
    if (type === "subscription_preapproval") {
      const preapprovalId = data?.id;
      if (!preapprovalId) return NextResponse.json({ received: true });

      try {
        const preapproval = await preApprovalClient.get({ id: preapprovalId });
        const externalRef = (preapproval as any).external_reference; // você usa id da subscription aqui
        const status = (preapproval as any).status;

        if (!externalRef) {
          console.error("[WEBHOOK] subscription_preapproval sem external_reference:", preapprovalId);
          return NextResponse.json({ received: true });
        }

        const subscription = await prisma.subscription.findUnique({ where: { id: externalRef } });
        if (!subscription) {
          console.error("[WEBHOOK] Assinatura não encontrada para preapproval:", externalRef);
          return NextResponse.json({ received: true });
        }

        if (status === "authorized") {
          const nextPaymentDate = (preapproval as any).next_payment_date;
          const periodEnd = nextPaymentDate ? new Date(nextPaymentDate) : new Date();

          // Ajuste de período
          if (subscription.billingPeriod === "yearly") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
          else periodEnd.setMonth(periodEnd.getMonth() + 1);

          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: "active",
              currentPeriodEnd: periodEnd,
              mpSubscriptionId: String(preapprovalId), // ✅ aqui sim!
            },
          });

          console.log("[WEBHOOK] Assinatura recorrente ativada (preapproval):", subscription.id);
        } else if (status === "cancelled" || status === "pending") {
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: status === "cancelled" ? "cancelled" : "pending" },
          });
        }
      } catch (err) {
        console.error("[WEBHOOK] Erro ao processar subscription_preapproval:", err);
      }

      return NextResponse.json({ received: true });
    }

    // -------------------------
    // SUBSCRIPTION AUTHORIZED PAYMENT (cobrança recorrente)
    // -------------------------
    if (type === "subscription_authorized_payment") {
      const authorizedPaymentId = data?.id;
      if (!authorizedPaymentId) return NextResponse.json({ received: true });

      try {
        const invoice = await invoiceClient.get({ id: authorizedPaymentId });
        const inv = invoice as any;

        const preapprovalId = inv.preapproval_id;
        const paymentId = inv.payment?.id;
        const amount = inv.transaction_amount ?? 0;
        const status = inv.status;

        if (!preapprovalId) {
          console.error("[WEBHOOK] subscription_authorized_payment sem preapproval_id:", authorizedPaymentId);
          return NextResponse.json({ received: true });
        }

        const subscription = await prisma.subscription.findFirst({
          where: { mpSubscriptionId: String(preapprovalId) },
        });

        if (!subscription) {
          console.error("[WEBHOOK] Assinatura não encontrada para preapproval_id:", preapprovalId);
          return NextResponse.json({ received: true });
        }

        if (paymentId) {
          await prisma.payment.upsert({
            where: { mpPaymentId: String(paymentId) },
            update: { status: status || "pending", amount },
            create: {
              subscriptionId: subscription.id,
              mpPaymentId: String(paymentId),
              amount,
              currency: "BRL",
              status: status || "pending",
            },
          });
        }

        if (status === "approved" || status === "paid") {
          const now = new Date();
          const periodEnd = new Date(now);

          if (subscription.billingPeriod === "monthly") periodEnd.setMonth(periodEnd.getMonth() + 1);
          else periodEnd.setFullYear(periodEnd.getFullYear() + 1);

          await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: "active", currentPeriodEnd: periodEnd },
          });

          // recompensa
          if (subscription.referralCode) {
            const referral = await prisma.referral.findFirst({
              where: {
                referredId: subscription.userId,
                referralCode: subscription.referralCode,
                rewardApplied: false,
              },
            });

            if (referral) {
              const rewardAmount = amount * 0.1;

              await prisma.user.update({
                where: { id: referral.referrerId },
                data: { referralRewards: { increment: Math.round(rewardAmount) } },
              });

              await prisma.referral.update({
                where: { id: referral.id },
                data: { rewardApplied: true, rewardAmount },
              });
            }
          }

          console.log("[WEBHOOK] Cobrança recorrente processada:", subscription.id, paymentId);
        } else {
          console.warn("[WEBHOOK] Cobrança recorrente não aprovada:", {
            subscriptionId: subscription.id,
            paymentId,
            status,
          });
          // aqui você pode marcar "past_due" se tiver esse status
        }
      } catch (err) {
        console.error("[WEBHOOK] Erro ao processar subscription_authorized_payment:", err);
      }

      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("[WEBHOOK] Error processing notification:", error);
    return NextResponse.json({ error: "Erro ao processar notificação" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ status: "ok" });
}
