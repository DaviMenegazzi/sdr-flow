import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import type { FlowExecutionEvent, FlowExecutionResult, FlowGraph } from '@sdr/shared';

// Redis-backed replacement for the API-process-local ConversationDebugRegistry. Flow execution
// now happens in apps/worker (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.5), so the registry
// that records live steps (written by the worker) and serves them over HTTP (read by the API)
// must be shared state, not in-memory — see 8.6 ("migrar seu registro para Redis com TTL").

export interface DebugFlowSnapshot {
  id: string;
  name: string;
  version: string;
  nodes: Array<{ id: string; type: string; label: string }>;
  graph?: FlowGraph;
}

export interface DebugIssue {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  nodeId?: string;
}

export interface DebugReport {
  outcome: 'success' | 'warning' | 'error';
  title: string;
  summary: string;
  steps: number;
  durationMs: number;
  tokens: { input: number; output: number };
  issues: DebugIssue[];
}

export interface ConversationDebugSession {
  id: string;
  organizationId: string;
  conversationId: string;
  connectionId: string;
  status: 'armed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
  armedAt: string;
  expiresAt: string;
  startedAt?: string;
  finishedAt?: string;
  executionId?: string;
  flow: DebugFlowSnapshot;
  events: FlowExecutionEvent[];
  report?: DebugReport;
}

const ARM_TTL_MS = 15 * 60 * 1000;
const RETENTION_MS = 60 * 60 * 1000;
const MAX_EVENTS = 250;

function sessionRedisKey(organizationId: string, conversationId: string) {
  return `sdr:debug:session:${organizationId}:${conversationId}`;
}
function executionRedisKey(executionId: string) {
  return `sdr:debug:exec:${executionId}`;
}

function lazyExpire(session: ConversationDebugSession): ConversationDebugSession {
  if (session.status === 'armed' && Date.parse(session.expiresAt) <= Date.now()) {
    return {
      ...session,
      status: 'expired',
      finishedAt: new Date().toISOString(),
      report: {
        outcome: 'warning',
        title: 'Escuta expirada',
        summary: 'Nenhuma nova mensagem chegou dentro de 15 minutos.',
        steps: 0,
        durationMs: 0,
        tokens: { input: 0, output: 0 },
        issues: [{ severity: 'warning', code: 'debug_expired', message: 'Ative o debug novamente para ouvir a próxima mensagem.' }],
      },
    };
  }
  return session;
}

export interface DebugRegistry {
  arm(input: { organizationId: string; conversationId: string; connectionId: string; flow: DebugFlowSnapshot }): Promise<ConversationDebugSession>;
  get(organizationId: string, conversationId: string): Promise<ConversationDebugSession | null>;
  cancel(organizationId: string, conversationId: string): Promise<ConversationDebugSession | null>;
  claim(input: { organizationId: string; conversationId: string; executionId: string; flow: DebugFlowSnapshot }): Promise<ConversationDebugSession | null>;
  record(event: FlowExecutionEvent): Promise<FlowExecutionEvent>;
  finish(executionId: string, result: FlowExecutionResult, extraIssues?: DebugIssue[]): Promise<ConversationDebugSession | null>;
  supersede(executionId: string): Promise<ConversationDebugSession | null>;
  failArmed(organizationId: string, conversationId: string, issue: DebugIssue): Promise<ConversationDebugSession | null>;
}

export class RedisDebugRegistry implements DebugRegistry {
  private readonly redis: IORedis;

  constructor(redisUrlOrClient: string | IORedis) {
    this.redis = typeof redisUrlOrClient === 'string' ? new IORedis(redisUrlOrClient, { maxRetriesPerRequest: null }) : redisUrlOrClient;
    this.redis.on('error', error => console.error('[RedisDebugRegistry] Redis error:', error));
  }

  private async readSession(organizationId: string, conversationId: string): Promise<ConversationDebugSession | null> {
    const raw = await this.redis.get(sessionRedisKey(organizationId, conversationId));
    if (!raw) return null;
    return lazyExpire(JSON.parse(raw) as ConversationDebugSession);
  }

  private async writeSession(session: ConversationDebugSession): Promise<void> {
    const ttlMs = session.status === 'armed'
      ? Math.max(1000, Date.parse(session.expiresAt) - Date.now())
      : RETENTION_MS;
    await this.redis.set(sessionRedisKey(session.organizationId, session.conversationId), JSON.stringify(session), 'PX', ttlMs);
  }

  async arm(input: { organizationId: string; conversationId: string; connectionId: string; flow: DebugFlowSnapshot }): Promise<ConversationDebugSession> {
    const previous = await this.readSession(input.organizationId, input.conversationId);
    if (previous?.executionId) await this.redis.del(executionRedisKey(previous.executionId));

    const now = new Date();
    const session: ConversationDebugSession = {
      id: randomUUID(),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      connectionId: input.connectionId,
      status: 'armed',
      armedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ARM_TTL_MS).toISOString(),
      flow: input.flow,
      events: [],
    };
    await this.writeSession(session);
    return session;
  }

  async get(organizationId: string, conversationId: string): Promise<ConversationDebugSession | null> {
    const session = await this.readSession(organizationId, conversationId);
    if (session && session.status === 'expired') await this.writeSession(session);
    return session;
  }

  async cancel(organizationId: string, conversationId: string): Promise<ConversationDebugSession | null> {
    const session = await this.readSession(organizationId, conversationId);
    if (!session) return null;
    if (session.executionId) await this.redis.del(executionRedisKey(session.executionId));
    session.status = 'cancelled';
    session.finishedAt = new Date().toISOString();
    await this.writeSession(session);
    return session;
  }

  async claim(input: { organizationId: string; conversationId: string; executionId: string; flow: DebugFlowSnapshot }): Promise<ConversationDebugSession | null> {
    const session = await this.readSession(input.organizationId, input.conversationId);
    if (!session || session.status !== 'armed') return null;
    session.status = 'running';
    session.startedAt = new Date().toISOString();
    session.executionId = input.executionId;
    session.flow = input.flow;
    await Promise.all([
      this.writeSession(session),
      this.redis.set(executionRedisKey(input.executionId), sessionRedisKey(input.organizationId, input.conversationId), 'PX', RETENTION_MS),
    ]);
    return session;
  }

  async record(event: FlowExecutionEvent): Promise<FlowExecutionEvent> {
    const sessionKey = await this.redis.get(executionRedisKey(event.executionId));
    if (!sessionKey) return event;
    const raw = await this.redis.get(sessionKey);
    if (!raw) return event;
    const session = JSON.parse(raw) as ConversationDebugSession;
    const enriched = { ...event, conversationId: session.conversationId, debugSessionId: session.id };
    if (session.events.length < MAX_EVENTS) session.events.push(enriched);
    await this.writeSession(session);
    return enriched;
  }

  async finish(executionId: string, result: FlowExecutionResult, extraIssues: DebugIssue[] = []): Promise<ConversationDebugSession | null> {
    const sessionKey = await this.redis.get(executionRedisKey(executionId));
    if (!sessionKey) return null;
    const raw = await this.redis.get(sessionKey);
    if (!raw) return null;
    const session = JSON.parse(raw) as ConversationDebugSession;

    const failedSteps = result.steps.filter(step => Boolean(step.error));
    const issues: DebugIssue[] = [
      ...failedSteps.map(step => ({
        severity: 'error' as const,
        code: 'step_failed',
        message: step.error || 'O bloco falhou sem informar detalhes.',
        nodeId: step.nodeId,
      })),
      ...extraIssues,
    ];
    if (result.status === 'failed' && issues.length === 0) {
      issues.push({ severity: 'error', code: 'execution_failed', message: result.error || 'A execução do fluxo falhou.' });
    }

    const hasError = issues.some(issue => issue.severity === 'error');
    const hasWarning = issues.some(issue => issue.severity === 'warning');
    const outcome: DebugReport['outcome'] = hasError || result.status === 'failed' ? 'error' : hasWarning || result.status === 'waiting' ? 'warning' : 'success';
    const title = outcome === 'success' ? 'Execução concluída' : outcome === 'warning' ? 'Execução concluída com atenção' : 'Problema encontrado';
    const summary = result.status === 'waiting'
      ? 'O fluxo executou e ficou aguardando a próxima entrada.'
      : outcome === 'success'
        ? 'Todos os blocos percorridos terminaram sem erro.'
        : `${issues.length} ponto${issues.length === 1 ? '' : 's'} precisa${issues.length === 1 ? '' : 'm'} de atenção.`;

    session.status = outcome === 'error' ? 'failed' : 'completed';
    session.finishedAt = new Date().toISOString();
    session.report = {
      outcome,
      title,
      summary,
      steps: result.steps.length,
      durationMs: result.steps.reduce((total, step) => total + (step.durationMs || 0), 0),
      tokens: result.tokens,
      issues,
    };
    await Promise.all([this.writeSession(session), this.redis.del(executionRedisKey(executionId))]);
    return session;
  }

  async supersede(executionId: string): Promise<ConversationDebugSession | null> {
    const sessionKey = await this.redis.get(executionRedisKey(executionId));
    if (!sessionKey) return null;
    const raw = await this.redis.get(sessionKey);
    if (!raw) return null;
    const session = JSON.parse(raw) as ConversationDebugSession;
    session.status = 'armed';
    session.startedAt = undefined;
    session.executionId = undefined;
    session.events = [];
    await Promise.all([this.writeSession(session), this.redis.del(executionRedisKey(executionId))]);
    return session;
  }

  async failArmed(organizationId: string, conversationId: string, issue: DebugIssue): Promise<ConversationDebugSession | null> {
    const session = await this.readSession(organizationId, conversationId);
    if (!session || session.status !== 'armed') return null;
    session.status = 'failed';
    session.finishedAt = new Date().toISOString();
    session.report = {
      outcome: 'error',
      title: 'O fluxo não iniciou',
      summary: issue.message,
      steps: 0,
      durationMs: 0,
      tokens: { input: 0, output: 0 },
      issues: [issue],
    };
    await this.writeSession(session);
    return session;
  }

  /** Test-only: never call in production — SCANs the whole debug key space. */
  async clear(): Promise<void> {
    const keys = await this.redis.keys('sdr:debug:*');
    if (keys.length) await this.redis.del(...keys);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/** Explicit in-memory test double, mirroring the original process-local registry. */
export class InMemoryDebugRegistry implements DebugRegistry {
  private readonly sessions = new Map<string, ConversationDebugSession>();
  private readonly executionKeys = new Map<string, string>();

  private key(organizationId: string, conversationId: string) {
    return `${organizationId}:${conversationId}`;
  }

  async arm(input: { organizationId: string; conversationId: string; connectionId: string; flow: DebugFlowSnapshot }): Promise<ConversationDebugSession> {
    const key = this.key(input.organizationId, input.conversationId);
    const previous = this.sessions.get(key);
    if (previous?.executionId) this.executionKeys.delete(previous.executionId);
    const now = new Date();
    const session: ConversationDebugSession = {
      id: randomUUID(),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      connectionId: input.connectionId,
      status: 'armed',
      armedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ARM_TTL_MS).toISOString(),
      flow: input.flow,
      events: [],
    };
    this.sessions.set(key, session);
    return structuredClone(session);
  }

  async get(organizationId: string, conversationId: string): Promise<ConversationDebugSession | null> {
    const session = this.sessions.get(this.key(organizationId, conversationId));
    return session ? structuredClone(lazyExpire(session)) : null;
  }

  async cancel(organizationId: string, conversationId: string): Promise<ConversationDebugSession | null> {
    const session = this.sessions.get(this.key(organizationId, conversationId));
    if (!session) return null;
    if (session.executionId) this.executionKeys.delete(session.executionId);
    session.status = 'cancelled';
    session.finishedAt = new Date().toISOString();
    return structuredClone(session);
  }

  async claim(input: { organizationId: string; conversationId: string; executionId: string; flow: DebugFlowSnapshot }): Promise<ConversationDebugSession | null> {
    const key = this.key(input.organizationId, input.conversationId);
    const session = this.sessions.get(key);
    if (!session || session.status !== 'armed') return null;
    session.status = 'running';
    session.startedAt = new Date().toISOString();
    session.executionId = input.executionId;
    session.flow = input.flow;
    this.executionKeys.set(input.executionId, key);
    return structuredClone(session);
  }

  async record(event: FlowExecutionEvent): Promise<FlowExecutionEvent> {
    const key = this.executionKeys.get(event.executionId);
    const session = key ? this.sessions.get(key) : null;
    const enriched = session ? { ...event, conversationId: session.conversationId, debugSessionId: session.id } : event;
    if (session && session.events.length < MAX_EVENTS) session.events.push(structuredClone(enriched));
    return enriched;
  }

  async finish(executionId: string, result: FlowExecutionResult, extraIssues: DebugIssue[] = []): Promise<ConversationDebugSession | null> {
    const key = this.executionKeys.get(executionId);
    const session = key ? this.sessions.get(key) : null;
    if (!session) return null;
    const failedSteps = result.steps.filter(step => Boolean(step.error));
    const issues: DebugIssue[] = [
      ...failedSteps.map(step => ({ severity: 'error' as const, code: 'step_failed', message: step.error || 'O bloco falhou sem informar detalhes.', nodeId: step.nodeId })),
      ...extraIssues,
    ];
    if (result.status === 'failed' && issues.length === 0) {
      issues.push({ severity: 'error', code: 'execution_failed', message: result.error || 'A execução do fluxo falhou.' });
    }
    const hasError = issues.some(issue => issue.severity === 'error');
    const hasWarning = issues.some(issue => issue.severity === 'warning');
    const outcome: DebugReport['outcome'] = hasError || result.status === 'failed' ? 'error' : hasWarning || result.status === 'waiting' ? 'warning' : 'success';
    session.status = outcome === 'error' ? 'failed' : 'completed';
    session.finishedAt = new Date().toISOString();
    session.report = {
      outcome,
      title: outcome === 'success' ? 'Execução concluída' : outcome === 'warning' ? 'Execução concluída com atenção' : 'Problema encontrado',
      summary: result.status === 'waiting' ? 'O fluxo executou e ficou aguardando a próxima entrada.' : outcome === 'success' ? 'Todos os blocos percorridos terminaram sem erro.' : `${issues.length} ponto${issues.length === 1 ? '' : 's'} precisa${issues.length === 1 ? '' : 'm'} de atenção.`,
      steps: result.steps.length,
      durationMs: result.steps.reduce((total, step) => total + (step.durationMs || 0), 0),
      tokens: result.tokens,
      issues,
    };
    this.executionKeys.delete(executionId);
    return structuredClone(session);
  }

  async supersede(executionId: string): Promise<ConversationDebugSession | null> {
    const key = this.executionKeys.get(executionId);
    const session = key ? this.sessions.get(key) : null;
    if (!session) return null;
    this.executionKeys.delete(executionId);
    session.status = 'armed';
    session.startedAt = undefined;
    session.executionId = undefined;
    session.events = [];
    return structuredClone(session);
  }

  async failArmed(organizationId: string, conversationId: string, issue: DebugIssue): Promise<ConversationDebugSession | null> {
    const session = this.sessions.get(this.key(organizationId, conversationId));
    if (!session || session.status !== 'armed') return null;
    session.status = 'failed';
    session.finishedAt = new Date().toISOString();
    session.report = { outcome: 'error', title: 'O fluxo não iniciou', summary: issue.message, steps: 0, durationMs: 0, tokens: { input: 0, output: 0 }, issues: [issue] };
    return structuredClone(session);
  }

  clear() {
    this.sessions.clear();
    this.executionKeys.clear();
  }
}
