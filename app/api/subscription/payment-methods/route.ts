import { NextRequest, NextResponse } from "next/server";

// GET - Detectar método de pagamento baseado no número do cartão
// Usa detecção simples baseada no primeiro dígito (BIN)
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const bin = searchParams.get("bin"); // Primeiros 6 dígitos do cartão

        if (!bin || bin.length < 6) {
            return NextResponse.json(
                { error: "Bin do cartão é obrigatório (6 primeiros dígitos)" },
                { status: 400 }
            );
        }

        // Detecção simples baseada no primeiro dígito
        // Cartões de teste do Mercado Pago geralmente começam com:
        // 5031 (Mastercard teste)
        // 4509 (Visa teste)
        // 3711 (Amex teste)
        const firstDigit = bin[0];
        const firstFour = bin.substring(0, 4);
        
        let paymentMethodId = "visa";
        let issuerId: string | undefined = undefined;

        // Detecção por BIN conhecido
        if (firstFour === "5031" || firstFour === "5031" || firstFour.startsWith("5")) {
            paymentMethodId = "master";
        } else if (firstFour === "4509" || firstFour.startsWith("4")) {
            paymentMethodId = "visa";
        } else if (firstFour === "3711" || firstFour.startsWith("3")) {
            paymentMethodId = "amex";
        } else if (firstFour.startsWith("6")) {
            paymentMethodId = "elo";
        } else {
            // Fallback baseado no primeiro dígito
            if (firstDigit === "4") paymentMethodId = "visa";
            else if (firstDigit === "5") paymentMethodId = "master";
            else if (firstDigit === "3") paymentMethodId = "amex";
            else if (firstDigit === "6") paymentMethodId = "elo";
        }

        return NextResponse.json({
            paymentMethodId,
            issuer: issuerId ? { id: issuerId } : null,
            installments: [],
        });
    } catch (error: any) {
        console.error("[PAYMENT_METHODS] GET error:", error);
        // Retornar valores padrão em caso de erro
        return NextResponse.json({
            paymentMethodId: "visa",
            issuer: null,
            installments: [],
        });
    }
}

