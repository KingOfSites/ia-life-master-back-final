# Guia de Actions para o Chat da IALI

## 📱 Como Funcionam os Botões de Ação no Chat

Quando a IA responde no chat, ela pode incluir botões de ação que aparecem abaixo da mensagem. O usuário pode clicar nesses botões para executar ações específicas.

## 🎯 Tipos de Actions Implementadas

### 1. **Navegação Simples**

#### **Abrir Scanner de Código de Barras**
```json
{
  "type": "open_barcode_scanner",
  "label": "Escanear Código de Barras"
}
```

#### **Abrir Tela de Nutrição**
```json
{
  "type": "open_nutrition",
  "label": "Ver Nutrição"
}
```

#### **Registrar Refeição (vai para upload de foto)**
```json
{
  "type": "register_meal",
  "label": "Registrar Refeição"
}
```

#### **Abrir Rotina/Plano**
```json
{
  "type": "open_routine",
  "label": "Ver Rotina"
}
```
ou
```json
{
  "type": "open_plan",
  "label": "Ver Plano"
}
```

### 2. **Adicionar Treino na Rotina**

Quando a IA sugere treinos, pode incluir um botão para adicionar diretamente na rotina:

```json
{
  "type": "add_workout",
  "label": "Adicionar Treino",
  "params": {
    "workouts": [
      {
        "title": "Treino Superior",
        "focus": "Peito e Tríceps",
        "startTime": "18:00",
        "endTime": "19:00",
        "intensity": "moderada"
      }
    ]
  }
}
```

**Campos do treino:**
- `title` (obrigatório): Nome do treino
- `focus` (opcional): Foco do treino (ex: "Peito e Tríceps")
- `startTime` (obrigatório): Hora de início (formato "HH:MM")
- `endTime` (obrigatório): Hora de fim (formato "HH:MM")
- `intensity` (opcional): "leve", "moderada", "intensa"

**Nota:** Adiciona o treino completo, não exercício por exercício.

### 3. **Adicionar Refeições na Rotina**

Quando a IA sugere um plano alimentar, pode incluir um botão para adicionar as refeições:

```json
{
  "type": "add_meals",
  "label": "Adicionar à Rotina",
  "params": {
    "meals": [
      {
        "title": "Café da manhã",
        "description": "2 ovos mexidos com 1 fatia de pão integral",
        "startTime": "08:00",
        "endTime": "08:30",
        "calories": 343,
        "protein": 20,
        "carbs": 30,
        "fat": 15
      },
      {
        "title": "Almoço",
        "description": "150g de peito de frango grelhado, 1 xícara de brócolis, 1/2 xícara de arroz integral",
        "startTime": "12:30",
        "endTime": "13:00",
        "calories": 499,
        "protein": 45,
        "carbs": 45,
        "fat": 10
      }
    ]
  }
}
```

**Campos da refeição:**
- `title` (obrigatório): Nome da refeição (ex: "Café da manhã", "Almoço")
- `description` (opcional): Descrição detalhada dos alimentos
- `startTime` (obrigatório): Hora de início (formato "HH:MM")
- `endTime` (obrigatório): Hora de fim (formato "HH:MM")
- `calories` (opcional): Calorias totais
- `protein` (opcional): Proteínas em gramas
- `carbs` (opcional): Carboidratos em gramas
- `fat` (opcional): Gorduras em gramas

## 💡 Exemplos de Uso no Prompt da IA

### Exemplo 1: Sugerir Plano Alimentar com Botão

```
Usuário: "consegue trocar minha rotina alimentar do café da manhã para ovo com pão?"

Resposta da IA:
{
  "reply": "Claro! Aqui está a rotina alimentar ajustada para hoje:\n- Café da manhã (08:00): 2 ovos mexidos com 1 fatia de pão integral.\n- Almoço (12:30): 150g de peito de frango grelhado, 1 xícara de brócolis e 1/2 xícara de arroz integral.\n- Lanche (16:00): 1 maçã e 10 amêndoas.\n- Jantar (19:30): 100g de filé de peixe grelhado, salada de folhas verdes com azeite e 1/2 batata-doce assada.\n\nQuer que eu ajuste para seu objetivo (perder/ganhar/manter) e quantidade de refeições?",
  "actions": [
    {
      "type": "add_meals",
      "label": "Adicionar à Rotina",
      "params": {
        "meals": [
          {
            "title": "Café da manhã",
            "description": "2 ovos mexidos com 1 fatia de pão integral",
            "startTime": "08:00",
            "endTime": "08:30",
            "calories": 343,
            "protein": 20,
            "carbs": 30,
            "fat": 15
          },
          {
            "title": "Almoço",
            "description": "150g de peito de frango grelhado, 1 xícara de brócolis, 1/2 xícara de arroz integral",
            "startTime": "12:30",
            "endTime": "13:00",
            "calories": 499,
            "protein": 45,
            "carbs": 45,
            "fat": 10
          },
          {
            "title": "Lanche",
            "description": "1 maçã e 10 amêndoas",
            "startTime": "16:00",
            "endTime": "16:00",
            "calories": 150,
            "protein": 3,
            "carbs": 20,
            "fat": 8
          },
          {
            "title": "Jantar",
            "description": "100g de filé de peixe grelhado, salada de folhas verdes com azeite, 1/2 batata-doce assada",
            "startTime": "19:30",
            "endTime": "20:00",
            "calories": 358,
            "protein": 30,
            "carbs": 30,
            "fat": 12
          }
        ]
      }
    },
    {
      "type": "register_meal",
      "label": "Registrar Refeição"
    }
  ]
}
```

### Exemplo 2: Sugerir Treino com Botão

```
Usuário: "Me sugira um treino para hoje"

Resposta da IA:
{
  "reply": "Treino para amanhã:\n\n2. Alongamentos dinâmicos (15 min): Corrida leve e alongamentos.\n3. Saltos de agachamento (15 min): Práticas saltos entre obstáculos baixos.\n...\n\nQuer que eu ajuste este treino ou adicione à sua rotina?",
  "actions": [
    {
      "type": "add_workout",
      "label": "Adicionar Treino",
      "params": {
        "workouts": [
          {
            "title": "Alongamentos dinâmicos",
            "focus": "Corrida leve e alongamentos",
            "startTime": "08:00",
            "endTime": "08:15",
            "intensity": "leve"
          },
          {
            "title": "Saltos de agachamento",
            "focus": "Práticas saltos entre obstáculos baixos",
            "startTime": "08:15",
            "endTime": "08:30",
            "intensity": "moderada"
          }
        ]
      }
    },
    {
      "type": "open_routine",
      "label": "Ver Rotina"
    }
  ]
}
```

### Exemplo 3: Orientar sobre Registro de Refeição

```
Usuário: "Como registro o que comi?"

Resposta da IA:
{
  "reply": "Para registrar sua refeição, você pode:\n1. Tirar uma foto do prato - eu vou identificar os alimentos\n2. Escanear o código de barras de produtos embalados\n\nClique em 'Registrar Refeição' para começar!",
  "actions": [
    {
      "type": "register_meal",
      "label": "Registrar Refeição"
    },
    {
      "type": "open_barcode_scanner",
      "label": "Escanear Código"
    }
  ]
}
```

## 🔧 Implementação no Backend

No arquivo `/api/chat/route.ts`, a IA deve retornar:

```typescript
return NextResponse.json({
  reply: "Mensagem de texto da IA",
  actions: [
    {
      type: "add_meals",
      label: "Adicionar à Rotina",
      params: { ... }
    }
  ],
  sessionId: "..."
});
```

## ✅ Checklist para a IA

Ao sugerir:
- **Plano alimentar** → Incluir action `add_meals`
- **Treino** → Incluir action `add_workout`
- **Sobre registro** → Incluir action `register_meal`
- **Sobre rotina/plano** → Incluir action `open_routine` ou `open_plan`
- **Sobre código de barras** → Incluir action `open_barcode_scanner`

## 🎨 Aparência no App

Os botões aparecem logo abaixo da mensagem da IA:

```
┌─────────────────────────────┐
│ Mensagem da IA aqui...      │
│                             │
│ ┌─────────┐ ┌─────────────┐│
│ │  Botão1 │ │   Botão2    ││
│ └─────────┘ └─────────────┘│
└─────────────────────────────┘
```

## 📝 Notas Importantes

1. **Limite de 3 botões** são exibidos por vez (primeiros 3 do array)
2. **Dados são salvos no plano do dia** (PlanDay do Prisma)
3. **Ações executam imediatamente** ao clicar
4. **Feedback visual** com Alert confirmando sucesso/erro
5. **Navegação automática** após adicionar (vai para tela de Rotina)


