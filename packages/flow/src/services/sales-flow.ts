import type { FlowContext } from '@sdr/shared';

const fieldAliases: Record<string, string[]> = {
  name: ['nome'], nome: ['name'],
  phone: ['telefone'], telefone: ['phone'],
  city: ['cidade'], cidade: ['city'],
  interest: ['interesse'], interesse: ['interest'],
  specialty: ['especialidade'], especialidade: ['specialty'],
  desired_day: ['dia_desejado', 'desiredDay'],
  desired_period: ['periodo_desejado', 'desiredPeriod'],
  selected_slot: ['horario_selecionado', 'selectedSlot'],
  event_id: ['evento_id', 'eventId'],
};

function propertyValue(record: Record<string, unknown>, key: string): unknown {
  if (record[key] !== undefined) return record[key];
  for (const alias of fieldAliases[key] || []) {
    if (record[alias] !== undefined) return record[alias];
  }
  return undefined;
}

function readPath(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = propertyValue(current as Record<string, unknown>, part);
  }
  return current;
}

function findNested(root: unknown, key: string, seen = new Set<unknown>()): unknown {
  if (!root || typeof root !== 'object' || seen.has(root)) return undefined;
  seen.add(root);
  if (!Array.isArray(root)) {
    const direct = propertyValue(root as Record<string, unknown>, key);
    if (direct !== undefined) return direct;
  }
  for (const value of Object.values(root as Record<string, unknown>)) {
    const found = findNested(value, key, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function resolveSalesField(ctx: FlowContext, path: string): unknown {
  const roots: unknown[] = [
    ctx.variables,
    ctx.lead,
    ctx.lead?.memory,
    ctx.variables.commercialMemory,
  ];
  for (const root of roots) {
    const exact = readPath(root, path);
    if (exact !== undefined) return exact;
  }
  const leaf = path.split('.').at(-1) || path;
  for (const root of roots) {
    const nested = findNested(root, leaf);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const questionPatterns: Record<string, RegExp> = {
  name: /\b(nome|como (voce|você) se chama)\b/i,
  phone: /\b(telefone|celular|whatsapp|whats)\b/i,
  city: /\b(cidade|onde (voce|você) mora|qual unidade)\b/i,
  interest: /\b(interesse|o que procura|qual servico|qual serviço)\b/i,
  specialty: /\b(especialidade|qual medico|qual médico|qual profissional)\b/i,
  desired_day: /\b(qual dia|que dia|data prefere|melhor dia)\b/i,
  desired_period: /\b(periodo|período|manha|manhã|tarde|noite)\b/i,
  selected_slot: /\b(qual horario|qual horário|que horario|que horário)\b/i,
};

function asksKnownField(text: string, field: string): boolean {
  if (!/[?]/.test(text)) return false;
  const leaf = field.split('.').at(-1) || field;
  const canonical = Object.keys(questionPatterns).find(key => key === leaf || fieldAliases[key]?.includes(leaf)) || leaf;
  return questionPatterns[canonical]?.test(text) ?? normalize(text).includes(normalize(leaf.replace(/_/g, ' ')));
}

function priceTokens(text: string): string[] {
  const matches = text.matchAll(/(?:r\$\s*([\d.]+(?:,\d{1,2})?)|([\d.]+(?:,\d{1,2})?)\s*reais?)/gi);
  return [...matches].map(match => (match[1] || match[2] || '').replace(/\D/g, '')).filter(Boolean);
}

export interface ResponsePolicyResult {
  status: 'pass' | 'rewrite' | 'blocked';
  violations: string[];
  message: string;
}

export function evaluateResponsePolicy(
  ctx: FlowContext,
  message: string,
  options: {
    maxCharacters: number;
    knownFields: string[];
    blockedTerms: string[];
    requireGroundedPrice: boolean;
  },
): ResponsePolicyResult {
  const violations: string[] = [];
  const blocking: string[] = [];
  const trimmed = message.trim();
  if (!trimmed) blocking.push('empty_message');
  if (trimmed.length > options.maxCharacters) violations.push('message_too_long');

  for (const field of options.knownFields) {
    if (isPresent(resolveSalesField(ctx, field)) && asksKnownField(trimmed, field)) {
      violations.push(`known_field_question:${field}`);
    }
  }

  const lastQuestion = [
    resolveSalesField(ctx, 'conversation.last_question'),
    resolveSalesField(ctx, 'conversation_state.last_question'),
    resolveSalesField(ctx, 'last_question'),
  ].find(value => typeof value === 'string' && value.trim());
  if (typeof lastQuestion === 'string' && /[?]/.test(trimmed) && normalize(lastQuestion) === normalize(trimmed)) {
    violations.push('repeated_question');
  }

  const normalizedMessage = normalize(trimmed);
  for (const term of options.blockedTerms) {
    if (term.trim() && normalizedMessage.includes(normalize(term))) blocking.push(`blocked_term:${term}`);
  }

  if (options.requireGroundedPrice) {
    const prices = priceTokens(trimmed);
    if (prices.length > 0) {
      const knowledge = ((ctx.variables.knowledgeSnippets as string[] | undefined) || []).join(' ');
      const supported = priceTokens(knowledge);
      for (const price of prices) {
        if (!supported.includes(price)) blocking.push(`ungrounded_price:${price}`);
      }
    }
  }

  const openingWords = normalizedMessage.split(' ').slice(0, 12);
  for (const opening of ['ola', 'oi', 'claro', 'entendi', 'perfeito']) {
    if (openingWords.filter(word => word === opening).length > 1) violations.push(`repeated_opening:${opening}`);
  }

  const nextAction = resolveSalesField(ctx, 'next_action.action');
  if (typeof nextAction === 'string' && !['END', 'HANDOFF'].includes(nextAction) && /\b(como posso ajudar|qualquer duvida|qualquer dúvida)\b/i.test(trimmed)) {
    violations.push('generic_cta');
  }

  const allViolations = [...new Set([...blocking, ...violations])];
  return {
    status: blocking.length > 0 ? 'blocked' : violations.length > 0 ? 'rewrite' : 'pass',
    violations: allViolations,
    message: trimmed,
  };
}

function textUnits(text: string): string[] {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
  return paragraphs.flatMap(paragraph => {
    const sentences = paragraph.split(/(?<=[.!?])\s+/).map(value => value.trim()).filter(Boolean);
    return sentences.length > 1 ? sentences : [paragraph];
  });
}

export function splitSmartMessage(text: string, maxBubbles: number, desiredCharacters: number): string[] {
  const normalized = text.trim().replace(/[ \t]+/g, ' ');
  if (!normalized) return [];
  const units = textUnits(normalized);
  if (units.length <= 1 || normalized.length <= desiredCharacters) return [normalized];

  const desiredCount = Math.min(maxBubbles, Math.max(1, Math.ceil(normalized.length / desiredCharacters)), units.length);
  if (desiredCount === 1) return [normalized];
  const bubbles: string[] = [];
  let current = '';
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    if (!unit) continue;
    const unitsRemaining = units.length - index;
    const bubblesRemaining = desiredCount - bubbles.length;
    const candidate = current ? `${current} ${unit}` : unit;
    const shouldClose = current && (
      candidate.length > desiredCharacters ||
      unitsRemaining === bubblesRemaining
    );
    if (shouldClose) {
      bubbles.push(current);
      current = unit;
    } else {
      current = candidate;
    }
  }
  if (current) bubbles.push(current);
  if (bubbles.length <= maxBubbles) return bubbles;
  return [...bubbles.slice(0, maxBubbles - 1), bubbles.slice(maxBubbles - 1).join(' ')];
}
