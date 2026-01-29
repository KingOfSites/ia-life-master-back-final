import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Gera código de 6 dígitos
function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json(
        { error: "Informe seu e-mail." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Não revelar se o e-mail existe ou não (segurança)
      return NextResponse.json({ ok: true, message: "Se o e-mail existir, você receberá um código em instantes." });
    }

    if (!user.password) {
      return NextResponse.json(
        { error: "Esta conta foi criada com login social (Google ou Apple). Use o mesmo método para entrar." },
        { status: 400 }
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetCode: code,
        resetCodeExpiresAt: expiresAt,
      },
    });

    // TODO: enviar e-mail com o código (Resend, SendGrid, etc.)
    // Por enquanto, em desenvolvimento você pode logar o código
    if (process.env.NODE_ENV === "development") {
      console.log("[FORGOT-PASSWORD] Código para", email, ":", code);
    }

    return NextResponse.json({
      ok: true,
      message: "Se o e-mail existir na base, você receberá um código em instantes. Verifique sua caixa de entrada e spam.",
    });
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    console.error("[FORGOT-PASSWORD]", e);
    // Se o banco não tiver as colunas de reset, orientar a rodar a migration
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("unknown column") || msg.includes("resetcode") || msg.includes("reset_code")) {
      return NextResponse.json(
        { error: "Serviço em atualização. Tente novamente em alguns minutos ou contate o suporte." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Erro ao processar. Tente novamente." },
      { status: 500 }
    );
  }
}
