import { type FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { MoreHorizontal, PauseCircle, SlidersHorizontal, UserPlus } from 'lucide-react';
import { supabase, useSession } from '../session';
import {
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageContainer,
  PageHeader,
  Popover,
  TableSkeleton,
  confirmDialog,
  toast,
} from '../components/ui';

type Account = {
  user_id: string;
  email: string;
  display_name: string | null;
  status: 'active' | 'suspended';
  max_agents: number;
  max_instances: number | null;
  active_agents: number;
  instances: number;
};

/** Usage against a limit: the number plus a thin bar, so a full plan is visible at a glance. */
function Meter({ used, max, unit }: { used: number; max: number | null; unit: string }) {
  const ratio = max ? Math.min(1, used / max) : 0;
  const full = max !== null && used >= max;
  return (
    <div className="min-w-[96px]">
      <p className="m-0 text-xs tabular-nums text-content">
        {used}
        <span className="text-content-muted"> / {max ?? '∞'} {unit}</span>
      </p>
      {max !== null && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-elevated">
          <div
            className={`h-full origin-left rounded-full ${full ? 'bg-warning' : 'bg-brand'}`}
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
      )}
    </div>
  );
}

function LimitsEditor({ account, onSave }: { account: Account; onSave: (agents: number, instances: number | null) => Promise<void> }) {
  const [agents, setAgents] = useState(String(account.max_agents));
  const [instances, setInstances] = useState(account.max_instances === null ? '' : String(account.max_instances));
  const [saving, setSaving] = useState(false);
  return (
    <Popover
      align="end"
      width={260}
      className="p-3"
      trigger={
        <Button size="sm" variant="ghost">
          <SlidersHorizontal size={14} /> Limites
        </Button>
      }
    >
      {close => (
        <form
          className="flex flex-col gap-3"
          onSubmit={async e => {
            e.preventDefault();
            const a = Number(agents);
            const i = instances.trim() === '' ? null : Number(instances);
            if (!Number.isInteger(a) || a < 0 || (i !== null && (!Number.isInteger(i) || i < 0))) {
              toast.error('Use números inteiros.');
              return;
            }
            setSaving(true);
            await onSave(a, i);
            setSaving(false);
            close();
          }}
        >
          <p className="m-0 text-xs font-semibold text-content">Limites de {account.display_name || account.email}</p>
          <Input label="Agentes" type="number" min={0} value={agents} onChange={e => setAgents(e.target.value)} />
          <Input
            label="Instâncias"
            type="number"
            min={0}
            value={instances}
            onChange={e => setInstances(e.target.value)}
            placeholder="Sem limite"
            helperText="Deixe vazio para não limitar."
          />
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            Salvar
          </Button>
        </form>
      )}
    </Popover>
  );
}

export function AdminPage() {
  const { session, profile } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [email, setEmail] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [loading, setLoading] = useState(true);

  const headers = session ? { Authorization: `Bearer ${session.access_token}` } : undefined;

  const load = async () => {
    if (!headers) {
      setLoading(false);
      return;
    }
    try {
      const r = await fetch('/api/admin/users', { headers });
      if (r.ok) setAccounts(await r.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session?.access_token]);

  if (supabase && profile?.role !== 'admin') return <Navigate to="/dashboard" replace />;

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!headers) return;
    setInviting(true);
    const r = await fetch('/api/admin/users/invite', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setInviting(false);
    if (r.ok) {
      toast.success('Convite enviado', { description: email });
      setEmail('');
      setInviteOpen(false);
      void load();
    } else {
      toast.error((await r.json().catch(() => ({}))).error || 'Falha ao convidar.');
    }
  };

  const update = async (account: Account, kind: 'status' | 'limits', body: unknown, success: string) => {
    if (!headers) return;
    const r = await fetch(`/api/admin/users/${account.user_id}/${kind}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) toast.error((await r.json().catch(() => ({}))).error || 'Erro na atualização.');
    else {
      toast.success(success);
      await load();
    }
  };

  const suspend = async (account: Account) => {
    const ok = await confirmDialog({
      title: `Suspender ${account.display_name || account.email}?`,
      description: 'A conta perde o acesso e os agentes dela param de responder até ser reativada.',
      confirmLabel: 'Suspender conta',
      danger: true,
    });
    if (ok) await update(account, 'status', { status: 'suspended' }, 'Conta suspensa');
  };

  const suspended = accounts.filter(a => a.status === 'suspended').length;

  return (
    <PageContainer>
      <PageHeader
        title="Administração"
        description={
          loading ? 'Carregando…' : `${accounts.length} ${accounts.length === 1 ? 'conta' : 'contas'}${suspended ? ` · ${suspended} suspensa${suspended > 1 ? 's' : ''}` : ''}`
        }
        actions={
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            <UserPlus size={15} /> Convidar cliente
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <TableSkeleton columns={5} rows={4} />
        ) : accounts.length === 0 ? (
          <EmptyState title="Nenhuma conta" description="Convide o primeiro cliente." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-2xs text-content-muted">
                  <th className="px-4 py-2 font-medium">Conta</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Agentes</th>
                  <th className="px-4 py-2 font-medium">Instâncias</th>
                  <th className="w-40" />
                </tr>
              </thead>
              <tbody>
                {accounts.map(account => {
                  const me = account.user_id === session?.user.id;
                  const active = account.status === 'active';
                  return (
                    <tr key={account.user_id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <p className="m-0 font-medium text-content">
                          {account.display_name || account.email}
                          {me && <span className="ml-1.5 font-normal text-content-muted">(você)</span>}
                        </p>
                        {account.display_name && <p className="m-0 text-2xs text-content-muted">{account.email}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-content">
                          <span className={`h-2 w-2 rounded-full ${active ? 'bg-success' : 'bg-danger'}`} aria-hidden="true" />
                          {active ? 'Ativa' : 'Suspensa'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Meter used={account.active_agents} max={account.max_agents} unit="agentes" />
                      </td>
                      <td className="px-4 py-3">
                        <Meter used={account.instances} max={account.max_instances} unit="instâncias" />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {!active && (
                            <Button size="sm" variant="outline" onClick={() => void update(account, 'status', { status: 'active' }, 'Conta reativada')}>
                              Reativar
                            </Button>
                          )}
                          <LimitsEditor
                            account={account}
                            onSave={(agents, instances) =>
                              update(account, 'limits', { maxAgents: agents, maxInstances: instances }, 'Limites atualizados')
                            }
                          />
                          <DropdownMenu
                            aria-label={`Ações de ${account.email}`}
                            items={[
                              {
                                label: 'Suspender conta…',
                                icon: <PauseCircle size={14} />,
                                danger: true,
                                disabled: me || !active,
                                hint: me ? 'Você não pode suspender a própria conta' : !active ? 'Já está suspensa' : undefined,
                                onSelect: () => void suspend(account),
                              },
                            ]}
                            trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} size="sm" tooltip={false} />}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={inviteOpen} onClose={() => !inviting && setInviteOpen(false)} title="Convidar cliente" description="A pessoa recebe um e-mail para criar a senha." maxWidth="md">
        <form onSubmit={invite} className="flex flex-col gap-4">
          <Input label="E-mail" type="email" required autoFocus placeholder="cliente@empresa.com" value={email} onChange={e => setEmail(e.target.value)} />
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={inviting}>
              Enviar convite
            </Button>
          </div>
        </form>
      </Modal>
    </PageContainer>
  );
}
