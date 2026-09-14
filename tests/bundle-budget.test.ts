import { describe, expect, it } from 'vitest';
import {
  evaluateBundleBudget,
  INITIAL_JS_GZIP_BUDGET_BYTES,
  ROUTE_CHUNK_GZIP_BUDGET_BYTES,
  type ChunkInfo,
} from '../scripts/check-bundle-budget.js';

// Fase 5 (11.5, 11.6.11): the CI gate's decision logic, tested against fabricated chunk sizes
// instead of a real `vite build` — fast, and pins the exact thresholds from section 11.5.

function chunk(file: string, gzipBytes: number, isInitial = false): ChunkInfo {
  return { file, bytes: gzipBytes * 3, gzipBytes, isInitial };
}

describe('evaluateBundleBudget', () => {
  it('passes when initial JS is under budget and no route chunk exceeds its own budget', () => {
    const chunks = [chunk('index.js', 60 * 1024, true), chunk('Dashboard.js', 100 * 1024)];
    const result = evaluateBundleBudget(chunks);
    expect(result.violations).toEqual([]);
    expect(result.initialGzipTotal).toBe(60 * 1024);
  });

  it('flags a violation when initial JS gzip exceeds the 180kB budget', () => {
    const chunks = [chunk('index.js', INITIAL_JS_GZIP_BUDGET_BYTES + 1024, true)];
    const result = evaluateBundleBudget(chunks);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('exceeds budget 180kB');
  });

  it('flags a violation when a route chunk exceeds the 250kB budget without being initial', () => {
    const chunks = [chunk('index.js', 50 * 1024, true), chunk('Builder.js', ROUTE_CHUNK_GZIP_BUDGET_BYTES + 1024)];
    const result = evaluateBundleBudget(chunks);
    expect(result.overRouteBudget.map(c => c.file)).toEqual(['Builder.js']);
    expect(result.violations.some(v => v.includes('Builder.js'))).toBe(true);
  });

  it('does not penalize a non-initial chunk merely for being large under the route budget', () => {
    const chunks = [chunk('index.js', 50 * 1024, true), chunk('Dashboard.js', 200 * 1024)];
    const result = evaluateBundleBudget(chunks);
    expect(result.violations).toEqual([]);
  });

  it('flags a regression when initial JS grows more than 10% versus the approved baseline', () => {
    const baseline = { initialGzipTotal: 100 * 1024 };
    const chunks = [chunk('index.js', 115 * 1024, true)]; // +15%
    const result = evaluateBundleBudget(chunks, baseline);
    expect(result.regressionPct).toBeCloseTo(0.15, 2);
    expect(result.violations.some(v => v.includes('regressed'))).toBe(true);
  });

  it('does not flag a regression within the 10% threshold, or an improvement', () => {
    const baseline = { initialGzipTotal: 100 * 1024 };
    const withinThreshold = evaluateBundleBudget([chunk('index.js', 108 * 1024, true)], baseline);
    expect(withinThreshold.violations).toEqual([]);

    const improved = evaluateBundleBudget([chunk('index.js', 60 * 1024, true)], baseline);
    expect(improved.regressionPct).toBeLessThan(0);
    expect(improved.violations).toEqual([]);
  });

  it('treats a chunk as initial when no baseline exists yet, matching the real script’s first-run behavior', () => {
    // Mirrors main(): entryScripts.size === 0 marks every chunk isInitial (no baseline to compare).
    const result = evaluateBundleBudget([chunk('index.js', 50 * 1024)]);
    expect(result.regressionPct).toBeNull();
  });
});
