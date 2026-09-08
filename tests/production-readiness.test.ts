import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { createApp } from '../apps/api/src/app.js';
import { SentryService } from '../apps/api/src/telemetry/sentry.js';
import { MemoryRateLimiter } from '../apps/api/src/rate-limit.js';
import { AlertMonitor } from '../apps/api/src/alerts/alert-monitor.js';
import { testDatabase } from './helpers/database.js';

describe('Phase 7 — Production Readiness, Telemetry, Alerts & Rate Limiting', () => {
  let db: PGlite;
  const orgId = randomUUID();

  beforeAll(async () => {
    db = await testDatabase();
    await db.query(`insert into public.organizations(id, name) values($1, 'Alerta Org Test')`, [orgId]);
  });

  afterAll(async () => {
    await db?.close();
  });

  describe('1. Health Checks & Memory Instrumentation', () => {
    it('provides detailed /api/health endpoint with uptime and memory usage', async () => {
      const app = createApp();
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('api');
      expect(typeof res.body.uptimeSeconds).toBe('number');
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.memory).toBeDefined();
      expect(typeof res.body.memory.rssMb).toBe('number');
      expect(typeof res.body.memory.heapUsedMb).toBe('number');
    });
  });

  describe('2. Sentry Multi-Tenant Error Capture', () => {
    it('captures exceptions enriched with organization, flow, execution, and user tags', () => {
      const error = new Error('Database query timed out during handoff');
      const event = SentryService.captureException(error, {
        organizationId: 'org-abc-123',
        flowId: 'flow-sdr-001',
        flowVersionId: 'v-2',
        executionId: 'exec-999',
        userId: 'user-operator-1',
        extra: { stepName: 'agent.decide' },
      });

      expect(event.level).toBe('error');
      expect(event.exception.message).toBe('Database query timed out during handoff');
      expect(event.tags.organizationId).toBe('org-abc-123');
      expect(event.tags.flowId).toBe('flow-sdr-001');
      expect(event.tags.flowVersionId).toBe('v-2');
      expect(event.tags.executionId).toBe('exec-999');
      expect(event.tags.userId).toBe('user-operator-1');
      expect(event.extra.stepName).toBe('agent.decide');
    });
  });

  describe('3. Organization & IP Rate Limiting', () => {
    it('tracks request count, emits headers, and enforces 429 when quota is exhausted', async () => {
      const limiter = new MemoryRateLimiter({
        windowMs: 60 * 1000,
        maxRequests: 3, // Low limit for test
        keyGenerator: () => 'test-tenant-quota',
      });

      const middleware = limiter.middleware();
      const mockReq = {} as any;

      // 1st request: OK, remaining 2
      let statusCalled = false;
      let nextCalled = false;
      const res1 = {
        setHeader: vi.fn(),
        status: vi.fn().mockImplementation(() => { statusCalled = true; return { json: vi.fn() }; }),
      } as any;
      middleware(mockReq, res1, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res1.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 3);
      expect(res1.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 2);

      // 2nd request: OK, remaining 1
      middleware(mockReq, { setHeader: vi.fn(), status: vi.fn() } as any, () => {});

      // 3rd request: OK, remaining 0
      middleware(mockReq, { setHeader: vi.fn(), status: vi.fn() } as any, () => {});

      // 4th request: Exceeded -> HTTP 429
      let jsonPayload: any = null;
      const res4 = {
        setHeader: vi.fn(),
        status: vi.fn().mockImplementation((code: number) => {
          expect(code).toBe(429);
          return {
            json: vi.fn().mockImplementation((d: any) => { jsonPayload = d; }),
          };
        }),
      } as any;

      let next4Called = false;
      middleware(mockReq, res4, () => { next4Called = true; });

      expect(next4Called).toBe(false);
      expect(res4.status).toHaveBeenCalledWith(429);
      expect(jsonPayload?.error).toContain('Limite de requisições excedido');
      expect(typeof jsonPayload?.retryAfterSeconds).toBe('number');

      limiter.close();
    });
  });

  describe('4. Operational Alerts Monitor (Connection, Backlog & Error Rate)', () => {
    it('detects dropped WhatsApp connections and generates critical alerts', async () => {
      await db.query(
        `insert into public.connections(organization_id, name, provider, status)
         values($1, 'WhatsApp Falha Teste', 'evolution', 'error')`,
        [orgId]
      );

      const alerts = await AlertMonitor.checkConnectionHealth(db, orgId);
      expect(alerts.length).toBe(1);
      expect(alerts[0].type).toBe('connection_down');
      expect(alerts[0].severity).toBe('critical');
      expect(alerts[0].title).toContain('WhatsApp Falha Teste');
    });

    it('detects queue backlog when waiting items exceed threshold', () => {
      const normal = AlertMonitor.checkQueueBacklog(30, 50);
      expect(normal).toBeNull();

      const backlogged = AlertMonitor.checkQueueBacklog(120, 50);
      expect(backlogged).toBeDefined();
      expect(backlogged?.type).toBe('queue_backlog');
      expect(backlogged?.severity).toBe('critical');
      expect(backlogged?.message).toContain('120 mensagens');
    });

    it('evaluates overall organization health status as critical when issues exist', async () => {
      const report = await AlertMonitor.evaluateAlerts(db, orgId, { queueWaitingCount: 80 });
      expect(report.status).toBe('critical');
      expect(report.activeAlerts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('5. Traefik Production Configuration Validation', () => {
    it('validates that infra/traefik.prod.yml defines Let\'s Encrypt, HTTPS redirection, and WebSocket routes', () => {
      const traefikProdPath = resolve(__dirname, '../infra/traefik.prod.yml');
      const content = readFileSync(traefikProdPath, 'utf8');

      expect(content).toContain('entryPoints:');
      expect(content).toContain('websecure:');
      expect(content).toContain('letsencrypt:');
      expect(content).toContain('acme:');
      expect(content).toContain('redirections:');
      expect(content).toContain('PathPrefix(`/ws`)');
      expect(content).toContain('PathPrefix(`/api`)');
      expect(content).toContain('flushInterval: 100ms');
      expect(content).toContain('stsSeconds: 31536000');
    });
  });
});
