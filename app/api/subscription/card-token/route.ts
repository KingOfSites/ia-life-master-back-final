import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { cardTokenClient } from "@/lib/mercadopago";

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

// POST - Criar token do cartão (checkout transparente)
export async function POST(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const body = await req.json();
        const { cardNumber, cardholderName, cardExpirationMonth, cardExpirationYear, securityCode, identificationType, identificationNumber } = body;

        // Validar campos obrigatórios
        if (!cardNumber || !cardholderName || !cardExpirationMonth || !cardExpirationYear || !securityCode) {
            return NextResponse.json(
                { error: "Todos os dados do cartão são obrigatórios" },
                { status: 400 }
            );
        }

        // Validar e formatar mês (deve ser entre 01 e 12)
        const month = String(cardExpirationMonth).trim();
        if (!month || month.length === 0) {
            return NextResponse.json(
                { error: "Mês de validade é obrigatório" },
                { status: 400 }
            );
        }
        const monthNum = parseInt(month);
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
            return NextResponse.json(
                { error: "Mês de validade inválido (deve ser entre 01 e 12)" },
                { status: 400 }
            );
        }
        const formattedMonth = String(monthNum).padStart(2, "0");

        // Validar e formatar ano
        const year = String(cardExpirationYear).trim();
        if (!year || year.length === 0) {
            return NextResponse.json(
                { error: "Ano de validade é obrigatório" },
                { status: 400 }
            );
        }
        
        // Se o ano tiver 2 dígitos, assumir 20XX (ex: 30 = 2030)
        // Se tiver 4 dígitos, usar como está
        let formattedYear: string;
        if (year.length === 2) {
            formattedYear = `20${year}`;
        } else if (year.length === 4) {
            formattedYear = year;
        } else {
            return NextResponse.json(
                { error: "Ano de validade inválido (use 2 ou 4 dígitos)" },
                { status: 400 }
            );
        }
        
        const yearNum = parseInt(formattedYear);
        if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2099) {
            return NextResponse.json(
                { error: "Ano de validade inválido (deve ser entre 2020 e 2099)" },
                { status: 400 }
            );
        }

        // Criar token do cartão no Mercado Pago
        const tokenData = {
            card_number: cardNumber.replace(/\s/g, ""), // Remover espaços
            cardholder: {
                name: cardholderName,
                identification: {
                    type: identificationType || "CPF",
                    number: identificationNumber || "",
                },
            },
            card_expiration_month: formattedMonth,
            card_expiration_year: formattedYear,
            security_code: securityCode,
        };

        console.log("[CARD_TOKEN] Criando token com dados:", {
            card_number: tokenData.card_number.substring(0, 4) + "****",
            card_expiration_month: tokenData.card_expiration_month,
            card_expiration_year: tokenData.card_expiration_year,
        });

        const token = await cardTokenClient.create({ body: tokenData });

        if (!token || !token.id) {
            console.error("[CARD_TOKEN] Token não foi criado corretamente:", token);
            return NextResponse.json(
                { error: "Erro ao criar token do cartão" },
                { status: 500 }
            );
        }

        console.log("[CARD_TOKEN] Token criado com sucesso:", token.id);

        return NextResponse.json({
            token: token.id,
        });
    } catch (error: any) {
        console.error("[CARD_TOKEN] POST error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao criar token do cartão" },
            { status: 500 }
        );
    }
}

