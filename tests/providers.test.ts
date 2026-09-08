import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { OpenAIProvider, WhatsAppMessagingService, createRuntimeProviders, runtimeConfigFromEnv } from '../packages/flow/src/server/index.js';
import { runPlayground } from '../packages/flow/src/playground.js';
import { ConnectionRepository, encryptCredentials } from '../packages/db/src/index.js';
import { secretMatches, verifyMetaSignature } from '../apps/api/src/whatsapp/webhook-auth.js';

const req = { provider: 'openai' as const, model: 'default', prompt: 'Atenda o lead.', latestUserMessage: 'Quero uma consulta', commercialMemory: { city: 'Campinas' }, knowledgeSnippets: ['Consulta apenas com agendamento'] };
const lead = { name: 'Ana', city: null, interest: 'consulta', urgency: null, objections: null, notes: null };
const decision = { reply: 'Qual horário prefere?', stage: 'QUALIFYING', handoff: false, handoff_reason: null, intent: 'consulta', lead_data: lead, score: 70 };
const output = (data: unknown, overrides = {}) => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }], usage: { input_tokens: 234, output_tokens: 56 }, ...overrides });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('OpenAI structured runtime', () => {
  it('sends Responses API schema, configured model, context and server authentication; counts actual usage', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(output(decision));
    const result = await new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4.1-mini', fetch: http }).decide(req);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: 'gpt-4.1-mini', store: false, text: { format: { type: 'json_schema', strict: true, schema: { additionalProperties: false } } } });
    expect(JSON.parse(body.input)).toMatchObject({ latestUserMessage: req.latestUserMessage, commercialMemory: req.commercialMemory, knowledgeSnippets: req.knowledgeSnippets });
    expect(result).toMatchObject({ data: { reply: decision.reply, lead_data: { name: 'Ana', interest: 'consulta' } }, inputTokens: 234, outputTokens: 56 });
    expect(result.data.lead_data).not.toHaveProperty('city');
  });
  it('supports classification, extraction and scoring with validated outputs', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(output({ intent: 'consulta' })).mockResolvedValueOnce(output(lead)).mockResolvedValueOnce(output({ score: 80, reason: 'Interesse declarado' }));
    const llm = new OpenAIProvider({ apiKey: 'test', fetch: http });
    expect((await llm.classify(req)).data.intent).toBe('consulta');
    expect((await llm.extract(req)).data).toEqual({ name: 'Ana', interest: 'consulta' });
    expect((await llm.score(req)).data.score).toBe(80);
  });
  it('rejects missing keys and unsupported providers without network calls', async () => {
    const http = vi.fn<typeof fetch>();
    await expect(new OpenAIProvider({ fetch: http }).decide(req)).rejects.toThrow('OPENAI_API_KEY');
    await expect(new OpenAIProvider({ apiKey: 'test', fetch: http }).decide({ ...req, provider: 'gemini' })).rejects.toThrow('Gemini');
    expect(http).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])('sanitizes HTTP %s errors', async status => {
    const llm = new OpenAIProvider({ apiKey: 'test-secret', fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'test-secret' }, { status })) });
    await expect(llm.decide(req)).rejects.toThrow(`HTTP ${status}`);
  });
  it.each([
    [{ status: 'incomplete' }, 'não concluiu'],
    [{ output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }, 'recusou'],
    [{ output: [{ content: [{ type: 'output_text', text: '{bad' }] }] }, 'formato'],
    [{ usage: null }, 'tokens'],
  ])('fails explicitly on incomplete or malformed provider response', async (overrides, error) => {
    const llm = new OpenAIProvider({ apiKey: 'test', fetch: vi.fn<typeof fetch>().mockResolvedValue(output(decision, overrides)) });
    await expect(llm.decide(req)).rejects.toThrow(error);
  });
  it('handles network failure without echoing secrets', async () => {
    const llm = new OpenAIProvider({ apiKey: 'secret', fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('secret')) });
    await expect(llm.decide(req)).rejects.toThrow('OpenAI indisponível');
  });
});

const evo = { provider: 'evolution' as const, status: 'connected', credentials: { serverUrl: 'https://evo.example', apiKey: 'evo-test', instanceName: 'sdr one' } };
const meta = { provider: 'meta' as const, status: 'connected', credentials: { phoneNumberId: '123456', accessToken: 'meta-test' } };
describe('WhatsApp provider contracts — HTTP mocked, no real messages', () => {
  it('blocks every output before loading credentials when sends are disabled', async () => {
    const http = vi.fn<typeof fetch>();
    const resolve = vi.fn().mockResolvedValue(evo);
    const service = new WhatsAppMessagingService({ fetch: http }, resolve);
    await expect(service.sendText('id', '5511999999999', 'Olá')).rejects.toThrow('desativado');
    await expect(service.sendMedia('id', '5511999999999', 'https://example.com/a.jpg', 'image')).rejects.toThrow('desativado');
    await expect(service.sendTemplate('id', '5511999999999', 'hello', 'pt_BR')).rejects.toThrow('desativado');
    expect(http).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });
  it('maps Evolution text, media and audio, requires returned message IDs', async () => {
    const http = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ key: { id: 'evo-confirmed' } }));
    const service = new WhatsAppMessagingService({ enabled: true, fetch: http }, async () => evo);
    expect(await service.sendText('id', '+55 (11) 99999-9999', 'Olá', { typing: true })).toEqual({ messageId: 'evo-confirmed' });
    expect(http.mock.calls[0]?.[0]).toBe('https://evo.example/message/sendText/sdr%20one');
    expect(JSON.parse(http.mock.calls[0]![1]!.body as string)).toMatchObject({ number: '5511999999999', text: 'Olá', delay: 1200 });
    await service.sendMedia('id', '5511999999999', 'https://cdn.example/a.jpg', 'image', 'Legenda');
    expect(JSON.parse(http.mock.calls[1]![1]!.body as string)).toMatchObject({ mediatype: 'image', media: 'https://cdn.example/a.jpg', caption: 'Legenda' });
    await service.sendMedia('id', '5511999999999', 'https://cdn.example/a.ogg', 'audio');
    expect(http.mock.calls[2]?.[0]).toContain('/sendWhatsAppAudio/');
    await expect(service.sendTemplate('id', '5511999999999', 'hello', 'pt_BR')).rejects.toThrow('Meta');
  });
  it('maps Meta text, media and parameterless approved template payloads', async () => {
    const http = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ messages: [{ id: 'wamid.confirmed' }] }));
    const service = new WhatsAppMessagingService({ enabled: true, fetch: http, graphVersion: 'v21.0' }, async () => meta);
    expect(await service.sendText('id', '5511999999999', 'Olá')).toEqual({ messageId: 'wamid.confirmed' });
    expect(http.mock.calls[0]?.[0]).toBe('https://graph.facebook.com/v21.0/123456/messages');
    expect(http.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer meta-test' });
    await service.sendMedia('id', '5511999999999', 'https://cdn.example/a.jpg', 'image', 'Foto');
    expect(JSON.parse(http.mock.calls[1]![1]!.body as string)).toMatchObject({ type: 'image', image: { link: 'https://cdn.example/a.jpg', caption: 'Foto' } });
    await service.sendTemplate('id', '5511999999999', 'hello_world', 'en_US');
    expect(JSON.parse(http.mock.calls[2]![1]!.body as string)).toMatchObject({ messaging_product: 'whatsapp', type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } });
  });
  it('never fabricates success on 200 without message ID or provider failure', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ error: 'secret' }, { status: 401 }));
    const service = new WhatsAppMessagingService({ enabled: true, fetch: http }, async () => meta);
    await expect(service.sendText('id', '5511999999999', 'Olá')).rejects.toThrow('ID');
    await expect(service.sendText('id', '5511999999999', 'Olá')).rejects.toThrow('HTTP 401');
  });
  it('rejects foreign organization connection before reading its credentials', async () => {
    const repo = new ConnectionRepository({} as any);
    vi.spyOn(repo, 'getConnection').mockResolvedValue(null);
    const creds = vi.spyOn(repo, 'getConnectionCredentials');
    expect(await repo.resolveMessagingConnection('org-a', 'org-b-connection')).toBeNull();
    expect(creds).not.toHaveBeenCalled();
  });
  it('uses explicit environment opt-in and never a mock LLM in runtime factory', () => {
    expect(runtimeConfigFromEnv({ WHATSAPP_SEND_ENABLED: 'false' }).whatsappSendEnabled).toBe(false);
    expect(runtimeConfigFromEnv({ WHATSAPP_SEND_ENABLED: 'true' }).whatsappSendEnabled).toBe(true);
    expect(createRuntimeProviders({}, async () => null).llm).toBeInstanceOf(OpenAIProvider);
  });
});

describe('Webhook authentication and credential encryption', () => {
  it('validates Meta HMAC over original bytes and rejects a modified body', () => {
    const raw = Buffer.from('{"message":"Olá"}');
    const signature = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
    expect(verifyMetaSignature(raw, signature, 'app-secret')).toBe(true);
    expect(verifyMetaSignature(Buffer.from('{}'), signature, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(raw, undefined, 'app-secret')).toBe(false);
    expect(secretMatches('token', 'token')).toBe(true);
    expect(secretMatches(undefined, undefined)).toBe(false);
  });
  it('does not encrypt with a hardcoded fallback key', () => {
    vi.stubEnv('ENCRYPTION_KEY', ''); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(() => encryptCredentials({ token: 'test' })).toThrow('ENCRYPTION_KEY');
  });
  it('keeps OpenAI playground isolated even when a real messaging service is passed', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(output(decision));
    const send = vi.fn();
    const graph = { schemaVersion: 1 as const, nodes: [
      { id: 'trigger', type: 'trigger.message_received', position: { x: 0, y: 0 }, config: {} },
      { id: 'agent', type: 'agent.decide', position: { x: 0, y: 100 }, config: { provider: 'openai', model: 'default', prompt: 'Atenda' } },
      { id: 'send', type: 'output.send_text', position: { x: 0, y: 200 }, config: { text: '{{decision.reply}}', typing: false } },
    ], edges: [{ id: 'a', source: 'trigger', target: 'agent', sourcePort: 'next' }, { id: 'b', source: 'agent', target: 'send', sourcePort: 'next' }] };
    const result = await runPlayground({ graph: graph as any, organizationId: 'sandbox', message: 'Olá', services: {
      llm: new OpenAIProvider({ apiKey: 'test', fetch: http }), messaging: { sendText: send, sendMedia: send, sendTemplate: send },
    } });
    expect(result.status).toBe('completed');
    expect(http).toHaveBeenCalledOnce();
    expect(result.sentMessages).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
});
