import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Download, LoaderCircle, RefreshCw, ScrollText } from 'lucide-react';
import { useSession } from '../session';
import { useInstance } from '../context/InstanceContext';
import { Badge, Button, Card, TableSkeleton, type BadgeProps } from '../components/ui';
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

const STATUS_BADGE: Record<ExecutionStatus, { variant: NonNullable<BadgeProps['variant']>; label: string }> = {
  completed: { variant: 'success', label: 'Concluída' },
  failed: { variant: 'danger', label: 'Falhou' },
  running: { variant: 'warning', label: 'Executando' },
  queued: { variant: 'default', label: 'Na fila' },
  waiting: { variant: 'info', label: 'Aguardando' },
};

const STATUS_OPTIONS: Array<{ value: ExecutionStatus | ''; label: string }> = [
  { value: '', label: 'Todos os status' },
  { value: 'completed', label: 'Concluída' },
  { value: 'failed', label: 'Falhou' },
  { value: 'running', label: 'Executando' },
  { value: 'waiting', label: 'Aguardando' },
  { value: 'queued', label: 'Na fila' },
];

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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

  const loadExecutions = useCallback(async () => {
    if (!activeOrg || !session?.access_token || !connectionId) {
      setExecutions([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setSelectedIds(new Set());
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

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 bg-canvas text-content">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand mb-1">
              <ScrollText className="w-3.5 h-3.5" /> INTELIGÊNCIA & DADOS
            </div>
            <h1 className="text-2xl font-bold text-content tracking-tight">Logs de Execução</h1>
            <p className="text-sm text-content-secondary max-w-2xl mt-1">
              Toda ativação de fluxo da instância{' '}
              <strong className="text-content-primary">{currentInstance?.name || 'selecionada'}</strong>: lead, quando
              rodou, modelo usado, tokens gastos e o passo a passo completo.
            </p>
          </div>
        </div>

        {!connectionId ? (
          <Card className="p-4 bg-surface border-border">
            <p className="text-xs text-content-muted m-0">
              Nenhuma instância conectada selecionada. Escolha uma instância no topo da página para ver seu histórico de execuções.
            </p>
          </Card>
        ) : (
          <>
            <Card className="p-4 bg-surface border-border">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-content-secondary">Status</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as ExecutionStatus | '')}
                    className="w-auto shrink-0 text-xs py-1.5 px-2.5 rounded-lg bg-surface-elevated border border-border text-content-primary outline-none focus:border-brand"
                  >
                    {STATUS_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-content-secondary">De</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="text-xs py-1.5 px-2.5 rounded-lg bg-surface-elevated border border-border text-content-primary outline-none focus:border-brand"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-content-secondary">Até</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="text-xs py-1.5 px-2.5 rounded-lg bg-surface-elevated border border-border text-content-primary outline-none focus:border-brand"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void loadExecutions()}
                  className="p-1.5 rounded-lg text-xs bg-surface-elevated border border-border hover:bg-surface text-content-secondary hover:text-content-primary transition-colors cursor-pointer flex items-center gap-1.5"
                  title="Recarregar"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Recarregar
                </button>
              </div>
            </Card>

            {error && (
              <div className="p-3 rounded-lg bg-danger-bg border border-danger-border text-danger text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> <span>{error}</span>
              </div>
            )}

            {selectedIds.size > 0 && (
              <div className="p-2.5 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-content-primary">
                  {selectedIds.size} execuç{selectedIds.size === 1 ? 'ão selecionada' : 'ões selecionadas'}
                </span>
                <Button variant="primary" size="sm" loading={bulkDownloading} onClick={() => void downloadSelected()}>
                  <Download size={14} /> Baixar selecionados (JSON)
                </Button>
              </div>
            )}

            <Card className="p-0 bg-surface border-border overflow-hidden">
              {loading && executions.length === 0 ? (
                <TableSkeleton columns={9} rows={6} />
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-muted/50 border-b border-border text-content-muted">
                      <th className="py-2.5 px-4 font-medium w-8">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAll}
                          aria-label="Selecionar todas as execuções desta página"
                          className="cursor-pointer"
                        />
                      </th>
                      <th className="py-2.5 px-4 font-medium">Lead</th>
                      <th className="py-2.5 px-4 font-medium">Data/Hora</th>
                      <th className="py-2.5 px-4 font-medium">Modelo</th>
                      <th className="py-2.5 px-4 font-medium">Tokens</th>
                      <th className="py-2.5 px-4 font-medium">Status</th>
                      <th className="py-2.5 px-4 font-medium">Fluxo</th>
                      <th className="py-2.5 px-4 font-medium">Duração</th>
                      <th className="py-2.5 px-4 font-medium text-right">Baixar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {executions.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-6 px-4 text-center text-content-muted">
                          Nenhuma execução registrada para esta instância com os filtros atuais.
                        </td>
                      </tr>
                    ) : (
                      executions.map(exec => (
                        <tr
                          key={exec.id}
                          className="hover:bg-surface-muted/40 transition-colors cursor-pointer"
                          onClick={() => setSelectedExecutionId(exec.id)}
                        >
                          <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(exec.id)}
                              onChange={() => toggleSelected(exec.id)}
                              aria-label="Selecionar execução"
                              className="cursor-pointer"
                            />
                          </td>
                          <td className="py-3 px-4 font-semibold text-content">
                            {exec.lead?.name || exec.lead?.phone || '—'}
                          </td>
                          <td className="py-3 px-4 text-content-secondary">
                            {new Date(exec.created_at).toLocaleString('pt-BR')}
                          </td>
                          <td className="py-3 px-4 font-mono text-content-secondary">{exec.model || '—'}</td>
                          <td className="py-3 px-4 text-content-secondary">
                            {exec.input_tokens + exec.output_tokens}
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant={STATUS_BADGE[exec.status]?.variant || 'default'} size="sm">
                              {STATUS_BADGE[exec.status]?.label || exec.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-content-secondary">
                            {exec.flow_version?.flow?.name
                              ? `${exec.flow_version.flow.name} · v${exec.flow_version.version}`
                              : '—'}
                          </td>
                          <td className="py-3 px-4 text-content-secondary">
                            {formatDuration(exec.created_at, exec.finished_at)}
                          </td>
                          <td className="py-3 px-4 text-right" onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => void downloadOne(exec.id)}
                              disabled={downloadingId === exec.id}
                              title="Baixar fluxo completo desta execução (JSON)"
                              className="p-1.5 rounded-lg text-content-muted hover:text-content-primary hover:bg-surface-elevated transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {downloadingId === exec.id ? (
                                <LoaderCircle size={14} className="animate-spin" />
                              ) : (
                                <Download size={14} />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              )}
            </Card>

            {total > 0 && (
              <div className="flex items-center justify-between text-xs text-content-muted">
                <span>
                  {total} execuç{total === 1 ? 'ão' : 'ões'} · página {page} de {pageCount}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={offset === 0}
                    onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
                    className="p-1.5 rounded-lg bg-surface-elevated border border-border hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed text-content-secondary hover:text-content-primary transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                  </button>
                  <button
                    type="button"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => setOffset(o => o + PAGE_SIZE)}
                    className="p-1.5 rounded-lg bg-surface-elevated border border-border hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed text-content-secondary hover:text-content-primary transition-colors cursor-pointer flex items-center gap-1"
                  >
                    Próxima <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ExecutionDetailModal executionId={selectedExecutionId} onClose={() => setSelectedExecutionId(null)} />
    </div>
  );
}
