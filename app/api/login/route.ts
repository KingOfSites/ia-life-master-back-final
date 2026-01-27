import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"

export const runtime = "nodejs"

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email e senha obrigatórios" },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email },
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

    const token = jwt.sign(
      { userId: user.id },
      secret,
      { expiresIn: "7d" }
    )

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
      },
    })
  } catch (error: any) {
    console.error("[LOGIN] Erro completo:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return NextResponse.json(
      {
        error: error.message || "Erro ao fazer login",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
