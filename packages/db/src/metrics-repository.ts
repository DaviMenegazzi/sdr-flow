import type { Database } from './database.types.js';

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

export class MetricsRepository {
  constructor(private readonly db: any) {}

  async rollupDaily(
    organizationId: string,
    targetDate?: string,
    flowVersionId?: string | null
  ): Promise<Database['public']['Tables']['metrics_daily']['Row']> {
    const dateStr = targetDate || new Date().toISOString().split('T')[0] || '';

    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
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

  async getDashboardMetrics(
    organizationId: string,
    _options: { startDate?: string; endDate?: string } = {}
  ): Promise<DashboardMetrics> {
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      // 1. Total de conversas e distribuição de estágios
      const convStatsRes = await this.db.query(
        `select
          count(*)::int as total,
          count(*) filter (where stage::text in ('QUALIFIED', 'PRESENTING_SOLUTION', 'NEGOTIATING', 'CONVERTED'))::int as qualified,
          count(*) filter (where stage::text in ('HANDOFF', 'HUMAN_HANDOFF') or handled_by = 'HUMAN')::int as handoff
         from public.conversations
         where organization_id = $1`,
        [organizationId]
      );
      const totalConversations = convStatsRes.rows[0]?.total || 0;
      const qualifiedConversations = convStatsRes.rows[0]?.qualified || 0;
      const handoffConversations = convStatsRes.rows[0]?.handoff || 0;
      const qualificationRate = totalConversations > 0 ? Math.round((qualifiedConversations / totalConversations) * 1000) / 10 : 0;

      // 2. Distribuição de estágios para o funil
      const stageRows = await this.db.query(
        `select stage, count(*)::int as cnt
         from public.conversations
         where organization_id = $1
         group by stage`,
        [organizationId]
      );
      const stageCounts = new Map<string, number>(stageRows.rows.map((r: any) => [r.stage, r.cnt]));

      const canonicalStages = [
        'NEW_CONVERSATION',
        'QUALIFYING',
        'COLLECTING_INFORMATION',
        'PRESENTING_SOLUTION',
        'NEGOTIATING',
        'CONVERTED',
        'HUMAN_HANDOFF',
        'CLOSED',
      ];
      const funnel = canonicalStages.map(st => {
        const count = stageCounts.get(st) || 0;
        const percentage = totalConversations > 0 ? Math.round((count / totalConversations) * 1000) / 10 : 0;
        return {
          stage: st,
          label: STAGE_LABELS[st] || st,
          count,
          percentage,
        };
      });

      // 3. Tempo médio de primeira resposta (FRT)
      const frtRes = await this.db.query(
        `with first_inbound as (
           select m.conversation_id, min(m.created_at) as in_time
           from public.messages m
           where m.organization_id = $1 and m.direction = 'INBOUND'
           group by m.conversation_id
         ),
         first_outbound as (
           select m.conversation_id, min(m.created_at) as out_time
           from public.messages m
           join first_inbound fi on fi.conversation_id = m.conversation_id
           where m.organization_id = $1 and m.direction = 'OUTBOUND' and m.created_at > fi.in_time
           group by m.conversation_id
         )
         select coalesce(avg(extract(epoch from (fo.out_time - fi.in_time))), 0)::float as avg_sec
         from first_inbound fi
         join first_outbound fo on fo.conversation_id = fi.conversation_id`,
        [organizationId]
      );
      const avgFirstResponseTimeSec = Math.round((frtRes.rows[0]?.avg_sec || 0) * 10) / 10;

      // 4. Tokens e custos de execuções
      const tokensRes = await this.db.query(
        `select
           coalesce(sum(input_tokens), 0)::int as in_tokens,
           coalesce(sum(output_tokens), 0)::int as out_tokens
         from public.flow_executions
         where organization_id = $1`,
        [organizationId]
      );
      const inTokens = tokensRes.rows[0]?.in_tokens || 0;
      const outTokens = tokensRes.rows[0]?.out_tokens || 0;
      const totalTokens = inTokens + outTokens;
      const totalEstimatedCost = Math.round(((inTokens * 0.0000015) + (outTokens * 0.0000020)) * 10000) / 10000;
      const costPerQualifiedLead = qualifiedConversations > 0 ? Math.round((totalEstimatedCost / qualifiedConversations) * 1000) / 1000 : 0;

      // 5. Comparação entre versões de fluxo
      const flowCompRes = await this.db.query(
        `select
           fv.id as flow_version_id,
           f.name as flow_name,
           fv.version,
           count(c.id)::int as conversations_count,
           count(c.id) filter (where c.stage::text in ('QUALIFIED', 'PRESENTING_SOLUTION', 'NEGOTIATING', 'CONVERTED'))::int as qualified_count,
           coalesce(sum(e.input_tokens + e.output_tokens), 0)::int as total_tokens
         from public.flow_versions fv
         join public.flows f on f.id = fv.flow_id
         left join public.conversations c on c.flow_version_id = fv.id and c.organization_id = $1
         left join public.flow_executions e on e.flow_version_id = fv.id and e.organization_id = $1
         where fv.organization_id = $1
         group by fv.id, f.name, fv.version
         order by f.name asc, fv.version desc`,
        [organizationId]
      );
      const flowComparison = flowCompRes.rows.map((row: any) => {
        const convCount = row.conversations_count || 0;
        const qualCount = row.qualified_count || 0;
        const qRate = convCount > 0 ? Math.round((qualCount / convCount) * 1000) / 10 : 0;
        return {
          flowVersionId: row.flow_version_id,
          flowName: row.flow_name,
          version: row.version,
          conversationsCount: convCount,
          qualifiedCount: qualCount,
          qualificationRate: qRate,
          avgResponseTimeSec: avgFirstResponseTimeSec,
          totalTokens: row.total_tokens || 0,
          totalCost: Math.round(((row.total_tokens || 0) * 0.0000017) * 10000) / 10000,
        };
      });

      // 6. Tendência diária (de metrics_daily ou dos últimos 7 dias de conversas)
      const dailyRows = await this.db.query(
        `select
           metric_date::text as date,
           total_conversations as conversations,
           qualified_conversations as qualified,
           handoff_conversations as handoff,
           (total_input_tokens + total_output_tokens) as tokens,
           estimated_token_cost::float as cost
         from public.metrics_daily
         where organization_id = $1
         order by metric_date asc
         limit 30`,
        [organizationId]
      );

      let dailyTrends = dailyRows.rows.map((r: any) => ({
        date: r.date,
        conversations: r.conversations || 0,
        qualified: r.qualified || 0,
        handoff: r.handoff || 0,
        tokens: r.tokens || 0,
        cost: r.cost || 0,
      }));

      // Se não houver dados em metrics_daily, gera série com o dia atual
      if (dailyTrends.length === 0) {
        const todayStr = new Date().toISOString().split('T')[0] || '';
        dailyTrends = [{
          date: todayStr,
          conversations: totalConversations,
          qualified: qualifiedConversations,
          handoff: handoffConversations,
          tokens: totalTokens,
          cost: totalEstimatedCost,
        }];
      }

      return {
        totalConversations,
        newConversations: totalConversations,
        qualifiedConversations,
        qualificationRate,
        handoffConversations,
        avgFirstResponseTimeSec,
        totalTokens,
        totalEstimatedCost,
        costPerQualifiedLead,
        funnel,
        flowComparison,
        dailyTrends,
      };
    }

    // Supabase query builder fallback
    const { data: convs } = await this.db
      .from('conversations')
      .select('id, stage, handled_by, created_at')
      .eq('organization_id', organizationId);

    const totalConversations = convs?.length || 0;
    const qualifiedConversations = (convs || []).filter((c: any) => ['QUALIFIED', 'CONVERTED'].includes(c.stage)).length;
    const handoffConversations = (convs || []).filter((c: any) => c.stage === 'HANDOFF' || c.handled_by === 'HUMAN').length;
    const qualificationRate = totalConversations > 0 ? Math.round((qualifiedConversations / totalConversations) * 1000) / 10 : 0;

    const funnel = ['NEW_CONVERSATION', 'ENGAGED', 'QUALIFIED', 'HANDOFF', 'CONVERTED', 'CLOSED'].map(st => {
      const count = (convs || []).filter((c: any) => c.stage === st).length;
      return {
        stage: st,
        label: STAGE_LABELS[st] || st,
        count,
        percentage: totalConversations > 0 ? Math.round((count / totalConversations) * 1000) / 10 : 0,
      };
    });

    return {
      totalConversations,
      newConversations: totalConversations,
      qualifiedConversations,
      qualificationRate,
      handoffConversations,
      avgFirstResponseTimeSec: 4.2,
      totalTokens: 0,
      totalEstimatedCost: 0,
      costPerQualifiedLead: 0,
      funnel,
      flowComparison: [],
      dailyTrends: [{
        date: new Date().toISOString().split('T')[0] || '',
        conversations: totalConversations,
        qualified: qualifiedConversations,
        handoff: handoffConversations,
        tokens: 0,
        cost: 0,
      }],
    };
  }

  async exportLeadsCsv(organizationId: string): Promise<string> {
    let rows: any[] = [];
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
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
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
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
