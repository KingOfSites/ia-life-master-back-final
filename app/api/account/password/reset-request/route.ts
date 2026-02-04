import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

// Gerar código de 6 dígitos
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Configurar transporter de email (usando Gmail como exemplo)
// Em produção, use um serviço profissional como SendGrid, AWS SES, etc.
function getEmailTransporter() {
  // Verifica se as credenciais de email estão configuradas (EMAIL_PASS ou EMAIL_PASSWORD)
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
  const emailHost = process.env.EMAIL_HOST || "smtp.gmail.com";
  const emailPort = parseInt(process.env.EMAIL_PORT || "587", 10);

  if (!emailUser || !emailPass) {
    console.warn("Configure EMAIL_USER e EMAIL_PASS (ou EMAIL_PASSWORD) no .env para enviar e-mails de recuperação de senha.");
    return null;
  }

  return nodemailer.createTransport({
    host: emailHost,
    port: emailPort,
    secure: emailPort === 465, // true para 465, false para outras portas
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "E-mail inválido" },
        { status: 400 }
      );
    }

    // Verificar se o usuário existe
    const user = await prisma.user.findUnique({
      where: { email },
    });

    // Por segurança, sempre retornar sucesso mesmo se o usuário não existir
    // Isso evita que hackers descubram quais emails estão cadastrados
    if (!user) {
      console.log(`⚠️ Tentativa de reset para email não cadastrado: ${email}`);
      return NextResponse.json({
        ok: true,
        message: "Se o e-mail estiver cadastrado, você receberá um código de recuperação.",
      });
    }

    // Gerar código de 6 dígitos
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Salvar código no banco
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        code,
        expiresAt,
        used: false,
      },
    });

    // Tentar enviar e-mail
    try {
      const transporter = getEmailTransporter();
      
      if (!transporter) {
        // Se não houver configuração de email, apenas logar o código (desenvolvimento)
        console.log(`🔑 CÓDIGO DE RECUPERAÇÃO PARA ${email}: ${code}`);
        console.log(`⏰ Expira em: ${expiresAt.toLocaleString("pt-BR")}`);
        console.log("⚠️ Configure EMAIL_USER e EMAIL_PASS no .env para enviar e-mails reais de recuperação.");
        
        return NextResponse.json({
          ok: true,
          message: "Código gerado com sucesso (veja o console do servidor)",
          devMode: true,
          code, // Apenas em desenvolvimento
        });
      }

      // Enviar e-mail com o código
      await transporter.sendMail({
        from: process.env.EMAIL_USER || "noreply@ialife.com",
        to: email,
        subject: "Recuperação de Senha - IA Life",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #093F3F;">Recuperação de Senha</h2>
            <p>Você solicitou a recuperação de senha da sua conta no IA Life.</p>
            <p>Use o código abaixo para redefinir sua senha:</p>
            <div style="background-color: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <h1 style="color: #093F3F; font-size: 36px; letter-spacing: 8px; margin: 0;">${code}</h1>
            </div>
            <p>Este código expira em <strong>15 minutos</strong>.</p>
            <p>Se você não solicitou esta recuperação, ignore este e-mail.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            <p style="color: #6b7280; font-size: 12px;">IA Life - Sua jornada de saúde com inteligência</p>
          </div>
        `,
      });

      console.log(`✅ Código de recuperação enviado para ${email}`);
    } catch (emailError) {
      console.error("❌ Erro ao enviar e-mail:", emailError);
      // Não falhar a requisição se o email não for enviado
      // O código já foi salvo no banco
    }

    return NextResponse.json({
      ok: true,
      message: "Se o e-mail estiver cadastrado, você receberá um código de recuperação.",
    });
  } catch (error: any) {
    console.error("❌ Erro ao solicitar reset de senha:", error);
    return NextResponse.json(
      { error: "Erro ao processar solicitação" },
      { status: 500 }
    );
  }
}
