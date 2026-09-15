import { describe,it,expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../apps/api/src/app.js';
import { createBlankFlow,createSdrTemplate } from '../packages/flow/src/index.js';
import { nodeTypes } from '../packages/shared/src/index.js';

describe('API without configured external services',() => {
  const app=createApp();
  it('reports process health and unconfigured persistence honestly',async () => {
    const result=await request(app).get('/api/health'); expect(result.status).toBe(200); expect(result.body.persistenceConfigured).toBe(false);
  });
  it('serves all form schemas without schema implementation internals',async () => {
    const result=await request(app).get('/api/catalog'); expect(result.body).toHaveLength(nodeTypes.length); expect(result.body[0]).not.toHaveProperty('schema'); expect(result.body[0].jsonSchema.type).toBe('object');
  });
  it('validates the SDR template and rejects malformed graphs',async () => {
    expect((await request(app).post('/api/flows/validate').send(createSdrTemplate())).status).toBe(200);
    const graph=createBlankFlow(); graph.edges=[];
    expect((await request(app).post('/api/flows/validate').send(graph)).status).toBe(422);
  });
  it('returns 410 for every retired root API before any legacy handler runs',async () => {
    const responses = await Promise.all([
      request(app).get('/api/flows'),
      request(app).post('/api/flows').send({name:'Legado',graph:createBlankFlow()}),
      request(app).get('/api/integrations'),
      request(app).post('/api/integrations/google/connect').send({refreshToken:'legacy'}),
      request(app).get('/api/connections/instances'),
      request(app).post('/api/connections/evolution/create').send({}),
      request(app).get('/api/knowledge'),
      request(app).get('/api/inbox/conversations'),
      request(app).get('/api/settings'),
      request(app).post('/api/webhooks/evolution/instance/old-instance').send({}),
    ]);
    for (const response of responses) expect(response.status).toBe(410);
  });
  it('does not load or retain the retired JSON persistence implementation', () => {
    const source = readFileSync('apps/api/src/app.ts', 'utf8');
    expect(source).not.toMatch(/standaloneStore|storage\.js|processStandalone|standaloneMode/);
    expect(existsSync('apps/api/src/storage.ts')).toBe(false);
    expect(existsSync('apps/api/src/conversation-turn-queue.ts')).toBe(false);
  });
  it('never claims local persistence is a successful cloud write',async () => {
    const result=await request(app).post('/api/organizations/00000000-0000-4000-8000-000000000001/flows').send({name:'Demo',graph:createBlankFlow()});
    expect(result.status).toBe(503);
  });
  it('requires a bearer token before reading organization data',async () => {
    const secured=createApp({supabaseUrl:'https://example.supabase.co',anonKey:'test'});
    expect((await request(secured).get('/api/organizations/00000000-0000-4000-8000-000000000001/flows')).status).toBe(401);
  });
  it('returns controlled errors for bad JSON, oversized input and unknown routes',async () => {
    expect((await request(app).post('/api/flows/validate').set('Content-Type','application/json').send('{')).status).toBe(400);
    expect((await request(app).post('/api/flows/validate').send({large:'x'.repeat(1_100_000)})).status).toBe(413);
    expect((await request(app).get('/missing')).status).toBe(404);
  });
});
