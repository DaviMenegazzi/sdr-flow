import { describe, expect, it } from 'vitest';
import { buildAgentDebugExport, createAgentDebugFilename } from '../apps/web/src/inbox/debug-export.js';

describe('agent debug JSON export', () => {
  it('keeps the full session and only messages inside the listening window', () => {
    const payload = buildAgentDebugExport({
      exportedAt: '2026-09-09T12:00:10.000Z',
      session: {
        id: 'debug-session-1234',
        status: 'completed',
        armedAt: '2026-09-09T12:00:00.000Z',
        expiresAt: '2026-09-09T12:15:00.000Z',
        startedAt: '2026-09-09T12:00:02.000Z',
        finishedAt: '2026-09-09T12:00:08.000Z',
        executionId: 'execution-5678',
        events: [{ type: 'step:complete', payload: { output: { reply: 'Olá' } } }],
        report: { outcome: 'success' },
      },
      conversation: { id: 'conversation-1', lead: { phone: '5548999999999' } },
      messages: [
        { id: 'old', created_at: '2026-09-09T11:59:59.000Z' },
        { id: 'inbound', created_at: '2026-09-09T12:00:03.000Z' },
        { id: 'outbound', created_at: '2026-09-09T12:00:07.000Z' },
        { id: 'later', created_at: '2026-09-09T12:00:09.000Z' },
      ],
      steps: [{ sequence: 1, nodeId: 'agent', output: { reply: 'Olá' } }],
    });

    expect(payload.schemaVersion).toBe('sdr-flow.agent-debug.v1');
    expect(payload.messagesDuringListening.map(message => message.id)).toEqual(['inbound', 'outbound']);
    expect(payload.debugSession.events).toHaveLength(1);
    expect(payload.normalizedExecution.steps).toEqual([{ sequence: 1, nodeId: 'agent', output: { reply: 'Olá' } }]);
    expect(payload.normalizedExecution.report).toEqual({ outcome: 'success' });
  });

  it('creates a safe and identifiable JSON filename', () => {
    expect(createAgentDebugFilename({
      conversationLabel: 'João da Silva',
      sessionId: 'debug-session-1234',
      executionId: 'execution-5678',
      exportedAt: '2026-09-09T12:34:56.789Z',
    })).toBe('sdr-debug-joao-da-silva-2026-09-09T12-34-56Z-executio.json');
  });
});
