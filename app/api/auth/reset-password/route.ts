import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    if (!email || !code || !newPassword) {
      return NextResponse.json(
        { error: "E-mail, código e nova senha são obrigatórios." },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "A nova senha deve ter pelo menos 6 caracteres." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.resetCode || !user.resetCodeExpiresAt) {
      return NextResponse.json(
        { error: "Código inválido ou expirado. Solicite um novo código." },
        { status: 400 }
      );
    }

    if (user.resetCode !== code) {
      return NextResponse.json(
        { error: "Código incorreto. Verifique e tente novamente." },
        { status: 400 }
      );
    }

    if (new Date() > user.resetCodeExpiresAt) {
      await prisma.user.update({
        where: { id: user.id },
        data: { resetCode: null, resetCodeExpiresAt: null },
      });
      return NextResponse.json(
        { error: "Código expirado. Solicite um novo código." },
        { status: 400 }
      );
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hash,
        resetCode: null,
        resetCodeExpiresAt: null,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Senha alterada com sucesso. Faça login com a nova senha.",
    });
  } catch (e) {
    console.error("[RESET-PASSWORD]", e);
    return NextResponse.json(
      { error: "Erro ao redefinir senha. Tente novamente." },
      { status: 500 }
    );
  }
}
