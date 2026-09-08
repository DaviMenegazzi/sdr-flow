import { describe,it,expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../apps/api/src/app.js';
import { createBlankFlow,createSdrTemplate } from '../packages/flow/src/index.js';

describe('API without configured external services',() => {
  const app=createApp();
  it('reports process health and unconfigured persistence honestly',async () => {
    const result=await request(app).get('/api/health'); expect(result.status).toBe(200); expect(result.body.persistenceConfigured).toBe(false);
  });
  it('serves all form schemas without schema implementation internals',async () => {
    const result=await request(app).get('/api/catalog'); expect(result.body).toHaveLength(31); expect(result.body[0]).not.toHaveProperty('schema'); expect(result.body[0].jsonSchema.type).toBe('object');
  });
  it('validates the SDR template and rejects malformed graphs',async () => {
    expect((await request(app).post('/api/flows/validate').send(createSdrTemplate())).status).toBe(200);
    const graph=createBlankFlow(); graph.edges=[];
    expect((await request(app).post('/api/flows/validate').send(graph)).status).toBe(422);
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
