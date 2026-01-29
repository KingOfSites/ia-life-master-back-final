import { MercadoPagoConfig, Preference, Payment, CardToken } from "mercadopago";

// Inicializa o cliente do Mercado Pago
const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
    options: {
        timeout: 5000,
        idempotencyKey: "your-idempotency-key",
    },
});

export const preferenceClient = new Preference(client);
export const paymentClient = new Payment(client);
export const cardTokenClient = new CardToken(client);

// Função auxiliar para gerar código de referência único
export function generateReferenceId(userId: string, planType: string): string {
    return `sub_${userId}_${planType}_${Date.now()}`;
}

