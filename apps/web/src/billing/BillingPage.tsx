import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, CreditCard, ExternalLink, Info, Sparkles } from 'lucide-react';
import {
  BILLING_OFFERS,
  PLANS,
  PLAN_LIMITS,
  findOffer,
  formatPrice,
  isPurchasable,
  orgTiers,
  tierRank,
  type BillingInterval,
  type BillingSummary,
} from '@sdr/shared';
import { Badge, Button, PageContainer, PageHeader, Skeleton, SegmentedControl, confirmDialog, toast } from '../components/ui';
import { useSession } from '../session';
import { useBillingApi } from './api';
import { clearPendingOffer } from './pendingOffer';

const STATUS_LABEL: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'default' }> = {
  active: { label: 'Ativa', variant: 'success' },
  pending_payment: { label: 'Aguardando pagamento', variant: 'warning' },
  past_due: { label: 'Pagamento pendente', variant: 'warning' },
  suspended: { label: 'Suspensa', variant: 'danger' },
  canceled: { label: 'Cancelada', variant: 'default' },
  expired: { label: 'Encerrada', variant: 'default' },
};

const PAYMENT_LABEL: Record<string, string> = {
  pending: 'Pendente', confirmed: 'Confirmado', received: 'Recebido', overdue: 'Vencido',
  refunded: 'Estornado', chargeback: 'Chargeback', canceled: 'Cancelado',
};

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const formatDate = (value: string | null | undefined) => (value ? dateFormat.format(new Date(value)) : '—');

export function BillingPage() {
  const api = useBillingApi();
  const { activeTier } = useSession();
  const [params, setParams] = useSearchParams();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interval, setBillingInterval] = useState<BillingInterval>(() => findOffer(params.get('offer') ?? '')?.interval ?? 'monthly');
  const [busyOffer, setBusyOffer] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const selectedOffer = findOffer(params.get('offer') ?? '');

  const load = async () => {
    if (!api.ready) return;
    try {
      setError(null);
      setSummary(await api.summary());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar o plano.');
    }
  };
  useEffect(() => { void load(); }, [api, activeTier]);

  // The LP choice has reached its destination; drop it so later logins go to the dashboard.
  useEffect(() => { clearPendingOffer(); }, []);

  useEffect(() => {
    if (params.get('canceled')) toast.info('Pagamento não concluído', { description: 'Nada foi cobrado e o seu plano não mudou.' });
  }, []);

  const startCheckout = async (offerCode: string) => {
    const key = keys.current.get(offerCode) ?? api.newIdempotencyKey();
    keys.current.set(offerCode, key);
    setBusyOffer(offerCode);
    try {
      const { checkoutUrl } = await api.startCheckout(offerCode, key);
      window.location.assign(checkoutUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível abrir o checkout.';
      toast.error('Checkout indisponível', { description: message });
      setBusyOffer(null);
    }
  };

  const scheduleDowngrade = async (offerCode: string) => {
    const offer = findOffer(offerCode);
    if (!offer) return;
    const ok = await confirmDialog({
      title: `Mudar para ${PLANS[offer.tier].name} no próximo ciclo?`,
      description: 'Você mantém o plano atual até o fim do período pago. Nada é apagado; criações acima do novo limite ficam bloqueadas.',
      confirmLabel: 'Agendar mudança',
    });
    if (!ok) return;
    try {
      await api.downgrade(offerCode);
      toast.success('Mudança agendada para o próximo ciclo');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível agendar a mudança.');
    }
  };

  const toggleCancel = async (cancel: boolean) => {
    if (cancel) {
      const ok = await confirmDialog({
        title: 'Cancelar a assinatura?',
        description: 'O acesso continua até o fim do período já pago. Depois disso a organização volta ao nível inicial.',
        confirmLabel: 'Cancelar no fim do período',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await api.setCancel(cancel);
      toast.success(cancel ? 'Cancelamento agendado' : 'Assinatura mantida');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível alterar a assinatura.');
    }
  };

  const offersForInterval = useMemo(() => BILLING_OFFERS.filter(offer => offer.interval === interval && offer.active), [interval]);

  if (error) {
    return (
      <PageContainer>
        <PageHeader title="Plano e cobrança" />
        <div role="alert" className="rounded-xl border border-danger-border bg-danger-bg p-4 text-sm text-danger">{error}</div>
      </PageContainer>
    );
  }
  if (!summary) {
    return (
      <PageContainer>
        <div role="status" aria-live="polite" className="space-y-6">
          <span className="sr-only">Carregando plano…</span>
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32 w-full" rounded="lg" />)}</div>
          <Skeleton className="h-72 w-full" rounded="lg" />
        </div>
      </PageContainer>
    );
  }

  const plan = PLANS[summary.tier];
  const sub = summary.subscription;
  const status = sub ? STATUS_LABEL[sub.status] : null;
  const currentRank = tierRank(summary.tier);

  return (
    <PageContainer>
      <PageHeader
        title="Plano e cobrança"
        description="A assinatura é da organização. O plano muda somente depois da confirmação do pagamento pelo gateway."
      />

      {!summary.gatewayConfigured && summary.canManage && (
        <div role="note" className="mb-6 flex gap-3 rounded-xl border border-warning-border bg-warning-bg p-4 text-sm text-content-secondary">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-warning" aria-hidden="true" />
          <p className="m-0">O pagamento online ainda não está disponível nesta instalação. Para contratar ou mudar de plano agora, fale com o suporte da Prodigi.</p>
        </div>
      )}

      {selectedOffer && summary.canManage && tierRank(selectedOffer.tier) > currentRank && (
        <section aria-label="Plano escolhido" className="mb-6 flex flex-col gap-4 rounded-2xl border border-brand/40 bg-brand-subtle p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-3">
            <Sparkles size={20} className="mt-0.5 flex-shrink-0 text-brand-fg" aria-hidden="true" />
            <div>
              <p className="m-0 text-sm font-semibold text-content">Você escolheu o plano {PLANS[selectedOffer.tier].name} ({selectedOffer.interval === 'monthly' ? 'mensal' : 'anual'})</p>
              <p className="m-0 mt-1 text-xs text-content-secondary">{formatPrice(selectedOffer.amountCents)}{selectedOffer.amountCents !== null ? (selectedOffer.interval === 'monthly' ? ' por mês' : ' por ano') : ''} · cobrança da organização ativa</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { params.delete('offer'); setParams(params, { replace: true }); }}>Agora não</Button>
            <Button
              variant="primary"
              loading={busyOffer === selectedOffer.code}
              disabled={!summary.gatewayConfigured || !isPurchasable(selectedOffer)}
              onClick={() => startCheckout(selectedOffer.code)}
            >
              <CreditCard size={15} /> Ir para o pagamento
            </Button>
          </div>
        </section>
      )}
      {selectedOffer && !summary.canManage && (
        <div role="note" className="mb-6 flex gap-3 rounded-xl border border-info-border bg-info-bg p-4 text-sm text-content-secondary">
          <Info size={18} className="mt-0.5 flex-shrink-0 text-info" aria-hidden="true" />
          <p className="m-0">Somente o proprietário da organização pode contratar ou mudar o plano. Peça a ele para concluir a assinatura.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2" aria-labelledby="current-plan">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="current-plan" className="m-0 text-lg font-semibold text-content">{plan.name}</h2>
            {status && <Badge variant={status.variant} size="sm">{status.label}</Badge>}
            {summary.entitlementSource === 'grant' && <Badge variant="info" size="sm">Concedido pela Prodigi</Badge>}
          </div>
          <p className="m-0 mt-1 text-sm text-content-secondary">{plan.tagline}</p>
          <dl className="m-0 mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {sub && summary.canViewFinancials ? (
              <>
                <Field label="Valor">{formatPrice(sub.amountCents, sub.currency)} / {sub.interval === 'monthly' ? 'mês' : 'ano'}</Field>
                <Field label={sub.cancelAtPeriodEnd || sub.status === 'canceled' ? 'Acesso até' : 'Próxima renovação'}>{formatDate(sub.currentPeriodEnd)}</Field>
                <Field label="Período atual">{formatDate(sub.currentPeriodStart)} – {formatDate(sub.currentPeriodEnd)}</Field>
              </>
            ) : summary.grant && summary.canViewFinancials ? (
              <>
                <Field label="Origem">Concessão manual</Field>
                <Field label="Válido até">{summary.grant.expiresAt ? formatDate(summary.grant.expiresAt) : 'Sem prazo'}</Field>
              </>
            ) : (
              <Field label="Cobrança">{summary.canViewFinancials ? 'Nenhuma assinatura ativa' : 'Gerenciada pelo proprietário'}</Field>
            )}
          </dl>
          {sub?.status === 'past_due' && (
            <p role="alert" className="m-0 mt-4 rounded-lg border border-warning-border bg-warning-bg p-3 text-xs text-content-secondary">
              Não recebemos o pagamento da renovação. O acesso continua até {formatDate(sub.graceUntil)}; depois, os recursos pagos são suspensos (seus dados ficam guardados).
            </p>
          )}
          {sub?.status === 'suspended' && (
            <p role="alert" className="m-0 mt-4 rounded-lg border border-danger-border bg-danger-bg p-3 text-xs text-content-secondary">
              A assinatura está suspensa. Regularize o pagamento ou escolha um plano abaixo para voltar a usar os recursos pagos.
            </p>
          )}
          {sub?.scheduledTier && (
            <p className="m-0 mt-4 text-xs text-content-secondary">Mudança agendada para {PLANS[sub.scheduledTier].name} em {formatDate(sub.currentPeriodEnd)}.</p>
          )}
          {summary.canManage && sub && ['active', 'past_due'].includes(sub.status) && (
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              {sub.cancelAtPeriodEnd
                ? <Button variant="secondary" onClick={() => toggleCancel(false)}>Manter assinatura</Button>
                : <Button variant="ghost" onClick={() => toggleCancel(true)}>Cancelar no fim do período</Button>}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5" aria-labelledby="usage">
          <h2 id="usage" className="m-0 text-sm font-semibold text-content">Uso do plano</h2>
          <div className="mt-4 flex flex-col gap-4">
            <Meter label="Agentes de IA" used={summary.limits.activeAgents} max={summary.limits.maxAgents} />
            <Meter label="Números de WhatsApp" used={summary.limits.instances} max={summary.limits.maxInstances} />
          </div>
          <p className="m-0 mt-4 text-2xs text-content-muted">Reduzir o plano nunca apaga nada; só bloqueia novas criações acima do limite.</p>
        </section>
      </div>

      <section className="mt-8" aria-labelledby="plans-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="plans-title" className="m-0 text-base font-semibold text-content">Planos</h2>
          <SegmentedControl
            value={interval}
            onChange={value => setBillingInterval(value as BillingInterval)}
            options={[{ value: 'monthly', label: 'Mensal' }, { value: 'yearly', label: 'Anual' }]}
            aria-label="Periodicidade"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {orgTiers.map(tier => {
            const offer = offersForInterval.find(item => item.tier === tier);
            const rank = tierRank(tier);
            const isCurrent = rank === currentRank;
            const canUpgrade = summary.canManage && rank > currentRank && offer;
            const canDowngrade = summary.canManage && sub && ['active', 'past_due'].includes(sub.status) && rank < tierRank(sub.tier) && offer;
            const limits = PLAN_LIMITS[tier];
            return (
              <article key={tier} className={`flex flex-col rounded-2xl border bg-surface p-5 ${isCurrent ? 'border-brand/60' : 'border-border'}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 text-base font-semibold text-content">{PLANS[tier].name}</h3>
                  {isCurrent && <Badge variant="accent" size="sm">Plano atual</Badge>}
                </div>
                <p className="m-0 mt-3 text-xl font-bold text-content">
                  {formatPrice(offer?.amountCents ?? null)}
                  {offer?.amountCents != null && <span className="text-xs font-normal text-content-muted"> /{interval === 'monthly' ? 'mês' : 'ano'}</span>}
                </p>
                <ul className="m-0 mt-4 flex flex-1 list-none flex-col gap-1.5 p-0 text-xs text-content-secondary">
                  {PLANS[tier].features.map(feature => <li key={feature}>• {feature}</li>)}
                  <li>• {limits.maxAgents === null ? 'Agentes ilimitados' : `Até ${limits.maxAgents} agentes`}</li>
                  <li>• {limits.maxInstances === null ? 'Números ilimitados' : `Até ${limits.maxInstances} ${limits.maxInstances === 1 ? 'número' : 'números'}`}</li>
                </ul>
                <div className="mt-5">
                  {canUpgrade ? (
                    <Button
                      variant="primary"
                      className="w-full"
                      loading={busyOffer === offer!.code}
                      disabled={!summary.gatewayConfigured || !isPurchasable(offer!)}
                      title={!isPurchasable(offer!) ? 'Preço em definição' : !summary.gatewayConfigured ? 'Pagamento online indisponível' : undefined}
                      onClick={() => startCheckout(offer!.code)}
                    >
                      <ArrowUpRight size={15} /> Fazer upgrade
                    </Button>
                  ) : canDowngrade ? (
                    <Button variant="secondary" className="w-full" disabled={!summary.gatewayConfigured || !isPurchasable(offer!)} onClick={() => scheduleDowngrade(offer!.code)}>
                      Mudar no próximo ciclo
                    </Button>
                  ) : !summary.canManage && rank > currentRank ? (
                    <p className="m-0 text-center text-2xs text-content-muted">Peça ao proprietário para fazer o upgrade.</p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {summary.canViewFinancials && (
        <section className="mt-8" aria-labelledby="payments-title">
          <h2 id="payments-title" className="m-0 mb-4 text-base font-semibold text-content">Histórico de pagamentos</h2>
          {summary.payments.length === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-border p-6 text-center text-sm text-content-muted">Nenhum pagamento registrado.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="bg-surface text-left text-xs text-content-muted">
                    <th scope="col" className="px-4 py-2.5 font-medium">Data</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Valor</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Situação</th>
                    <th scope="col" className="px-4 py-2.5 font-medium"><span className="sr-only">Fatura</span></th>
                  </tr>
                </thead>
                <tbody>
                  {summary.payments.map(payment => (
                    <tr key={payment.id} className="border-t border-border">
                      <td className="px-4 py-2.5 text-content-secondary">{formatDate(payment.paidAt ?? payment.dueDate ?? payment.createdAt)}</td>
                      <td className="px-4 py-2.5 text-content">{formatPrice(payment.amountCents, payment.currency)}</td>
                      <td className="px-4 py-2.5 text-content-secondary">{PAYMENT_LABEL[payment.status] ?? payment.status}</td>
                      <td className="px-4 py-2.5 text-right">
                        {payment.invoiceUrl && (
                          <a href={payment.invoiceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-fg">
                            Fatura <ExternalLink size={12} aria-hidden="true" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </PageContainer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wider text-content-muted">{label}</dt>
      <dd className="m-0 mt-1 text-sm text-content">{children}</dd>
    </div>
  );
}

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max === null ? 0 : Math.min(100, Math.round((used / Math.max(max, 1)) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-content-secondary">{label}</span>
        <span className="font-medium text-content">{used} / {max === null ? '∞' : max}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-elevated" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={max ?? undefined}>
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-warning' : 'bg-brand'}`} style={{ width: `${max === null ? 8 : pct}%` }} />
      </div>
    </div>
  );
}
