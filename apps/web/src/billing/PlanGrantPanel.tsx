import { useEffect, useState, type FormEvent } from 'react';
import { PLANS, orgTiers, type OrgTier } from '@sdr/shared';
import { Button, Input, Select, toast } from '../components/ui';
import { useSession } from '../session';

interface BillingAdminView {
  organization: { id: string; name: string; tier: OrgTier };
  grants: Array<{ id: string; tier: OrgTier; reason: string; expires_at: string | null; revoked_at: string | null; created_at: string }>;
  subscriptions: Array<{ id: string; tier: OrgTier; status: string; current_period_end: string | null }>;
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Concessão manual de plano (administrador da plataforma): cortesia, contrato fora do
 * gateway ou piloto. Sempre com motivo, expiração opcional e trilha de auditoria.
 * Substitui o antigo seletor de plano do formulário de criação de login.
 */
export function PlanGrantPanel({ organizationId, onChanged }: { organizationId: string; onChanged?: () => void }) {
  const { session, refresh } = useSession();
  const [view, setView] = useState<BillingAdminView | null>(null);
  const [tier, setTier] = useState<OrgTier>('vendedor');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' };

  const load = async () => {
    const res = await fetch(`/api/admin/organizations/${organizationId}/billing`, { headers });
    if (res.ok) setView(await res.json());
  };
  useEffect(() => { void load(); }, [organizationId, session?.access_token]);

  const activeGrant = view?.grants.find(grant => !grant.revoked_at && (!grant.expires_at || new Date(grant.expires_at) > new Date()));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}/plan-grants`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tier, reason: reason.trim(), expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível conceder o plano.');
      toast.success(`Plano ${PLANS[tier].name} concedido`);
      setReason('');
      setExpiresAt('');
      await load();
      refresh();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível conceder o plano.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const why = window.prompt('Motivo da revogação (fica registrado na auditoria):');
    if (!why || why.trim().length < 3) return;
    const res = await fetch(`/api/admin/organizations/${organizationId}/plan-grants/revoke`, { method: 'POST', headers, body: JSON.stringify({ reason: why.trim() }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error || 'Não foi possível revogar.'); return; }
    toast.success('Concessão revogada', { description: `Plano efetivo agora: ${PLANS[data.tier as OrgTier]?.name ?? data.tier}.` });
    await load();
    refresh();
    onChanged?.();
  };

  return (
    <div className="mt-8 space-y-4">
      <div>
        <h2 className="m-0 text-base font-semibold text-content">Plano da organização (administração)</h2>
        <p className="m-0 mt-1 text-xs text-content-secondary">
          O plano muda por assinatura paga ou por concessão manual auditada. Criar logins nunca altera o plano.
        </p>
      </div>
      {view && (
        <dl className="m-0 grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 text-xs sm:grid-cols-3">
          <div><dt className="text-content-muted">Plano efetivo</dt><dd className="m-0 mt-1 font-semibold text-content">{PLANS[view.organization.tier].name}</dd></div>
          <div><dt className="text-content-muted">Assinatura</dt><dd className="m-0 mt-1 text-content">{view.subscriptions[0] ? `${PLANS[view.subscriptions[0].tier].name} · ${view.subscriptions[0].status}` : 'Nenhuma'}</dd></div>
          <div>
            <dt className="text-content-muted">Concessão ativa</dt>
            <dd className="m-0 mt-1 text-content">
              {activeGrant ? `${PLANS[activeGrant.tier].name}${activeGrant.expires_at ? ` até ${dateFormat.format(new Date(activeGrant.expires_at))}` : ''}` : 'Nenhuma'}
              {activeGrant && <button type="button" onClick={revoke} className="ml-2 border-0 bg-transparent p-0 text-xs text-danger underline">Revogar</button>}
            </dd>
          </div>
        </dl>
      )}
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-content-secondary">Plano</span>
          <Select fullWidth aria-label="Plano a conceder" value={tier} onChange={value => setTier(value as OrgTier)} options={orgTiers.map(value => ({ value, label: PLANS[value].name }))} />
        </label>
        <Input label="Expira em (opcional)" type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} />
        <div className="sm:col-span-2">
          <Input label="Motivo" required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ex.: contrato anual assinado fora do gateway" />
        </div>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" variant="primary" loading={busy} disabled={reason.trim().length < 3}>Conceder plano</Button>
        </div>
      </form>
    </div>
  );
}
