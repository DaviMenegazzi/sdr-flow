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
    <div style={{ height: '100%', overflowY: 'auto', padding: '32px 40px', background: 'var(--color-bg-primary)' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <span className="eyebrow">INDICADORES DE DESEMPENHO</span>
          <h1 style={{ fontSize: '24px', fontWeight: 600, margin: '6px 0 4px', letterSpacing: '-0.5px' }}>
            Painel Gerencial SDR
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Taxas de conversão, tempo de resposta e custos consolidados em tempo real.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={handleRollup}
            disabled={consolidating}
            style={{ fontSize: '11px', minHeight: '32px' }}
            title="Consolidar métricas do dia em lote"
          >
            <RefreshCw size={13} className={consolidating ? 'animate-spin' : ''} />
            Consolidar Hoje
          </button>
          <button
            onClick={() => downloadCsv('leads')}
            style={{ fontSize: '11px', minHeight: '32px' }}
            title="Baixar lista completa de leads em CSV"
          >
            <Download size={13} />
            Exportar Leads (CSV)
          </button>
          <button
            onClick={() => downloadCsv('conversations')}
            style={{ fontSize: '11px', minHeight: '32px' }}
            title="Baixar histórico de conversas em CSV"
          >
            <Download size={13} />
            Exportar Conversas (CSV)
          </button>
        </div>
      </div>

      {notice && (
        <div
          style={{
            padding: '10px 16px',
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: '8px',
            color: '#065f46',
            fontSize: '12px',
            marginBottom: '20px',
          }}
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '10px 16px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#b91c1c',
            fontSize: '12px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '16px',
          marginBottom: '28px',
        }}
      >
        {/* Total Conversas */}
        <div className="info-card" style={{ padding: '18px', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 500 }}>Total de Conversas</span>
            <Users size={16} />
          </div>
          <strong style={{ fontSize: '26px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {metrics?.totalConversations ?? 0}
          </strong>
          <span style={{ display: 'block', fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            {metrics?.handoffConversations ?? 0} assumidas por humanos
          </span>
        </div>

        {/* Leads Qualificados */}
        <div className="info-card" style={{ padding: '18px', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#10b981', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Qualificados</span>
            <CheckCircle2 size={16} />
          </div>
          <strong style={{ fontSize: '26px', fontWeight: 600, color: '#10b981' }}>
            {metrics?.qualifiedConversations ?? 0}
          </strong>
          <span style={{ display: 'block', fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            Leads com critérios atingidos
          </span>
        </div>

        {/* Taxa de Qualificação */}
        <div className="info-card" style={{ padding: '18px', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--color-bg-accent)', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Taxa de Qualificação</span>
            <TrendingUp size={16} />
          </div>
          <strong style={{ fontSize: '26px', fontWeight: 600, color: 'var(--color-bg-accent)' }}>
            {metrics?.qualificationRate ?? 0}%
          </strong>
          <span style={{ display: 'block', fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            Percentual sobre o total
          </span>
        </div>

        {/* Tempo de Resposta */}
        <div className="info-card" style={{ padding: '18px', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#f59e0b', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>1ª Resposta Média</span>
            <Clock size={16} />
          </div>
          <strong style={{ fontSize: '26px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {metrics?.avgFirstResponseTimeSec ?? 0}s
          </strong>
          <span style={{ display: 'block', fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            Tempo até primeiro retorno
          </span>
        </div>

        {/* Custo Total de IA */}
        <div className="info-card" style={{ padding: '18px', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 500 }}>Custo Estimado IA</span>
            <Coins size={16} />
          </div>
          <strong style={{ fontSize: '26px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            ${metrics?.totalEstimatedCost?.toFixed(3) ?? '0.000'}
          </strong>
          <span style={{ display: 'block', fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            {((metrics?.totalTokens ?? 0) / 1000).toFixed(1)}k tokens consumidos
          </span>
        </div>

        {/* Custo por Lead Qualificado */}
        <div className="info-card" style={{ padding: '18px', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 500 }}>Custo / Lead Qual.</span>
            <Coins size={16} />
          </div>
          <strong style={{ fontSize: '26px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            ${metrics?.costPerQualifiedLead?.toFixed(3) ?? '0.000'}
          </strong>
          <span style={{ display: 'block', fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            Eficiência de custo da IA
          </span>
        </div>
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '20px', marginBottom: '28px' }}>
        {/* Funnel Bar Chart */}
        <div
          style={{
            padding: '22px',
            borderRadius: '10px',
            border: '1px solid var(--color-border-secondary)',
            background: 'var(--color-bg-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>Funil de Conversão SDR</h2>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Por Estágio Canônico</span>
          </div>

          <div style={{ width: '100%', height: 260 }}>
            {metrics?.funnel && metrics.funnel.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.funnel} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="label" fontSize={9} interval={0} angle={-25} textAnchor="end" />
                  <YAxis fontSize={10} allowDecimals={false} />
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
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                Sem dados de funil disponíveis.
              </div>
            )}
          </div>
        </div>

        {/* Daily Trends Area Chart */}
        <div
          style={{
            padding: '22px',
            borderRadius: '10px',
            border: '1px solid var(--color-border-secondary)',
            background: 'var(--color-bg-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>Evolução Diária de Atendimentos</h2>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>Consolidado por Data</span>
          </div>

          <div style={{ width: '100%', height: 260 }}>
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
                  <XAxis dataKey="date" fontSize={10} />
                  <YAxis fontSize={10} allowDecimals={false} />
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
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                Sem dados temporais disponíveis.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Flow Comparison Table */}
      <div
        style={{
          padding: '22px',
          borderRadius: '10px',
          border: '1px solid var(--color-border-secondary)',
          background: 'var(--color-bg-primary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Workflow size={16} color="var(--color-bg-accent)" />
            Comparativo de Eficiência por Versão de Fluxo
          </h2>
          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
            Compare o impacto de prompts e nós nas conversões reais
          </span>
        </div>

        {metrics?.flowComparison && metrics.flowComparison.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-secondary)', color: 'var(--color-text-secondary)' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Fluxo</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Versão</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Conversas</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Qualificados</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Taxa (%)</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Tokens</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Custo ($)</th>
                </tr>
              </thead>
              <tbody>
                {metrics.flowComparison.map((f, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--color-border-secondary)' }}>
                    <td style={{ padding: '12px', fontWeight: 600 }}>{f.flowName}</td>
                    <td style={{ padding: '12px' }}>
                      <span className="badge">v{f.version}</span>
                    </td>
                    <td style={{ padding: '12px' }}>{f.conversationsCount}</td>
                    <td style={{ padding: '12px', color: '#10b981', fontWeight: 600 }}>{f.qualifiedCount}</td>
                    <td style={{ padding: '12px', fontWeight: 600 }}>{f.qualificationRate}%</td>
                    <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>{f.totalTokens.toLocaleString()}</td>
                    <td style={{ padding: '12px', color: 'var(--color-text-secondary)' }}>${f.totalCost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
            Nenhum fluxo publicado associado a conversas ainda.
          </div>
        )}
      </div>
    </div>
  );
}
