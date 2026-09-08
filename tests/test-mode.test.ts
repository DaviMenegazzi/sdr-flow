import { describe, expect, it, vi } from 'vitest';
import { createSdrTemplate, createBlankFlow, executeFlow, MockLLMProvider, runPlayground, validateGraph } from '../packages/flow/src/index.js';
import { flowGraphSchema, type FlowContext } from '../packages/shared/src/index.js';
import type { FlowServices } from '../packages/flow/src/services/types.js';
import { matchesTestPhone, restrictTestMessaging } from '../packages/flow/src/services/test-mode.js';
import { useBuilder } from '../apps/web/src/builder/store.js';
import { createRuntimeProviders } from '../packages/flow/src/server/index.js';

const authorized = '5511999998888';
function context(phone = authorized): FlowContext {
  return { organizationId: 'org', connectionId: 'connection', leadId: 'lead', conversationId: 'conversation', executionId: 'execution', flowVersionId: 'version',
    lead: { id: 'lead', phone, name: 'Ana', memory: {} }, conversation: { id: 'conversation', stage: 'NEW_CONVERSATION', handled_by: 'AI', bot_paused: false },
    messages: [{ id: 'message', text: 'Olá', fromMe: false }], variables: {}, tokens: { input: 0, output: 0 } };
}
function services(): FlowServices {
  return { llm: new MockLLMProvider({ reply: 'Olá, Ana' }), messaging: {
    sendText: vi.fn().mockResolvedValue({ messageId: 'test-only' }), sendMedia: vi.fn().mockResolvedValue({ messageId: 'test-only' }), sendTemplate: vi.fn().mockResolvedValue({ messageId: 'test-only' }),
  } };
}
function graph() { return { ...createSdrTemplate(), testMode: { enabled: true, phone: '+55 (11) 99999-8888' } }; }

describe('Flow-level single-number test mode', () => {
  it('allows the selected number, including the existing SDR template guard', async () => {
    const svc = services();
    const decide = vi.spyOn(svc.llm, 'decide');
    const result = await executeFlow(graph(), context(), svc);
    expect(result.status).toBe('completed');
    expect(decide).toHaveBeenCalledOnce();
    expect(svc.messaging.sendText).toHaveBeenCalledOnce();
    expect((svc.messaging.sendText as any).mock.calls[0][1]).toBe(authorized);
  });
  it.each(['5511988887777', '5521999998888', '11999998888', '999998888', '5511999998888@g.us', ''])('ignores unauthorized or incomplete source %s before all LLM and messaging calls', async phone => {
    const svc = services();
    const decide = vi.spyOn(svc.llm, 'decide');
    const record = vi.fn();
    const result = await executeFlow(graph(), context(phone), svc, { hooks: { onStepComplete: record } });
    expect(result.variables.testModeBlocked).toBe(true);
    expect(result.tokens).toEqual({ input: 0, output: 0 });
    expect(decide).not.toHaveBeenCalled();
    expect(svc.messaging.sendText).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ nodeId: '$flow-test-mode', output: { blocked: true, reason: 'Modo Teste: número não autorizado.' } }));
  });
  it('also blocks resume entry points and missing lead context', async () => {
    const ctx = context(); delete ctx.lead;
    const result = await executeFlow(graph(), ctx, services(), { resumeFromNodeId: 'reply' });
    expect(result.variables.testModeBlocked).toBe(true);
  });
  it.each(['', '5511999998888,5521988887777', '5511999998888;5521988887777', 'abc5511999998888'])('rejects invalid or multiple configured numbers: %s', async phone => {
    const invalid = { ...graph(), testMode: { enabled: true, phone } };
    expect(validateGraph(invalid).valid).toBe(false);
    const result = await executeFlow(invalid, context(), services());
    expect(result.status).toBe('failed');
    expect(result.steps).toHaveLength(0);
  });
  it('preserves the setting in JSON, graph parsing and undo/redo', () => {
    useBuilder.getState().replace(createBlankFlow(), true);
    useBuilder.getState().replace(graph());
    const roundtrip = flowGraphSchema.parse(JSON.parse(JSON.stringify(useBuilder.getState().graph)));
    expect(roundtrip.testMode).toEqual(graph().testMode);
    useBuilder.getState().undo(); expect(useBuilder.getState().graph.testMode).toBeUndefined();
    useBuilder.getState().redo(); expect(useBuilder.getState().graph.testMode).toEqual(graph().testMode);
  });
  it('does not change older graphs or disabled mode', async () => {
    expect(flowGraphSchema.parse(createBlankFlow()).testMode).toBeUndefined();
    const result = await executeFlow({ ...createBlankFlow(), testMode: { enabled: false, phone: '' } }, context('5511988887777'), services());
    expect(result.status).toBe('completed'); expect(result.variables.testModeBlocked).toBeUndefined();
  });
  it('checks text, media and template destinations again before reaching a provider', async () => {
    const svc = services(); const locked = restrictTestMessaging(svc.messaging, authorized, 'connection');
    expect(() => locked.sendText('connection', '5521999998888', 'Não enviar')).toThrow('Modo Teste');
    expect(() => locked.sendMedia('connection', '5511988887777', 'https://example.com/a.jpg', 'image')).toThrow('Modo Teste');
    expect(() => locked.sendTemplate('other-connection', authorized, 'hello', 'pt_BR')).toThrow('Modo Teste');
    expect(svc.messaging.sendText).not.toHaveBeenCalled(); expect(svc.messaging.sendMedia).not.toHaveBeenCalled(); expect(svc.messaging.sendTemplate).not.toHaveBeenCalled();
    expect(matchesTestPhone('+55 (11) 99999-8888', authorized)).toBe(true);
  });
  it('does not override the global WhatsApp send disable switch', async () => {
    const runtime = createRuntimeProviders({ whatsappSendEnabled: false }, vi.fn());
    const locked = restrictTestMessaging(runtime.messaging, authorized, 'connection');
    await expect(locked.sendText('connection', authorized, 'Não enviar')).rejects.toThrow('desativado');
  });
  it('uses the same number restriction in the playground and cannot auto-authorize a different lead', async () => {
    const result = await runPlayground({ graph: graph(), organizationId: 'test', message: 'Olá', lead: { phone: '5521999998888' } });
    expect(result.testModeBlocked).toBe(true); expect(result.tokens.total).toBe(0); expect(result.sentMessages).toHaveLength(0);
    const allowed = await runPlayground({ graph: graph(), organizationId: 'test', message: 'Olá', lead: { phone: authorized } });
    expect(allowed.testModeBlocked).toBe(false); expect(allowed.sentMessages).toHaveLength(1);
  });
});
