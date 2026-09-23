import { type FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase, useSession } from '../session';
import { Button, Badge, Card, Input, TableSkeleton } from '../components/ui';
import { Users, Mail, UserPlus, AlertCircle, CheckCircle2, Shield, Settings } from 'lucide-react';

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

export function AdminPage() {
  const { session, profile } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [inviting, setInviting] = useState(false);
  const [loading, setLoading] = useState(true);

  const headers = session ? { Authorization: `Bearer ${session.access_token}` } : undefined;

  const load = async () => {
    if (!headers) { setLoading(false); return; }
    setLoading(true);
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
    setMessage(r.ok ? 'Convite enviado com sucesso.' : (await r.json()).error || 'Falha ao convidar.');
    if (r.ok) setEmail('');
  };

  const update = async (account: Account, kind: 'status' | 'limits', body: unknown) => {
    if (!headers) return;
    const r = await fetch(`/api/admin/users/${account.user_id}/${kind}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) setMessage((await r.json()).error || 'Erro na atualização.');
    else await load();
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 bg-canvas text-content">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand-fg mb-1">
              <Shield className="w-3.5 h-3.5" /> PAINEL DE CONTROLE ADMINISTRATIVO
            </div>
            <h1 className="text-2xl font-bold text-content tracking-tight">
              Administração
            </h1>
            <p className="text-sm text-content-secondary max-w-2xl mt-1">
              Gerencie organizações, acessos de clientes, permissões e cotas de recursos.
            </p>
          </div>
        </div>

      {/* Invite Form Card */}
      <Card className="p-5 bg-surface border-border max-w-xl mb-6">
        <h2 className="text-sm font-semibold text-content m-0 mb-3 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-brand-fg" /> Convidar Novo Usuário
        </h2>
        <form onSubmit={invite} className="flex gap-2.5 items-center">
          <Input
            type="email"
            required
            placeholder="cliente@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" variant="primary" size="sm" loading={inviting}>
            Convidar
          </Button>
        </form>
      </Card>

      {message && (
        <div className="p-3.5 mb-6 max-w-xl rounded-lg bg-brand/10 border border-brand/20 text-brand-fg text-xs flex items-center gap-2" role="status">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Accounts Table */}
      <h2 className="text-base font-semibold text-content mb-3">Usuários Registrados ({accounts.length})</h2>
      <Card className="p-0 bg-surface border-border overflow-hidden max-w-4xl">
        {loading ? (
          <TableSkeleton columns={5} rows={4} />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-surface-muted/50 border-b border-border text-content-muted">
                <th className="py-2.5 px-4 font-medium">Usuário</th>
                <th className="py-2.5 px-4 font-medium">Instâncias</th>
                <th className="py-2.5 px-4 font-medium">Agentes</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
                <th className="py-2.5 px-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {accounts.map((a) => (
                <tr key={a.user_id} className="hover:bg-surface-muted/40 transition-colors">
                  <td className="py-3 px-4">
                    <strong className="text-content block">{a.display_name || a.email}</strong>
                    <span className="text-2xs text-content-muted font-mono">{a.email}</span>
                  </td>
                  <td className="py-3 px-4 text-content">{a.instances} instância(s)</td>
                  <td className="py-3 px-4 text-content">
                    {a.active_agents} / {a.max_agents}
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant={a.status === 'active' ? 'success' : 'danger'} size="sm">
                      {a.status === 'active' ? 'Ativo' : 'Suspenso'}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant={a.status === 'active' ? 'danger' : 'outline'}
                        size="sm"
                        onClick={() =>
                          void update(a, 'status', {
                            status: a.status === 'active' ? 'suspended' : 'active',
                          })
                        }
                      >
                        {a.status === 'active' ? 'Suspender' : 'Reativar'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const value = Number(prompt('Novo limite de agentes', String(a.max_agents)));
                          if (Number.isInteger(value)) {
                            void update(a, 'limits', {
                              maxAgents: value,
                              maxInstances: a.max_instances,
                            });
                          }
                        }}
                      >
                        <Settings className="w-3 h-3" /> Limites
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </Card>
    </div>
  </div>
  );
}
