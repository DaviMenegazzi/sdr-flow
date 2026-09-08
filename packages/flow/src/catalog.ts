import { z } from 'zod';
import { nodeTypes, type NodeType, type FlowNode } from '@sdr/shared';

const text = (value: string, description: string) => z.string().min(1).default(value).describe(description);
const count = (value: number, max: number, description: string) => z.number().int().min(1).max(max).default(value).describe(description);
const empty = z.object({}).passthrough();
const prompt = z.object({
  provider: z.enum(['openai', 'gemini']).default('openai').describe('Provedor'),
  model: text('default', 'Modelo (default usa OPENAI_MODEL do servidor)'),
  prompt: text('Conduza a conversa a partir do contexto disponível. Não invente informações.', 'Instruções do agente'),
  system: z.string().optional().describe('Instrução de sistema opcional'),
}).passthrough();
const schemas = {
  'trigger.message_received': empty,
  'trigger.schedule': z.strictObject({ cron: text('0 9 * * 1-5', 'Expressão cron'), timezone: text('America/Sao_Paulo', 'Fuso horário') }),
  'trigger.manual': empty,
  'guard.test_mode': z.strictObject({ enabled: z.boolean().default(true).describe('Modo teste ativo'), allowedPhones: z.array(z.string().min(8)).default([]).describe('Telefones autorizados (JSON)') }),
  'guard.human_takeover': empty,
  'guard.business_hours': z.strictObject({ timezone: text('America/Sao_Paulo', 'Fuso horário'), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:00').describe('Início'), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('18:00').describe('Fim'), weekdays: z.array(z.number().int().min(0).max(6)).min(1).default([1,2,3,4,5]).describe('Dias da semana (0 = domingo)') }),
  'guard.chat_type': z.strictObject({ allowGroups: z.boolean().default(false).describe('Permitir grupos') }),
  'input.buffer': z.strictObject({ windowSeconds: count(5, 120, 'Janela em segundos') }),
  'input.media': z.strictObject({ transcribeAudio: z.boolean().default(true).describe('Transcrever áudio'), describeImages: z.boolean().default(true).describe('Descrever imagens') }),
  'input.normalize': z.strictObject({ country: z.enum(['BR', 'international']).default('BR').describe('Formato do telefone') }),
  'context.memory': z.strictObject({ recentMessages: count(6, 50, 'Mensagens recentes') }),
  'context.knowledge': z.strictObject({ collection: z.enum(['default', 'pricing', 'catalog', 'faq', 'objections', 'documents']).default('default').describe('Coleção'), topK: count(5, 20, 'Número de trechos'), threshold: z.number().min(0).max(1).default(0.3).describe('Similaridade mínima') }),
  'context.crm': empty,
  'context.summarize': z.strictObject({ afterMessages: count(30, 500, 'Resumir após mensagens') }),
  'agent.decide': prompt, 'agent.classify': prompt, 'agent.extract': prompt, 'agent.score': prompt,
  'agent.structured': z.strictObject({
    provider: z.enum(['openai', 'gemini']).default('openai').describe('Provedor'),
    model: text('default', 'Modelo'),
    prompt: text('Analise o contexto e retorne os dados solicitados em formato estruturado.', 'Instruções'),
    outputKeys: z.array(z.string().min(1).max(40)).min(1).max(10).default(['message', 'done']).describe('Chaves do JSON de saída'),
  }),
  'flow.condition': z.strictObject({ variable: text('decision.handoff', 'Variável'), operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than']).default('equals').describe('Operador'), value: z.string().default('true').describe('Valor de comparação') }),
  'flow.switch': z.strictObject({ variable: text('decision.intent', 'Variável'), cases: z.array(z.string().min(1).max(40).regex(/^[\w-]+$/)).min(1).max(10).default(['interesse', 'suporte']).describe('Saídas (JSON)') }),
  'flow.delay': z.strictObject({ seconds: count(2, 86400, 'Atraso em segundos') }),
  'flow.wait_reply': z.strictObject({ timeoutMinutes: count(1440, 43200, 'Tempo limite em minutos') }),
  'action.update_stage': z.strictObject({ stage: text('{{decision.stage}}', 'Estágio de destino') }),
  'action.update_lead': z.strictObject({ source: text('decision.lead_data', 'Variável com dados do lead') }),
  'action.crm_sync': empty,
  'action.handoff': z.strictObject({ reason: text('{{decision.handoff_reason}}', 'Motivo do encaminhamento') }),
  'action.webhook': z.strictObject({ url: z.url().default('https://example.com/webhook').describe('URL'), method: z.enum(['POST', 'PUT', 'PATCH']).default('POST').describe('Método'), timeoutSeconds: count(15, 60, 'Tempo limite em segundos') }),
  'output.send_text': z.strictObject({ text: text('{{decision.reply}}', 'Mensagem'), typing: z.boolean().default(true).describe('Mostrar digitando') }),
  'output.send_media': z.strictObject({ url: text('{{media.url}}', 'URL da mídia'), mediaType: z.enum(['image', 'audio', 'video', 'document']).default('image').describe('Tipo de mídia'), caption: z.string().default('').describe('Legenda') }),
  'output.send_template': z.strictObject({ name: text('hello_world', 'Nome do template aprovado'), language: text('pt_BR', 'Idioma') }),
  'output.end': empty,
} satisfies Record<NodeType, z.ZodType>;

const labels: Record<NodeType, string> = {
  'trigger.message_received': 'Mensagem recebida', 'trigger.schedule': 'Agendamento', 'trigger.manual': 'Início manual',
  'guard.test_mode': 'Modo teste', 'guard.human_takeover': 'Atendimento humano', 'guard.business_hours': 'Horário comercial', 'guard.chat_type': 'Tipo de conversa',
  'input.buffer': 'Agrupar mensagens', 'input.media': 'Processar mídia', 'input.normalize': 'Normalizar telefone',
  'context.memory': 'Memória comercial', 'context.knowledge': 'Base de conhecimento', 'context.crm': 'Consultar CRM', 'context.summarize': 'Resumir conversa',
  'agent.decide': 'Decisão do agente', 'agent.classify': 'Classificar intenção', 'agent.extract': 'Extrair informações', 'agent.score': 'Pontuar lead', 'agent.structured': 'Resposta estruturada',
  'flow.condition': 'Condição', 'flow.switch': 'Múltiplos caminhos', 'flow.delay': 'Aguardar', 'flow.wait_reply': 'Esperar resposta',
  'action.update_stage': 'Atualizar estágio', 'action.update_lead': 'Atualizar lead', 'action.crm_sync': 'Sincronizar CRM', 'action.handoff': 'Encaminhar para humano', 'action.webhook': 'Chamar webhook',
  'output.send_text': 'Enviar mensagem', 'output.send_media': 'Enviar mídia', 'output.send_template': 'Enviar template', 'output.end': 'Encerrar fluxo',
};
export const categories = { trigger: 'Gatilhos', guard: 'Guardas', input: 'Entrada', context: 'Contexto', agent: 'Inteligência', flow: 'Controle', action: 'Ações', output: 'Saída' };
export const categoryColors = { trigger: '#0d9488', guard: '#d97706', input: '#0284c7', context: '#7c3aed', agent: '#464feb', flow: '#c026d3', action: '#ea580c', output: '#16a34a' };
export type Category = keyof typeof categories;
export function portsFor(type: NodeType, config: Record<string, unknown>): string[] {
  if (type === 'output.end') return [];
  if (type.startsWith('guard.')) return ['pass', 'blocked'];
  if (type === 'flow.condition') return ['true', 'false'];
  if (type === 'flow.wait_reply') return ['reply', 'timeout'];
  if (type === 'flow.switch') return [...(Array.isArray(config.cases) ? config.cases.filter((x): x is string => typeof x === 'string') : []), 'default'];
  if (type === 'agent.structured') return [...(Array.isArray(config.outputKeys) ? config.outputKeys.filter((x): x is string => typeof x === 'string') : []), 'default'];
  return ['next'];
}
const schemaToJson = (schema: z.ZodType) => z.toJSONSchema(schema);
export const catalog = Object.fromEntries(nodeTypes.map(type => [type, {
  type, label: labels[type], category: type.split('.')[0] as Category,
  schema: schemas[type], defaults: schemas[type].parse({}) as FlowNode['config'],
  // JSON Schema is derived from the same Zod schema used at publication time.
  jsonSchema: schemaToJson(schemas[type]),
}])) as unknown as Record<NodeType, { type: NodeType; label: string; category: Category; schema: z.ZodType; defaults: FlowNode['config']; jsonSchema: ReturnType<typeof schemaToJson> }>;
