import type { ExecutionDetail, ExecutionStep } from './types';

function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function timestampFor(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

export function buildExecutionExport(execution: ExecutionDetail, steps: ExecutionStep[]) {
  return {
    schemaVersion: 'sdr-flow.execution-log.v1',
    exportedAt: new Date().toISOString(),
    sensitiveDataWarning: 'Este arquivo pode conter dados pessoais, prompts, entradas e saídas do agente.',
    execution,
    steps,
  };
}

export function createExecutionExportFilename(execution: ExecutionDetail): string {
  const label = slugify(execution.lead?.name || execution.lead?.phone || 'execucao', 'execucao');
  return `sdr-execucao-${label}-${timestampFor(execution.created_at)}-${execution.id.slice(0, 8)}.json`;
}

export function buildExecutionBatchExport(items: Array<{ execution: ExecutionDetail; steps: ExecutionStep[] }>) {
  return {
    schemaVersion: 'sdr-flow.execution-log-batch.v1',
    exportedAt: new Date().toISOString(),
    sensitiveDataWarning: 'Este arquivo pode conter dados pessoais, prompts, entradas e saídas do agente.',
    count: items.length,
    executions: items,
  };
}

export function createExecutionBatchFilename(count: number): string {
  return `sdr-execucoes-${count}-${timestampFor(new Date().toISOString())}.json`;
}

export function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}
