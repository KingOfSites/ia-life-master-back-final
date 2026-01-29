# Especificação do Health Score (0–10)

## 1. Definição: soma de sub-scores inteiros

O Health Score é um **inteiro de 0 a 10** obtido por:

1. **Sub-scores por dimensão**: cada dimensão retorna um número **inteiro** (bônus ≥ 0 ou penalidade ≤ 0).
2. **Agregação**: soma de um **ponto base** com todos os sub-scores.
3. **Clamping final**: o resultado é limitado ao conjunto **{0, 1, 2, …, 10}**.

Não se usa valor fracionário em nenhuma etapa; apenas inteiros, para **consistência e estabilidade** (mesma refeição → mesmo score).

---

## 2. Dimensões que compõem o score (refeição)

| Dimensão | Descrição | Sub-score | Tipo |
|----------|-----------|-----------|------|
| **Base** | Neutro quando há dados | 5 | fixo |
| **Proteína** | Densidade proteica (g por 100 kcal) | 0, 1 ou 2 | bônus |
| **Fibra** | Fibra por 100 kcal | 0, 1 ou 2 | bônus |
| **Açúcar** | % das calorias vindas de açúcar | 0, -1 ou -2 | penalidade |
| **Sódio** | mg de sódio por 100 kcal | 0, -1 ou -2 | penalidade |
| **Equilíbrio de macros** | Dominância de um único macro | 0 ou -1 | penalidade |

**Score bruto** = Base + Proteína + Fibra + Açúcar + Sódio + Equilíbrio.  
**Score final** = clamp(round(Score bruto), 0, 10).

---

## 3. Thresholds discretos (refeição)

Todas as comparações usam **limiares fixos**; resultado sempre inteiro.

### 3.1 Proteína (por 100 kcal)

- `proteína_por_100kcal = (protein_g * 4) / (calorias / 100)` = (proteína em kcal) / (calorias) * 100.  
  Ou: `(protein_g * 400) / calorias` se calorias > 0.

| Condição | Sub-score |
|----------|-----------|
| &lt; 2 g por 100 kcal | 0 |
| ≥ 2 e &lt; 4 g por 100 kcal | +1 |
| ≥ 4 g por 100 kcal | +2 |

### 3.2 Fibra (por 100 kcal)

- `fibra_por_100kcal = (fiber_g * 2) / (calorias / 100)` ou `(fiber_g * 200) / calorias`.

| Condição | Sub-score |
|----------|-----------|
| &lt; 1 g por 100 kcal | 0 |
| ≥ 1 e &lt; 2 g por 100 kcal | +1 |
| ≥ 2 g por 100 kcal | +2 |

### 3.3 Açúcar (penalidade)

- `açúcar_%_cal = (sugar_g * 4) / calorias * 100` (percentual de calorias de açúcar).

| Condição | Sub-score |
|----------|-----------|
| ≤ 10% | 0 |
| &gt; 10% e ≤ 25% | -1 |
| &gt; 25% | -2 |

### 3.4 Sódio (penalidade)

- `sódio_por_100kcal = (sodium_mg / calorias) * 100`.

| Condição | Sub-score |
|----------|-----------|
| ≤ 400 mg por 100 kcal | 0 |
| &gt; 400 e ≤ 600 mg por 100 kcal | -1 |
| &gt; 600 mg por 100 kcal | -2 |

### 3.5 Equilíbrio de macros (penalidade)

- % proteína = `(protein_g * 4) / calorias * 100`
- % carboidrato = `(carbs_g * 4) / calorias * 100`
- % gordura = `(fat_g * 9) / calorias * 100`

| Condição | Sub-score |
|----------|-----------|
| Nenhum macro &gt; 70% das calorias | 0 |
| Algum macro &gt; 70% das calorias | -1 |

---

## 4. Método de agregação (inteiro)

1. **Calcular cada dimensão** com os thresholds acima → todos os valores são **inteiros**.
2. **Somar**:  
   `score_bruto = 5 + pts_proteína + pts_fibra + pts_açúcar + pts_sódio + pts_equilíbrio`  
   (pts_açúcar e pts_sódio e pts_equilíbrio já são ≤ 0).
3. **Clamping final**:  
   `score_final = max(0, min(10, round(score_bruto)))`.  
   Como score_bruto já é inteiro, `round(score_bruto)` = score_bruto.  
   Assim o resultado pertence **sempre** ao conjunto **{0, 1, …, 10}**.

Intervalo teórico do bruto: mínimo 5 − 2 − 2 − 1 = 0, máximo 5 + 2 + 2 = 9 (sem bônus extra por equilíbrio na spec atual). Para caber em 0–10, o clamp garante; não é necessário reescalar.

---

## 5. Consistência e estabilidade

- **Ordem de aplicação fixa**: Base → Proteína → Fibra → Açúcar → Sódio → Equilíbrio. Não há dependência entre dimensões; a ordem não altera a soma.
- **Desempate**: não se aplica; mesma entrada sempre produz o mesmo score (tudo determinístico e inteiro).
- **Prioridade de penalidades**: todas as penalidades são **somadas**; não há “uma anula a outra”. Quem define o impacto é só o limite por dimensão (-1 ou -2) e o clamp final.
- **Variação por dia (opcional)**: para score **do dia**, pode-se limitar a variação em relação ao dia anterior (ex.: não mudar mais que 2 pontos). Para **refeição**, não há variação temporal; só entrada nutricional → score.
- **Sem dados**: se `calorias === 0` (e proteína/carboidrato/gordura todos zero), retornar **5** (neutro).

---

## 6. Clamping final (conjunto {0..10})

```text
score_bruto = 5 + proteína + fibra + açúcar + sódio + equilíbrio
score_final = max(0, min(10, Math.round(score_bruto)))
```

- `Math.round(score_bruto)` mantém inteiro (score_bruto já é inteiro).
- `min(10, …)` e `max(0, …)` garantem que o score final está **sempre** em **{0, 1, 2, …, 10}**.

---

## 7. Score do dia (opcional)

Para **Pontuação de Saúde do Dia** pode-se usar:

- **Opção A**: média (ou mediana) dos scores das refeições do dia, depois clamp 0–10.
- **Opção B**: mesma lógica de sub-scores inteiros, mas com **adequação calórica às metas** como dimensão extra:
  - Aderência calorias: ratio = min(consumido/meta, meta/consumido); pontos = 0, 1 ou 2 por faixas de ratio (ex.: &gt; 0,9 → 2; &gt; 0,7 → 1; senão 0).
  - Idem para proteína, carboidrato, gordura (cada 0–2).
  - Soma base + dimensões, clamp 0–10.

Mantendo sempre **sub-scores inteiros** e **clamp final** em {0..10}.
