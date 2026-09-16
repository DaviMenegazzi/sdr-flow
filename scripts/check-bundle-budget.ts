// Reads apps/web/dist (after `pnpm --filter @sdr/web build`) and checks JS bundle size
// against the budgets in docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md section 11.5 / 13.3.
// Tracks a baseline file so regressions >10% fail even before the absolute budget is hit.
//
// Usage: tsx scripts/check-bundle-budget.ts [--dist=apps/web/dist] [--enforce] [--update-baseline]
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

export const INITIAL_JS_GZIP_BUDGET_BYTES = 180 * 1024;
export const ROUTE_CHUNK_GZIP_BUDGET_BYTES = 250 * 1024;
export const REGRESSION_THRESHOLD = 0.10;

interface CliArgs {
  dist: string;
  enforce: boolean;
  updateBaseline: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dist: 'apps/web/dist', enforce: false, updateBaseline: false };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'dist' && value) args.dist = value;
    if (key === 'enforce') args.enforce = true;
    if (key === 'update-baseline') args.updateBaseline = true;
  }
  return args;
}

export interface ChunkInfo {
  file: string;
  bytes: number;
  gzipBytes: number;
  isInitial: boolean;
}

export interface BundleBudgetEvaluation {
  initialGzipTotal: number;
  overRouteBudget: ChunkInfo[];
  regressionPct: number | null;
  violations: string[];
}

// Pure decision logic, split out from main()'s file I/O so it's directly unit-testable
// (11.6.11: "teste de build verifica orçamento") without invoking a real `vite build`.
export function evaluateBundleBudget(chunks: ChunkInfo[], baseline?: { initialGzipTotal: number }): BundleBudgetEvaluation {
  const initialGzipTotal = chunks.filter(c => c.isInitial).reduce((sum, c) => sum + c.gzipBytes, 0);
  const overRouteBudget = chunks.filter(c => !c.isInitial && c.gzipBytes > ROUTE_CHUNK_GZIP_BUDGET_BYTES);
  const regressionPct = baseline ? (initialGzipTotal - baseline.initialGzipTotal) / baseline.initialGzipTotal : null;

  const violations = [
    ...(initialGzipTotal > INITIAL_JS_GZIP_BUDGET_BYTES
      ? [`initial JS gzip ${Math.round(initialGzipTotal / 1024)}kB exceeds budget ${INITIAL_JS_GZIP_BUDGET_BYTES / 1024}kB`]
      : []),
    ...overRouteBudget.map(c => `${c.file} gzip ${Math.round(c.gzipBytes / 1024)}kB exceeds route-chunk budget ${ROUTE_CHUNK_GZIP_BUDGET_BYTES / 1024}kB`),
    ...(baseline && regressionPct !== null && regressionPct > REGRESSION_THRESHOLD
      ? [`initial JS gzip regressed ${Math.round(regressionPct * 1000) / 10}% vs approved baseline`]
      : []),
  ];

  return { initialGzipTotal, overRouteBudget, regressionPct, violations };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const assetsDir = path.join(args.dist, 'assets');
  const indexHtml = await readFile(path.join(args.dist, 'index.html'), 'utf8').catch(() => '');
  const entryScripts = new Set(
    Array.from(indexHtml.matchAll(/<script[^>]+src="\/?assets\/([^"]+)"/g)).map(m => m[1]!)
  );

  const files = (await readdir(assetsDir).catch(() => [])).filter(f => f.endsWith('.js'));
  if (files.length === 0) {
    console.error(`No JS assets found in ${assetsDir}. Run "pnpm --filter @sdr/web build" first.`);
    process.exit(1);
  }

  const chunks: ChunkInfo[] = [];
  for (const file of files) {
    const buf = await readFile(path.join(assetsDir, file));
    const gzip = gzipSync(buf, { level: 9 });
    chunks.push({ file, bytes: buf.byteLength, gzipBytes: gzip.byteLength, isInitial: entryScripts.has(file) || entryScripts.size === 0 });
  }

  const baselinePath = path.join(args.dist, '..', '.bundle-baseline.json');
  let baseline: { initialGzipTotal: number } | undefined;
  try {
    baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  } catch {
    baseline = undefined;
  }

  const evaluation = evaluateBundleBudget(chunks, baseline);
  const { initialGzipTotal, regressionPct, violations } = evaluation;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    chunks: chunks
      .sort((a, b) => b.gzipBytes - a.gzipBytes)
      .map(c => ({ file: c.file, kB: Math.round(c.bytes / 1024 * 10) / 10, gzipKB: Math.round(c.gzipBytes / 1024 * 10) / 10, isInitial: c.isInitial })),
    initialJsGzipKB: Math.round(initialGzipTotal / 1024 * 10) / 10,
    budgets: {
      initialJsGzipBudgetKB: INITIAL_JS_GZIP_BUDGET_BYTES / 1024,
      routeChunkGzipBudgetKB: ROUTE_CHUNK_GZIP_BUDGET_BYTES / 1024,
      regressionThresholdPct: REGRESSION_THRESHOLD * 100,
    },
    baselineInitialJsGzipKB: baseline ? Math.round(baseline.initialGzipTotal / 1024 * 10) / 10 : null,
    regressionPct: regressionPct !== null ? Math.round(regressionPct * 1000) / 10 : null,
    violations,
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.updateBaseline || !baseline) {
    await writeFile(baselinePath, JSON.stringify({ initialGzipTotal, savedAt: new Date().toISOString() }, null, 2));
    console.error(`Baseline ${baseline ? 'updated' : 'created'} at ${baselinePath}`);
  }

  if (args.enforce && report.violations.length > 0) {
    console.error(`Bundle budget FAILED: ${report.violations.length} violation(s).`);
    process.exit(1);
  }
}

// Only run when executed directly (`tsx scripts/check-bundle-budget.ts`) — tests/bundle-budget.test.ts
// imports this module for its pure functions (evaluateBundleBudget etc.) and must not also trigger
// a real dist/ read, which fails before `pnpm build` has run in the `pnpm check` chain.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
