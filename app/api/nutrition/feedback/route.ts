import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

export async function POST(req: NextRequest) {
    try {
        // Autentica usuário
        const auth = req.headers.get("authorization");
        let userId: string | null = null;

        if (auth?.startsWith("Bearer ")) {
            const token = auth.slice(7);
            try {
                const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
                userId = decoded.userId;
            } catch (err) {
                console.error("Token inválido:", err);
            }
        }

        const body = await req.json();
        const { rating, comment, foodsAnalyzed, totalCalories } = body;

        if (!rating || rating < 1 || rating > 5) {
            return NextResponse.json(
                { error: "Rating deve estar entre 1 e 5" },
                { status: 400 }
            );
        }

        // Salva feedback no banco
        const feedback = await prisma.nutritionFeedback.create({
            data: {
                userId: userId || "anonymous",
                rating,
                comment: comment || null,
                foodsAnalyzed: foodsAnalyzed || [],
                totalCalories: totalCalories || 0,
            },
        });

        console.log("[FEEDBACK] Saved:", {
            id: feedback.id,
            userId: feedback.userId,
            rating: feedback.rating,
            foods: foodsAnalyzed?.length || 0,
        });

        return NextResponse.json({ success: true, id: feedback.id });
    } catch (error) {
        console.error("Error saving feedback:", error);
        return NextResponse.json(
            { error: "Erro ao salvar feedback" },
            { status: 500 }
        );
    }
}

