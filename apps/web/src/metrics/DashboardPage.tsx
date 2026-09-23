import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowDown, ArrowUp, BarChart3, Download, MoreHorizontal, RefreshCw, TrendingUp, Workflow } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { useSession } from '../session';
import { useInstance } from '../context/InstanceContext';
import {
  DateRangePicker,
  DEFAULT_PRESETS,
  DropdownMenu,
  EmptyState,
  IconButton,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  TableSkeleton,
  Tooltip,
  describeRange,
  previousRange,
  rangeFromPreset,
  toast,
  type DateRange,
} from '../components/ui';
import { formatCompact, formatDuration, formatNumber, formatTime, formatUsd } from '../lib/format';

interface FunnelStep {
  stage: string;
  label: string;
  count: number;
  percentage: number;
}

interface FlowComp {
  flowVersionId: string | null;
  flowName: string;
  version: number;
  conversationsCount: number;
  qualifiedCount: number;
  qualificationRate: number;
  avgResponseTimeSec: number;
  totalTokens: number;
  totalCost: number;
}

interface DailyTrend {
  date: string;
  conversations: number;
  qualified: number;
  handoff: number;
  tokens: number;
  cost: number;
}

interface DashboardData {
  totalConversations: number;
  newConversations: number;
  qualifiedConversations: number;
  qualificationRate: number;
  handoffConversations: number;
  avgFirstResponseTimeSec: number;
  totalTokens: number;
  totalEstimatedCost: number;
  costPerQualifiedLead: number;
  funnel: FunnelStep[];
  flowComparison: FlowComp[];
  dailyTrends: DailyTrend[];
}

// Palettes validated with the dataviz validator (CVD separation + contrast) against each surface.
const PALETTE = {
  light: {
    ramp: ['#6cc795', '#3fb074', '#1f9460', '#127547', '#0b5a36'],
    conversations: '#2a78d6',
    qualified: '#10915a',
    grid: 'rgba(15, 23, 42, 0.08)',
    axis: '#64748b',
  },
  dark: {
    ramp: ['#0f5c37', '#1a7a4a', '#27a866', '#4fc583', '#8fe0b0'],
    conversations: '#3987e5',
    qualified: '#22a861',
    grid: 'rgba(255, 255, 255, 0.08)',
    axis: '#8b8b8b',
  },
};

/** Stages where the conversation left the funnel; shown as outcomes, not as funnel steps. */
const OUTCOME_STAGES = new Set(['HUMAN_HANDOFF', 'CLOSED']);

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function shortDate(iso: string) {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

/** Relative change, or null when there is no previous value to compare with. */
function delta(current: number, previous: number | undefined | null) {
  if (previous === undefined || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

function Delta({ value, unit = '%', invert = false }: { value: number | null; unit?: '%' | 'p.p.' | 's'; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-2xs text-content-muted">sem comparação</span>;
  const shown = unit === '%' ? Math.abs(value * 100) : Math.abs(value);
  if (shown < 0.05) return <span className="text-2xs text-content-muted">estável vs. anterior</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-2xs font-medium ${good ? 'text-success' : 'text-danger'}`}>
      <Icon size={11} strokeWidth={2.5} />
      {shown.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
      {unit === '%' ? '%' : ` ${unit}`}
      <span className="font-normal text-content-muted">&nbsp;vs. anterior</span>
    </span>
  );
}

function Kpi({ label, value, hint, children }: { label: string; value: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-4">
      <span className="text-xs text-content-secondary">{label}</span>
      <span className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-content">{value}</span>
      <div className="mt-1 min-h-[16px]">{children}</div>
      {hint && <span className="mt-0.5 text-2xs text-content-muted">{hint}</span>}
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.0001);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 28}`).join(' ');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-10 w-full" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function DashboardPage() {
  const { session, activeOrg, activeRole } = useSession();
  const { activeInstance } = useInstance();
  const dark = useIsDark();
  const colors = dark ? PALETTE.dark : PALETTE.light;
  const canConsolidate = activeRole === 'owner' || activeRole === 'admin';

  const [range, setRange] = useState<DateRange>(() => rangeFromPreset(DEFAULT_PRESETS[2]!));
  const [connections, setConnections] = useState<Array<{ id: string; name: string }>>([]);
  const [connectionId, setConnectionId] = useState<string>('all');
  const [metrics, setMetrics] = useState<DashboardData | null>(null);
  const [previous, setPrevious] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [consolidating, setConsolidating] = useState(false);

  const auth = { Authorization: `Bearer ${session?.access_token}` };

  // Instances for the filter; the one picked in the header is the default.
  useEffect(() => {
    if (!session || !activeOrg) return;
    let cancelled = false;
    fetch(`/api/organizations/${activeOrg}/connections`, { headers: auth })
      .then(res => (res.ok ? res.json() : []))
      .then((data: unknown) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? (data as Array<{ id: string; name: string }>) : [];
        setConnections(list);
        const matching = list.find(c => c.name === activeInstance || c.id === activeInstance);
        setConnectionId(matching?.id ?? 'all');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.access_token, activeOrg, activeInstance]);

  async function fetchMetrics(r: DateRange | null): Promise<DashboardData | null> {
    if (!r) return null;
    const params = new URLSearchParams();
    if (r.start) params.set('startDate', r.start);
    if (r.end) params.set('endDate', r.end);
    if (connectionId !== 'all') params.set('connectionId', connectionId);
    const res = await fetch(`/api/organizations/${activeOrg}/metrics/dashboard?${params}`, { headers: auth });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || 'Falha ao carregar indicadores.');
    }
    return res.json();
  }

  async function load() {
    if (!session || !activeOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [current, before] = await Promise.all([fetchMetrics(range), fetchMetrics(previousRange(range)).catch(() => null)]);
      setMetrics(current);
      setPrevious(before);
      setLoadedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar métricas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [session?.access_token, activeOrg, connectionId, range.start, range.end]);

  async function handleRollup() {
    setConsolidating(true);
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/metrics/rollup`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Falha na consolidação.');
      toast.success('Métricas de hoje consolidadas');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao consolidar métricas.');
    } finally {
      setConsolidating(false);
    }
  }

  async function downloadCsv(type: 'leads' | 'conversations') {
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/export/${type}.csv`, { headers: auth });
      if (!res.ok) throw new Error(`Falha ao exportar ${type === 'leads' ? 'leads' : 'conversas'}.`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro na exportação.');
    }
  }

  const funnel = useMemo(() => (metrics?.funnel ?? []).filter(step => !OUTCOME_STAGES.has(step.stage)), [metrics]);
  const outcomes = useMemo(() => (metrics?.funnel ?? []).filter(step => OUTCOME_STAGES.has(step.stage)), [metrics]);
  const funnelTop = funnel[0]?.count || 1;
  const dailyRate = (metrics?.dailyTrends ?? []).map(d => (d.conversations ? d.qualified / d.conversations : 0));
  const instanceName = connectionId === 'all' ? 'Todas as instâncias' : connections.find(c => c.id === connectionId)?.name ?? 'Instância';

  const rateDelta = metrics && previous ? metrics.qualificationRate - previous.qualificationRate : null;
  const hasData = Boolean(metrics && metrics.totalConversations > 0);

  return (
    <PageContainer wide>
      <PageHeader
        title="Indicadores"
        description={`${describeRange(range)} · ${instanceName}${loadedAt ? ` · atualizado ${formatTime(loadedAt)}` : ''}`}
        actions={
          <>
            <DropdownMenu
              aria-label="Exportar"
              width={240}
              items={[
                { label: 'Leads', description: 'Planilha CSV com todos os leads', icon: <Download size={14} />, onSelect: () => void downloadCsv('leads') },
                { label: 'Conversas', description: 'Planilha CSV com o histórico', icon: <Download size={14} />, onSelect: () => void downloadCsv('conversations') },
              ]}
              trigger={
                <button
                  type="button"
                  className="press flex h-8 min-h-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-content hover:bg-surface-elevated"
                >
                  <Download size={14} /> Exportar
                </button>
              }
            />
            {canConsolidate && (
              <DropdownMenu
                aria-label="Mais ações"
                width={260}
                items={[
                  {
                    label: consolidating ? 'Consolidando…' : 'Consolidar métricas de hoje',
                    description: 'Recalcula o dia atual agora, sem esperar a rotina noturna',
                    icon: <RefreshCw size={14} className={consolidating ? 'animate-spin' : ''} />,
                    disabled: consolidating,
                    onSelect: () => void handleRollup(),
                  },
                ]}
                trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} variant="outline" tooltip={false} />}
              />
            )}
          </>
        }
        toolbar={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Select
              appearance="chip"
              aria-label="Instância"
              prefix="Instância:"
              value={connectionId}
              onChange={setConnectionId}
              options={[{ value: 'all', label: 'Todas' }, ...connections.map(c => ({ value: c.id, label: c.name }))]}
            />
          </>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs text-danger">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="min-h-0 border-0 bg-transparent p-0 text-xs font-semibold text-danger hover:underline">
            Tentar de novo
          </button>
        </div>
      )}

      {/* KPIs: one headline number, four supporting ones. */}
      {loading && !metrics ? (
        <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_repeat(2,1fr)] xl:grid-cols-[1.4fr_repeat(4,1fr)]">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[120px] w-full" rounded="lg" />
          ))}
        </div>
      ) : (
        <div className={`mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-[1.5fr_repeat(4,1fr)] transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <div className="col-span-2 flex flex-col rounded-xl border border-border bg-surface p-4 lg:col-span-4 xl:col-span-1">
            <span className="text-xs text-content-secondary">Taxa de qualificação</span>
            <div className="mt-1.5 flex items-end justify-between gap-4">
              <div>
                <span className="text-4xl font-semibold tabular-nums tracking-tight text-content">
                  {(metrics?.qualificationRate ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </span>
                <div className="mt-1">
                  <Delta value={rateDelta} unit="p.p." />
                </div>
              </div>
              <div className="w-32 flex-shrink-0">
                <Sparkline values={dailyRate} color={colors.qualified} />
              </div>
            </div>
            <span className="mt-auto pt-2 text-2xs text-content-muted">
              {formatNumber(metrics?.qualifiedConversations)} de {formatNumber(metrics?.totalConversations)} conversas qualificadas
            </span>
          </div>
          <Kpi label="Conversas" value={formatNumber(metrics?.totalConversations)} hint={`${formatNumber(metrics?.handoffConversations)} passaram para atendentes`}>
            <Delta value={delta(metrics?.totalConversations ?? 0, previous?.totalConversations)} />
          </Kpi>
          <Kpi label="Qualificados" value={formatNumber(metrics?.qualifiedConversations)}>
            <Delta value={delta(metrics?.qualifiedConversations ?? 0, previous?.qualifiedConversations)} />
          </Kpi>
          <Kpi label="1ª resposta (média)" value={formatDuration(metrics?.avgFirstResponseTimeSec ?? 0)}>
            <Delta value={delta(metrics?.avgFirstResponseTimeSec ?? 0, previous?.avgFirstResponseTimeSec)} invert />
          </Kpi>
          <Kpi label="Custo por qualificado" value={formatUsd(metrics?.costPerQualifiedLead)} hint={`Total ${formatUsd(metrics?.totalEstimatedCost)} · ${formatCompact(metrics?.totalTokens)} tokens`}>
            <Delta value={delta(metrics?.costPerQualifiedLead ?? 0, previous?.costPerQualifiedLead)} invert />
          </Kpi>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Funnel as horizontal bars: labels stay readable, the ramp encodes depth. */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="m-0 mb-4 text-sm font-semibold text-content">Funil</h2>
          {loading && !metrics ? (
            <Skeleton className="h-56 w-full" rounded="lg" />
          ) : funnel.length > 0 && hasData ? (
            <>
              <ol className="m-0 list-none space-y-2.5 p-0">
                {funnel.map((step, i) => {
                  const ratio = step.count / funnelTop;
                  const colorIndex = funnel.length > 1 ? Math.round((i * (colors.ramp.length - 1)) / (funnel.length - 1)) : 0;
                  return (
                    <li key={step.stage}>
                        <div>
                          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate text-content-secondary">{step.label}</span>
                            <span className="flex-shrink-0 tabular-nums text-content">
                              {formatNumber(step.count)}
                              <span className="ml-1.5 text-2xs text-content-muted">{Math.round(ratio * 100)}%</span>
                            </span>
                          </div>
                          <div className="h-2.5 w-full rounded-full bg-surface-elevated">
                            <div
                              className="h-full rounded-full transition-[width] duration-500 ease-out"
                              style={{ width: `${Math.max(ratio * 100, 1.5)}%`, background: colors.ramp[colorIndex] }}
                            />
                          </div>
                        </div>
                    </li>
                  );
                })}
              </ol>
              {outcomes.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs">
                  {outcomes.map(step => (
                    <span key={step.stage} className="text-content-secondary">
                      {step.label}: <span className="tabular-nums font-medium text-content">{formatNumber(step.count)}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={<BarChart3 size={18} />}
              title="Sem dados de funil no período"
              description="O funil aparece quando as conversas passam pelos estágios do fluxo publicado."
              action={<Link to="/connections" className="text-xs font-semibold text-brand-fg hover:underline">Conectar WhatsApp</Link>}
            />
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="m-0 mb-4 text-sm font-semibold text-content">Conversas por dia</h2>
          {loading && !metrics ? (
            <Skeleton className="h-56 w-full" rounded="lg" />
          ) : metrics?.dailyTrends && metrics.dailyTrends.length > 0 ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics.dailyTrends} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke={colors.grid} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    fontSize={11}
                    stroke={colors.axis}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis fontSize={11} allowDecimals={false} stroke={colors.axis} tickLine={false} axisLine={false} tickFormatter={v => formatCompact(v)} />
                  <ChartTooltip
                    cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }}
                    labelFormatter={label => shortDate(String(label))}
                    formatter={(value, name) => [formatNumber(Number(value)), String(name)]}
                    contentStyle={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'var(--text-primary)',
                    }}
                  />
                  <Legend
                    iconType="plainline"
                    iconSize={14}
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                    formatter={value => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>}
                  />
                  <Line type="monotone" dataKey="conversations" name="Conversas" stroke={colors.conversations} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-surface)' }} />
                  <Line type="monotone" dataKey="qualified" name="Qualificados" stroke={colors.qualified} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-surface)' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={<TrendingUp size={18} />} title="Sem conversas no período" description="A linha começa no primeiro dia com conversas." />
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
          <h2 className="m-0 text-sm font-semibold text-content">Resultado por versão do fluxo</h2>
          <Link to="/flows" className="text-xs text-content-secondary hover:text-content">
            Abrir construtor →
          </Link>
        </div>
        {loading && !metrics ? (
          <TableSkeleton columns={6} rows={3} />
        ) : metrics?.flowComparison && metrics.flowComparison.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-y border-border text-2xs text-content-muted">
                  <th className="px-5 py-2 font-medium">Fluxo</th>
                  <th className="px-3 py-2 text-right font-medium">Conversas</th>
                  <th className="px-3 py-2 text-right font-medium">Qualificados</th>
                  <th className="px-3 py-2 text-right font-medium">Taxa</th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">1ª resposta</th>
                  <th className="px-5 py-2 text-right font-medium">Custo</th>
                </tr>
              </thead>
              <tbody>
                {metrics.flowComparison.map(flow => (
                  <tr key={`${flow.flowVersionId ?? flow.flowName}-${flow.version}`} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-content">{flow.flowName}</span>
                      <span className="ml-1.5 text-content-muted">v{flow.version}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-content">{formatNumber(flow.conversationsCount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-content">{formatNumber(flow.qualifiedCount)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-content">
                      {flow.qualificationRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-content-secondary md:table-cell">{formatDuration(flow.avgResponseTimeSec)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-content-secondary">
                      <Tooltip content={`${formatNumber(flow.totalTokens)} tokens`}>
                        <span>{formatUsd(flow.totalCost)}</span>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Workflow size={18} />}
            title="Nenhum fluxo publicado com conversas"
            description="Publique um fluxo numa instância para comparar as versões."
          />
        )}
      </section>
    </PageContainer>
  );
}
