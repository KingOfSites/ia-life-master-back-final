# Pagamento e Webhook (Mercado Pago)

Este documento descreve como configurar o sistema de pagamento com assinaturas e o **webhook** do Mercado Pago, incluindo validação de assinatura e testes.

## Visão geral

- O backend expõe a rota **POST** `/api/subscription/webhook` para receber notificações do Mercado Pago.
- O Mercado Pago envia um **POST** para essa URL sempre que há atualização de pagamento (criação, aprovação, rejeição, etc.).
- O backend valida a autenticidade da notificação usando o header **x-signature** e a variável **MP_WEBHOOK_SECRET**.

## Requisitos

1. **URL pública**  
   O webhook precisa ser acessível pela internet. Em desenvolvimento local use um túnel (ex.: [ngrok](https://ngrok.com)).

2. **Variáveis de ambiente** (backend `.env`):

   ```env
   MERCADOPAGO_ACCESS_TOKEN=seu_access_token
   BACKEND_URL=https://seu-backend-publico.com
   MP_WEBHOOK_SECRET=seu_webhook_secret
   ```

   - **MERCADOPAGO_ACCESS_TOKEN**: token da aplicação no [Painel de Desenvolvedores](https://www.mercadopago.com.br/developers).
   - **BACKEND_URL**: URL base do backend (usada para montar links e documentar o webhook).
   - **MP_WEBHOOK_SECRET**: secret gerado ao configurar o webhook em “Suas integrações” (ver abaixo). Se não for definido, a assinatura **não** será validada (útil apenas para testes locais).

## Configuração do webhook no Mercado Pago

1. Acesse [Suas integrações](https://www.mercadopago.com.br/developers/panel/app) e selecione sua aplicação.
2. No menu lateral: **Webhooks** → **Configurar notificações**.
3. **URL de produção**:  
   `https://SEU_BACKEND/api/subscription/webhook`  
   (substitua `SEU_BACKEND` pela sua **BACKEND_URL** real, sem barra no final).
4. Em **Eventos**, marque pelo menos: **Payments** (pagamentos).
5. Clique em **Salvar**. O Mercado Pago gera um **secret** (assinatura secreta).
6. Copie esse secret e defina no `.env` como **MP_WEBHOOK_SECRET**.

Importante: sem **MP_WEBHOOK_SECRET** configurado, o backend aceita o webhook mas **não valida** a assinatura (menos seguro). Em produção, sempre use o secret.

## Validação da assinatura (x-signature)

O backend valida cada notificação do tipo `payment` da seguinte forma:

- Lê o header **x-signature** (formato: `ts=...,v1=...`).
- Lê o header **x-request-id** (se existir).
- Usa o **data.id** do body (ID do pagamento).
- Monta o “manifest” conforme a [documentação do Mercado Pago](https://www.mercadopago.com.br/developers/en/docs/your-integrations/notifications/webhooks) e calcula **HMAC-SHA256** com **MP_WEBHOOK_SECRET**.
- Compara o resultado com o valor `v1` do header.
- Rejeita notificações com **ts** (timestamp) fora de uma janela de 5 minutos para evitar replay.

Se a validação falhar, a rota responde com **401** e a notificação não é processada.

## URL do webhook

| Ambiente   | URL |
|-----------|-----|
| Produção  | `POST {BACKEND_URL}/api/subscription/webhook` |
| Exemplo   | `POST https://ia-life-master-back--final-production.up.railway.app/api/subscription/webhook` |

O endpoint também responde **GET** com `{ "status": "ok" }` para checagem manual ou health check.

## Testando o webhook

### 1. Com túnel (desenvolvimento local)

1. Instale e inicie o ngrok (ou similar) apontando para a porta do seu backend, por exemplo:
   ```bash
   ngrok http 3000
   ```
2. Use a URL HTTPS gerada (ex.: `https://abc123.ngrok.io`) como **BACKEND_URL** temporária.
3. No painel do Mercado Pago, configure a URL do webhook como:
   `https://abc123.ngrok.io/api/subscription/webhook`
4. Defina **MP_WEBHOOK_SECRET** no `.env` com o secret exibido no painel após salvar o webhook.
5. No painel, use **Simular** para enviar uma notificação de teste e verifique os logs do backend.

### 2. Simulador no painel

Em **Webhooks** → **Configurar notificações**, após salvar a URL e o evento **Payments**, use o botão **Simular** para enviar um evento de teste. Confira no backend se a requisição chegou e se a assinatura foi aceita (ou se retornou 401 por secret errado).

### 3. Produção

Em produção, use a **BACKEND_URL** real e garanta que **MP_WEBHOOK_SECRET** está definido. O Mercado Pago enviará os POSTs automaticamente quando houver pagamentos; o dashboard de notificações em “Webhooks” mostra entregas e falhas.

## Resumo de variáveis

| Variável                   | Obrigatória | Descrição |
|---------------------------|-------------|-----------|
| MERCADOPAGO_ACCESS_TOKEN  | Sim         | Token da aplicação MP |
| BACKEND_URL               | Recomendado | URL base do backend (pública) |
| MP_WEBHOOK_SECRET         | Sim em prod.| Secret do webhook para validar x-signature |

## Documentação oficial

- [Webhooks - Mercado Pago](https://www.mercadopago.com.br/developers/en/docs/your-integrations/notifications/webhooks)  
- [Notificações e assinatura secreta](https://www.mercadopago.com.br/developers/en/news/2024/01/11/Webhooks-Notifications-Simulator-and-Secret-Signature)

Para fluxo de assinaturas, preços e endpoints da API de assinatura, veja **README_SUBSCRIPTION.md**.
