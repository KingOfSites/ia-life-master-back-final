import { NextRequest, NextResponse } from "next/server";
import { calcTargetsWithAI, calcTargets } from "../plan/helpers";

function getUserIdFromAuth(req: NextRequest): string | null {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.substring(7);
    const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return decoded.userId;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Permitir chamadas sem autenticação durante onboarding
    // const userId = getUserIdFromAuth(req);
    // if (!userId) {
    //   return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    // }

    const body = await req.json().catch(() => ({}));
    const onboarding = body.onboarding || {};

    // Tentar calcular com IA primeiro
    let targets = await calcTargetsWithAI(onboarding);
    let method = "ai";
    
    // Se falhar, usar cálculo matemático
    if (!targets) {
      console.log("[TARGETS] Usando cálculo matemático (fallback)");
      targets = calcTargets(onboarding);
      method = "math";
    } else {
      console.log("[TARGETS] Usando cálculo via IA");
    }

    return NextResponse.json({
      success: true,
      ...targets,
      method,
    });
  } catch (error) {
    console.error("[TARGETS] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao calcular targets" },
      { status: 500 }
    );
  }
}

