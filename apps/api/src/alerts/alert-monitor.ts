export interface AlertItem {
  id: string;
  type: 'connection_down' | 'queue_backlog' | 'high_error_rate';
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export class AlertMonitor {
  static async checkConnectionHealth(db: any, organizationId: string): Promise<AlertItem[]> {
    const alerts: AlertItem[] = [];

    if (typeof db.query === 'function' && typeof db.from !== 'function') {
      const res = await db.query(
        `select id, name, provider, status, updated_at
         from public.connections
         where organization_id = $1 and status in ('error', 'disconnected')`,
        [organizationId]
      );

      for (const row of res.rows) {
        alerts.push({
          id: `conn-${row.id}`,
          type: 'connection_down',
          severity: row.status === 'error' ? 'critical' : 'warning',
          title: `Conexão ${row.name} instável`,
          message: `A conexão ${row.name} (${row.provider}) está com status '${row.status}'.`,
          timestamp: new Date().toISOString(),
          metadata: { connectionId: row.id, provider: row.provider, status: row.status },
        });
      }
      return alerts;
    }

    const { data } = await db
      .from('connections')
      .select('id, name, provider, status')
      .eq('organization_id', organizationId)
      .in('status', ['error', 'disconnected']);

    for (const row of data || []) {
      alerts.push({
        id: `conn-${row.id}`,
        type: 'connection_down',
        severity: row.status === 'error' ? 'critical' : 'warning',
        title: `Conexão ${row.name} instável`,
        message: `A conexão ${row.name} (${row.provider}) está com status '${row.status}'.`,
        timestamp: new Date().toISOString(),
        metadata: { connectionId: row.id, provider: row.provider, status: row.status },
      });
    }

    return alerts;
  }

  static checkQueueBacklog(waitingCount: number, threshold = 50): AlertItem | null {
    if (waitingCount <= threshold) return null;

    return {
      id: `queue-backlog-${Date.now()}`,
      type: 'queue_backlog',
      severity: waitingCount > threshold * 2 ? 'critical' : 'warning',
      title: 'Fila de turnos acumulando',
      message: `Existem ${waitingCount} mensagens aguardando processamento pelo worker de fluxos (limite recomendado: ${threshold}).`,
      timestamp: new Date().toISOString(),
      metadata: { waitingCount, threshold },
    };
  }

  static async checkFailureRate(
    db: any,
    organizationId: string,
    thresholdPercentage = 5
  ): Promise<AlertItem | null> {
    let total = 0;
    let failed = 0;

    if (typeof db.query === 'function' && typeof db.from !== 'function') {
      const res = await db.query(
        `select
           count(*)::int as total,
           count(*) filter (where status = 'failed')::int as failed
         from public.flow_executions
         where organization_id = $1 and created_at >= (now() - interval '1 hour')`,
        [organizationId]
      );
      total = res.rows[0]?.total || 0;
      failed = res.rows[0]?.failed || 0;
    } else {
      const { data } = await db
        .from('flow_executions')
        .select('status')
        .eq('organization_id', organizationId);

      total = data?.length || 0;
      failed = (data || []).filter((e: any) => e.status === 'failed').length;
    }

    // Only alert if there is a minimum statistically relevant volume of executions
    if (total < 5) return null;

    const failureRate = Math.round((failed / total) * 1000) / 10;
    if (failureRate > thresholdPercentage) {
      return {
        id: `high-error-rate-${Date.now()}`,
        type: 'high_error_rate',
        severity: failureRate > 20 ? 'critical' : 'warning',
        title: 'Taxa de erro de execuções elevada',
        message: `A taxa de falha de fluxos na última hora está em ${failureRate}% (${failed} de ${total} execuções).`,
        timestamp: new Date().toISOString(),
        metadata: { total, failed, failureRate, threshold: thresholdPercentage },
      };
    }

    return null;
  }

  static async evaluateAlerts(
    db: any,
    organizationId: string,
    options: { queueWaitingCount?: number } = {}
  ): Promise<{ activeAlerts: AlertItem[]; status: 'healthy' | 'warning' | 'critical' }> {
    const alerts: AlertItem[] = [];

    const connAlerts = await this.checkConnectionHealth(db, organizationId);
    alerts.push(...connAlerts);

    if (options.queueWaitingCount !== undefined) {
      const queueAlert = this.checkQueueBacklog(options.queueWaitingCount);
      if (queueAlert) alerts.push(queueAlert);
    }

    const failureAlert = await this.checkFailureRate(db, organizationId);
    if (failureAlert) alerts.push(failureAlert);

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (alerts.some((a) => a.severity === 'critical')) {
      status = 'critical';
    } else if (alerts.length > 0) {
      status = 'warning';
    }

    return { activeAlerts: alerts, status };
  }
}
