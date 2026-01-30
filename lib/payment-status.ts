/**
 * Mapeia status do Mercado Pago para status interno do sistema.
 * Usado ao persistir Payment no banco.
 */
const MP_STATUS_TO_INTERNAL: Record<string, string> = {
  pending: "pending",
  approved: "paid",
  cancelled: "cancelled",
  expired: "expired",
  rejected: "rejected",
  refunded: "refunded",
};

export function mapMpPaymentStatus(mpStatus: string | undefined | null): string {
  if (mpStatus == null || mpStatus === "") return "pending";
  return MP_STATUS_TO_INTERNAL[mpStatus] ?? mpStatus;
}

/** Retorna true se o status (MP ou interno) indica pagamento aprovado/pago. */
export function isPaymentApproved(status: string | undefined | null): boolean {
  return status === "approved" || status === "paid";
}
