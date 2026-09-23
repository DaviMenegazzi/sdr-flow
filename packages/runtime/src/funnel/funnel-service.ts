import { Queue, Worker } from 'bullmq';
import { ConversationRepository, FunnelRepository, type LeadTemperature } from '@sdr/db';
import { queueNames } from '@sdr/shared';
import type { ServiceDb } from '../inbound/inbound-event-repository.js';
import { canAdvanceFunnel, normalizeFunnelStage, strongestSignal, type FunnelSignal } from './funnel-rules.js';
import { layaPredict, type LayaConfig, type LayaQuestion } from './laya-client.js';

export interface FunnelMoveResult {
  from: string;
  to: string;
  signal: FunnelSignal;
}

/** Applies the strongest of this turn's signals to leads.funnel_stage, if it moves the funnel. */
export async function applyFunnelSignals(
  db: ServiceDb,
  input: { organizationId: string; leadId: string; conversationId?: string | null; signals: FunnelSignal[] },
): Promise<FunnelMoveResult | null> {
  const signal = strongestSignal(input.signals);
  if (!signal) return null;
  const repo = new FunnelRepository(db);
  const lead = await repo.getLeadFunnel(input.organizationId, input.leadId);
  if (!lead || lead.is_group) return null;
  const from = normalizeFunnelStage(lead.funnel_stage);
  if (!canAdvanceFunnel(from, signal.stage)) return null;
  const moved = await repo.moveLeadFunnel(input.organizationId, {
    leadId: input.leadId,
    conversationId: input.conversationId,
    from: lead.funnel_stage,
    to: signal.stage,
    source: signal.source,
    reason: signal.reason,
    evidence: signal.evidence,
    confidence: signal.confidence,
  });
  return moved ? { from, to: signal.stage, signal } : null;
}

// Validated against labelled PT-BR sales conversations (2026-09-23): the ordinal interest score
// was the only Laya answer that tracked reality. Refusals scored < 0.8, confirmed purchases ~3.9,
// open conversations 1.3–2.6. Funnel stage as a Laya choice question was right 3/8 times, so the
// stage itself comes from flow signals and text rules; Laya only decides "lost" and temperature.
const INTEREST_QUESTION: LayaQuestion = {
  type: 'score',
  instructions: 'Qual o nível de interesse de compra do CONTATO?',
  criteria: [
    'sem interesse, recusou ou desistiu',
    'interesse baixo, só curiosidade',
    'interesse moderado, fazendo perguntas',
    'interesse alto, quer avançar',
    'pronto para comprar ou já comprou',
  ],
};
const INTEREST_LEVELS = INTEREST_QUESTION.criteria.length - 1;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 1200;
const MIN_INBOUND_MESSAGES = 2;

export function temperatureFor(score: number): LeadTemperature {
  if (score >= 70) return 'HOT';
  if (score >= 40) return 'WARM';
  return 'COLD';
}

export interface LeadClassificationJob {
  organizationId: string;
  leadId: string;
  conversationId: string;
}

export type LeadClassificationResult =
  | { status: 'skipped'; reason: string }
  | { status: 'classified'; interest: number; confidence: number; score: number; temperature: LeadTemperature; move: FunnelMoveResult | null };

export async function classifyLeadWithLaya(
  deps: { db: ServiceDb; laya: LayaConfig; lostThreshold?: number },
  job: LeadClassificationJob,
): Promise<LeadClassificationResult> {
  const funnelRepo = new FunnelRepository(deps.db);
  const lead = await funnelRepo.getLeadFunnel(job.organizationId, job.leadId);
  if (!lead) return { status: 'skipped', reason: 'lead_not_found' };
  if (lead.is_group) return { status: 'skipped', reason: 'group' };

  const messages = (await new ConversationRepository(deps.db).getLeadRecentMessages(job.organizationId, job.leadId, MAX_MESSAGES * 2))
    .filter(message => typeof message.content === 'string' && message.content.trim())
    .slice(-MAX_MESSAGES);
  if (messages.filter(message => message.direction === 'INBOUND').length < MIN_INBOUND_MESSAGES) {
    return { status: 'skipped', reason: 'not_enough_messages' };
  }
  const state = messages.map(message =>
    `${message.direction === 'INBOUND' ? 'CONTATO' : 'EQUIPE'}: ${message.content.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_CHARS)}`,
  );

  const answers = await layaPredict(deps.laya, state, { interest: INTEREST_QUESTION });
  const interest = Math.min(INTEREST_LEVELS, Math.max(0, answers.interest!.score!));
  const confidence = answers.interest!.confidence;
  const score = Math.round((interest / INTEREST_LEVELS) * 100);
  const temperature = temperatureFor(score);
  await funnelRepo.setLeadScore(job.organizationId, job.leadId, score, temperature);

  const lostThreshold = deps.lostThreshold ?? 0.8;
  const move = interest < lostThreshold
    ? await applyFunnelSignals(deps.db, {
        organizationId: job.organizationId,
        leadId: job.leadId,
        conversationId: job.conversationId,
        signals: [{ stage: 'CLOSED', source: 'laya', reason: `Laya: interesse ${interest.toFixed(2)}/4 indica recusa ou desistência`, evidence: state[state.length - 1] ?? null, confidence }],
      })
    : null;
  return { status: 'classified', interest, confidence, score, temperature, move };
}

function redisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

export interface LeadClassificationQueue {
  enqueue(job: LeadClassificationJob): Promise<void>;
}

/**
 * Debounced per lead: every new turn pushes the pending job back by `debounceMs` and replaces its
 * data, so a burst of messages costs one Laya inference once the conversation settles.
 */
export class RedisLeadClassificationQueue implements LeadClassificationQueue {
  private readonly queue: Queue;

  constructor(redisUrl: string, private readonly debounceMs = 60_000) {
    this.queue = new Queue(queueNames.leadClassification, { connection: redisConnection(redisUrl) });
  }

  async enqueue(job: LeadClassificationJob) {
    await this.queue.add('classify', job, {
      delay: this.debounceMs,
      deduplication: { id: `${job.organizationId}:${job.leadId}`, ttl: this.debounceMs, extend: true, replace: true },
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }

  close() {
    return this.queue.close();
  }
}

/** Concurrency 1: the Laya service runs one inference at a time anyway, shared with Tráfego Pro. */
export function startLeadClassificationWorker(
  redisUrl: string,
  deps: { db: ServiceDb; laya: LayaConfig; lostThreshold?: number },
  handlers: { onResult?: (job: LeadClassificationJob, result: LeadClassificationResult) => void; onError?: (job: LeadClassificationJob, error: unknown) => void } = {},
) {
  return new Worker<LeadClassificationJob>(
    queueNames.leadClassification,
    async job => {
      try {
        const result = await classifyLeadWithLaya(deps, job.data);
        handlers.onResult?.(job.data, result);
        return result;
      } catch (error) {
        // Classification is best effort: the lead keeps its current funnel stage and score.
        handlers.onError?.(job.data, error);
        return { status: 'skipped', reason: 'laya_error' };
      }
    },
    { connection: redisConnection(redisUrl), concurrency: 1 },
  );
}
