import { beforeEach, describe, expect, it } from 'vitest';
import { ConversationDebugRegistry } from '../apps/api/src/debug-session.js';

const flow = {
  id: 'flow-1',
  name: 'Qualificação SDR',
  version: 'v3',
  nodes: [{ id: 'start', type: 'trigger.message_received', label: 'Mensagem recebida' }],
};

describe('ConversationDebugRegistry', () => {
  let registry: ConversationDebugRegistry;

  beforeEach(() => {
    registry = new ConversationDebugRegistry();
  });

  it('arms and claims only the next execution for a conversation', () => {
    const armed = registry.arm({ organizationId: 'org-1', conversationId: 'conv-1', connectionId: 'conn-1', flow });
    expect(armed.status).toBe('armed');

    const claimed = registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-1', flow });
    expect(claimed?.status).toBe('running');
    expect(registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-2', flow })).toBeNull();
  });

  it('records the cascade and produces a success report', () => {
    const armed = registry.arm({ organizationId: 'org-1', conversationId: 'conv-1', connectionId: 'conn-1', flow });
    registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-1', flow });
    const event = registry.record({
      type: 'step:complete',
      executionId: 'exec-1',
      organizationId: 'org-1',
      timestamp: new Date().toISOString(),
      payload: { sequence: 1, nodeId: 'start', nodeType: 'trigger.message_received', durationMs: 4 },
    });

    expect(event.debugSessionId).toBe(armed.id);
    expect(event.conversationId).toBe('conv-1');

    const completed = registry.finish('exec-1', {
      status: 'completed',
      steps: [{ sequence: 1, nodeId: 'start', nodeType: 'trigger.message_received', input: {}, output: {}, durationMs: 4 }],
      tokens: { input: 10, output: 5 },
      variables: {},
    });
    expect(completed?.status).toBe('completed');
    expect(completed?.report).toMatchObject({ outcome: 'success', steps: 1, durationMs: 4, tokens: { input: 10, output: 5 } });
  });

  it('reports why an armed debug could not start', () => {
    registry.arm({ organizationId: 'org-1', conversationId: 'conv-1', connectionId: 'conn-1', flow });
    const failed = registry.failArmed('org-1', 'conv-1', {
      severity: 'error',
      code: 'bot_paused',
      message: 'A IA está pausada.',
    });
    expect(failed?.status).toBe('failed');
    expect(failed?.report?.issues[0]?.code).toBe('bot_paused');
  });

  it('rearms the same session when a response is superseded by a newer message', () => {
    const armed = registry.arm({ organizationId: 'org-1', conversationId: 'conv-1', connectionId: 'conn-1', flow });
    registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-old', flow });

    const rearmed = registry.supersede('exec-old');

    expect(rearmed?.id).toBe(armed.id);
    expect(rearmed?.status).toBe('armed');
    expect(rearmed?.executionId).toBeUndefined();
    expect(registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-new', flow })?.status).toBe('running');
  });
});
