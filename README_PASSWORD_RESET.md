# Sistema de Recuperação de Senha

## 📋 Visão Geral

Sistema completo de recuperação de senha com código de 6 dígitos enviado por e-mail.

### Fluxo do Usuário

1. **Solicitar Código**: Usuário insere seu e-mail
2. **Receber Código**: Código de 6 dígitos enviado por e-mail (válido por 15 minutos)
3. **Verificar Código**: Usuário insere o código recebido
4. **Nova Senha**: Usuário define uma nova senha (com confirmação)

## 🚀 Configuração

### 1. Migração do Banco de Dados

Execute a migração para criar a tabela `PasswordReset`:

```bash
cd ia-life-master-back-final
npx prisma migrate dev --name add_password_reset
```

Ou crie e execute manualmente:

```sql
CREATE TABLE `PasswordReset` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `used` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `PasswordReset_userId_idx` (`userId`),
  INDEX `PasswordReset_code_idx` (`code`),
  INDEX `PasswordReset_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `PasswordReset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Configurar Envio de E-mails

#### Opção A: Gmail (Desenvolvimento/Produção Pequena)

1. Ative a verificação em 2 etapas na sua conta Google
2. Crie uma senha de app: https://myaccount.google.com/apppasswords
3. Configure as variáveis de ambiente:

```bash
# .env.local
EMAIL_USER=seu-email@gmail.com
EMAIL_PASSWORD=sua-senha-de-app-16-caracteres
```

#### Opção B: SendGrid (Recomendado para Produção)

```bash
npm install @sendgrid/mail
```

```typescript
// Modificar reset-request/route.ts
import sgMail from '@sendgrid/mail';
sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

await sgMail.send({
  to: email,
  from: 'noreply@seudominio.com',
  subject: 'Recuperação de Senha - IA Life',
  html: emailHtml,
});
```

#### Opção C: AWS SES (Produção em Escala)

```bash
npm install @aws-sdk/client-ses
```

#### Modo Desenvolvimento (Sem Configuração)

Se `EMAIL_USER` e `EMAIL_PASSWORD` não estiverem configurados:
- O código será impresso no console do servidor
- A resposta da API incluirá o código (apenas em dev)
- Perfeito para testar sem configurar email

## 📡 Endpoints da API

### 1. Solicitar Código de Recuperação

```http
POST /api/account/password/reset-request
Content-Type: application/json

{
  "email": "usuario@email.com"
}
```

**Resposta (Sucesso):**
```json
{
  "ok": true,
  "message": "Se o e-mail estiver cadastrado, você receberá um código de recuperação."
}
```

**Resposta (Dev Mode - sem email configurado):**
```json
{
  "ok": true,
  "message": "Código gerado com sucesso (veja o console do servidor)",
  "devMode": true,
  "code": "123456"
}
```

### 2. Verificar Código

```http
POST /api/account/password/reset-verify
Content-Type: application/json

{
  "email": "usuario@email.com",
  "code": "123456"
}
```

**Resposta (Sucesso):**
```json
{
  "ok": true,
  "message": "Código válido",
  "resetId": "uuid-do-reset"
}
```

**Resposta (Erro):**
```json
{
  "error": "Código inválido ou expirado"
}
```

### 3. Confirmar Nova Senha

```http
POST /api/account/password/reset-confirm
Content-Type: application/json

{
  "email": "usuario@email.com",
  "code": "123456",
  "newPassword": "novaSenha123"
}
```

**Resposta (Sucesso):**
```json
{
  "ok": true,
  "message": "Senha alterada com sucesso"
}
```

## 🔒 Segurança

### Implementações de Segurança

1. **Rate Limiting**: Recomenda-se adicionar rate limiting nos endpoints
2. **Códigos Únicos**: Cada código é único e válido por apenas 15 minutos
3. **Uso Único**: Códigos não podem ser reutilizados após reset bem-sucedido
4. **Resposta Genérica**: Sempre retorna sucesso mesmo para emails não cadastrados (previne enumeração de usuários)
5. **Expiração**: Códigos expiram automaticamente após 15 minutos
6. **Hash de Senha**: Senhas são hasheadas com bcrypt (10 rounds)

### Melhorias Recomendadas para Produção

```typescript
// Rate Limiting (usando express-rate-limit)
import rateLimit from 'express-rate-limit';

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 3, // máximo 3 tentativas
  message: 'Muitas tentativas. Tente novamente mais tarde.',
});
```

## 🧪 Testando

### 1. Teste Manual (Dev Mode)

```bash
# Iniciar backend
cd ia-life-master-back-final
npm run dev

# O código será impresso no console
```

### 2. Testar Fluxo Completo

1. Na tela de login, clique em "Deu branco? Clique aqui"
2. Insira seu e-mail
3. Verifique o console do servidor para pegar o código
4. Insira o código de 6 dígitos
5. Defina sua nova senha
6. Faça login com a nova senha

### 3. Testar com Email Real

Configure `EMAIL_USER` e `EMAIL_PASSWORD` e teste com um email real.

## 📱 Frontend

A tela `forgot-password.tsx` já está implementada com:

- ✅ Formulário de e-mail
- ✅ Validação de código (6 dígitos)
- ✅ Confirmação de senha
- ✅ Feedback visual em cada etapa
- ✅ Loading states
- ✅ Validações de erro
- ✅ Design consistente com o app

## 🐛 Troubleshooting

### Email não está sendo enviado

1. Verifique se `EMAIL_USER` e `EMAIL_PASSWORD` estão configurados
2. Se usar Gmail, certifique-se de usar uma senha de app, não sua senha normal
3. Verifique os logs do servidor para erros de SMTP
4. Em desenvolvimento, o código sempre aparece no console mesmo se o email falhar

### Código sempre inválido

1. Verifique se o código não expirou (15 minutos)
2. Certifique-se de usar o código mais recente
3. Verifique se o email está correto
4. Códigos são case-sensitive (use apenas números)

### Migração não aplicada

```bash
npx prisma generate
npx prisma db push
```

## 📊 Limpeza de Códigos Expirados

Recomenda-se criar um cron job para limpar códigos expirados:

```typescript
// cron/cleanup-password-resets.ts
import { prisma } from '@/lib/prisma';

async function cleanupExpiredCodes() {
  const result = await prisma.passwordReset.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } }, // Expirados
        { used: true }, // Já usados
      ],
    },
  });
  console.log(`🧹 Limpeza: ${result.count} códigos removidos`);
}

// Executar diariamente
setInterval(cleanupExpiredCodes, 24 * 60 * 60 * 1000);
```

## 📝 Próximos Passos

- [ ] Adicionar rate limiting
- [ ] Implementar serviço de email profissional (SendGrid/SES)
- [ ] Adicionar logs de auditoria
- [ ] Implementar sistema de notificação quando senha é alterada
- [ ] Adicionar testes automatizados
- [ ] Monitoramento de tentativas suspeitas

## 🎨 Customização do Email

Para customizar o template do email, edite o HTML em `reset-request/route.ts`:

```typescript
const emailHtml = `
  <!-- Seu template customizado aqui -->
`;
```

Considere usar um serviço de templates como:
- MJML (responsive email framework)
- React Email
- Handlebars templates
