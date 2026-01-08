# Sistema de Feedback de Análise Nutricional

## 📊 Como Funciona

### 1. Usuário Analisa Alimento
- Tira foto da refeição
- IA identifica alimentos e calcula calorias
- Usuário vê os resultados

### 2. Sistema Solicita Feedback
Após a análise, o app pergunta:
**"Esse cálculo de comida ficou bom para você?"**

- ⭐⭐⭐⭐⭐ (1-5 estrelas)
- Campo opcional: "O que podemos melhorar?"

### 3. Feedback é Salvo
```json
{
  "userId": "uuid",
  "rating": 3,
  "comment": "Calorias vieram altas",
  "foodsAnalyzed": ["Arroz", "Feijão", "Frango"],
  "totalCalories": 650,
  "createdAt": "2025-01-07T..."
}
```

## 🧠 Como Usar o Feedback para Melhorar a IA

### Opção 1: Ajustar Prompt Baseado em Feedbacks Gerais

No arquivo `/api/vision/route.ts` (ou onde faz análise de imagem), adicione:

```typescript
// Buscar feedbacks recentes do usuário
const recentFeedbacks = await prisma.nutritionFeedback.findMany({
  where: { 
    userId: userId,
    createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // últimos 30 dias
  },
  orderBy: { createdAt: 'desc' },
  take: 10
});

// Analisar tendências
const avgRating = recentFeedbacks.reduce((sum, f) => sum + f.rating, 0) / recentFeedbacks.length;
const lowRatings = recentFeedbacks.filter(f => f.rating <= 2);
const commonComplaints = lowRatings.map(f => f.comment).filter(Boolean);

// Construir instruções baseadas no feedback
let feedbackInstructions = "";
if (avgRating < 3) {
  feedbackInstructions = `
O usuário tem dado notas baixas (média ${avgRating.toFixed(1)}) nas análises recentes.
Principais reclamações: ${commonComplaints.join("; ")}

Ajuste sua análise:
- Se reclamam de "valores altos": seja mais conservador nas porções
- Se reclamam de "incompleto": seja mais detalhado
- Se reclamam de "erros": seja mais preciso na identificação
`;
}

// Adicionar ao prompt da OpenAI Vision
const prompt = `
Você é um nutricionista especializado em análise de imagens de alimentos.
Identifique os alimentos na imagem e calcule as calorias.

${feedbackInstructions}

Retorne JSON com...
`;
```

### Opção 2: Ajustar Baseado em Feedback Específico

Quando o usuário dá feedback **imediatamente** após análise:

```typescript
POST /api/nutrition/feedback
{
  "rating": 2,
  "comment": "Veio muito alto, acho que não tem tanto",
  "analysisId": "abc123" // referência à análise que gerou o feedback
}

// No próximo request de análise desse usuário, injete:
const lastFeedback = await prisma.nutritionFeedback.findFirst({
  where: { userId },
  orderBy: { createdAt: 'desc' }
});

if (lastFeedback && lastFeedback.rating <= 2) {
  prompt += `
  Importante: Na última análise, o usuário disse "${lastFeedback.comment}".
  Considere isso ao calcular porções desta vez.
  `;
}
```

## 📈 Insights de Feedback

### Endpoint para Análise (Opcional)

```typescript
// /api/nutrition/feedback/insights
GET /api/nutrition/feedback/insights

Response:
{
  "averageRating": 3.8,
  "totalFeedbacks": 127,
  "commonIssues": [
    { "issue": "valores altos", "count": 23 },
    { "issue": "faltou detalhar", "count": 15 }
  ],
  "ratingDistribution": {
    "1": 5,
    "2": 12,
    "3": 30,
    "4": 45,
    "5": 35
  }
}
```

## 🎯 Exemplos Práticos

### Caso 1: Usuário Reclama de Valores Altos

**Feedback:**
- Rating: 2/5
- Comment: "Sempre vem muito alto"

**Ação na IA:**
```typescript
const prompt = `
IMPORTANTE: Este usuário tende a reclamar que os valores vêm altos.
Seja mais conservador ao estimar porções.
Se houver dúvida entre 150g e 200g, escolha 150g.
`;
```

### Caso 2: Usuário Quer Mais Detalhes

**Feedback:**
- Rating: 3/5
- Comment: "Faltou detalhar os molhos"

**Ação na IA:**
```typescript
const prompt = `
Este usuário valoriza detalhes.
Identifique molhos, temperos e acompanhamentos separadamente.
Não agrupe tudo como "refeição completa".
`;
```

### Caso 3: Usuário Satisfeito

**Feedback:**
- Rating: 5/5
- Comment: "Perfeito!"

**Ação:**
- Continue usando o mesmo approach atual
- Use como exemplo de "análise bem-sucedida"

## 🔄 Ciclo de Melhoria Contínua

```
1. IA analisa imagem
2. Usuário dá feedback
3. Sistema salva feedback
4. Na próxima análise, IA considera feedbacks anteriores
5. Usuário percebe melhoria
6. Dá feedback positivo
7. Sistema aprende que essa abordagem funciona
```

## 💡 Dicas Importantes

- **Não mude a IA globalmente** baseado em 1 feedback
- **Agrupe feedbacks** por padrões (pelo menos 5-10 similares)
- **Considere contexto**: usuário em dieta restritiva tende a querer valores menores
- **Feedbacks positivos** também são valiosos (continue fazendo o que funciona)
- **Anonimize dados** se for analisar feedbacks em lote

## 🚀 Próximos Passos

1. ✅ Implementar UI de feedback (Concluído)
2. ✅ Salvar feedbacks no banco (Concluído)
3. ⏳ Buscar feedbacks recentes ao analisar
4. ⏳ Ajustar prompt baseado em padrões
5. ⏳ Dashboard para analisar feedbacks (Opcional)

## 📝 Migration do Banco

Para ativar o sistema, rode:

```bash
cd ia-life-master-back
npx prisma migrate dev --name add-nutrition-feedback
npx prisma generate
```

