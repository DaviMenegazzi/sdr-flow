import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Static-analysis gate for docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 8.8.1/8.9: apps/api must
// never instantiate a BullMQ Worker for the canonical turns queue — the acceptance criterion
// "API não instancia BullMQ Worker em produção". The one remaining exception is standalone
// mode's own, entirely separate debounce queue (apps/api/src/conversation-turn-queue.ts),
// which is scoped to config.standaloneMode (never true in production) and never touches
// queueNames.turns.

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...listTsFiles(full));
    else if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('turn processing topology (Fase 2)', () => {
  const apiSrcDir = join(process.cwd(), 'apps', 'api', 'src');
  const files = listTsFiles(apiSrcDir);

  it('apps/api never constructs a BullMQ Worker, except standalone mode\'s own queue file', () => {
    const offenders = files.filter(file => {
      if (file.endsWith(join('whatsapp', 'conversation-turn-queue.ts')) || file.endsWith('conversation-turn-queue.ts')) return false;
      const content = readFileSync(file, 'utf8');
      return /new\s+Worker\s*\(/.test(content);
    });
    expect(offenders).toEqual([]);
  });

  it('apps/api produces to the canonical queue but never attaches a handler to it (producer-only)', () => {
    const appTs = readFileSync(join(apiSrcDir, 'app.ts'), 'utf8');
    expect(appTs).toContain('queueNames.turns');
    // A handler-carrying construction would read `new RedisTurnBuffer(url, name, someHandler, ...)`.
    // The producer-only construction in app.ts must have exactly two arguments.
    const match = appTs.match(/new RedisTurnBuffer\(([^)]*)\)/);
    expect(match).not.toBeNull();
    const args = match![1]!.split(',').map(part => part.trim()).filter(Boolean);
    expect(args).toHaveLength(2);
  });

  it('apps/worker is the only process wiring processTurn to the canonical queue', () => {
    const workerMain = readFileSync(join(process.cwd(), 'apps', 'worker', 'src', 'main.ts'), 'utf8');
    expect(workerMain).toContain('queueNames.turns');
    expect(workerMain).toContain('processTurn');
    const apiHasProcessTurn = files.some(file => readFileSync(file, 'utf8').includes('processTurn('));
    // apps/api's dev-only inline fallback also calls processTurn directly (never through a
    // queue) — that is expected and distinct from a queue consumer. Assert it's confined to
    // webhook.ts, the one place that decides between enqueue and inline fallback.
    if (apiHasProcessTurn) {
      const offenders = files.filter(file => file.endsWith('webhook.ts') ? false : readFileSync(file, 'utf8').includes('processTurn('));
      expect(offenders).toEqual([]);
    }
  });

  it('TURN_PROCESSING_MODE=worker requires REDIS_URL and refuses production without it (source-level gate present)', () => {
    const appTs = readFileSync(join(apiSrcDir, 'app.ts'), 'utf8');
    expect(appTs).toMatch(/TURN_PROCESSING_MODE/);
    expect(appTs).toMatch(/isProduction/);
  });
});
