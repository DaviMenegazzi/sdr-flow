import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

/** Minimal shape of a raw SQL client (PGlite in tests) — distinguished from the Supabase JS
 * client at runtime by the presence of `.query` and absence of `.from` (see rollupDaily,
 * getDashboardMetrics below, matching the existing pattern for this repository). */
interface RawSqlClient {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export type MetricsDbClient = SupabaseClient<Database> | RawSqlClient;

function isRawSqlClient(db: MetricsDbClient): db is RawSqlClient {
  return typeof (db as RawSqlClient).query === 'function' && typeof (db as SupabaseClient<Database>).from !== 'function';
}

export interface DashboardMetrics {
  totalConversations: number;
  newConversations: number;
  qualifiedConversations: number;
  qualificationRate: number; // Porcentagem (0-100)
  handoffConversations: number;
  avgFirstResponseTimeSec: number;
  totalTokens: number;
  totalEstimatedCost: number; // USD
  costPerQualifiedLead: number; // USD
  funnel: {
    stage: string;
    label: string;
    count: number;
    percentage: number;
  }[];
  flowComparison: {
    flowVersionId: string | null;
    flowName: string;
    version: number;
    conversationsCount: number;
    qualifiedCount: number;
    qualificationRate: number;
    avgResponseTimeSec: number;
    totalTokens: number;
    totalCost: number;
  }[];
  dailyTrends: {
    date: string;
    conversations: number;
    qualified: number;
    handoff: number;
    tokens: number;
    cost: number;
  }[];
}

const STAGE_LABELS: Record<string, string> = {
  NEW_CONVERSATION: 'Nova Conversa',
  QUALIFYING: 'Qualificando',
  COLLECTING_INFORMATION: 'Coleta de Informações',
  PRESENTING_SOLUTION: 'Apresentação de Solução',
  NEGOTIATING: 'Em Negociação',
  CONVERTED: 'Convertido',
  HUMAN_HANDOFF: 'Encaminhado p/ Humano',
  CLOSED: 'Encerrado',
};

/** get_dashboard_metrics computes everything except the display label, added here client-side. */
function enrichFunnelLabels(
  metrics: Omit<DashboardMetrics, 'funnel'> & { funnel: Array<{ stage: string; count: number; percentage: number }> }
): DashboardMetrics {
  return {
    ...metrics,
    funnel: metrics.funnel.map(entry => ({ ...entry, label: STAGE_LABELS[entry.stage] || entry.stage })),
  };
}

export class MetricsRepository {
  constructor(private readonly db: MetricsDbClient) {}

  async rollupDaily(
    organizationId: string,
    targetDate?: string,
    flowVersionId?: string | null
  ): Promise<Database['public']['Tables']['metrics_daily']['Row']> {
    const dateStr = targetDate || new Date().toISOString().split('T')[0] || '';

    if (isRawSqlClient(this.db)) {
      const res = await this.db.query(
        `select * from public.rollup_metrics_daily($1, $2::date, $3)`,
        [organizationId, dateStr, flowVersionId || null]
      );
      return res.rows[0];
    }

    const { data, error } = await this.db.rpc('rollup_metrics_daily', {
      p_org: organizationId,
      p_target_date: dateStr,
      p_flow_version: flowVersionId || null,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Fase 4 (docs/OPTIMIZATION_IMPLEMENTATION_PLAN.md 10.3-10.4): both the PGlite/test path and
   * the Supabase path call the exact same public.get_dashboard_metrics RPC — one
   * implementation, not two that can silently drift (10.5.11). Aggregation happens entirely in
   * Postgres; no conversation rows are ever pulled into Node to be summed here. startDate/
   * endDate are required (the route always supplies them, defaulting itself when absent) and
   * are genuinely used — the pre-Fase-4 hardcoded 4.2 / ignored-dates fallback is gone.
   */
  async getDashboardMetrics(
    organizationId: string,
    options: { startDate: string; endDate: string }
  ): Promise<DashboardMetrics> {
    if (isRawSqlClient(this.db)) {
      const res = await this.db.query(
        `select public.get_dashboard_metrics($1, $2::date, $3::date) as metrics`,
        [organizationId, options.startDate, options.endDate]
      );
      return enrichFunnelLabels(res.rows[0].metrics);
    }

    const { data, error } = await this.db.rpc('get_dashboard_metrics', {
      p_organization_id: organizationId,
      p_start_date: options.startDate,
      p_end_date: options.endDate,
    });
    if (error) throw error;
    return enrichFunnelLabels(data as Omit<DashboardMetrics, 'funnel'> & { funnel: Array<{ stage: string; count: number; percentage: number }> });
  }

  async exportLeadsCsv(organizationId: string): Promise<string> {
    let rows: any[] = [];
    if (isRawSqlClient(this.db)) {
      const res = await this.db.query(
        `select l.*, c.stage as current_stage
         from public.leads l
         left join lateral (
           select stage from public.conversations
           where lead_id = l.id and organization_id = l.organization_id
           order by created_at desc limit 1
         ) c on true
         where l.organization_id = $1
         order by l.created_at desc`,
        [organizationId]
      );
      rows = res.rows;
    } else {
      const { data } = await this.db
        .from('leads')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      rows = data || [];
    }

    const headers = ['ID', 'Telefone', 'Nome', 'Cidade', 'Interesse', 'Urgencia', 'Estagio', 'Criado_Em', 'Memoria_Resumo'];
    const lines = [headers.join(',')];

    for (const r of rows) {
      const memObj = typeof r.memory === 'string' ? JSON.parse(r.memory) : (r.memory || {});
      const memorySnippet = JSON.stringify(memObj).replace(/"/g, '""');

      const escapeField = (val: string | null | undefined) => {
        if (!val) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      lines.push([
        escapeField(r.id),
        escapeField(r.phone),
        escapeField(r.name),
        escapeField(r.city),
        escapeField(r.interest),
        escapeField(r.urgency),
        escapeField(r.current_stage || 'NEW_CONVERSATION'),
        escapeField(r.created_at),
        `"${memorySnippet}"`,
      ].join(','));
    }

    return lines.join('\r\n');
  }

  async exportConversationsCsv(organizationId: string): Promise<string> {
    let rows: any[] = [];
    if (isRawSqlClient(this.db)) {
      const res = await this.db.query(
        `select 
           c.*,
           l.phone as lead_phone,
           l.name as lead_name,
           u.email as assigned_user_email,
           coalesce(msg_count.cnt, 0)::int as total_messages
         from public.conversations c
         join public.leads l on l.id = c.lead_id
         left join auth.users u on u.id = c.assigned_user_id
         left join lateral (
           select count(*)::int as cnt from public.messages
           where conversation_id = c.id
         ) msg_count on true
         where c.organization_id = $1
         order by c.created_at desc`,
        [organizationId]
      );
      rows = res.rows;
    } else {
      const { data } = await this.db
        .from('conversations')
        .select('*, lead:leads(phone, name)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      rows = (data || []).map((c: any) => ({
        ...c,
        lead_phone: c.lead?.phone,
        lead_name: c.lead?.name,
        assigned_user_email: null,
        total_messages: 0,
      }));
    }

    const headers = [
      'ID',
      'Telefone_Lead',
      'Nome_Lead',
      'Estagio',
      'Atendido_Por',
      'Bot_Pausado',
      'Responsavel',
      'Ultima_Mensagem_Em',
      'Criado_Em',
      'Total_Mensagens',
    ];
    const lines = [headers.join(',')];

    for (const r of rows) {
      const escapeField = (val: string | boolean | number | null | undefined) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      lines.push([
        escapeField(r.id),
        escapeField(r.lead_phone),
        escapeField(r.lead_name),
        escapeField(r.stage),
        escapeField(r.handled_by),
        escapeField(r.bot_paused ? 'SIM' : 'NAO'),
        escapeField(r.assigned_user_email || r.assigned_user_id),
        escapeField(r.last_message_at),
        escapeField(r.created_at),
        escapeField(r.total_messages),
      ].join(','));
    }

    return lines.join('\r\n');
  }
}
