import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const code = String(body?.code || "").trim();

    if (!email || !code) {
      return NextResponse.json(
        { error: "E-mail e código são obrigatórios" },
        { status: 400 }
      );
    }

    // Buscar usuário
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Código inválido ou expirado" },
        { status: 400 }
      );
    }

    // Buscar código válido (não usado e não expirado)
    const resetRequest = await prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        code,
        used: false,
        expiresAt: {
          gt: new Date(), // Ainda não expirou
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!resetRequest) {
      return NextResponse.json(
        { error: "Código inválido ou expirado" },
        { status: 400 }
      );
    }

    // Código válido! Retornar sucesso
    return NextResponse.json({
      ok: true,
      message: "Código válido",
      resetId: resetRequest.id, // ID para usar na próxima etapa
    });
  } catch (error: any) {
    console.error("❌ Erro ao verificar código:", error);
    return NextResponse.json(
      { error: "Erro ao verificar código" },
      { status: 500 }
    );
  }
}
