import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDebugRegistry } from '@sdr/runtime';

const flow = {
  id: 'flow-1',
  name: 'Qualificação SDR',
  version: 'v3',
  nodes: [{ id: 'start', type: 'trigger.message_received', label: 'Mensagem recebida' }],
};

describe('DebugRegistry (InMemoryDebugRegistry)', () => {
  let registry: InMemoryDebugRegistry;

  beforeEach(() => {
    registry = new InMemoryDebugRegistry();
  });

  it('arms and claims only the next execution for a conversation', async () => {
    const armed = await registry.arm({ organizationId: 'org-1', conversationId: 'conv-1', connectionId: 'conn-1', flow });
    expect(armed.status).toBe('armed');

    const claimed = await registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-1', flow });
    expect(claimed?.status).toBe('running');
    expect(await registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-2', flow })).toBeNull();
  });

  it('records the cascade and produces a success report', async () => {
    const armed = await registry.arm({ organizationId: 'org-1', conversationId: 'conv-1', connectionId: 'conn-1', flow });
    await registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-1', flow });
    const event = await registry.record({
      type: 'step:complete',
      executionId: 'exec-1',
      organizationId: 'org-1',
      timestamp: new Date().toISOString(),
      payload: { sequence: 1, nodeId: 'start', nodeType: 'trigger.message_received', durationMs: 4 },
    });

    expect(event.debugSessionId).toBe(armed.id);
    expect(event.conversationId).toBe('conv-1');

    const completed = await registry.finish('exec-1', {
      status: 'completed',
      steps: [{ sequence: 1, nodeId: 'start', nodeType: 'trigger.message_received', input: {}, output: {}, durationMs: 4 }],
      tokens: { input: 10, output: 5 },
      variables: {},
    });
    expect(completed?.status).toBe('completed');
    expect(completed?.report).toMatchObject({ outcome: 'success', steps: 1, durationMs: 4, tokens: { input: 10, output: 5 } });
  });

  it('reports why an armed debug could not start', async () => {
    await registry.arm({ organizationId: 'org-1', conversationId: 'conv-1', connectionId: 'conn-1', flow });
    const failed = await registry.failArmed('org-1', 'conv-1', {
      severity: 'error',
      code: 'bot_paused',
      message: 'A IA está pausada.',
    });
    expect(failed?.status).toBe('failed');
    expect(failed?.report?.issues[0]?.code).toBe('bot_paused');
  });

  it('rearms the same session when a response is superseded by a newer message', async () => {
    const armed = await registry.arm({ organizationId: 'org-1', conversationId: 'conv-1', connectionId: 'conn-1', flow });
    await registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-old', flow });

    const rearmed = await registry.supersede('exec-old');

    expect(rearmed?.id).toBe(armed.id);
    expect(rearmed?.status).toBe('armed');
    expect(rearmed?.executionId).toBeUndefined();
    expect((await registry.claim({ organizationId: 'org-1', conversationId: 'conv-1', executionId: 'exec-new', flow }))?.status).toBe('running');
  });
});
