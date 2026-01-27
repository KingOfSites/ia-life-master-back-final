import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()

    console.log("[LOGIN] Requisição recebida:", { email, password });

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email e senha obrigatórios" },
        { status: 400 }
      )
    }

    // Normalizar email (trim e lowercase)
    const trimmedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: trimmedEmail },
    })

    if (!user) {
      return NextResponse.json(
        { error: "E-mail ou senha incorretos" },
        { status: 401 }
      )
    }

    // Se o usuário não tem senha, significa que é OAuth
    if (!user.password) {
      return NextResponse.json(
        { error: "Este usuário foi cadastrado com login social. Use Google ou Apple para fazer login." },
        { status: 401 }
      )
    }

    const passwordMatch = await bcrypt.compare(password, user.password)

    if (!passwordMatch) {
      return NextResponse.json(
        { error: "E-mail ou senha incorretos" },
        { status: 401 }
      )
    }

    const secret = process.env.JWT_SECRET || process.env.AUTH_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "Servidor sem JWT_SECRET configurado" },
        { status: 500 }
      )
    }

    // Token com expiração de 1 ano para manter usuário logado permanentemente
    const token = jwt.sign(
      { userId: user.id },
      secret,
      { expiresIn: "365d" }
    )

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    })
  } catch (error: unknown) {
    console.error("[LOGIN] Erro completo:", {
      message: error instanceof Error ? error.message : undefined,
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao fazer login",
        details: process.env.NODE_ENV === "development" ? error instanceof Error ? error.stack : undefined : undefined,
      },
      { status: 500 }
    );
  }
}
