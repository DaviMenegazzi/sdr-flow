# Especificação Resumida — Novos Blocos para o SDR Flow

## Objetivo

Evoluir o SDR Flow para que o agente deixe de apenas “responder mensagens” e passe a **executar a próxima ação correta da venda**, mantendo o fluxo enxuto, rápido e confiável.

A prioridade é evitar:
- perguntas repetidas;
- perda de contexto;
- excesso de nós;
- respostas longas ou robotizadas;
- dependência excessiva do histórico bruto;
- handoff antes da hora.

---

# Blocos Prioritários

## 1. `flow.required_fields`

### Objetivo
Validar se os dados necessários para uma ação já estão disponíveis na memória antes de perguntar qualquer coisa ao lead.

### Exemplo de uso

Para agendar uma consulta:

```json
{
  "required": ["city", "specialty"],
  "optional": ["desired_day", "desired_period"]
}
```

### Saídas

```text
complete
missing
```

### Variáveis esperadas

```text
{{required_fields.complete}}
{{required_fields.missing}}
{{required_fields.missing_count}}
```

### Regra principal

Se o campo já existe na memória, o agente **não pode perguntar novamente**.

Exemplo:

```json
{
  "city": "Ijuí",
  "specialty": "Oftalmologia"
}
```

Nesse caso, o fluxo deve seguir direto para preço, disponibilidade ou agendamento.

---

## 2. `agent.next_action`

### Objetivo
Decidir **o que deve acontecer agora**, antes de decidir o que responder.

O agente não deve pensar primeiro em “qual mensagem enviar”, mas em:

> “Qual é a próxima ação que aproxima essa conversa da conversão?”

### Possíveis ações

```text
ASK_MISSING_FIELD
SHOW_PRICE
CHECK_CALENDAR
CREATE_APPOINTMENT
RESCHEDULE_APPOINTMENT
CANCEL_APPOINTMENT
SEND_INFORMATION
HANDOFF
END
```

### Exemplo de saída

```json
{
  "action": "CHECK_CALENDAR",
  "field": null,
  "reason": "Cidade e especialidade já conhecidas; lead quer agendar."
}
```

Outro exemplo:

```json
{
  "action": "ASK_MISSING_FIELD",
  "field": "city",
  "reason": "Cidade ainda não informada."
}
```

---

## 3. `calendar.availability`

### Objetivo
Consultar a disponibilidade de um Google Calendar conectado.

### Entradas sugeridas

```text
calendar_id
date
period
duration_minutes
timezone
days_ahead
```

### Variáveis esperadas

```text
{{calendar.slots}}
{{calendar.first_available}}
{{calendar.calendar_name}}
```

### Saídas

```text
available
unavailable
error
```

### Exemplo

Lead:

> Quero oftalmo segunda à tarde.

Memória:

```json
{
  "city": "Ijuí",
  "specialty": "Oftalmologia",
  "desired_day": "segunda-feira",
  "desired_period": "tarde"
}
```

Resultado do calendário:

```json
{
  "slots": ["14:00", "15:30", "17:00"]
}
```

Resposta:

> Tenho 14h, 15h30 e 17h disponíveis na segunda. Qual fica melhor?

---

## 4. `calendar.create_event`

### Objetivo
Criar o agendamento quando o lead escolher o horário.

### Entradas sugeridas

```text
calendar_id
start
duration_minutes
title
description
lead_name
lead_phone
```

### Variáveis esperadas

```text
{{calendar.event_id}}
{{calendar.start}}
{{calendar.end}}
```

### Saídas

```text
created
error
```

---

# Blocos Secundários

## 5. `calendar.reschedule_event`

Alterar data ou horário de um agendamento existente.

### Entradas

```text
event_id
new_start
duration_minutes
```

---

## 6. `calendar.cancel_event`

Cancelar um agendamento existente.

### Entradas

```text
event_id
reason
```

---

## 7. `context.conversation_state`

### Objetivo
Guardar o estágio real da conversa de forma estruturada.

### Estados sugeridos

```text
DISCOVERY
QUALIFYING
PRICING
SCHEDULING
CLOSING
HANDOFF
SUPPORT
```

### Exemplo

```json
{
  "stage": "SCHEDULING",
  "last_action": "CHECK_CALENDAR",
  "next_expected_input": "selected_slot"
}
```

---

## 8. `output.smart_message`

### Objetivo
Receber uma resposta completa e decidir automaticamente se ela deve ser enviada em 1, 2 ou 3 bolhas de WhatsApp.

### Regras

**1 bolha**
- resposta simples;
- preço único;
- confirmação.

**2 bolhas**
- resposta + próximo passo;
- explicação curta + CTA.

**3 bolhas**
- comparação;
- várias opções;
- pergunta mais complexa.

### Regras adicionais

- não cortar frases no meio;
- não repetir informação;
- evitar bolhas muito longas;
- evitar fragmentação artificial;
- última bolha deve avançar a conversa quando houver próximo passo.

---

## 9. `guard.response_policy`

### Objetivo
Validar a mensagem antes do envio.

### O bloco deve verificar

```text
- pergunta repetida;
- resposta longa demais;
- repetição de palavras/aberturas;
- preço não sustentado pela base;
- informação já conhecida sendo perguntada novamente;
- compliance da marca;
- CTA genérico quando existe próximo passo melhor.
```

### Saídas

```text
pass
rewrite
blocked
```

---

# Memória Estruturada

O histórico bruto deve ser apenas apoio.

O estado principal da venda deve ficar no armazenamento persistente.

### Estrutura sugerida

```json
{
  "lead": {
    "name": "Carlos",
    "phone": "..."
  },
  "qualification": {
    "city": "Ijuí",
    "interest": "consulta",
    "specialty": "oftalmologia"
  },
  "commercial": {
    "stage": "SCHEDULING",
    "last_price_shown": 90,
    "ready_to_buy": true
  },
  "scheduling": {
    "desired_day": "segunda-feira",
    "desired_period": "tarde",
    "selected_slot": null,
    "event_id": null
  },
  "conversation": {
    "last_question": "Qual horário fica melhor?",
    "next_action": "WAIT_SLOT_SELECTION"
  }
}
```

---

# Arquitetura Recomendada

O fluxo principal deve continuar pequeno.

```text
Mensagem
↓
Buffer
↓
Memória / Storage
↓
Extrair e salvar novos dados
↓
Required Fields
↓
Next Action
↓
Preço / Calendar / Handoff / outra ação
↓
Smart Message
↓
Fim
```

Meta recomendada:

```text
12 a 18 nós no fluxo principal
```

Evitar recriar lógica complexa em dezenas de agentes ou switches.

---

# Prioridade de Implementação

## Fase 1 — Essencial

Implementar primeiro:

```text
flow.required_fields
agent.next_action
calendar.availability
calendar.create_event
```

Esses quatro blocos já resolvem grande parte dos problemas atuais de continuidade, repetição e avanço da venda.

## Fase 2 — Qualidade

Depois implementar:

```text
output.smart_message
context.conversation_state
guard.response_policy
```

## Fase 3 — Agenda Completa

Por último:

```text
calendar.reschedule_event
calendar.cancel_event
```

---

# Resultado Esperado

O SDR deve deixar de funcionar como:

> mensagem → IA responde → mensagem → IA responde

e passar a funcionar como:

> mensagem → entende estado → verifica o que falta → escolhe próxima ação → executa → responde

Esse é o comportamento desejado para tornar o SDR Flow mais próximo de um agente comercial real e menos parecido com um chatbot.
