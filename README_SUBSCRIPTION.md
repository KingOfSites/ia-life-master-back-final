# Sistema de Assinaturas com Mercado Pago

## Configuração

### 1. Variáveis de Ambiente

Adicione as seguintes variáveis no arquivo `.env` do backend:

```env
MERCADOPAGO_ACCESS_TOKEN=seu_access_token_aqui
FRONTEND_URL=https://seu-frontend.com
BACKEND_URL=https://seu-backend.com
```

### 2. Obter Access Token do Mercado Pago

1. Acesse https://www.mercadopago.com.br/developers
2. Crie uma aplicação
3. Copie o **Access Token** (não o Public Key)
4. Para testes, use o Access Token de **teste** (sandbox)

### 3. Configurar Webhook

1. No painel do Mercado Pago, vá em **Webhooks**
2. Configure a URL: `https://seu-backend.com/api/subscription/webhook`
3. Selecione os eventos: `payment`

### 4. Migração do Banco de Dados

Execute a migração do Prisma para criar as novas tabelas:

```bash
cd ia-life-master-back
npx prisma migrate dev --name add_subscription_models
npx prisma generate
```

### 5. Instalar Dependências

```bash
npm install mercadopago
```

## Estrutura

### Modelos do Banco de Dados

- **Subscription**: Armazena informações da assinatura do usuário
- **Payment**: Registra todos os pagamentos realizados
- **Referral**: Sistema de indicação com recompensas

### Endpoints da API

#### GET `/api/subscription`
Busca a assinatura atual do usuário autenticado.

#### POST `/api/subscription`
Cria uma nova assinatura e retorna o link de pagamento do Mercado Pago.

**Body:**
```json
{
  "planType": "basic" | "complete",
  "billingPeriod": "monthly" | "yearly",
  "referralCode": "codigo_opcional"
}
```

**Response:**
```json
{
  "preferenceId": "123456789",
  "initPoint": "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=...",
  "sandboxInitPoint": "https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=...",
  "subscriptionId": "uuid"
}
```

#### DELETE `/api/subscription`
Cancela a assinatura atual (marca para cancelar no final do período).

#### POST `/api/subscription/webhook`
Webhook recebido do Mercado Pago quando há atualizações de pagamento.

## Fluxo de Pagamento

1. Usuário seleciona um plano na tela de planos
2. Frontend chama `POST /api/subscription` com os dados do plano
3. Backend cria preferência no Mercado Pago e retorna `initPoint`
4. Frontend abre o link do Mercado Pago no navegador
5. Usuário completa o pagamento no Mercado Pago
6. Mercado Pago redireciona de volta para o frontend com status
7. Mercado Pago envia webhook para o backend
8. Backend atualiza status da assinatura e cria registro de pagamento

## Sistema de Indicação

- Usuário pode inserir um código de indicação ao assinar
- Se o código for válido, aplica desconto de 10% no pagamento
- Quando o pagamento é aprovado, o usuário que indicou recebe 10% do valor como recompensa
- Recompensas são acumuladas no campo `referralRewards` do usuário

## Preços

- **Básico Mensal**: R$ 19,90
- **Básico Anual**: R$ 199,00
- **Completo Mensal**: R$ 39,90
- **Completo Anual**: R$ 399,00

## Testes

Para testar em modo sandbox:

1. Use o Access Token de teste do Mercado Pago
2. Use cartões de teste: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/test-cards
3. O webhook será chamado automaticamente após o pagamento

## Próximos Passos

- [ ] Implementar validação de entitlements nas rotas protegidas
- [ ] Criar sistema de renovação automática
- [ ] Adicionar notificações de expiração de assinatura
- [ ] Implementar dashboard de pagamentos para admin


