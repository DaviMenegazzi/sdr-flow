import { z } from 'zod';
import {
  conversationStateStages,
  nextActionTypes,
  nodeTypes,
  type NodeType,
  type FlowNode,
} from '@sdr/shared';

const text = (value: string, description: string) => z.string().min(1).default(value).describe(description);
const count = (value: number, max: number, description: string) => z.number().int().min(1).max(max).default(value).describe(description);
const empty = z.object({}).passthrough();
const prompt = z.object({
  provider: z.enum(['openai', 'gemini']).default('openai').describe('Provedor'),
  model: text('default', 'Modelo (default usa OPENAI_MODEL do servidor)'),
  prompt: text('Conduza a conversa a partir do contexto disponível. Não invente informações.', 'Instruções do agente'),
  system: z.string().optional().describe('Instrução de sistema opcional'),
}).passthrough();
const extractField = z.strictObject({
  name: z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/).describe('Nome técnico do campo'),
  type: z.enum(['string', 'number', 'boolean', 'string_array']).default('string').describe('Tipo do campo'),
  description: z.string().max(300).optional().describe('Quando e como extrair este campo'),
  values: z.array(z.string().min(1).max(100)).max(30).optional().describe('Valores permitidos para campos de texto'),
});
const extractPrompt = z.strictObject({
  provider: z.enum(['openai', 'gemini']).default('openai').describe('Provedor'),
  model: text('default', 'Modelo (default usa OPENAI_MODEL do servidor)'),
  prompt: text('Extraia apenas informações declaradas no contexto. Não invente informações.', 'Instruções do agente'),
  system: z.string().optional().describe('Instrução de sistema opcional'),
  fields: z.array(extractField).max(30).default([]).describe('Campos personalizados persistidos em custom_fields (JSON)'),
});
const schemas = {
  'trigger.message_received': empty,
  'trigger.schedule': z.strictObject({ cron: text('0 9 * * 1-5', 'Expressão cron'), timezone: text('America/Sao_Paulo', 'Fuso horário') }),
  'trigger.manual': empty,
  'guard.test_mode': z.strictObject({ enabled: z.boolean().default(true).describe('Modo teste ativo'), allowedPhones: z.array(z.string().min(8)).default([]).describe('Telefones autorizados (JSON)') }),
  'guard.human_takeover': empty,
  'guard.business_hours': z.strictObject({ timezone: text('America/Sao_Paulo', 'Fuso horário'), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:00').describe('Início'), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('18:00').describe('Fim'), weekdays: z.array(z.number().int().min(0).max(6)).min(1).default([1,2,3,4,5]).describe('Dias da semana (0 = domingo)') }),
  'guard.chat_type': z.strictObject({ allowGroups: z.boolean().default(false).describe('Permitir grupos') }),
  'guard.response_policy': z.strictObject({
    text: text('{{decision.reply}}', 'Mensagem que será validada'),
    maxCharacters: z.number().int().min(80).max(4000).default(700).describe('Máximo de caracteres antes de solicitar reescrita'),
    knownFields: z.array(z.string().min(1).max(80)).max(30).default(['name', 'city', 'interest', 'specialty']).describe('Campos que não devem ser perguntados novamente (JSON)'),
    blockedTerms: z.array(z.string().min(1).max(120)).max(50).default([]).describe('Termos proibidos pela política da marca (JSON)'),
    requireGroundedPrice: z.boolean().default(true).describe('Bloquear preços ausentes na base de conhecimento'),
    groundingSources: z.array(z.string().min(1).max(100)).min(1).max(10).default(['knowledgeSnippets']).describe('Variáveis aceitas como fontes para preços (JSON)'),
    preventSemanticRepetition: z.boolean().default(true).describe('Solicitar reescrita quando a resposta repete uma mensagem recente da IA'),
    similarityThreshold: z.number().min(0.5).max(1).default(0.72).describe('Similaridade mínima considerada repetição'),
  }),
  'input.buffer': z.strictObject({ windowSeconds: count(5, 120, 'Janela em segundos') }),
  'input.media': z.strictObject({ transcribeAudio: z.boolean().default(true).describe('Transcrever áudio'), describeImages: z.boolean().default(true).describe('Descrever imagens') }),
  'input.normalize': z.strictObject({ country: z.enum(['BR', 'international']).default('BR').describe('Formato do telefone') }),
  'context.memory': z.strictObject({ recentMessages: count(6, 50, 'Mensagens recentes') }),
  'context.knowledge': z.strictObject({
    collection: z.enum(['default', 'pricing', 'catalog', 'faq', 'objections', 'documents']).default('default').describe('Coleção'),
    topK: count(5, 20, 'Número de trechos'),
    threshold: z.number().min(0).max(1).default(0.3).describe('Similaridade mínima'),
    query: z.string().max(2000).default('{{latestLeadMessage}}').describe('Consulta semântica; aceita variáveis do fluxo'),
    fallbackToAll: z.boolean().default(true).describe('Se a coleção não retornar trechos, pesquisar em todas as coleções'),
  }),
  'context.crm': empty,
  'context.summarize': z.strictObject({ afterMessages: count(30, 500, 'Resumir após mensagens') }),
  'context.storage': z.strictObject({
    content: z.string().max(5000).default('').describe('Conteúdo armazenado (até 5000 caracteres)'),
    variableName: text('storage', 'Nome da variável de acesso (ex: storage)'),
    outputPorts: z.array(z.string().min(1).max(40)).min(1).max(10).default(['next']).describe('Portas de saída (JSON)'),
  }),
  'context.conversation_state': z.strictObject({
    stage: z.enum(conversationStateStages).default('DISCOVERY').describe('Estágio real da conversa'),
    lastAction: z.string().max(120).default('{{next_action.action}}').describe('Última ação executada'),
    nextExpectedInput: z.string().max(120).default('').describe('Próxima informação esperada do lead'),
  }),
  'agent.decide': prompt, 'agent.classify': prompt, 'agent.extract': extractPrompt, 'agent.score': prompt,
  'agent.structured': z.strictObject({
    provider: z.enum(['openai', 'gemini']).default('openai').describe('Provedor'),
    model: text('default', 'Modelo'),
    prompt: text('Analise o contexto e retorne os dados solicitados em formato estruturado.', 'Instruções'),
    outputKeys: z.array(z.string().min(1).max(40)).min(1).max(10).default(['message', 'done']).describe('Chaves do JSON de saída'),
  }),
  'agent.next_action': z.strictObject({
    provider: z.enum(['openai', 'gemini']).default('openai').describe('Provedor'),
    model: text('default', 'Modelo'),
    prompt: text('Escolha a próxima ação comercial que mais aproxima a conversa da conversão. Não invente dados ausentes.', 'Instruções para decidir a próxima ação'),
    system: z.string().optional().describe('Instrução de sistema opcional'),
    allowedActions: z.array(z.enum(nextActionTypes)).min(1).default([...nextActionTypes]).describe('Ações permitidas (JSON)'),
    currentMessagePriority: z.boolean().default(true).describe('Responder à intenção atual antes de solicitar campos ausentes'),
  }),
  'flow.condition': z.strictObject({ variable: text('decision.handoff', 'Variável'), operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than']).default('equals').describe('Operador'), value: z.string().default('true').describe('Valor de comparação') }),
  'flow.switch': z.strictObject({ variable: text('decision.intent', 'Variável'), cases: z.array(z.string().min(1).max(40).regex(/^[\w-]+$/)).min(1).max(10).default(['interesse', 'suporte']).describe('Saídas (JSON)') }),
  'flow.delay': z.strictObject({ seconds: count(2, 86400, 'Atraso em segundos') }),
  'flow.wait_reply': z.strictObject({ timeoutMinutes: count(1440, 43200, 'Tempo limite em minutos') }),
  'flow.loop': z.strictObject({ times: text('3', 'Repetições (aceita variáveis, ex: {{structured.repeat_count}})'), counterVar: text('loop_count', 'Nome da variável do contador') }),
  'flow.required_fields': z.strictObject({
    required: z.array(z.string().min(1).max(100)).min(1).max(30).default(['city', 'specialty']).describe('Campos obrigatórios (JSON; aceita caminhos como qualification.city)'),
    optional: z.array(z.string().min(1).max(100)).max(30).default(['desired_day', 'desired_period']).describe('Campos opcionais (JSON)'),
  }),
  'action.update_stage': z.strictObject({ stage: text('{{decision.stage}}', 'Estágio de destino') }),
  'action.update_lead': z.strictObject({ source: text('decision.lead_data', 'Variável com dados do lead') }),
  'action.crm_sync': empty,
  'action.handoff': z.strictObject({ reason: text('{{decision.handoff_reason}}', 'Motivo do encaminhamento') }),
  'action.webhook': z.strictObject({ url: z.url().default('https://example.com/webhook').describe('URL'), method: z.enum(['POST', 'PUT', 'PATCH']).default('POST').describe('Método'), timeoutSeconds: count(15, 60, 'Tempo limite em segundos') }),
  'integration.google_calendar': z.strictObject({
    action: z.enum(['list_events', 'create_event', 'check_availability']).default('list_events').describe('Ação'),
    calendarId: text('primary', 'ID do calendário (primary = padrão)'),
    credentials: z.string().default('').describe('Credenciais Google OAuth2 (JSON)'),
    daysAhead: count(7, 90, 'Dias à frente para buscar eventos'),
    eventTitle: z.string().default('').describe('Título do evento (para criar)'),
    eventStart: z.string().default('').describe('Início do evento ISO 8601 (para criar)'),
    eventEnd: z.string().default('').describe('Fim do evento ISO 8601 (para criar)'),
    eventDescription: z.string().default('').describe('Descrição do evento (para criar)'),
  }),
  'calendar.availability': z.strictObject({
    calendarId: text('primary', 'ID do Google Calendar'),
    date: text('{{scheduling.desired_day}}', 'Data ISO, hoje, amanhã ou dia da semana'),
    period: z.string().max(40).default('{{scheduling.desired_period}}').describe('Período: manhã, tarde, noite ou dia inteiro'),
    durationMinutes: count(30, 480, 'Duração de cada horário, em minutos'),
    timezone: text('America/Sao_Paulo', 'Fuso horário'),
    daysAhead: count(14, 90, 'Limite de dias para resolver datas relativas'),
  }),
  'calendar.create_event': z.strictObject({
    calendarId: text('primary', 'ID do Google Calendar'),
    start: text('{{calendar.first_available}}', 'Início ISO 8601 do agendamento'),
    durationMinutes: count(30, 480, 'Duração, em minutos'),
    timezone: text('America/Sao_Paulo', 'Fuso horário'),
    title: text('Consulta - {{lead.name}}', 'Título do evento'),
    description: z.string().max(5000).default('').describe('Descrição do evento'),
    leadName: z.string().max(200).default('{{lead.name}}').describe('Nome do lead'),
    leadPhone: z.string().max(80).default('{{lead.phone}}').describe('Telefone do lead'),
  }),
  'calendar.reschedule_event': z.strictObject({
    calendarId: text('primary', 'ID do Google Calendar'),
    eventId: text('{{calendar.event_id}}', 'ID do evento'),
    newStart: text('{{scheduling.selected_slot}}', 'Novo início ISO 8601'),
    durationMinutes: count(30, 480, 'Nova duração, em minutos'),
    timezone: text('America/Sao_Paulo', 'Fuso horário'),
  }),
  'calendar.cancel_event': z.strictObject({
    calendarId: text('primary', 'ID do Google Calendar'),
    eventId: text('{{calendar.event_id}}', 'ID do evento'),
    reason: z.string().max(1000).default('').describe('Motivo do cancelamento'),
  }),
  'output.send_text': z.strictObject({ text: text('{{decision.reply}}', 'Mensagem'), typing: z.boolean().default(true).describe('Mostrar digitando') }),
  'output.send_media': z.strictObject({ url: text('{{media.url}}', 'URL da mídia'), mediaType: z.enum(['image', 'audio', 'video', 'document']).default('image').describe('Tipo de mídia'), caption: z.string().default('').describe('Legenda') }),
  'output.send_template': z.strictObject({ name: text('hello_world', 'Nome do template aprovado'), language: text('pt_BR', 'Idioma') }),
  'output.smart_message': z.strictObject({
    text: text('{{decision.reply}}', 'Resposta completa'),
    typing: z.boolean().default(true).describe('Mostrar digitando'),
    maxBubbles: z.number().int().min(1).max(3).default(3).describe('Máximo de bolhas'),
    maxCharactersPerBubble: z.number().int().min(80).max(1000).default(320).describe('Tamanho desejado por bolha'),
  }),
  'output.end': empty,
} satisfies Record<NodeType, z.ZodType>;

const labels: Record<NodeType, string> = {
  'trigger.message_received': 'Mensagem recebida', 'trigger.schedule': 'Agendamento', 'trigger.manual': 'Início manual',
  'guard.test_mode': 'Modo teste', 'guard.human_takeover': 'Atendimento humano', 'guard.business_hours': 'Horário comercial', 'guard.chat_type': 'Tipo de conversa', 'guard.response_policy': 'Política de resposta',
  'input.buffer': 'Agrupar mensagens', 'input.media': 'Processar mídia', 'input.normalize': 'Normalizar telefone',
  'context.memory': 'Memória comercial', 'context.knowledge': 'Base de conhecimento', 'context.crm': 'Consultar CRM', 'context.summarize': 'Resumir conversa', 'context.storage': 'Armazenamento interno', 'context.conversation_state': 'Estado da conversa',
  'agent.decide': 'Decisão do agente', 'agent.classify': 'Classificar intenção', 'agent.extract': 'Extrair informações', 'agent.score': 'Pontuar lead', 'agent.structured': 'Resposta estruturada', 'agent.next_action': 'Próxima ação',
  'flow.condition': 'Condição', 'flow.switch': 'Múltiplos caminhos', 'flow.delay': 'Aguardar', 'flow.wait_reply': 'Esperar resposta', 'flow.loop': 'Repetir X vezes', 'flow.required_fields': 'Campos obrigatórios',
  'action.update_stage': 'Atualizar estágio', 'action.update_lead': 'Atualizar lead', 'action.crm_sync': 'Sincronizar CRM', 'action.handoff': 'Encaminhar para humano', 'action.webhook': 'Chamar webhook',
  'integration.google_calendar': 'Google Calendar',
  'calendar.availability': 'Consultar disponibilidade', 'calendar.create_event': 'Criar agendamento', 'calendar.reschedule_event': 'Reagendar', 'calendar.cancel_event': 'Cancelar agendamento',
  'output.send_text': 'Enviar mensagem', 'output.send_media': 'Enviar mídia', 'output.send_template': 'Enviar template', 'output.smart_message': 'Mensagem inteligente', 'output.end': 'Encerrar fluxo',
};
export const categories = { trigger: 'Gatilhos', guard: 'Guardas', input: 'Entrada', context: 'Contexto', agent: 'Inteligência', flow: 'Controle', action: 'Ações', integration: 'Integrações', calendar: 'Agenda', output: 'Saída' };
export const categoryColors = { trigger: '#0d9488', guard: '#d97706', input: '#0284c7', context: '#7c3aed', agent: '#464feb', flow: '#c026d3', action: '#ea580c', integration: '#2563eb', calendar: '#0891b2', output: '#16a34a' };
export type Category = keyof typeof categories;
export function portsFor(type: NodeType, config: Record<string, unknown>): string[] {
  if (type === 'output.end') return [];
  if (type === 'guard.response_policy') return ['pass', 'rewrite', 'blocked'];
  if (type.startsWith('guard.')) return ['pass', 'blocked'];
  if (type === 'flow.condition') return ['true', 'false'];
  if (type === 'flow.required_fields') return ['complete', 'missing'];
  if (type === 'flow.wait_reply') return ['reply', 'timeout'];
  if (type === 'flow.switch') return [...(Array.isArray(config.cases) ? config.cases.filter((x): x is string => typeof x === 'string') : []), 'default'];
  if (type === 'agent.structured') return [...(Array.isArray(config.outputKeys) ? config.outputKeys.filter((x): x is string => typeof x === 'string') : []), 'default'];
  if (type === 'flow.loop') return ['body', 'done'];
  if (type === 'context.storage') return Array.isArray(config.outputPorts) ? config.outputPorts.filter((x): x is string => typeof x === 'string') : ['next'];
  if (type === 'integration.google_calendar') return ['success', 'error'];
  if (type === 'calendar.availability') return ['available', 'unavailable', 'error'];
  if (type === 'calendar.create_event') return ['created', 'error'];
  if (type === 'calendar.reschedule_event') return ['rescheduled', 'error'];
  if (type === 'calendar.cancel_event') return ['cancelled', 'error'];
  return ['next'];
}
const schemaToJson = (schema: z.ZodType) => z.toJSONSchema(schema);
export const catalog = Object.fromEntries(nodeTypes.map(type => [type, {
  type, label: labels[type], category: type.split('.')[0] as Category,
  schema: schemas[type], defaults: schemas[type].parse({}) as FlowNode['config'],
  // JSON Schema is derived from the same Zod schema used at publication time.
  jsonSchema: schemaToJson(schemas[type]),
}])) as unknown as Record<NodeType, { type: NodeType; label: string; category: Category; schema: z.ZodType; defaults: FlowNode['config']; jsonSchema: ReturnType<typeof schemaToJson> }>;
