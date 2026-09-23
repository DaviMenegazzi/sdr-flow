import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Download } from 'lucide-react';
import { Modal, Badge, Button, Skeleton, SkeletonText, type BadgeProps } from '../components/ui';
import { useSession } from '../session';
import type { ExecutionDetail, ExecutionStatus, ExecutionStep } from './types';
import { buildExecutionExport, createExecutionExportFilename, downloadJson } from './export';

interface ExecutionDetailModalProps {
  executionId: string | null;
  onClose: () => void;
}

const STATUS_BADGE: Record<ExecutionStatus, { variant: NonNullable<BadgeProps['variant']>; label: string }> = {
  completed: { variant: 'success', label: 'Concluída' },
  failed: { variant: 'danger', label: 'Falhou' },
  running: { variant: 'warning', label: 'Executando' },
  queued: { variant: 'default', label: 'Na fila' },
  waiting: { variant: 'info', label: 'Aguardando' },
};

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function ExecutionDetailModal({ executionId, onClose }: ExecutionDetailModalProps) {
  const { session, activeOrg } = useSession();
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  useEffect(() => {
    if (!executionId) return;
    setExpandedStep(null);
    if (!activeOrg || !session?.access_token) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setDetail(null);
    setSteps([]);
    fetch(`/api/organizations/${activeOrg}/executions/${executionId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `Erro ${res.status} ao carregar execução.`);
        }
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        setDetail(data.execution);
        setSteps(Array.isArray(data.steps) ? data.steps : []);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao carregar execução.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [executionId, activeOrg, session?.access_token]);

  return (
    <Modal
      isOpen={Boolean(executionId)}
      onClose={onClose}
      title="Detalhe da execução"
      description={
        detail?.flow_version?.flow ? `${detail.flow_version.flow.name} · v${detail.flow_version.version}` : undefined
      }
      maxWidth="4xl"
      footer={
        detail && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadJson(createExecutionExportFilename(detail), buildExecutionExport(detail, steps))}
            title="Inclui o fluxo, todos os passos com entrada/saída e erros"
          >
            <Download size={14} /> Baixar fluxo completo (JSON)
          </Button>
        )
      }
    >
      {loading && (
        <div role="status" aria-live="polite" className="space-y-4 py-1">
          <span className="sr-only">Carregando execução…</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="rounded-lg border border-border bg-surface-elevated/50 p-3">
                <Skeleton className="mb-2 h-2.5 w-16" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ))}
          </div>
          <Skeleton className="h-5 w-20" rounded="full" />
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <Skeleton className="h-4 w-4 shrink-0" rounded="full" />
                <SkeletonText lines={2} className="flex-1" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 mb-4 rounded-lg bg-danger-bg border border-danger-border text-danger text-xs flex items-center gap-2">
          <AlertCircle size={15} className="flex-shrink-0" /> <span>{error}</span>
        </div>
      )}

      {detail && !loading && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <SummaryItem label="Lead" value={detail.lead?.name || detail.lead?.phone || '—'} />
            <SummaryItem label="Instância" value={detail.connection?.name || '—'} />
            <SummaryItem label="Agente" value={detail.agent?.name || '—'} />
            <SummaryItem label="Modelo" value={detail.model || '—'} />
            <SummaryItem
              label="Tokens"
              value={`${detail.input_tokens + detail.output_tokens} (${detail.input_tokens} in / ${detail.output_tokens} out)`}
            />
            <SummaryItem label="Duração" value={formatDuration(detail.created_at, detail.finished_at)} />
          </div>

          <Badge variant={STATUS_BADGE[detail.status]?.variant || 'default'} size="sm" className="self-start">
            {STATUS_BADGE[detail.status]?.label || detail.status}
          </Badge>

          {detail.trace_status === 'pending' && (
            <div className="p-2.5 rounded-lg bg-warning-bg border border-warning-border text-warning text-xs flex items-center gap-2">
              <AlertCircle size={14} className="flex-shrink-0" />
              <span>O registro completo desta execução ainda está sendo gravado — alguns passos abaixo podem estar faltando. Atualize em instantes.</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-content-secondary">Passo a passo</span>
            {steps.length === 0 ? (
              <p className="text-xs text-content-muted m-0">Nenhum passo registrado para esta execução.</p>
            ) : (
              steps.map((step, index) => {
                const node = detail.flow_version?.nodes.find(n => n.id === step.node_id);
                const failed = Boolean(step.error);
                const expanded = expandedStep === step.id;
                return (
                  <div key={step.id} className="rounded-lg border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedStep(expanded ? null : step.id)}
                      className="w-full flex items-center gap-2.5 p-2.5 text-left hover:bg-surface-elevated/60 transition-colors cursor-pointer"
                    >
                      {failed ? (
                        <AlertCircle size={15} className="text-danger flex-shrink-0" />
                      ) : (
                        <CheckCircle2 size={15} className="text-success flex-shrink-0" />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block text-2xs text-content-muted uppercase tracking-wide">
                          Passo {index + 1} · {node?.type || 'nó desconhecido'}
                        </span>
                        <span className="block text-xs font-semibold text-content-primary truncate">
                          {node?.label || step.node_id}
                        </span>
                      </span>
                      <span className="text-2xs text-content-muted flex-shrink-0 max-w-[160px] truncate">
                        {failed ? step.error || 'Falhou' : `${step.duration_ms ?? 0} ms`}
                      </span>
                      <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                    {expanded && (
                      <div className="p-3 pt-0 flex flex-col gap-2 bg-surface-subtle/40 border-t border-border">
                        {step.error && (
                          <div className="p-2 rounded-md bg-danger-bg border border-danger-border text-danger text-2xs">
                            {step.error}
                          </div>
                        )}
                        <StepJson label="Entrada do bloco" value={step.input} />
                        <StepJson label="Saída do bloco" value={step.output} />
                        <div className="text-2xs font-mono text-content-muted">ID do nó: {step.node_id}</div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-surface-elevated/50 border border-border/60">
      <span className="block text-2xs font-semibold uppercase tracking-wide text-content-muted">{label}</span>
      <span className="block text-xs font-semibold text-content-primary mt-0.5 truncate" title={value}>
        {value}
      </span>
    </div>
  );
}

function StepJson({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="text-2xs">
      <summary className="cursor-pointer text-content-secondary font-medium">{label}</summary>
      <pre className="mt-1.5 p-2 rounded-md bg-surface border border-border overflow-x-auto text-content-muted whitespace-pre-wrap break-words">
        {JSON.stringify(value ?? null, null, 2)}
      </pre>
    </details>
  );
}
