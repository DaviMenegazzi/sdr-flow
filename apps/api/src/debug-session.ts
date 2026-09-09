import crypto from 'node:crypto';
import type { FlowExecutionEvent, FlowExecutionResult } from '@sdr/shared';

export interface DebugFlowSnapshot {
  id: string;
  name: string;
  version: string;
  nodes: Array<{ id: string; type: string; label: string }>;
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

function sessionKey(organizationId: string, conversationId: string) {
  return `${organizationId}:${conversationId}`;
}

function cloneSession(session: ConversationDebugSession): ConversationDebugSession {
  return structuredClone(session);
}

export class ConversationDebugRegistry {
  private readonly sessions = new Map<string, ConversationDebugSession>();
  private readonly executionKeys = new Map<string, string>();

  arm(input: {
    organizationId: string;
    conversationId: string;
    connectionId: string;
    flow: DebugFlowSnapshot;
  }): ConversationDebugSession {
    this.cleanup();
    const key = sessionKey(input.organizationId, input.conversationId);
    const previous = this.sessions.get(key);
    if (previous?.executionId) this.executionKeys.delete(previous.executionId);

    const now = new Date();
    const session: ConversationDebugSession = {
      id: crypto.randomUUID(),
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
    return cloneSession(session);
  }

  get(organizationId: string, conversationId: string): ConversationDebugSession | null {
    this.cleanup();
    const session = this.sessions.get(sessionKey(organizationId, conversationId));
    return session ? cloneSession(session) : null;
  }

  cancel(organizationId: string, conversationId: string): ConversationDebugSession | null {
    const key = sessionKey(organizationId, conversationId);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.executionId) this.executionKeys.delete(session.executionId);
    session.status = 'cancelled';
    session.finishedAt = new Date().toISOString();
    return cloneSession(session);
  }

  claim(input: {
    organizationId: string;
    conversationId: string;
    executionId: string;
    flow: DebugFlowSnapshot;
  }): ConversationDebugSession | null {
    this.cleanup();
    const key = sessionKey(input.organizationId, input.conversationId);
    const session = this.sessions.get(key);
    if (!session || session.status !== 'armed') return null;
    session.status = 'running';
    session.startedAt = new Date().toISOString();
    session.executionId = input.executionId;
    session.flow = input.flow;
    this.executionKeys.set(input.executionId, key);
    return cloneSession(session);
  }

  record(event: FlowExecutionEvent): FlowExecutionEvent {
    const key = this.executionKeys.get(event.executionId);
    const session = key ? this.sessions.get(key) : null;
    const enriched = session
      ? { ...event, conversationId: session.conversationId, debugSessionId: session.id }
      : event;
    if (session && session.events.length < MAX_EVENTS) session.events.push(structuredClone(enriched));
    return enriched;
  }

  finish(executionId: string, result: FlowExecutionResult, extraIssues: DebugIssue[] = []): ConversationDebugSession | null {
    const key = this.executionKeys.get(executionId);
    const session = key ? this.sessions.get(key) : null;
    if (!session) return null;

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
    this.executionKeys.delete(executionId);
    return cloneSession(session);
  }

  failArmed(organizationId: string, conversationId: string, issue: DebugIssue): ConversationDebugSession | null {
    const session = this.sessions.get(sessionKey(organizationId, conversationId));
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
    return cloneSession(session);
  }

  clear() {
    this.sessions.clear();
    this.executionKeys.clear();
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (session.status === 'armed' && Date.parse(session.expiresAt) <= now) {
        session.status = 'expired';
        session.finishedAt = new Date().toISOString();
        session.report = {
          outcome: 'warning',
          title: 'Escuta expirada',
          summary: 'Nenhuma nova mensagem chegou dentro de 15 minutos.',
          steps: 0,
          durationMs: 0,
          tokens: { input: 0, output: 0 },
          issues: [{ severity: 'warning', code: 'debug_expired', message: 'Ative o debug novamente para ouvir a próxima mensagem.' }],
        };
      }
      const finishedAt = session.finishedAt ? Date.parse(session.finishedAt) : null;
      if (finishedAt && finishedAt + RETENTION_MS <= now) {
        if (session.executionId) this.executionKeys.delete(session.executionId);
        this.sessions.delete(key);
      }
    }
  }
}

export const conversationDebugRegistry = new ConversationDebugRegistry();
