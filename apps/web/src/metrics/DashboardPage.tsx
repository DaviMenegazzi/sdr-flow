import { useState, useEffect } from 'react';
import {
  BarChart3,
  TrendingUp,
  Clock,
  Coins,
  CheckCircle2,
  Users,
  Download,
  RefreshCw,
  Workflow,
  AlertCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import { useSession } from '../session';
import { Button, Card, Badge } from '../components/ui';

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

export function DashboardPage() {
  const { session, activeOrg } = useSession();

  const [metrics, setMetrics] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !activeOrg) return;
    loadMetrics();
  }, [session, activeOrg]);

  async function loadMetrics() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/metrics/dashboard`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!res.ok) throw new Error('Falha ao carregar indicadores.');
      const data = await res.json();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar métricas.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRollup() {
    setConsolidating(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/metrics/rollup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Falha na consolidação.');
      setNotice('Métricas do dia consolidadas em metrics_daily com sucesso!');
      await loadMetrics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao consolidar métricas.');
    } finally {
      setConsolidating(false);
    }
  }

  async function downloadCsv(type: 'leads' | 'conversations') {
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/export/${type}.csv`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!res.ok) throw new Error(`Falha ao exportar ${type}.`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro na exportação CSV.');
    }
  }

  return (
    <div className="h-full overflow-y-auto p-8 bg-canvas">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">
            INDICADORES DE DESEMPENHO
          </span>
          <h1 className="text-xl font-bold text-content tracking-tight mt-1 mb-1">
            Painel Gerencial SDR
          </h1>
          <p className="text-xs text-content-muted m-0">
            Taxas de conversão, tempo de resposta e custos consolidados em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={handleRollup}
            disabled={consolidating}
            variant="secondary"
            size="sm"
            title="Consolidar métricas do dia em lote"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${consolidating ? 'animate-spin' : ''}`} />
            Consolidar Hoje
          </Button>
          <Button
            onClick={() => downloadCsv('leads')}
            variant="outline"
            size="sm"
            title="Baixar lista completa de leads em CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar Leads (CSV)
          </Button>
          <Button
            onClick={() => downloadCsv('conversations')}
            variant="outline"
            size="sm"
            title="Baixar histórico de conversas em CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar Conversas (CSV)
          </Button>
        </div>
      </div>

      {notice && (
        <div className="p-3.5 mb-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 mb-6 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {/* Total Conversas */}
        <Card className="p-4 bg-surface border-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-content-muted mb-2">
            <span className="text-xs font-medium">Total de Conversas</span>
            <Users className="w-4 h-4" />
          </div>
          <div>
            <div className="text-2xl font-bold text-content tracking-tight">
              {metrics?.totalConversations ?? 0}
            </div>
            <span className="block text-[10px] text-content-muted mt-1">
              {metrics?.handoffConversations ?? 0} assumidas por humanos
            </span>
          </div>
        </Card>

        {/* Leads Qualificados */}
        <Card className="p-4 bg-surface border-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-500 mb-2">
            <span className="text-xs font-medium text-content-muted">Qualificados</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight">
              {metrics?.qualifiedConversations ?? 0}
            </div>
            <span className="block text-[10px] text-content-muted mt-1">
              Leads com critérios atingidos
            </span>
          </div>
        </Card>

        {/* Taxa de Qualificação */}
        <Card className="p-4 bg-surface border-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand mb-2">
            <span className="text-xs font-medium text-content-muted">Taxa de Qualificação</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <div className="text-2xl font-bold text-brand tracking-tight">
              {metrics?.qualificationRate ?? 0}%
            </div>
            <span className="block text-[10px] text-content-muted mt-1">
              Percentual sobre o total
            </span>
          </div>
        </Card>

        {/* Tempo de Resposta */}
        <Card className="p-4 bg-surface border-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-500 mb-2">
            <span className="text-xs font-medium text-content-muted">1ª Resposta Média</span>
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <div className="text-2xl font-bold text-content tracking-tight">
              {metrics?.avgFirstResponseTimeSec ?? 0}s
            </div>
            <span className="block text-[10px] text-content-muted mt-1">
              Tempo até primeiro retorno
            </span>
          </div>
        </Card>

        {/* Custo Total de IA */}
        <Card className="p-4 bg-surface border-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-content-muted mb-2">
            <span className="text-xs font-medium">Custo Estimado IA</span>
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <div className="text-2xl font-bold text-content tracking-tight">
              ${metrics?.totalEstimatedCost?.toFixed(3) ?? '0.000'}
            </div>
            <span className="block text-[10px] text-content-muted mt-1">
              {((metrics?.totalTokens ?? 0) / 1000).toFixed(1)}k tokens consumidos
            </span>
          </div>
        </Card>

        {/* Custo por Lead Qualificado */}
        <Card className="p-4 bg-surface border-border flex flex-col justify-between">
          <div className="flex items-center justify-between text-content-muted mb-2">
            <span className="text-xs font-medium">Custo / Lead Qual.</span>
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <div className="text-2xl font-bold text-content tracking-tight">
              ${metrics?.costPerQualifiedLead?.toFixed(3) ?? '0.000'}
            </div>
            <span className="block text-[10px] text-content-muted mt-1">
              Eficiência de custo da IA
            </span>
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Funnel Bar Chart */}
        <Card className="p-6 bg-surface border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-content m-0">Funil de Conversão SDR</h2>
            <span className="text-xs text-content-muted">Por Estágio Canônico</span>
          </div>

          <div className="w-full h-64">
            {metrics?.funnel && metrics.funnel.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.funnel} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="label" fontSize={10} interval={0} angle={-25} textAnchor="end" stroke="var(--color-text-secondary)" />
                  <YAxis fontSize={10} allowDecimals={false} stroke="var(--color-text-secondary)" />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-secondary)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(val: any) => [`${val} conversas`, 'Volume']}
                  />
                  <Bar dataKey="count" fill="var(--color-bg-accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-content-muted">
                Sem dados de funil disponíveis.
              </div>
            )}
          </div>
        </Card>

        {/* Daily Trends Area Chart */}
        <Card className="p-6 bg-surface border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-content m-0">Evolução Diária de Atendimentos</h2>
            <span className="text-xs text-content-muted">Consolidado por Data</span>
          </div>

          <div className="w-full h-64">
            {metrics?.dailyTrends && metrics.dailyTrends.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.dailyTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorConv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#464feb" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#464feb" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorQual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="date" fontSize={10} stroke="var(--color-text-secondary)" />
                  <YAxis fontSize={10} allowDecimals={false} stroke="var(--color-text-secondary)" />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-bg-primary)',
                      borderColor: 'var(--color-border-secondary)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Area type="monotone" dataKey="conversations" name="Conversas" stroke="#464feb" fillOpacity={1} fill="url(#colorConv)" />
                  <Area type="monotone" dataKey="qualified" name="Qualificados" stroke="#10b981" fillOpacity={1} fill="url(#colorQual)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-content-muted">
                Sem dados temporais disponíveis.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Flow Comparison Table */}
      <Card className="p-6 bg-surface border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-content m-0 flex items-center gap-2">
            <Workflow className="w-4 h-4 text-brand" />
            Comparativo de Eficiência por Versão de Fluxo
          </h2>
          <span className="text-xs text-content-muted">
            Compare o impacto de prompts e nós nas conversões reais
          </span>
        </div>

        {metrics?.flowComparison && metrics.flowComparison.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-content-muted">
                  <th className="py-2.5 px-3 font-medium">Fluxo</th>
                  <th className="py-2.5 px-3 font-medium">Versão</th>
                  <th className="py-2.5 px-3 font-medium">Conversas</th>
                  <th className="py-2.5 px-3 font-medium">Qualificados</th>
                  <th className="py-2.5 px-3 font-medium">Taxa (%)</th>
                  <th className="py-2.5 px-3 font-medium">Tokens</th>
                  <th className="py-2.5 px-3 font-medium">Custo ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {metrics.flowComparison.map((f, idx) => (
                  <tr key={idx} className="hover:bg-surface-muted/40 transition-colors">
                    <td className="py-3 px-3 font-semibold text-content">{f.flowName}</td>
                    <td className="py-3 px-3">
                      <Badge variant="outline" size="sm">v{f.version}</Badge>
                    </td>
                    <td className="py-3 px-3 text-content">{f.conversationsCount}</td>
                    <td className="py-3 px-3 text-emerald-600 dark:text-emerald-400 font-semibold">{f.qualifiedCount}</td>
                    <td className="py-3 px-3 font-semibold text-content">{f.qualificationRate}%</td>
                    <td className="py-3 px-3 text-content-muted">{f.totalTokens.toLocaleString()}</td>
                    <td className="py-3 px-3 text-content-muted">${f.totalCost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-content-muted">
            Nenhum fluxo publicado associado a conversas ainda.
          </div>
        )}
      </Card>
    </div>
  );
}
