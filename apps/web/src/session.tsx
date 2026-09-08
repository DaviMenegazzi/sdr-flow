import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import type { MemberRole } from '@sdr/shared';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;

interface Org {
  id: string;
  name: string;
  role?: MemberRole;
}

interface Member {
  organization_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
}

interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  expires_at: string;
  created_at: string;
}

interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  role: MemberRole;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

interface SessionContextType {
  session: Session | null;
  organizations: Org[];
  activeOrg: string;
  activeRole: MemberRole | null;
  setActiveOrg(id: string): void;
  reload(): Promise<void>;
}

const Context = createContext<SessionContextType>({
  session: null,
  organizations: [],
  activeOrg: '',
  activeRole: null,
  setActiveOrg: () => {},
  reload: async () => {},
});

export const useSession = () => useContext(Context);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState('');
  const [activeRole, setActiveRole] = useState<MemberRole | null>(null);

  const reload = async () => {
    if (!supabase || !session) return;
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .order('name');
    if (orgError) throw orgError;

    const rows = (orgData ?? []) as Org[];
    setOrganizations(rows);

    const currentOrgId = rows.some((org) => org.id === activeOrg) ? activeOrg : rows[0]?.id ?? '';
    setActiveOrg(currentOrgId);

    if (currentOrgId && session?.user?.id) {
      const { data: memberData } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', currentOrgId)
        .eq('user_id', session.user.id)
        .maybeSingle();

      setActiveRole((memberData?.role as MemberRole) ?? null);
    } else {
      setActiveRole(null);
    }
  };

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setOrganizations([]);
    setActiveOrg('');
    setActiveRole(null);
    if (session) void reload().catch(() => setOrganizations([]));
  }, [session?.user.id]);

  useEffect(() => {
    if (activeOrg && session?.user?.id && supabase) {
      void supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', activeOrg)
        .eq('user_id', session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          setActiveRole((data?.role as MemberRole) ?? null);
        });
    }
  }, [activeOrg]);

  return (
    <Context.Provider value={{ session, organizations, activeOrg, activeRole, setActiveOrg, reload }}>
      {children}
    </Context.Provider>
  );
}

export function Settings() {
  const { session, organizations, activeOrg, activeRole, setActiveOrg, reload } = useSession();

  const [authTab, setAuthTab] = useState<'login' | 'signup' | 'magic' | 'invitation'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [settingsTab, setSettingsTab] = useState<'team' | 'invitations' | 'api-keys' | 'new-org'>('team');
  const [newOrgName, setNewOrgName] = useState('');

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('viewer');

  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [keyName, setKeyName] = useState('');
  const [keyRole, setKeyRole] = useState<MemberRole>('viewer');
  const [keyScopes, setKeyScopes] = useState<string[]>(['flows:read']);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const isAdminOrOwner = activeRole === 'owner' || activeRole === 'admin';

  useEffect(() => {
    if (!activeOrg || !session?.access_token) return;
    void loadTeamData();
  }, [activeOrg, session?.access_token]);

  async function loadTeamData() {
    if (!activeOrg || !session?.access_token) return;
    try {
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [membersRes, invitesRes, keysRes] = await Promise.all([
        fetch(`/api/organizations/${activeOrg}/members`, { headers }),
        fetch(`/api/organizations/${activeOrg}/invitations`, { headers }),
        fetch(`/api/organizations/${activeOrg}/api-keys`, { headers }),
      ]);

      if (membersRes.ok) setMembers(await membersRes.json());
      if (invitesRes.ok) setInvitations(await invitesRes.json());
      if (keysRes.ok) setApiKeys(await keysRes.json());
    } catch {
      // API may be offline in dev
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setPassword('');
      setMessage('Sessão iniciada com sucesso.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao entrar.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      setPassword('');
      setMessage('Conta criada! Verifique seu e-mail se a confirmação estiver ativada.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha no cadastro.');
    } finally {
      setBusy(false);
    }
  }

  async function handleMagicLink(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      setMessage('Link mágico enviado! Verifique sua caixa de entrada.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao enviar link mágico.');
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleLogin() {
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
      if (error) throw error;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha na autenticação Google.');
      setBusy(false);
    }
  }

  async function handleAcceptInvitation(e: FormEvent) {
    e.preventDefault();
    if (!session?.access_token) {
      setMessage('É necessário estar autenticado para aceitar um convite.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token: invitationToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao aceitar convite.');

      setMessage('Convite aceito com sucesso! Bem-vindo à organização.');
      setInvitationToken('');
      await reload();
      setActiveOrg(data.organizationId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro ao processar convite.');
    } finally {
      setBusy(false);
    }
  }

  async function createOrg(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('create_organization', { org_name: newOrgName.trim() });
      if (error) throw error;
      await reload();
      setActiveOrg(String(data));
      setNewOrgName('');
      setMessage('Organização criada com sucesso.');
      setSettingsTab('team');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível criar a organização.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateMemberRole(userId: string, newRole: MemberRole) {
    if (!activeOrg || !session?.access_token) return;
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/members/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      await loadTeamData();
      setMessage('Papel do membro atualizado.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao alterar papel.');
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!activeOrg || !session?.access_token) return;
    if (!confirm('Tem certeza que deseja remover este membro da organização?')) return;
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/members/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      await loadTeamData();
      setMessage('Membro removido.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao remover membro.');
    }
  }

  async function handleSendInvitation(e: FormEvent) {
    e.preventDefault();
    if (!activeOrg || !session?.access_token) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setInviteEmail('');
      await loadTeamData();
      setMessage(`Convite gerado para ${data.email}! Token: ${data.token}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao criar convite.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    if (!activeOrg || !session?.access_token) return;
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/invitations/${invitationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Falha ao revogar');
      await loadTeamData();
      setMessage('Convite cancelado.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao revogar convite.');
    }
  }

  async function handleCreateApiKey(e: FormEvent) {
    e.preventDefault();
    if (!activeOrg || !session?.access_token) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: keyName.trim(),
          role: keyRole,
          scopes: keyScopes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setNewlyCreatedKey(data.rawKey);
      setKeyName('');
      await loadTeamData();
      setMessage('Chave de API gerada com sucesso.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao gerar chave.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeApiKey(keyId: string) {
    if (!activeOrg || !session?.access_token) return;
    if (!confirm('Deseja realmente revogar esta chave de API?')) return;
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Falha ao revogar');
      await loadTeamData();
      setMessage('Chave de API revogada.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao revogar chave.');
    }
  }

  function toggleScope(scope: string) {
    setKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  return (
    <div className="page-content">
      <span className="eyebrow">ESPAÇO DE TRABALHO</span>
      <h1>Configurações & Organizações</h1>
      <p className="muted">Gerencie autenticação, membros do time, convites e chaves de API com isolamento seguro.</p>

      {!supabase ? (
        <div className="info-card">
          <h2>Conecte o Supabase</h2>
          <p>Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env para ativar autenticação e organizações.</p>
        </div>
      ) : !session ? (
        <div style={{ maxWidth: 460, marginTop: 24 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              className={authTab === 'login' ? 'primary' : ''}
              onClick={() => { setAuthTab('login'); setMessage(''); }}
            >
              Entrar
            </button>
            <button
              className={authTab === 'signup' ? 'primary' : ''}
              onClick={() => { setAuthTab('signup'); setMessage(''); }}
            >
              Criar Conta
            </button>
            <button
              className={authTab === 'magic' ? 'primary' : ''}
              onClick={() => { setAuthTab('magic'); setMessage(''); }}
            >
              Link Mágico
            </button>
            <button
              className={authTab === 'invitation' ? 'primary' : ''}
              onClick={() => { setAuthTab('invitation'); setMessage(''); }}
            >
              Convite
            </button>
          </div>

          {authTab === 'login' && (
            <form className="settings-form" onSubmit={handleLogin}>
              <h2>Entrar na conta</h2>
              <label>
                E-mail
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>Entrar</button>
              <div style={{ textAlign: 'center', margin: '8px 0', color: 'var(--color-text-secondary)' }}>ou</div>
              <button type="button" onClick={handleGoogleLogin} disabled={busy}>Entrar com Google</button>
            </form>
          )}

          {authTab === 'signup' && (
            <form className="settings-form" onSubmit={handleSignUp}>
              <h2>Cadastrar nova conta</h2>
              <label>
                E-mail
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>Criar minha conta</button>
            </form>
          )}

          {authTab === 'magic' && (
            <form className="settings-form" onSubmit={handleMagicLink}>
              <h2>Entrar via Link Mágico</h2>
              <p className="muted">Enviaremos um link de acesso direto para o seu e-mail sem necessidade de senha.</p>
              <label>
                E-mail
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>Enviar Link Mágico</button>
            </form>
          )}

          {authTab === 'invitation' && (
            <div className="settings-form">
              <h2>Aceitar Convite de Organização</h2>
              <p className="muted">Faça login ou cadastre-se primeiro para aceitar convites de equipes.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="info-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <strong>{session.user.email}</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <span className="badge" style={{ textTransform: 'uppercase' }}>
                  Papel: {activeRole ?? 'sem papel'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ margin: 0, minWidth: 200 }}>
                <select value={activeOrg} onChange={(e) => setActiveOrg(e.target.value)}>
                  <option value="">Selecione uma organização</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={async () => {
                  const res = await supabase!.auth.signOut();
                  if (res.error) setMessage(res.error.message);
                }}
              >
                Sair
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, margin: '24px 0 16px', borderBottom: '1px solid var(--color-border-secondary)', paddingBottom: 12 }}>
            <button
              className={settingsTab === 'team' ? 'primary' : ''}
              onClick={() => setSettingsTab('team')}
            >
              Time & Membros
            </button>
            <button
              className={settingsTab === 'invitations' ? 'primary' : ''}
              onClick={() => setSettingsTab('invitations')}
            >
              Convites
            </button>
            <button
              className={settingsTab === 'api-keys' ? 'primary' : ''}
              onClick={() => setSettingsTab('api-keys')}
            >
              Chaves de API (S2S)
            </button>
            <button
              className={settingsTab === 'new-org' ? 'primary' : ''}
              onClick={() => setSettingsTab('new-org')}
            >
              + Nova Organização
            </button>
          </div>

          {settingsTab === 'team' && (
            <div style={{ marginTop: 20 }}>
              <h2>Membros da Organização</h2>
              <p className="muted">Usuários vinculados e seus níveis de permissão (owner, admin, agent, viewer).</p>

              {members.length === 0 ? (
                <p className="muted">Nenhum membro encontrado ou sem permissão de visualização.</p>
              ) : (
                <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 8, overflow: 'hidden', marginTop: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-secondary)', textAlign: 'left' }}>
                        <th style={{ padding: '10px 14px' }}>ID do Usuário</th>
                        <th style={{ padding: '10px 14px' }}>Papel</th>
                        <th style={{ padding: '10px 14px' }}>Data de Ingresso</th>
                        {isAdminOrOwner && <th style={{ padding: '10px 14px', textAlign: 'right' }}>Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.user_id} style={{ borderTop: '1px solid var(--color-border-secondary)' }}>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>
                            {m.user_id} {m.user_id === session.user.id && '(Você)'}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {isAdminOrOwner && m.user_id !== session.user.id ? (
                              <select
                                value={m.role}
                                onChange={(e) => handleUpdateMemberRole(m.user_id, e.target.value as MemberRole)}
                                style={{ width: 'auto', padding: '4px 8px' }}
                              >
                                <option value="owner">Dono (owner)</option>
                                <option value="admin">Administrador (admin)</option>
                                <option value="agent">Atendente (agent)</option>
                                <option value="viewer">Leitor (viewer)</option>
                              </select>
                            ) : (
                              <span className="badge">{m.role}</span>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px' }}>{new Date(m.created_at).toLocaleDateString()}</td>
                          {isAdminOrOwner && (
                            <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                              {m.user_id !== session.user.id && (
                                <button
                                  className="danger"
                                  style={{ margin: 0, padding: '3px 8px', minHeight: 26 }}
                                  onClick={() => handleRemoveMember(m.user_id)}
                                >
                                  Remover
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {settingsTab === 'invitations' && (
            <div style={{ marginTop: 20 }}>
              {isAdminOrOwner && (
                <form className="settings-form" onSubmit={handleSendInvitation} style={{ marginBottom: 30 }}>
                  <h2>Convidar novo membro</h2>
                  <label>
                    E-mail do convidado
                    <input
                      type="email"
                      required
                      placeholder="usuario@empresa.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </label>
                  <label>
                    Papel inicial
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as MemberRole)}>
                      <option value="viewer">Leitor (viewer)</option>
                      <option value="agent">Atendente (agent)</option>
                      <option value="admin">Administrador (admin)</option>
                      <option value="owner">Dono (owner)</option>
                    </select>
                  </label>
                  <button className="primary" disabled={busy}>Gerar Convite</button>
                </form>
              )}

              <h2>Convites Pendentes</h2>
              {invitations.length === 0 ? (
                <p className="muted">Nenhum convite pendente nesta organização.</p>
              ) : (
                <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 8, overflow: 'hidden', marginTop: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-secondary)', textAlign: 'left' }}>
                        <th style={{ padding: '10px 14px' }}>E-mail</th>
                        <th style={{ padding: '10px 14px' }}>Papel</th>
                        <th style={{ padding: '10px 14px' }}>Expira em</th>
                        {isAdminOrOwner && <th style={{ padding: '10px 14px', textAlign: 'right' }}>Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {invitations.map((inv) => (
                        <tr key={inv.id} style={{ borderTop: '1px solid var(--color-border-secondary)' }}>
                          <td style={{ padding: '10px 14px' }}>{inv.email}</td>
                          <td style={{ padding: '10px 14px' }}><span className="badge">{inv.role}</span></td>
                          <td style={{ padding: '10px 14px' }}>{new Date(inv.expires_at).toLocaleDateString()}</td>
                          {isAdminOrOwner && (
                            <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                              <button
                                className="danger"
                                style={{ margin: 0, padding: '3px 8px', minHeight: 26 }}
                                onClick={() => handleRevokeInvitation(inv.id)}
                              >
                                Revogar
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <form className="settings-form" onSubmit={handleAcceptInvitation} style={{ marginTop: 32 }}>
                <h2>Aceitar convite de outra organização</h2>
                <label>
                  Token do convite
                  <input
                    required
                    placeholder="Cole o token do convite aqui..."
                    value={invitationToken}
                    onChange={(e) => setInvitationToken(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={busy}>Entrar na Organização</button>
              </form>
            </div>
          )}

          {settingsTab === 'api-keys' && (
            <div style={{ marginTop: 20 }}>
              <div className="runtime-note" style={{ marginBottom: 20 }}>
                <strong>Chaves Servidor-a-Servidor (S2S):</strong> Utilize para integrar webhooks, pipelines e automações via cabeçalho <code>X-API-Key: sdr_live_...</code>.
              </div>

              {newlyCreatedKey && (
                <div className="info-card" style={{ border: '1px solid #16a34a', background: '#16a34a11' }}>
                  <h2 style={{ color: '#16a34a', margin: '0 0 8px' }}>Chave Gerada com Sucesso!</h2>
                  <p style={{ margin: '0 0 12px' }}>
                    Esta chave não será exibida novamente. Copie e guarde em local seguro agora:
                  </p>
                  <code style={{ display: 'block', padding: 10, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)', borderRadius: 6, wordBreak: 'break-all', userSelect: 'all' }}>
                    {newlyCreatedKey}
                  </code>
                  <button
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      void navigator.clipboard.writeText(newlyCreatedKey);
                      setMessage('Chave copiada para a área de transferência!');
                    }}
                  >
                    Copiar Chave
                  </button>
                </div>
              )}

              {isAdminOrOwner && (
                <form className="settings-form" onSubmit={handleCreateApiKey} style={{ marginBottom: 30 }}>
                  <h2>Criar nova Chave de API</h2>
                  <label>
                    Nome identificador
                    <input
                      required
                      placeholder="Ex: Integração Backend N8N"
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                    />
                  </label>
                  <label>
                    Papel associado
                    <select value={keyRole} onChange={(e) => setKeyRole(e.target.value as MemberRole)}>
                      <option value="viewer">Leitor (viewer)</option>
                      <option value="agent">Atendente (agent)</option>
                      <option value="admin">Administrador (admin)</option>
                    </select>
                  </label>
                  <label>
                    Escopos permitidos
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                      {[
                        { id: 'flows:read', label: 'Consultar fluxos (flows:read)' },
                        { id: 'flows:write', label: 'Criar e editar fluxos (flows:write)' },
                        { id: 'executions:read', label: 'Consultar histórico de execuções (executions:read)' },
                        { id: 'executions:write', label: 'Disparar re-execução de fluxo (executions:write)' },
                      ].map((scope) => (
                        <label key={scope.id} className="check-row" style={{ fontWeight: 'normal' }}>
                          <input
                            type="checkbox"
                            checked={keyScopes.includes(scope.id)}
                            onChange={() => toggleScope(scope.id)}
                          />
                          {scope.label}
                        </label>
                      ))}
                    </div>
                  </label>
                  <button className="primary" disabled={busy}>Gerar Chave S2S</button>
                </form>
              )}

              <h2>Chaves Ativas</h2>
              {apiKeys.length === 0 ? (
                <p className="muted">Nenhuma chave de API gerada nesta organização.</p>
              ) : (
                <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 8, overflow: 'hidden', marginTop: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-secondary)', textAlign: 'left' }}>
                        <th style={{ padding: '10px 14px' }}>Nome</th>
                        <th style={{ padding: '10px 14px' }}>Prefixo</th>
                        <th style={{ padding: '10px 14px' }}>Papel</th>
                        <th style={{ padding: '10px 14px' }}>Escopos</th>
                        <th style={{ padding: '10px 14px' }}>Último Uso</th>
                        {isAdminOrOwner && <th style={{ padding: '10px 14px', textAlign: 'right' }}>Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {apiKeys.map((k) => (
                        <tr key={k.id} style={{ borderTop: '1px solid var(--color-border-secondary)' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600 }}>{k.name}</td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>{k.key_prefix}…</td>
                          <td style={{ padding: '10px 14px' }}><span className="badge">{k.role}</span></td>
                          <td style={{ padding: '10px 14px' }}>
                            {k.scopes?.map((s) => (
                              <span key={s} style={{ fontSize: 10, background: 'var(--color-bg-secondary)', padding: '2px 6px', borderRadius: 4, marginRight: 4 }}>
                                {s}
                              </span>
                            ))}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Nunca'}
                          </td>
                          {isAdminOrOwner && (
                            <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                              <button
                                className="danger"
                                style={{ margin: 0, padding: '3px 8px', minHeight: 26 }}
                                onClick={() => handleRevokeApiKey(k.id)}
                              >
                                Revogar
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {settingsTab === 'new-org' && (
            <form className="settings-form" onSubmit={createOrg}>
              <h2>Criar nova Organização</h2>
              <p className="muted">Você se tornará o proprietário (owner) da nova organização com controle administrativo pleno.</p>
              <label>
                Nome da empresa / organização
                <input
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="Ex: Vida Card Matriz"
                />
              </label>
              <button className="primary" disabled={busy}>Criar organização</button>
            </form>
          )}
        </>
      )}

      {message && (
        <p role="status" style={{ marginTop: 20, color: 'var(--color-bg-accent)', fontWeight: 500 }}>
          {message}
        </p>
      )}
    </div>
  );
}

