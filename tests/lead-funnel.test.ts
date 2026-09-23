import { describe, expect, it, vi } from 'vitest';
import type { StepExecutionRecord } from '../packages/shared/src/index.js';
import {
  canAdvanceFunnel,
  signalsFromLeadText,
  signalsFromSteps,
  strongestSignal,
} from '../packages/runtime/src/funnel/funnel-rules.js';
import { layaPredict } from '../packages/runtime/src/funnel/laya-client.js';
import { applyFunnelSignals, classifyLeadWithLaya, temperatureFor } from '../packages/runtime/src/funnel/funnel-service.js';

const step = (nodeType: string, output: unknown, error?: string): StepExecutionRecord =>
  ({ sequence: 1, nodeId: nodeType, nodeType, input: {}, output, durationMs: 1, error }) as StepExecutionRecord;

describe('funnel rules', () => {
  it('only moves forward, reopens a lost lead on buying signals and never leaves CONVERTED', () => {
    expect(canAdvanceFunnel('QUALIFYING', 'NEGOTIATING')).toBe(true);
    expect(canAdvanceFunnel('NEGOTIATING', 'COLLECTING_INFORMATION')).toBe(false);
    expect(canAdvanceFunnel('NEGOTIATING', 'CLOSED')).toBe(true);
    expect(canAdvanceFunnel('CLOSED', 'QUALIFYING')).toBe(true);
    expect(canAdvanceFunnel('CLOSED', 'NEW_CONVERSATION')).toBe(false);
    expect(canAdvanceFunnel('CONVERTED', 'CLOSED')).toBe(false);
    expect(canAdvanceFunnel('QUALIFYING', 'QUALIFYING')).toBe(false);
  });

  it('maps signals the flow already produced, ignoring failed steps', () => {
    const signals = signalsFromSteps([
      step('agent.extract', { interest: 'plano familiar' }),
      step('agent.next_action', { action: 'SHOW_PRICE', evidence: 'quanto custa' }),
      step('agent.next_action', { action: 'HANDOFF' }),
      step('calendar.create_event', { error: 'sem agenda' }, 'sem agenda'),
    ]);
    expect(signals.map(signal => [signal.stage, signal.source])).toEqual([
      ['QUALIFYING', 'flow_signal'],
      ['NEGOTIATING', 'flow_signal'],
    ]);
    expect(signalsFromSteps([step('calendar.create_event', { event_id: 'evt-1', start: '2026-09-24T10:00:00-03:00' })])[0]!.stage).toBe('CONVERTED');
  });

  it('reads price and payment cues from what the lead wrote', () => {
    expect(signalsFromLeadText(['Quanto custa o plano familiar?'])[0]).toMatchObject({ stage: 'NEGOTIATING', source: 'text_rule' });
    expect(signalsFromLeadText(['consigo pagar no BOLETO?'])[0]!.stage).toBe('NEGOTIATING');
    expect(signalsFromLeadText(['Já paguei, segue comprovante'])[0]!.stage).toBe('CONVERTED');
    expect(signalsFromLeadText(['fiz o pix agora'])[0]!.stage).toBe('CONVERTED');
    expect(signalsFromLeadText(['oi, tudo bem?', null, ''])).toEqual([]);
    expect(signalsFromLeadText(['isso me valorizou muito'])).toEqual([]);
  });

  it('prefers the furthest forward signal over a lost signal in the same turn', () => {
    expect(strongestSignal([
      { stage: 'CLOSED', source: 'laya', reason: 'x' },
      { stage: 'QUALIFYING', source: 'flow_signal', reason: 'y' },
      { stage: 'NEGOTIATING', source: 'text_rule', reason: 'z' },
    ])!.stage).toBe('NEGOTIATING');
    expect(strongestSignal([])).toBeNull();
  });

  it('buckets the lead score into a temperature', () => {
    expect([temperatureFor(97), temperatureFor(55), temperatureFor(20)]).toEqual(['HOT', 'WARM', 'COLD']);
  });
});

describe('Laya client', () => {
  const config = { url: 'http://127.0.0.1:8010/', secret: 's3cret' };
  const question = { interest: { type: 'score' as const, instructions: 'Interesse?', criteria: ['baixo', 'alto'] } };

  it('posts state and questions with the bearer secret and returns typed answers', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ answers: { interest: { type: 'score', score: 1.2, confidence: 0.6 } } }));
    const answers = await layaPredict({ ...config, fetch: http }, ['CONTATO: oi'], question);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8010/predict');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer s3cret' });
    expect(JSON.parse(init!.body as string)).toEqual({ state: ['CONTATO: oi'], questions: question });
    expect(answers.interest).toMatchObject({ score: 1.2, confidence: 0.6 });
  });

  it('fails explicitly on HTTP errors, network errors and malformed answers', async () => {
    await expect(layaPredict({ ...config, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('x', { status: 503 })) }, [], question)).rejects.toThrow('HTTP 503');
    await expect(layaPredict({ ...config, fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED s3cret')) }, [], question)).rejects.toThrow('Laya indisponível');
    await expect(layaPredict({ ...config, fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ answers: { interest: { type: 'choice', choice: 'x', confidence: 0.9 } } })) }, [], question)).rejects.toThrow('interest');
  });
});

// Minimal PostgREST-style fake: enough of the builder chain for FunnelRepository/ConversationRepository.
function fakeDb(state: { lead: Record<string, unknown>; messages: Array<Record<string, unknown>>; deal?: { id: string } | null }) {
  const writes: Array<{ table: string; op: string; values: unknown; filters: Record<string, unknown> }> = [];
  const db = {
    writes,
    from(table: string) {
      let op = 'select';
      let values: unknown;
      const filters: Record<string, unknown> = {};
      const result = () => {
        if (op !== 'select') {
          writes.push({ table, op, values, filters: { ...filters } });
          if (table === 'leads' && op === 'update') {
            if ('funnel_stage' in filters && filters.funnel_stage !== state.lead.funnel_stage) return { data: [], error: null };
            Object.assign(state.lead, values as object);
            return { data: [{ id: state.lead.id }], error: null };
          }
          return { data: null, error: null };
        }
        if (table === 'leads') return { data: state.lead, error: null };
        if (table === 'conversations') return { data: [{ id: 'conv-1' }], error: null };
        if (table === 'messages') return { data: [...state.messages].reverse().filter(row => !('sender' in filters) || row.sender === filters.sender), error: null };
        if (table === 'deals') return { data: state.deal ?? null, error: null };
        return { data: null, error: null };
      };
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: unknown) => { filters[column] = value; return builder; },
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        update: (next: unknown) => { op = 'update'; values = next; return builder; },
        insert: (next: unknown) => { op = 'insert'; values = next; return Promise.resolve(result()); },
        maybeSingle: () => Promise.resolve(result()),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      };
      return builder;
    },
  };
  return db;
}

const message = (direction: 'INBOUND' | 'OUTBOUND', content: string) => ({ id: content, conversation_id: 'conv-1', content, sender: direction === 'INBOUND' ? 'lead' : 'ai', direction });
const laya = (score: number) => ({ url: 'http://laya', secret: 's', fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ answers: { interest: { type: 'score', score, confidence: 0.84 } } })) });

describe('lead funnel service', () => {
  it('moves the lead forward and records why, guarded by the stage it read', async () => {
    const db = fakeDb({ lead: { id: 'lead-1', funnel_stage: 'QUALIFYING', is_group: false }, messages: [] });
    const move = await applyFunnelSignals(db as any, {
      organizationId: 'org-1', leadId: 'lead-1', conversationId: 'conv-1',
      signals: [{ stage: 'NEGOTIATING', source: 'text_rule', reason: 'lead falou de preço', evidence: 'quanto custa' }],
    });
    expect(move).toMatchObject({ from: 'QUALIFYING', to: 'NEGOTIATING' });
    expect(db.writes[0]).toMatchObject({ table: 'leads', op: 'update', values: { funnel_stage: 'NEGOTIATING' }, filters: { funnel_stage: 'QUALIFYING', organization_id: 'org-1' } });
    expect(db.writes[1]).toMatchObject({ table: 'lead_stage_events', op: 'insert', values: { from_stage: 'QUALIFYING', to_stage: 'NEGOTIATING', source: 'text_rule', evidence: 'quanto custa' } });
  });

  it('does not move a converted lead or a group', async () => {
    for (const lead of [{ id: 'l', funnel_stage: 'CONVERTED', is_group: false }, { id: 'l', funnel_stage: 'QUALIFYING', is_group: true }]) {
      const db = fakeDb({ lead, messages: [] });
      expect(await applyFunnelSignals(db as any, { organizationId: 'o', leadId: 'l', signals: [{ stage: 'NEGOTIATING', source: 'text_rule', reason: 'x' }] })).toBeNull();
      expect(db.writes).toEqual([]);
    }
  });

  it('scores the lead with Laya, mirrors the score on the existing deal and marks a refusal as lost', async () => {
    const db = fakeDb({
      lead: { id: 'lead-1', funnel_stage: 'NEGOTIATING', is_group: false },
      messages: [message('INBOUND', 'quanto custa?'), message('OUTBOUND', 'R$ 29,90 por mês.'), message('INBOUND', 'muito caro, não tenho interesse')],
      deal: { id: 'deal-1' },
    });
    const layaConfig = laya(0.05);
    const result = await classifyLeadWithLaya({ db: db as any, laya: layaConfig }, { organizationId: 'org-1', leadId: 'lead-1', conversationId: 'conv-1' });

    expect(JSON.parse(layaConfig.fetch.mock.calls[0]![1]!.body as string).state).toEqual(['CONTATO: quanto custa?', 'EQUIPE: R$ 29,90 por mês.', 'CONTATO: muito caro, não tenho interesse']);
    expect(result).toMatchObject({ status: 'classified', score: 1, temperature: 'COLD', move: { from: 'NEGOTIATING', to: 'CLOSED' } });
    expect(db.writes.find(write => write.table === 'deals')).toMatchObject({ op: 'update', values: { score: 1 } });
    expect(db.writes.find(write => write.table === 'lead_stage_events')).toMatchObject({ values: { source: 'laya', to_stage: 'CLOSED', confidence: 0.84 } });
  });

  it('keeps an interested lead where it is and skips short conversations without calling Laya', async () => {
    const db = fakeDb({ lead: { id: 'lead-1', funnel_stage: 'NEGOTIATING', is_group: false }, messages: [message('INBOUND', 'quero fechar'), message('OUTBOUND', 'Perfeito!'), message('INBOUND', 'no pix')] });
    const result = await classifyLeadWithLaya({ db: db as any, laya: laya(3.9) }, { organizationId: 'org-1', leadId: 'lead-1', conversationId: 'conv-1' });
    expect(result).toMatchObject({ status: 'classified', score: 98, temperature: 'HOT', move: null });

    const short = laya(2);
    const skipped = await classifyLeadWithLaya({ db: fakeDb({ lead: { id: 'l', funnel_stage: 'NEW_CONVERSATION', is_group: false }, messages: [message('OUTBOUND', 'Olá!'), message('INBOUND', 'oi')] }) as any, laya: short }, { organizationId: 'o', leadId: 'l', conversationId: 'c' });
    expect(skipped).toEqual({ status: 'skipped', reason: 'not_enough_messages' });
    expect(short.fetch).not.toHaveBeenCalled();
  });

  it('never classifies a chat the SDR did not answer (owner replying from the phone is not a lead)', async () => {
    const layaConfig = laya(0.1);
    const db = fakeDb({
      lead: { id: 'lead-1', funnel_stage: 'NEW_CONVERSATION', is_group: false },
      messages: [{ ...message('OUTBOUND', 'tem disponibilidade dia 12?'), sender: 'human' }, message('INBOUND', 'dia 12 não temos'), message('INBOUND', 'só 11 ou 13')],
    });
    const result = await classifyLeadWithLaya({ db: db as any, laya: layaConfig }, { organizationId: 'org-1', leadId: 'lead-1', conversationId: 'conv-1' });
    expect(result).toEqual({ status: 'skipped', reason: 'sdr_never_replied' });
    expect(layaConfig.fetch).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });
});
