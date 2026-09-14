# HANDOFF: SDR Flow V11 "Vendedor Completo" - Debug & Fix

> Documento de passagem para continuar o diagnóstico e correção do fluxo V11 do Vida Card.
> Gerado em 2026-09-09 por Claude Opus 4.6.

---

## 1. CONTEXTO DO PROJETO

**SDR Flow** é uma plataforma de automação de vendas via WhatsApp. Usa um motor de fluxo visual (grafo JSON) que processa mensagens recebidas pelo Evolution API e responde via LLM.

### Arquitetura
```
WhatsApp → Evolution API → Webhook (apps/api/src/webhook.ts) → Flow Engine (packages/flow) → LLM → WhatsApp
                                                                      ↓
                                                              Supabase (PostgreSQL)
```

### Stack
- **Monorepo pnpm**: `apps/api`, `apps/worker`, `packages/flow`, `packages/db`, `packages/shared`
- **Runtime**: Node.js + TypeScript
- **DB**: Supabase (PostgreSQL)
- **Queue**: BullMQ + Redis (opcional, fallback inline)
- **LLM**: OpenAI (via provider abstraction)
- **Messaging**: Evolution API (WhatsApp)
- **Deploy**: VPS 147.93.10.249, código em `/root/sdr-flow/`, sem PM2/Docker para a app (roda direto ou via script)

### SSH
```bash
ssh -i ~/.ssh/id_ed25519_sdr_flow_vps root@147.93.10.249
```

---

## 2. O QUE É O V11

O V11 "Vendedor Completo" é um fluxo de vendas autônomo para o Vida Card. Diferente do V10 (pré-venda), o V11 deve:
- Qualificar leads
- Apresentar cartões (Essence R$59,90 / Smart R$69,90 / Premium R$89,90)
- Contornar objeções
- Coletar dados (nome, CPF, dependentes)
- Fechar a venda
- Fazer handoff SOMENTE para o gateway de pagamento

O JSON do fluxo está em: `VIDACARD_SDR_FLOW_V11_VENDEDOR.json` (raiz do projeto)

---

## 3. O BUG PRINCIPAL: `recentMessages` retorna apenas 1 mensagem

### Sintoma
O agente repete a apresentação do Cartão Smart toda vez que o lead manda mensagem, sem avançar no funil. O lead "luana nascimento" disse "quero sim, me fala ai" e o bot respondeu NOVAMENTE com SHOW_PRICE ao invés de avançar para fechar/coletar.

### Causa raiz
O `recentMessages` interpolado nos prompts do `next_action` e `writer` contém apenas a mensagem trigger atual:
```
"recentMessages": "[Lead]: quero sim, me fala ai"
```
Sem o histórico da conversa, o LLM não sabe o que já foi dito e volta ao passo 2 do funil (SHOW_PRICE).

### O que já foi feito (mas NÃO resolveu)

1. **`packages/db/src/conversation-repository.ts`** — método `getMessages()` adicionado (linhas 188-205):
```typescript
async getMessages(organizationId: string, conversationId: string, limit = 50) {
  const { data, error } = await this.db
    .from('messages')
    .select('id, content, sender, direction')
    .eq('organization_id', organizationId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data || [];
  rows.reverse();
  return rows;
}
```

2. **`packages/flow/src/services/types.ts`** — interface `DatabaseService` tem `getMessages?` (linha 35):
```typescript
getMessages?(organizationId: string, conversationId: string, limit: number): Promise<Array<{ id: string; content: string; sender: string; direction: string }>>;
```

3. **`packages/flow/src/executors/index.ts`** — executor `context.memory` (linhas 203-236):
```typescript
'context.memory': async (ctx, config, services) => {
  const commercialMemory = MemoryService.getCommercialMemory(ctx.lead);
  const count = config.recentMessages ?? 6;
  let messages = ctx.messages;
  if (services.db?.getMessages) {
    try {
      const rows = await services.db.getMessages(ctx.organizationId, ctx.conversationId, count);
      if (rows.length > 0) {
        messages = rows.map(r => ({
          id: r.id,
          text: r.content,
          fromMe: r.direction === 'OUTBOUND',
        }));
      }
    } catch { /* fall back to ctx.messages */ }
  }
  const recentMessages = MemoryService.formatRecentMessages(messages, count);
  // ...
```

4. **`apps/api/src/webhook.ts`** — wiring (linhas 429-431):
```typescript
getMessages: async (_org, convId, limit) => {
  return convRepo.getMessages(_org, convId, limit);
},
```

5. **`apps/worker/src/main.ts`** — mesma wiring (linhas 121-123).

6. **Commit 3454b5c** — tudo acima foi commitado e deployado.

### Por que NÃO está funcionando (hipóteses a investigar)

O debug JSON mostra que o `context.memory` executor **executou com sucesso** (durationMs: 1), mas `recentMessages` ainda tem só 1 msg. Isso significa uma de:

**Hipótese A (mais provável): A query retorna 0 rows e o fallback `ctx.messages` é usado**
- O `ctx.messages` passado pelo webhook contém apenas a mensagem trigger (a que acabou de chegar)
- Se `rows.length === 0`, cai no fallback, que é o trigger message
- Possíveis razões pra 0 rows:
  - A tabela `messages` pode não ter mensagens para esse `conversation_id` (mensagens antigas não foram salvas, ou conversation_id mudou)
  - O `organization_id` pode estar errado na query
  - O `conversation_id` do debug é `28e7c69c-2561-44dd-aa43-90085f79b04e` — verificar se existem msgs nele

**Hipótese B: O try/catch engole um erro**
- O `catch { }` vazio na linha 218 engole qualquer exceção
- Se o Supabase retornar erro de permissão (RLS), o catch descarta e usa fallback
- **FIX**: Adicionar `console.warn` no catch para logar o erro

**Hipótese C: `durationMs: 1` indica que o passo foi cachado ou não executou a query**
- 1ms é rápido demais para uma query ao Supabase
- Pode ser que `services.db?.getMessages` seja `undefined` (o optional chaining não entra no if)
- **Verificar**: Se a propriedade `getMessages` realmente existe no objeto `services.db` passado

### Como diagnosticar

1. **SSH no servidor e verificar se há mensagens no DB para essa conversa**:
```sql
SELECT id, content, sender, direction, created_at
FROM messages
WHERE conversation_id = '28e7c69c-2561-44dd-aa43-90085f79b04e'
ORDER BY created_at DESC
LIMIT 20;
```
Rodar via Supabase Dashboard ou psql.

2. **Adicionar log no executor context.memory**:
No arquivo `packages/flow/src/executors/index.ts`, dentro do executor `context.memory`:
```typescript
if (services.db?.getMessages) {
  try {
    console.log('[context.memory] Fetching messages from DB:', ctx.organizationId, ctx.conversationId, count);
    const rows = await services.db.getMessages(ctx.organizationId, ctx.conversationId, count);
    console.log('[context.memory] DB returned', rows.length, 'messages');
    // ...
  } catch (err) {
    console.warn('[context.memory] getMessages failed:', err);
  }
} else {
  console.log('[context.memory] getMessages not available on services.db');
}
```

3. **Rebuildar e redeployar**:
```bash
ssh -i ~/.ssh/id_ed25519_sdr_flow_vps root@147.93.10.249
cd /root/sdr-flow
git pull
pnpm install
pnpm build
# reiniciar o serviço (verificar como roda — pode ser systemd, pm2, ou script)
```

4. **Testar mandando mensagem e ver os logs**.

---

## 4. PROBLEMA SECUNDÁRIO: Notes/Memory bloated

O campo `notes` do lead está extremamente repetitivo e acumulativo. Cada execução adiciona texto sem limpar o anterior. Exemplo:
```
"Prefere exame de sangue para amanhã; confirmou interesse no cartão Vida Card e exame amanhã; questionou preço e opções mais baratas; cliente com alta urgência e dúvidas sobre preço; lead qualificado com objeção ao preço do cartão Vida Card; vendas iniciadas; acompanhamento em progresso; aguarda retorno do vendedor para negociação e esclarecimentos sobre preço em Ijuí; mantém interesse apesar da objeção ao preço do cartão Vida Card; atendimento iniciado em Ijuí; lead responde positivamente à proposta de receber informações."
```

Isso polui o contexto do LLM e desperdiça tokens. O extract node deveria gerar notas concisas e substituir, não acumular infinitamente.

**Fix sugerido**: No prompt do `extract` node no V11 JSON, adicionar regra: "notes deve ter no máximo 200 caracteres, resumo conciso do estado atual, não acumulativo."

---

## 5. PROBLEMA TERCIÁRIO: Knowledge node retorna 0 snippets

```json
{
  "nodeId": "knowledge",
  "output": { "snippetsCount": 0, "snippets": [] }
}
```

A collection "pricing" do vector DB está vazia. Isso NÃO é crítico no V11 porque:
- `requireGroundedPrice: false` na policy
- Preços estão no `context.storage` (node "storage")

Mas se quiser enriquecer, precisa popular a collection "pricing" no Supabase.

---

## 6. DETALHES DO FLUXO V11

### Mapeamento de ações (schema constraint)
O `agent.next_action` só aceita estas ações fixas:
```
ASK_MISSING_FIELD, SHOW_PRICE, CHECK_CALENDAR, CREATE_APPOINTMENT,
RESCHEDULE_APPOINTMENT, CANCEL_APPOINTMENT, SEND_INFORMATION, HANDOFF, END
```

O V11 usa prefixos no `reason` para diferenciar contextos:
- `qualify:` e `coletar:` → ASK_MISSING_FIELD
- `apresentar:` → SHOW_PRICE
- `objecao:`, `pergunta:`, `fechar:`, `confirmar:` → SEND_INFORMATION
- `pagamento:` → CREATE_APPOINTMENT (repurposed como handoff para pagamento)

### Funil progressivo
```
1. Lead novo → ASK_MISSING_FIELD (qualify)
2. Qualificado → SHOW_PRICE
3. Objeção → SEND_INFORMATION (objecao)
4. Pergunta → SEND_INFORMATION (pergunta)
5. Interesse → SEND_INFORMATION (fechar)
6. Aceitou → ASK_MISSING_FIELD (coletar nome)
7. Tem nome → ASK_MISSING_FIELD (coletar cpf)
8. Tem CPF → ASK_MISSING_FIELD (coletar dependents)
9. Dados completos → SEND_INFORMATION (confirmar)
10. Confirmou → CREATE_APPOINTMENT (pagamento)
```

### Compliance (ANS/CFO)
- NUNCA usar: "plano de saúde", "convênio", "carência do plano", "cobertura médica ilimitada", "coparticipação"
- SEMPRE usar: "cartão", "cartão de benefícios", "rede credenciada"
- Policy node tem `blockedTerms` configurado

### Routing
```
route (switch) → ASK_MISSING_FIELD, SHOW_PRICE, SEND_INFORMATION → writer → policy → smart_message → end
                 CREATE_APPOINTMENT → payment_msg → handoff_node
                 HANDOFF → smart_fallback → handoff_node
                 END → end
```

---

## 7. ARQUIVOS-CHAVE

| Arquivo | O que faz |
|---------|-----------|
| `VIDACARD_SDR_FLOW_V11_VENDEDOR.json` | JSON do fluxo V11 (importar no app) |
| `packages/flow/src/executors/index.ts` | Todos os executores de nós, incluindo `context.memory` (linha 203) |
| `packages/flow/src/services/types.ts` | Interface `DatabaseService` com `getMessages?` |
| `packages/db/src/conversation-repository.ts` | `getMessages()` query Supabase (linha 188) |
| `apps/api/src/webhook.ts` | Webhook principal, wiring de services (linha 429) |
| `apps/worker/src/main.ts` | Worker BullMQ, wiring de services (linha 121) |
| `packages/flow/src/services/memory.ts` | `MemoryService.formatRecentMessages()` e `getCommercialMemory()` |
| `packages/flow/src/services/sales-flow.ts` | `evaluateResponsePolicy()`, `splitSmartMessage()` |

---

## 8. DEBUG JSON ANALISADO

Arquivo: `sdr-debug-luana-nascimento-2026-09-09T19-27-57Z-1932ad01.json`

### Sequência de execução (17 steps, todos success):
1. `start` → trigger.message_received
2. `test_mode` → allowed (phone 555592311146)
3. `guard_human` → not blocked (bot_paused: false)
4. `buffer` → 5s window, 1 msg aggregated
5. `media` → no media
6. **`memory`** → `recentMessages: "[Lead]: quero sim, me fala ai"` ← **BUG AQUI, só 1 msg**
7. `storage` → regras carregadas (2384 chars)
8. `knowledge` → 0 snippets (collection "pricing" vazia)
9. `extract` → lead_data atualizado (notes bloated)
10. `update_lead` → salvo no DB
11. `required` → complete (interest present)
12. **`next_action`** → **SHOW_PRICE** (reason: "apresentar: Cartao Smart recomendado") ← **Deveria ser SEND_INFORMATION (fechar) ou (objecao) dado o histórico**
13. `route` → SHOW_PRICE
14. `writer` → "Luana, o Cartão Smart custa R$69,90/mês..." (repetição)
15. `policy` → pass (no violations)
16. `smart` → enviado
17. `end`

### Dados do lead no momento da execução:
```json
{
  "name": "luana nascimento",
  "city": "Ijuí",
  "interest": "exame de sangue",
  "urgency": "amanhã",
  "objections": "questionou sobre valor dos cartões do Vida Card; meio caro pra mim",
  "stage": "HUMAN_HANDOFF",
  "bot_paused": false,
  "handled_by": "AI"
}
```

Note: `stage: "HUMAN_HANDOFF"` mas `handled_by: "AI"` — isso pode indicar um estado inconsistente de uma execução anterior.

---

## 9. O QUE FAZER (plano de ação)

### Passo 1: Confirmar se mensagens existem no DB
```sql
SELECT count(*) FROM messages
WHERE conversation_id = '28e7c69c-2561-44dd-aa43-90085f79b04e';
```
Se 0: as mensagens não estão sendo salvas, ou o conversation_id mudou.

### Passo 2: Adicionar logging no catch do executor
Em `packages/flow/src/executors/index.ts` linha 218, trocar:
```typescript
} catch { /* fall back to ctx.messages */ }
```
por:
```typescript
} catch (err) { console.warn('[context.memory] getMessages error:', err); }
```

### Passo 3: Adicionar log de diagnóstico antes do if
```typescript
console.log('[context.memory] db available:', !!services.db, 'getMessages available:', !!services.db?.getMessages);
```

### Passo 4: Build + Deploy + Testar
```bash
ssh root@147.93.10.249
cd /root/sdr-flow
git pull
pnpm build
# restart
```

### Passo 5: Se mensagens existem mas query falha
- Verificar RLS policies na tabela `messages`
- Verificar se `SUPABASE_SERVICE_ROLE_KEY` está correta (service role bypassa RLS)
- Testar query manualmente via supabase-js

### Passo 6: Se mensagens NÃO existem
- Verificar se `saveMessage` está sendo chamado para mensagens de saída
- O flow salva a resposta do bot? Procurar em `output.smart_message` executor se ele chama `saveMessage`
- Possibilidade: mensagens INBOUND são salvas pelo webhook, mas OUTBOUND não estão sendo salvas pelo executor

### Passo 7: Após fix do recentMessages
- O `next_action` vai ter histórico completo e vai tomar decisões corretas no funil
- Testar com lead novo (conversa limpa)
- Verificar se a lead "luana nascimento" precisa ter notes limpas e conversation stage resetado

---

## 10. NOTAS IMPORTANTES

- **NUNCA colocar credenciais em arquivos git-tracked** — Davi é enfático sobre isso
- **VPS SSH key**: `C:\Users\Davi Menegazzi\.ssh\id_ed25519_sdr_flow_vps`
- **Supabase**: credentials estão em `.env` no servidor, não no repo
- O V11 JSON precisa ser importado via UI do app (não é auto-deployado)
- O usuário (Davi) se comunica em português brasileiro
- Ele prefere respostas diretas, sem rodeios
- O V10 "Fusca" (pré-venda) funciona bem — V11 é a evolução para venda completa
- O `requireGroundedPrice: false` no V11 é intencional (preços no storage, não no knowledge)
