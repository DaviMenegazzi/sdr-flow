# 📐 Playbook de Especificação JSON: Estruturação de Fluxos no SDR Flow

> **Manual técnico para desenvolvedores, IAs e operadores: como estruturar e gerar arquivos JSON válidos que a plataforma SDR Flow aceita, valida e publica sem erros.**

---

## 🎯 1. Estrutura Raiz do JSON (`FlowGraph`)

A plataforma valida a raiz do arquivo com um schema estrito (`z.strictObject`). Isso significa que **qualquer propriedade não reconhecida causará a rejeição imediata do arquivo**.

### Esquema da Raiz:

```json
{
  "schemaVersion": 1,
  "nodes": [ /* Array de nós (1 a 250) */ ],
  "edges": [ /* Array de conexões (0 a 1000) */ ],
  "testMode": {
    "enabled": true,
    "phone": "555592311146"
  },
  "loopLimit": 5
}
```

### Campos da Raiz:
| Campo | Tipo | Obrigatório? | Descrição / Regra |
| :--- | :--- | :---: | :--- |
| `schemaVersion` | `number` | **SIM** | Deve ser estritamente o número literal `1`. |
| `nodes` | `array` | **SIM** | Lista contendo de `1` a `250` objetos de nó. |
| `edges` | `array` | **SIM** | Lista contendo até `1000` objetos de conexão. |
| `testMode` | `object` | *Opcional* | Configurações do modo de teste para filtrar número de WhatsApp. |
| `loopLimit` | `number` | *Opcional* | Limite máximo de iterações em ciclos (inteiro de 1 a 20, default: `5`). |

---

## 📍 2. Estrutura de Cada Nó (`FlowNode`)

Cada item da lista `nodes` representa um bloco visual na tela e deve seguir rigorosamente a seguinte anatomia:

```json
{
  "id": "start",
  "type": "trigger.message_received",
  "label": "Mensagem recebida",
  "position": {
    "x": 0,
    "y": 113
  },
  "config": {}
}
```

### Campos Obrigatórios do Nó:
1. `id` (`string`): Identificador único do nó no fluxo (ex: `"start"`, `"node_1"`, ou UUID como `"a7257032-014c-4c61-a456-2489e261a4e8"`). **Não podem existir IDs repetidos**.
2. `type` (`string`): Um dos **44 tipos exatos** suportados pelo catálogo da plataforma (ver Tabela 2.1).
3. `label` (`string`): Nome legível exibido no card visual (ex: `"Extrair informações"`, `"Modo teste"`).
4. `position` (`object`): Coordenadas cartesianas no Canvas:
   - `x` (`number`): Posição horizontal.
   - `y` (`number`): Posição vertical.
5. `config` (`object`): Objeto contendo os parâmetros de configuração específicos daquele tipo de nó.

---

### 📋 2.1. Dicionário de Nós e Especificação do `config`

Abaixo estão todos os nós aceitos e como deve ser preenchido o seu respectivo `config`:

#### A) Gatilhos (`trigger.*`)
*Todo fluxo deve conter **EXATAMENTE UM** nó desta categoria.*
- `trigger.message_received`: `"config": {}` (objeto vazio).
- `trigger.schedule`: `"config": { "cron": "0 9 * * 1-5", "timezone": "America/Sao_Paulo" }`.
- `trigger.manual`: `"config": {}`.

#### B) Guardas (`guard.*`)
- `guard.test_mode`:
  ```json
  "config": {
    "enabled": true,
    "allowedPhones": ["555592311146"]
  }
  ```
- `guard.human_takeover`: `"config": {}`.
- `guard.business_hours`:
  ```json
  "config": {
    "timezone": "America/Sao_Paulo",
    "start": "08:00",
    "end": "18:00",
    "weekdays": [1, 2, 3, 4, 5]
  }
  ```
- `guard.chat_type`: `"config": { "allowGroups": false }`.
- `guard.response_policy`:
  ```json
  "config": {
    "text": "{{decision.reply}}",
    "maxCharacters": 700,
    "knownFields": ["name", "city", "interest", "specialty"],
    "blockedTerms": [],
    "requireGroundedPrice": true
  }
  ```
  O nó envia pela porta `blocked` mensagens vazias, termos proibidos e preços sem lastro na base de
  conhecimento. Mensagens longas, perguntas sobre campos já conhecidos, perguntas repetidas,
  aberturas repetitivas e CTAs genéricos seguem por `rewrite`; as demais seguem por `pass`.

#### C) Entrada (`input.*`)
- `input.buffer`: `"config": { "windowSeconds": 10 }` (min: 5, max: 120).
  Com `REDIS_URL` configurada, cada mensagem reinicia essa janela no Redis/BullMQ. Apenas a geração
  mais recente roda e ela recebe o lote completo; execuções ultrapassadas não podem enviar mensagem,
  chamar webhook nem alterar agenda. Sem Redis, a execução permanece inline — não há buffer em memória.
- `input.media`: `"config": { "transcribeAudio": true, "describeImages": true }`.
- `input.normalize`: `"config": { "country": "BR" }` (valores: `"BR"` ou `"international"`).

#### D) Contexto (`context.*`)
- `context.memory`: `"config": { "recentMessages": 10 }` (min: 6, max: 50).
- `context.knowledge`:
  ```json
  "config": {
    "collection": "catalog",
    "topK": 5,
    "threshold": 0.7
  }
  ```
  *(Coleções válidas: `"default"`, `"pricing"`, `"catalog"`, `"faq"`, `"objections"`, `"documents"`)*.
- `context.crm`: `"config": {}`.
- `context.summarize`: `"config": { "afterMessages": 30 }` (min: 30, max: 500).
- `context.storage`:
  ```json
  "config": {
    "content": "Texto ou JSON interno",
    "variableName": "storage",
    "outputPorts": ["next"]
  }
  ```
- `context.conversation_state`:
  ```json
  "config": {
    "stage": "DISCOVERY",
    "lastAction": "{{next_action.action}}",
    "nextExpectedInput": ""
  }
  ```
  *(Estágios aceitos: `DISCOVERY`, `QUALIFYING`, `PRICING`, `SCHEDULING`, `CLOSING`, `HANDOFF`,
  `SUPPORT`.) O estado é salvo em `lead.memory.conversation_state` e também fica disponível como
  `{{conversation_state}}`.*

#### E) Agente / Inteligência (`agent.*`)
- `agent.decide`, `agent.classify`, `agent.extract`, `agent.score`:
  ```json
  "config": {
    "provider": "openai",
    "model": "default",
    "prompt": "Instruções do agente...",
    "system": "Instruções de sistema (opcional)"
  }
  ```
  *(Provedores aceitos: `"openai"`, `"gemini"`)*.
- `agent.structured`:
  ```json
  "config": {
    "provider": "openai",
    "model": "default",
    "prompt": "Instruções de extração JSON...",
    "outputKeys": ["repeat_count", "category"]
  }
  ```
  *(Atenção: cada chave listada em `outputKeys` gera uma porta de saída correspondente no nó).*
- `agent.next_action`:
  ```json
  "config": {
    "provider": "openai",
    "model": "default",
    "prompt": "Escolha a próxima ação comercial sem inventar dados ausentes.",
    "allowedActions": [
      "ASK_MISSING_FIELD",
      "SHOW_PRICE",
      "CHECK_CALENDAR",
      "CREATE_APPOINTMENT",
      "RESCHEDULE_APPOINTMENT",
      "CANCEL_APPOINTMENT",
      "SEND_INFORMATION",
      "HANDOFF",
      "END"
    ]
  }
  ```
  Se `required_fields.missing` contiver campos, o nó escolhe deterministicamente
  `ASK_MISSING_FIELD` para o primeiro campo, sem gastar tokens. Caso contrário, exige saída
  estruturada do LLM e rejeita qualquer ação fora de `allowedActions`.

#### F) Controle de Fluxo (`flow.*`)
- `flow.condition`:
  ```json
  "config": {
    "variable": "decision.handoff",
    "operator": "equals",
    "value": "true"
  }
  ```
  *(Operadores: `"equals"`, `"not_equals"`, `"contains"`, `"greater_than"`)*.
- `flow.switch`:
  ```json
  "config": {
    "variable": "decision.intent",
    "cases": ["preco", "agendamento", "duvidas"]
  }
  ```
  *(Cada caso vira uma porta de saída própria).*
- `flow.delay`: `"config": { "seconds": 5 }` (min: 2, max: 86400).
- `flow.wait_reply`: `"config": { "timeoutMinutes": 1440 }` (min: 1440, max: 43200).
- `flow.loop`:
  ```json
  "config": {
    "times": "{{structured.repeat_count}}",
    "counterVar": "loop_count"
  }
  ```
- `flow.required_fields`:
  ```json
  "config": {
    "required": ["city", "specialty"],
    "optional": ["desired_day", "desired_period"]
  }
  ```
  Os campos podem ser caminhos (`qualification.city`) e são procurados em `variables`, no lead,
  em `lead.memory` e em `commercialMemory`, inclusive pelos aliases em português. O resultado fica
  em `{{required_fields}}` com `complete`, `missing`, `missing_count` e `optional_available`.

#### G) Ações Comerciais (`action.*`)
- `action.update_stage`: `"config": { "stage": "QUALIFYING" }`.
- `action.update_lead`: `"config": { "source": "decision.lead_data" }`.
- `action.crm_sync`: `"config": {}`.
- `action.handoff`: `"config": { "reason": "Lead solicitou agendamento com consultor humano" }`.
- `action.webhook`:
  ```json
  "config": {
    "url": "https://api.empresa.com/webhook",
    "method": "POST",
    "timeoutSeconds": 15
  }
  ```

#### H) Integrações e Agenda (`integration.*`, `calendar.*`)
- `integration.google_calendar`: integração genérica legada com portas `success` e `error`. Para
  novos fluxos comerciais, prefira os nós `calendar.*`, pois as credenciais ficam somente no
  servidor.
  ```json
  "config": {
    "action": "list_events",
    "calendarId": "primary",
    "credentials": "",
    "daysAhead": 7,
    "eventTitle": "",
    "eventStart": "",
    "eventEnd": "",
    "eventDescription": ""
  }
  ```
  *(Ações: `list_events`, `create_event`, `check_availability`. O campo `credentials` existe apenas
  por compatibilidade e não deve ser usado em fluxos novos.)*
- `calendar.availability`:
  ```json
  "config": {
    "calendarId": "primary",
    "date": "{{scheduling.desired_day}}",
    "period": "{{scheduling.desired_period}}",
    "durationMinutes": 30,
    "timezone": "America/Sao_Paulo",
    "daysAhead": 14
  }
  ```
  Aceita data ISO, `hoje`, `amanhã` ou dia da semana. As janelas padrão são manhã `08:00–12:00`,
  tarde `12:00–18:00`, noite `18:00–22:00` e dia inteiro `08:00–18:00`.
- `calendar.create_event`:
  ```json
  "config": {
    "calendarId": "primary",
    "start": "{{calendar.first_available}}",
    "durationMinutes": 30,
    "timezone": "America/Sao_Paulo",
    "title": "Consulta - {{lead.name}}",
    "description": "",
    "leadName": "{{lead.name}}",
    "leadPhone": "{{lead.phone}}"
  }
  ```
- `calendar.reschedule_event`:
  ```json
  "config": {
    "calendarId": "primary",
    "eventId": "{{calendar.event_id}}",
    "newStart": "{{scheduling.selected_slot}}",
    "durationMinutes": 30,
    "timezone": "America/Sao_Paulo"
  }
  ```
- `calendar.cancel_event`:
  ```json
  "config": {
    "calendarId": "primary",
    "eventId": "{{calendar.event_id}}",
    "reason": ""
  }
  ```

> As credenciais dos nós `calendar.*` vêm de `GOOGLE_CALENDAR_CREDENTIALS_JSON` no servidor. Elas
> não pertencem ao JSON publicado. Criação, reagendamento e cancelamento só usam as portas de
> sucesso depois de confirmação da API do Google; ausência de provedor ou erro HTTP segue por
> `error`.

#### I) Saídas (`output.*`)
- `output.send_text`:
  ```json
  "config": {
    "text": "{{decision.reply}}",
    "typing": true
  }
  ```
- `output.send_media`:
  ```json
  "config": {
    "url": "https://meusite.com/tabela.pdf",
    "mediaType": "document",
    "caption": "Segue a tabela oficial de serviços."
  }
  ```
  *(Tipos de mídia: `"image"`, `"audio"`, `"video"`, `"document"`)*.
- `output.send_template`: `"config": { "name": "boas_vindas", "language": "pt_BR" }`.
- `output.smart_message`:
  ```json
  "config": {
    "text": "{{decision.reply}}",
    "typing": true,
    "maxBubbles": 3,
    "maxCharactersPerBubble": 320
  }
  ```
  Divide a resposta por parágrafos e frases completas em no máximo três bolhas, envia cada uma e
  persiste separadamente seus IDs. Mensagem vazia, telefone ausente ou falha de envio interrompem a
  execução; o nó não simula sucesso.
- `output.end`: `"config": {}`.

---

## 🔗 3. Estrutura de Conexões (`FlowEdge`)

As conexões unem um nó ao próximo. No SDR Flow, uma conexão é definida estritamente assim:

```json
{
  "id": "edge-1",
  "source": "start",
  "target": "node-2",
  "sourcePort": "next"
}
```

### Campos Obrigatórios da Conexão:
| Campo | Tipo | Descrição |
| :--- | :--- | :--- |
| `id` | `string` | ID único da conexão (ex: UUID ou `"edge-1"`). |
| `source` | `string` | `id` do nó de **origem**. |
| `target` | `string` | `id` do nó de **destino**. |
| `sourcePort` | `string` | Nome exato da porta de saída do nó de origem. |

> ⚠️ **Atenção:** A plataforma **NÃO possui** campo `targetPort`. Apenas `sourcePort`.

---

### 🚪 3.1. Mapa Obrigatório de Portas de Saída (`sourcePort`)

Cada nó possui saídas específicas que o validador exige que existam e estejam conectadas:

| Tipo do Nó | Saídas Obrigatórias (`sourcePort`) |
| :--- | :--- |
| `output.end` | *(Nenhuma saída permitida - nó terminal)* |
| `guard.response_policy` | `["pass", "rewrite", "blocked"]` |
| Demais guardas (`guard.*`) | `["pass", "blocked"]` (ambas devem ser conectadas) |
| `flow.condition` | `["true", "false"]` (ambas devem ser conectadas) |
| `flow.required_fields` | `["complete", "missing"]` |
| `flow.wait_reply` | `["reply", "timeout"]` (ambas devem ser conectadas) |
| `flow.loop` | `["body", "done"]` (ambas devem ser conectadas) |
| `flow.switch` | Cada valor definido em `cases` + `"default"` |
| `agent.structured` | Cada chave definida em `outputKeys` + `"default"` |
| `context.storage` | Cada valor definido em `outputPorts` |
| `integration.google_calendar` | `["success", "error"]` |
| `calendar.availability` | `["available", "unavailable", "error"]` |
| `calendar.create_event` | `["created", "error"]` |
| `calendar.reschedule_event` | `["rescheduled", "error"]` |
| `calendar.cancel_event` | `["cancelled", "error"]` |
| **Todos os demais nós** | `["next"]` |

### 3.2. Variáveis produzidas pelos blocos comerciais

| Nó | Variáveis disponíveis para os nós seguintes |
| :--- | :--- |
| `flow.required_fields` | `required_fields.complete`, `required_fields.missing`, `required_fields.missing_count`, `required_fields.optional_available` |
| `agent.next_action` | `next_action.action`, `next_action.field`, `next_action.reason`, `decision.action`, `decision.next_action` |
| `context.conversation_state` | `conversation_state.stage`, `conversation_state.last_action`, `conversation_state.next_expected_input`, `conversation_state.updated_at` |
| `guard.response_policy` | `response_policy.status`, `response_policy.violations`, `response_policy.message` |
| `calendar.availability` | `calendar.slots`, `calendar.slot_starts`, `calendar.slot_details`, `calendar.first_available`, `calendar.calendar_name`, `calendar.date`, `calendar.timezone` |
| `calendar.create_event` | `calendar.event_id`, `calendar.start`, `calendar.end`, `calendar.event_link` |
| `calendar.reschedule_event` | Campos do evento acima + `calendar.rescheduled` |
| `calendar.cancel_event` | `calendar.event_id`, `calendar.cancelled`, `calendar.cancellation_reason` |
| `output.smart_message` | `smart_message.sent`, `smart_message.bubble_count`, `smart_message.bubbles`, `smart_message.message_ids` |

---

## 🛑 4. As 7 Regras de Ouro do Validador (Checklist Anti-Erro)

Antes de salvar ou publicar um fluxo, execute mentalmente este checklist. Se violar qualquer ponto, o JSON será rejeitado:

### ✅ Regra 1: Exatamente 1 Gatilho (`trigger_count`)
- O fluxo precisa ter **um único** nó do tipo `trigger.*`.
- Nenhum nó pode apontar para um gatilho (`trigger_incoming` é proibido).

### ✅ Regra 2: 100% das Portas Conectadas (`required_port`)
- Toda porta gerada por um nó precisa ter **uma conexão saindo dela**.
- Se você colocou um nó `guard.test_mode`, é **obrigatório** ter uma conexão para `pass` e outra para `blocked`.
- Se você colocou `agent.structured` com `outputKeys: ["count"]`, é **obrigatório** ter uma conexão para `count` e outra para `default`.

### ✅ Regra 3: Saída Única por Porta (`forbids multiple targets on one port`)
- Não ligue duas linhas saindo da mesma porta. Se você precisa que dois caminhos ocorram, use nós de fluxo intermediários ou ramificações condicionais.

### ✅ Regra 4: Garantia de Término em Todos os Ramos (`no_termination`)
- Nós como `output.send_text`, `action.update_lead`, etc., possuem saída `next`.
- **Eles nunca podem ficar soltos no vácuo**.
- A saída `next` do último nó precisa alcançar um `output.end` ou entrar em um ciclo controlado.
- Ciclos são aceitos pelo validador, mas o runtime encerra com erro após `loopLimit` visitas ao mesmo
  nó (default `5`) ou após `50` passos totais. As duas portas de `flow.wait_reply` também precisam
  continuar para um término ou ciclo válido.

### ✅ Regra 5: Nenhum Nó Órfão (`unreachable`)
- Todos os nós no array `nodes` devem ser alcançáveis a partir do nó gatilho inicial. Se houver um nó flutuando sem conexão, a validação falhará.

### ✅ Regra 6: IDs Únicos (`duplicate_node` / `duplicate_edge`)
- Não repita IDs em nós ou conexões.

### ✅ Regra 7: Sintaxe Limpa de Interpolação
- Use sempre `{{variavel}}` sem caracteres soltos (como parênteses extras `}})` ou espaços indevidos).

---

## 📱 5. Objeto de Modo Teste (`testMode`)

Se você incluir o bloco `testMode` na raiz do JSON, ele deve seguir a regex de telefone internacional ou padrão brasileiro:

```json
"testMode": {
  "enabled": true,
  "phone": "555592311146"
}
```
- Se `enabled: true`, o campo `phone` não pode ser vazio e deve conter DDI + DDD + número (ex: `"5511999998888"` ou `"+55 55 99231-1146"`).

---

## 🌟 6. Template Mínimo Válido (Pronto para Copiar e Usar)

Abaixo está o menor JSON possível e 100% aprovado pelo validador. Use-o como base para construir qualquer fluxo:

```json
{
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "start",
      "type": "trigger.message_received",
      "label": "Mensagem recebida",
      "position": { "x": 0, "y": 100 },
      "config": {}
    },
    {
      "id": "agent",
      "type": "agent.decide",
      "label": "IA Decide",
      "position": { "x": 300, "y": 100 },
      "config": {
        "provider": "openai",
        "model": "default",
        "prompt": "Você é o assistente virtual da empresa. Responda com cordialidade e brevidade."
      }
    },
    {
      "id": "send",
      "type": "output.send_text",
      "label": "Enviar WhatsApp",
      "position": { "x": 600, "y": 100 },
      "config": {
        "text": "{{decision.reply}}",
        "typing": true
      }
    },
    {
      "id": "end",
      "type": "output.end",
      "label": "Fim",
      "position": { "x": 900, "y": 100 },
      "config": {}
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "start",
      "target": "agent",
      "sourcePort": "next"
    },
    {
      "id": "e2",
      "source": "agent",
      "target": "send",
      "sourcePort": "next"
    },
    {
      "id": "e3",
      "source": "send",
      "target": "end",
      "sourcePort": "next"
    }
  ]
}
```

---

## 🚀 7. Template Completo de SDR Comercial (Com Modo Teste, RAG, IA e Handoff)

Este template representa o fluxo comercial completo de pré-vendas com proteção de teste, consulta semântica à base de conhecimento, decisão do agente, envio da mensagem e transbordo para atendente humano:

```json
{
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "start",
      "type": "trigger.message_received",
      "label": "Mensagem recebida",
      "position": { "x": 0, "y": 150 },
      "config": {}
    },
    {
      "id": "guard_test",
      "type": "guard.test_mode",
      "label": "Modo teste",
      "position": { "x": 300, "y": 150 },
      "config": {
        "enabled": true,
        "allowedPhones": ["555592311146"]
      }
    },
    {
      "id": "end_blocked",
      "type": "output.end",
      "label": "Bloqueado / Fim",
      "position": { "x": 300, "y": 0 },
      "config": {}
    },
    {
      "id": "memory",
      "type": "context.memory",
      "label": "Memória comercial",
      "position": { "x": 600, "y": 150 },
      "config": {
        "recentMessages": 10
      }
    },
    {
      "id": "knowledge",
      "type": "context.knowledge",
      "label": "Base de conhecimento",
      "position": { "x": 900, "y": 150 },
      "config": {
        "collection": "catalog",
        "topK": 5,
        "threshold": 0.7
      }
    },
    {
      "id": "decide",
      "type": "agent.decide",
      "label": "Decisão do SDR",
      "position": { "x": 1200, "y": 150 },
      "config": {
        "provider": "openai",
        "model": "default",
        "prompt": "Você é o SDR da empresa no WhatsApp. Conduza o atendimento com empatia e brevidade (2 a 3 frases curtas). Se o lead estiver pronto para fechar, ative handoff."
      }
    },
    {
      "id": "check_handoff",
      "type": "flow.condition",
      "label": "Precisa de humano?",
      "position": { "x": 1500, "y": 150 },
      "config": {
        "variable": "decision.handoff",
        "operator": "equals",
        "value": "true"
      }
    },
    {
      "id": "action_handoff",
      "type": "action.handoff",
      "label": "Passar para humano",
      "position": { "x": 1800, "y": 50 },
      "config": {
        "reason": "Qualificação concluída - passar para consultor fechar"
      }
    },
    {
      "id": "send_text",
      "type": "output.send_text",
      "label": "Enviar mensagem",
      "position": { "x": 1800, "y": 250 },
      "config": {
        "text": "{{decision.reply}}",
        "typing": true
      }
    },
    {
      "id": "end_flow",
      "type": "output.end",
      "label": "Encerrar fluxo",
      "position": { "x": 2100, "y": 150 },
      "config": {}
    }
  ],
  "edges": [
    {
      "id": "e_start_to_guard",
      "source": "start",
      "target": "guard_test",
      "sourcePort": "next"
    },
    {
      "id": "e_guard_blocked",
      "source": "guard_test",
      "target": "end_blocked",
      "sourcePort": "blocked"
    },
    {
      "id": "e_guard_pass",
      "source": "guard_test",
      "target": "memory",
      "sourcePort": "pass"
    },
    {
      "id": "e_memory_to_knowledge",
      "source": "memory",
      "target": "knowledge",
      "sourcePort": "next"
    },
    {
      "id": "e_knowledge_to_decide",
      "source": "knowledge",
      "target": "decide",
      "sourcePort": "next"
    },
    {
      "id": "e_decide_to_cond",
      "source": "decide",
      "target": "check_handoff",
      "sourcePort": "next"
    },
    {
      "id": "e_cond_true",
      "source": "check_handoff",
      "target": "action_handoff",
      "sourcePort": "true"
    },
    {
      "id": "e_cond_false",
      "source": "check_handoff",
      "target": "send_text",
      "sourcePort": "false"
    },
    {
      "id": "e_handoff_to_end",
      "source": "action_handoff",
      "target": "end_flow",
      "sourcePort": "next"
    },
    {
      "id": "e_send_to_end",
      "source": "send_text",
      "target": "end_flow",
      "sourcePort": "next"
    }
  ],
  "testMode": {
    "enabled": true,
    "phone": "555592311146"
  },
  "loopLimit": 5
}
```

---

## 🧠 8. Encadeamento Action-First dos Novos Blocos

A decisão comercial deve ser estruturada antes de redigir a mensagem. A sequência recomendada é:

1. `context.memory` e `context.knowledge` carregam fatos já conhecidos.
2. `flow.required_fields` calcula o que falta.
3. Tanto `complete` quanto `missing` podem convergir para `agent.next_action`:
   - em `missing`, ele escolhe `ASK_MISSING_FIELD` sem LLM;
   - em `complete`, o LLM escolhe uma ação válida da lista configurada.
4. Um `flow.switch` sobre `next_action.action` encaminha para pergunta, preço, informação,
   calendário, handoff ou encerramento.
5. `context.conversation_state` registra a ação escolhida e a próxima entrada esperada.
6. Toda mensagem gerada passa por `guard.response_policy`:
   - `pass` → `output.smart_message`;
   - `rewrite` → um agente de redação tenta novamente, respeitando o `loopLimit`;
   - `blocked` → handoff ou encerramento seguro, sem envio.
7. Operações `calendar.*` tratam obrigatoriamente o ramo `error`; nunca converta erro em sucesso.

Exemplo da convergência inicial:

```json
[
  {
    "id": "e_required_complete",
    "source": "required_fields",
    "target": "next_action",
    "sourcePort": "complete"
  },
  {
    "id": "e_required_missing",
    "source": "required_fields",
    "target": "next_action",
    "sourcePort": "missing"
  },
  {
    "id": "e_next_action",
    "source": "next_action",
    "target": "route_action",
    "sourcePort": "next"
  }
]
```

O `flow.switch` seguinte deve declarar como `cases` exatamente as ações que terão um ramo no grafo
e também conectar `default`. Se todas as nove ações forem habilitadas, as portas são:

```json
"cases": [
  "ASK_MISSING_FIELD",
  "SHOW_PRICE",
  "CHECK_CALENDAR",
  "CREATE_APPOINTMENT",
  "RESCHEDULE_APPOINTMENT",
  "CANCEL_APPOINTMENT",
  "SEND_INFORMATION",
  "HANDOFF",
  "END"
]
```
