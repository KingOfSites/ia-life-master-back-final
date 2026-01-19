import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getUserEntitlements } from "@/lib/entitlements";

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

// GET - Obter entitlements do usuário
export async function GET(req: NextRequest) {
    try {
        const userId = getUserIdFromToken(req);
        if (!userId) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const entitlements = await getUserEntitlements(userId);
        return NextResponse.json(entitlements);
    } catch (error: any) {
        console.error("[ENTITLEMENTS] GET error:", error);
        return NextResponse.json(
            { error: error.message || "Erro ao buscar entitlements" },
            { status: 500 }
        );
    }
}


