import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Download, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useSession } from '../session';
import { useInstance } from '../context/InstanceContext';
import {
  Button,
  Checkbox,
  DateRangePicker,
  DEFAULT_PRESETS,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  SegmentedControl,
  TableSkeleton,
  Tooltip,
  type DateRange,
} from '../components/ui';
import { formatDateTime, formatNumber, formatPhone, formatRelative } from '../lib/format';
import { ExecutionDetailModal } from './ExecutionDetailModal';
import type { ExecutionDetail, ExecutionListItem, ExecutionStatus, ExecutionStep } from './types';
import {
  buildExecutionBatchExport,
  buildExecutionExport,
  createExecutionBatchFilename,
  createExecutionExportFilename,
  downloadJson,
} from './export';

const PAGE_SIZE = 50;

const STATUS_META: Record<ExecutionStatus, { dot: string; label: string }> = {
  completed: { dot: 'bg-success', label: 'Concluída' },
  failed: { dot: 'bg-danger', label: 'Falhou' },
  running: { dot: 'bg-warning', label: 'Executando' },
  queued: { dot: 'bg-content-muted', label: 'Na fila' },
  waiting: { dot: 'bg-info', label: 'Aguardando' },
};

const STATUS_FILTERS: Array<{ value: ExecutionStatus | ''; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'failed', label: 'Falhas' },
  { value: 'running', label: 'Executando' },
  { value: 'waiting', label: 'Aguardando' },
];

const LOG_PRESETS = [{ key: '24h', label: 'Últimas 24 horas', days: 1 }, ...DEFAULT_PRESETS.filter(p => p.key !== 'today')];

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

export function ExecutionLogPage() {
  const { session, activeOrg } = useSession();
  const { currentInstance } = useInstance();

  const [executions, setExecutions] = useState<ExecutionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<ExecutionStatus | ''>('');
  const [range, setRange] = useState<DateRange>({ start: '', end: '', preset: 'all' });
  const startDate = range.start;
  const endDate = range.end;
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);

  const connectionId = currentInstance?.id;

  // Any filter change starts back at page 1 — an old offset could point past the new result set.
  useEffect(() => {
    setOffset(0);
  }, [connectionId, status, startDate, endDate]);

  const fetchExecutionDetail = useCallback(
    async (id: string): Promise<{ execution: ExecutionDetail; steps: ExecutionStep[] }> => {
      if (!activeOrg || !session?.access_token) throw new Error('Sessão indisponível.');
      const res = await fetch(`/api/organizations/${activeOrg}/executions/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Erro ${res.status} ao carregar execução.`);
      }
      const data = await res.json();
      return { execution: data.execution as ExecutionDetail, steps: Array.isArray(data.steps) ? (data.steps as ExecutionStep[]) : [] };
    },
    [activeOrg, session?.access_token]
  );

  async function downloadOne(id: string) {
    setDownloadingId(id);
    setError('');
    try {
      const { execution, steps } = await fetchExecutionDetail(id);
      downloadJson(createExecutionExportFilename(execution), buildExecutionExport(execution, steps));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao baixar execução.');
    } finally {
      setDownloadingId(null);
    }
  }

  async function downloadSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDownloading(true);
    setError('');
    try {
      const results = await Promise.allSettled(ids.map(id => fetchExecutionDetail(id)));
      const items = results
        .filter((r): r is PromiseFulfilledResult<{ execution: ExecutionDetail; steps: ExecutionStep[] }> => r.status === 'fulfilled')
        .map(r => r.value);
      if (items.length > 0) {
        downloadJson(createExecutionBatchFilename(items.length), buildExecutionBatchExport(items));
      }
      const failedCount = results.length - items.length;
      if (failedCount > 0) {
        setError(`${failedCount} de ${ids.length} execuções selecionadas não puderam ser baixadas.`);
      }
      setSelectedIds(new Set());
    } finally {
      setBulkDownloading(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleSelected = executions.length > 0 && executions.every(exec => selectedIds.has(exec.id));
  function toggleSelectAll() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(executions.map(exec => exec.id)));
  }

  const loadExecutions = useCallback(async (silent = false) => {
    if (!activeOrg || !session?.access_token || !connectionId) {
      setExecutions([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
      setSelectedIds(new Set());
    }
    setError('');
    try {
      const params = new URLSearchParams({ connectionId, limit: String(PAGE_SIZE), offset: String(offset) });
      if (status) params.set('status', status);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`/api/organizations/${activeOrg}/executions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Erro ${res.status} ao carregar execuções.`);
      }
      const data = await res.json();
      setExecutions(Array.isArray(data.executions) ? data.executions : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar execuções.');
      setExecutions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeOrg, session?.access_token, connectionId, status, startDate, endDate, offset]);

  useEffect(() => {
    void loadExecutions();
  }, [loadExecutions]);

  // While something is still running, keep the page fresh instead of asking for a manual reload.
  const hasActive = executions.some(exec => exec.status === 'running' || exec.status === 'queued' || exec.status === 'waiting');
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void loadExecutions(true), 30_000);
    return () => window.clearInterval(timer);
  }, [hasActive, loadExecutions]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selecting = selectedIds.size > 0;
  const someVisibleSelected = executions.some(exec => selectedIds.has(exec.id));

  return (
    <PageContainer>
      <PageHeader
        title="Logs de Execução"
        description={
          connectionId
            ? `Cada vez que um fluxo rodou em ${currentInstance?.name || 'esta instância'}: lead, resultado e o passo a passo.`
            : undefined
        }
        toolbar={
          connectionId ? (
            <>
              <SegmentedControl<ExecutionStatus | ''>
                aria-label="Status"
                value={status}
                onChange={setStatus}
                options={STATUS_FILTERS.map(f => ({ value: f.value, label: f.label }))}
              />
              <DateRangePicker value={range} onChange={setRange} presets={LOG_PRESETS} allowAll />
              <div className="ml-auto flex items-center gap-2 text-2xs text-content-muted">
                {hasActive && <span>Atualiza sozinho a cada 30 s</span>}
                <IconButton
                  label="Recarregar"
                  icon={<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />}
                  onClick={() => void loadExecutions()}
                />
              </div>
            </>
          ) : undefined
        }
      />

      {!connectionId ? (
        <EmptyState
          title="Escolha uma instância"
          description="Selecione um número no topo da página para ver o histórico de execuções dele."
        />
      ) : (
        <>
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger-border bg-danger-bg p-3 text-xs text-danger">
              <AlertCircle size={16} className="flex-shrink-0" /> <span>{error}</span>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {loading && executions.length === 0 ? (
              <TableSkeleton columns={6} rows={6} />
            ) : executions.length === 0 ? (
              <EmptyState
                title="Nenhuma execução"
                description={
                  status || range.start || range.end
                    ? 'Nada com estes filtros. Tente outro período ou status.'
                    : 'Quando um lead mandar mensagem e um fluxo publicado rodar, ele aparece aqui.'
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="group/table w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-2xs text-content-muted">
                      <th className="w-10 py-2 pl-4 pr-0 font-medium">
                        <span className={selecting ? '' : 'opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100 group-hover/table:opacity-100 [@media(hover:none)]:opacity-100'}>
                          <Checkbox
                            checked={allVisibleSelected}
                            indeterminate={someVisibleSelected && !allVisibleSelected}
                            onChange={toggleSelectAll}
                            aria-label="Selecionar todas as execuções desta página"
                          />
                        </span>
                      </th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Lead</th>
                      <th className="hidden px-3 py-2 font-medium md:table-cell">Fluxo</th>
                      <th className="px-3 py-2 font-medium">Quando</th>
                      <th className="px-3 py-2 text-right font-medium">Duração</th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map(exec => {
                      const meta = STATUS_META[exec.status];
                      const checked = selectedIds.has(exec.id);
                      const tokens = exec.input_tokens + exec.output_tokens;
                      return (
                        <tr
                          key={exec.id}
                          tabIndex={0}
                          aria-label={`Abrir execução de ${exec.lead?.name || exec.lead?.phone || 'lead'}`}
                          onClick={() => setSelectedExecutionId(exec.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') setSelectedExecutionId(exec.id);
                            if (e.key === ' ') {
                              e.preventDefault();
                              toggleSelected(exec.id);
                            }
                          }}
                          className={`group cursor-pointer border-b border-border last:border-0 outline-none transition-colors hover:bg-surface-elevated focus-visible:bg-surface-elevated ${
                            checked ? 'bg-brand/5' : ''
                          }`}
                        >
                          <td className="py-2.5 pl-4 pr-0" onClick={e => e.stopPropagation()}>
                            <span
                              className={`transition-opacity ${
                                selecting || checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'
                              }`}
                            >
                              <Checkbox checked={checked} onChange={() => toggleSelected(exec.id)} aria-label="Selecionar execução" tabIndex={-1} />
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span className="inline-flex items-center gap-1.5 font-medium text-content">
                              <span className={`h-2 w-2 rounded-full ${meta?.dot ?? 'bg-content-muted'}`} aria-hidden="true" />
                              {meta?.label ?? exec.status}
                            </span>
                          </td>
                          <td className="max-w-[220px] px-3 py-2.5">
                            <p className="m-0 truncate font-medium text-content">{exec.lead?.name || formatPhone(exec.lead?.phone) || '—'}</p>
                            {exec.lead?.name && <p className="m-0 truncate text-2xs text-content-muted">{formatPhone(exec.lead.phone)}</p>}
                          </td>
                          <td className="hidden max-w-[220px] truncate px-3 py-2.5 text-content-secondary md:table-cell">
                            {exec.flow_version?.flow?.name ? `${exec.flow_version.flow.name} · v${exec.flow_version.version}` : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-content-secondary">
                            <Tooltip content={`${formatDateTime(exec.created_at)}${tokens ? ` · ${formatNumber(tokens)} tokens` : ''}`}>
                              <span>{formatRelative(exec.created_at)}</span>
                            </Tooltip>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-content-secondary">
                            {formatDuration(exec.created_at, exec.finished_at)}
                          </td>
                          <td className="py-1 pr-2 text-right" onClick={e => e.stopPropagation()}>
                            <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                              <IconButton
                                label="Baixar JSON desta execução"
                                size="sm"
                                tabIndex={-1}
                                disabled={downloadingId === exec.id}
                                onClick={() => void downloadOne(exec.id)}
                                icon={downloadingId === exec.id ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
                              />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {total > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs text-content-muted">
              <span className="tabular-nums">
                {formatNumber(total)} {total === 1 ? 'execução' : 'execuções'}
                {pageCount > 1 && ` · página ${page} de ${pageCount}`}
              </span>
              {pageCount > 1 && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}>
                    <ChevronLeft size={14} /> Anterior
                  </Button>
                  <Button size="sm" variant="ghost" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(o => o + PAGE_SIZE)}>
                    Próxima <ChevronRight size={14} />
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Bulk actions float in only while something is selected. */}
      {selecting && (
        <div className="motion-popover fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 shadow-modal">
          <span className="text-xs font-medium tabular-nums text-content">
            {selectedIds.size} {selectedIds.size === 1 ? 'selecionada' : 'selecionadas'}
          </span>
          <Button size="sm" variant="primary" loading={bulkDownloading} onClick={() => void downloadSelected()}>
            <Download size={14} /> Baixar JSON
          </Button>
          <IconButton label="Limpar seleção" size="sm" icon={<X size={14} />} onClick={() => setSelectedIds(new Set())} />
        </div>
      )}

      <ExecutionDetailModal executionId={selectedExecutionId} onClose={() => setSelectedExecutionId(null)} />
    </PageContainer>
  );
}
