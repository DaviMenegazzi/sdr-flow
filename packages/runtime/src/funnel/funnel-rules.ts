import type { StepExecutionRecord } from '@sdr/shared';

// The lead-level sales funnel (leads.funnel_stage). It only moves forward, except that a lead
// marked lost (CLOSED) can be reopened by fresh buying signals in a later turn. CONVERTED is final.
// HUMAN_HANDOFF is a session state of conversations.stage, never a funnel position.
export const FUNNEL_ORDER = [
  'NEW_CONVERSATION',
  'QUALIFYING',
  'COLLECTING_INFORMATION',
  'PRESENTING_SOLUTION',
  'NEGOTIATING',
  'CONVERTED',
] as const;

export type FunnelStage = (typeof FUNNEL_ORDER)[number] | 'CLOSED';
export type FunnelSource = 'flow_signal' | 'text_rule' | 'laya';

export interface FunnelSignal {
  stage: FunnelStage;
  source: FunnelSource;
  reason: string;
  evidence?: string | null;
  confidence?: number | null;
}

function rank(stage: string): number {
  return FUNNEL_ORDER.indexOf(stage as (typeof FUNNEL_ORDER)[number]);
}

export function normalizeFunnelStage(stage: string | null | undefined): FunnelStage {
  if (stage === 'CLOSED') return 'CLOSED';
  return rank(stage ?? '') >= 0 ? (stage as FunnelStage) : 'NEW_CONVERSATION';
}

/** Whether a signal may move the funnel from `current`. */
export function canAdvanceFunnel(current: FunnelStage, candidate: FunnelStage): boolean {
  if (current === 'CONVERTED' || current === candidate) return false;
  if (candidate === 'CLOSED') return true;
  if (current === 'CLOSED') return rank(candidate) >= rank('QUALIFYING');
  return rank(candidate) > rank(current);
}

/** The furthest signal wins; CLOSED only wins when nothing in the same turn points forward. */
export function strongestSignal(signals: FunnelSignal[]): FunnelSignal | null {
  const forward = signals.filter(signal => signal.stage !== 'CLOSED');
  if (forward.length === 0) return signals[0] ?? null;
  return forward.reduce((best, signal) => (rank(signal.stage) > rank(best.stage) ? signal : best));
}

// agent.next_action is already paid for by the turn; its action says what the conversation is
// doing right now. HANDOFF/END say nothing about how far the sale went.
const NEXT_ACTION_STAGE: Record<string, FunnelStage> = {
  ASK_MISSING_FIELD: 'COLLECTING_INFORMATION',
  SEND_INFORMATION: 'PRESENTING_SOLUTION',
  SHOW_PRICE: 'NEGOTIATING',
  CHECK_CALENDAR: 'NEGOTIATING',
  CREATE_APPOINTMENT: 'NEGOTIATING',
};

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Layer 1: signals the flow already produced this turn, at no extra LLM cost. */
export function signalsFromSteps(steps: StepExecutionRecord[]): FunnelSignal[] {
  const signals: FunnelSignal[] = [];
  for (const step of steps) {
    if (step.error) continue;
    const output = (step.output ?? {}) as Record<string, any>;
    if (step.nodeType === 'agent.next_action') {
      const stage = NEXT_ACTION_STAGE[String(output.action ?? '')];
      if (stage) signals.push({ stage, source: 'flow_signal', reason: `next_action=${output.action}`, evidence: output.evidence ?? null });
    } else if (step.nodeType === 'calendar.create_event' && hasText(output.event_id)) {
      signals.push({ stage: 'CONVERTED', source: 'flow_signal', reason: 'calendar.create_event criou o agendamento', evidence: String(output.start ?? '') || null });
    } else if (step.nodeType === 'agent.extract' && hasText(output.interest)) {
      signals.push({ stage: 'QUALIFYING', source: 'flow_signal', reason: 'agent.extract identificou o interesse', evidence: String(output.interest) });
    } else if (step.nodeType === 'agent.decide' && hasText(output.lead_data?.interest)) {
      signals.push({ stage: 'QUALIFYING', source: 'flow_signal', reason: 'agent.decide identificou o interesse', evidence: String(output.lead_data.interest) });
    }
  }
  return signals;
}

function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Only what the lead wrote counts: the bot's own wording (which may be generated) never proves
// that a payment happened.
const TEXT_RULES: Array<{ stage: FunnelStage; pattern: RegExp; reason: string }> = [
  {
    stage: 'CONVERTED',
    pattern: /\b(paguei|ja paguei|fiz o pix|pix feito|ja transferi|segue (o )?comprovante|mandei o comprovante)\b/,
    reason: 'lead confirmou o pagamento',
  },
  {
    stage: 'NEGOTIATING',
    pattern: /\b(quanto (custa|fica|sai|e|eh)|qual (e |eh )?o (valor|preco)|valores?|precos?|boleto|pix|parcel\w*|desconto|forma de pagamento|formas de pagamento|proposta|contrato|mensalidade)\b/,
    reason: 'lead falou de preço, pagamento ou proposta',
  },
];

/** Layer 2: PT-BR cues in the lead's own messages from this turn. */
export function signalsFromLeadText(texts: Array<string | null | undefined>): FunnelSignal[] {
  const signals: FunnelSignal[] = [];
  for (const raw of texts) {
    if (!raw) continue;
    const text = normalizeText(raw);
    for (const rule of TEXT_RULES) {
      const match = text.match(rule.pattern);
      if (match) {
        signals.push({ stage: rule.stage, source: 'text_rule', reason: rule.reason, evidence: match[0] });
        break;
      }
    }
  }
  return signals;
}
