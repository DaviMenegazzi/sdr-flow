import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import { CheckCircle2, Sliders, UserPlus } from 'lucide-react';
import type { MemberRole, OrgTier, Capability } from '@sdr/shared';
import { Button, Input, Modal, Card, TableSkeleton } from './components/ui';

const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;

interface Org {
  id: string;
  name: string;
  role?: MemberRole;
  tier?: OrgTier;
}

interface Member {
  organization_id: string;
  user_id: string;
  display_name?: string | null;
  role: MemberRole;
  created_at: string;
}

interface AgentSummary {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  provider: string;
  model: string;
  is_default?: boolean;
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
  activeTier: OrgTier | null;
  capabilities: Capability[];
  can(capability: Capability): boolean;
  setActiveOrg(id: string): void;
  reload(): Promise<void>;
  loading: boolean;
  profile: {
    role: 'admin' | 'client';
    platformRole?: 'admin' | 'client';
    status: string;
    organizationId: string;
    memberRole?: MemberRole;
    orgTier?: OrgTier;
    capabilities?: Capability[];
  } | null;
  signOut(): Promise<void>;
}

const Context = createContext<SessionContextType>({
  session: null,
  organizations: [],
  activeOrg: '',
  activeRole: null,
  activeTier: null,
  capabilities: [],
  can: () => false,
  setActiveOrg: () => {},
  reload: async () => {},
  loading: true,
  profile: null,
  signOut: async () => {},
});

export const useSession = () => useContext(Context);

export function Can({
  do: capability,
  children,
  fallback = null,
}: {
  do: Capability;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useSession();
  return can(capability) ? <>{children}</> : <>{fallback}</>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState('');
  const [activeRole, setActiveRole] = useState<MemberRole | null>(null);
  const [activeTier, setActiveTier] = useState<OrgTier | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(() => Boolean(supabase));
  const [profile, setProfile] = useState<SessionContextType['profile']>(null);

  const reload = async () => {
    if (!supabase || !session) return;
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, tier')
      .order('name');
    if (orgError) throw orgError;

    const rows = (orgData ?? []) as Org[];
    setOrganizations(rows);

    const currentOrgId = rows.some((org) => org.id === activeOrg) ? activeOrg : rows[0]?.id ?? '';
    setActiveOrg(currentOrgId);

    const currentOrg = rows.find((org) => org.id === currentOrgId);
    if (currentOrg?.tier) setActiveTier(currentOrg.tier);

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
    if (!supabase) {
      setLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    if (!session) {
      setProfile(null);
      setActiveTier(null);
      setCapabilities([]);
      return;
    }
    setLoading(true);
    const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}` };
    if (activeOrg) headers['X-Organization-Id'] = activeOrg;
    void fetch('/api/me', { headers })
      .then(async (response) => {
        if (!response.ok) {
          setProfile(null);
          return;
        }
        const me = await response.json();
        setProfile({
          role: me.role,
          platformRole: me.platformRole,
          status: me.status,
          organizationId: me.organizationId,
          memberRole: me.memberRole,
          orgTier: me.orgTier,
          capabilities: me.capabilities,
        });
        if (me.orgTier) setActiveTier(me.orgTier);
        if (Array.isArray(me.capabilities)) setCapabilities(me.capabilities);
        if (me.memberRole) setActiveRole(me.memberRole);
      })
      .finally(() => setLoading(false));
  }, [session?.access_token, activeOrg]);

  const signOut = async () => {
    setOrganizations([]);
    setActiveOrg('');
    setActiveRole(null);
    setActiveTier(null);
    setCapabilities([]);
    setProfile(null);
    setSession(null);
    try { localStorage.removeItem('sdr-flow:active-instance'); } catch {}
    await supabase?.auth.signOut();
  };

  useEffect(() => {
    if (!supabase) return;
    setOrganizations([]);
    setActiveOrg('');
    setActiveRole(null);
    setActiveTier(null);
    setCapabilities([]);
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
      const currentOrg = organizations.find((o) => o.id === activeOrg);
      if (currentOrg?.tier) setActiveTier(currentOrg.tier);
    }
  }, [activeOrg]);

  const can = (cap: Capability): boolean => {
    if (profile?.role === 'admin' || profile?.platformRole === 'admin') return true;
    return capabilities.includes(cap);
  };

  return (
    <Context.Provider
      value={{
        session,
        organizations,
        activeOrg,
        activeRole,
        activeTier,
        capabilities,
        can,
        setActiveOrg,
        reload,
        loading,
        profile,
        signOut,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function Settings() {
  const { session, organizations, activeOrg, activeRole, activeTier, profile, setActiveOrg, reload } = useSession();

  const [authTab, setAuthTab] = useState<'login' | 'signup' | 'magic' | 'invitation'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [settingsTab, setSettingsTab] = useState<'team' | 'invitations' | 'api-keys' | 'new-org'>('team');
  const [newOrgName, setNewOrgName] = useState('');
  const [loadingTeam, setLoadingTeam] = useState(true);

  const [members, setMembers] = useState<Member[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentSummary[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('viewer');

  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [keyName, setKeyName] = useState('');
  const [keyRole, setKeyRole] = useState<MemberRole>('viewer');
  const [keyScopes, setKeyScopes] = useState<string[]>(['flows:read']);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginDisplayName, setLoginDisplayName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginAccountRole, setLoginAccountRole] = useState<'admin' | 'client'>('client');
  const [loginMemberRole, setLoginMemberRole] = useState<MemberRole>('agent');
  const [loginOrgTier, setLoginOrgTier] = useState<OrgTier>('pre-venda');
  const [loginSuccess, setLoginSuccess] = useState('');

  const isAdminOrOwner = activeRole === 'owner' || activeRole === 'admin';
  const isPlatformAdmin = profile?.platformRole === 'admin' || profile?.role === 'admin';
  const canManageTeam = isPlatformAdmin && isAdminOrOwner;
  const activeOrganization = organizations.find((org) => org.id === activeOrg);

  useEffect(() => {
    if (!activeOrg || !session?.access_token) {
      setLoadingTeam(false);
      return;
    }
    void loadTeamData();
  }, [activeOrg, session?.access_token, isPlatformAdmin]);

  useEffect(() => {
    if (!isPlatformAdmin && settingsTab !== 'team') setSettingsTab('team');
  }, [isPlatformAdmin, settingsTab]);

  useEffect(() => {
    if (activeTier) setLoginOrgTier(activeTier);
  }, [activeOrg, activeTier]);

  async function loadTeamData(): Promise<boolean> {
    if (!activeOrg || !session?.access_token) { setLoadingTeam(false); return false; }
    setLoadingTeam(true);
    try {
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [membersRes, agentsRes, invitesRes, keysRes] = await Promise.all([
        fetch(`/api/organizations/${activeOrg}/members`, { headers }),
        fetch('/api/me/agents', { headers: { ...headers, 'X-Organization-Id': activeOrg } }),
        isPlatformAdmin
          ? fetch(`/api/organizations/${activeOrg}/invitations`, { headers })
          : Promise.resolve(null),
        isPlatformAdmin
          ? fetch(`/api/organizations/${activeOrg}/api-keys`, { headers })
          : Promise.resolve(null),
      ]);

      if (!membersRes.ok) return false;
      setMembers(await membersRes.json());
      if (agentsRes.ok) {
        const payload = await agentsRes.json();
        setAvailableAgents(Array.isArray(payload?.agents) ? payload.agents : []);
      }
      if (invitesRes?.ok) setInvitations(await invitesRes.json());
      if (keysRes?.ok) setApiKeys(await keysRes.json());
      return true;
    } catch {
      // API may be offline in dev
      return false;
    } finally {
      setLoadingTeam(false);
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

  async function handleCreateLogin(e: FormEvent) {
    e.preventDefault();
    if (!activeOrg || !session?.access_token || !isPlatformAdmin) return;
    setBusy(true);
    setMessage('');
    setLoginSuccess('');
    try {
      const res = await fetch(`/api/admin/organizations/${activeOrg}/logins`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          displayName: loginDisplayName.trim(),
          email: loginEmail.trim(),
          password: loginPassword,
          accountRole: loginAccountRole,
          memberRole: loginMemberRole,
          orgTier: loginOrgTier,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao criar login.');

      const createdEmail = String(data.email);
      const organizationName = activeOrganization?.name ?? 'selecionada';
      setLoginDisplayName('');
      setLoginEmail('');
      setLoginPassword('');
      setLoginAccountRole('client');
      setLoginMemberRole('agent');
      setLoginModalOpen(false);
      const [teamRefresh] = await Promise.allSettled([loadTeamData(), reload()]);
      const listWasRefreshed = teamRefresh.status === 'fulfilled' && teamRefresh.value;
      setLoginSuccess(
        listWasRefreshed
          ? `${createdEmail} agora tem acesso à organização ${organizationName}. A lista de membros foi atualizada.`
          : `${createdEmail} agora tem acesso à organização ${organizationName}. Recarregue a página para atualizar a lista de membros.`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao criar login.');
    } finally {
      setBusy(false);
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
    <div className="h-full overflow-y-auto p-6 md:p-8 bg-canvas text-content">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand mb-1">
            <Sliders size={14} /> ADMINISTRAÇÃO & AJUSTES
          </div>
          <h1 className="text-2xl font-bold text-content tracking-tight">
            Organizações e Equipe
          </h1>
          <p className="text-sm text-content-secondary max-w-2xl mt-1">
            Gerencie membros, convites e chaves de integração da organização ativa.
          </p>
        </div>

        <>
          {!supabase ? (
            <div className="info-card" style={{ maxWidth: 640 }}>
              <h2 style={{ fontSize: 16, marginBottom: 8 }}>Conecte o Supabase</h2>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>.env</code> para ativar autenticação de usuários, times e permissões por organização.
              </p>
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
            {isPlatformAdmin && (
              <>
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
              </>
            )}
          </div>

          {settingsTab === 'team' && (
            <div style={{ marginTop: 20 }}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2>Membros da Organização</h2>
                  <p className="muted">Usuários vinculados e seus níveis de permissão (owner, admin, agent, viewer).</p>
                </div>
                {isPlatformAdmin && (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setLoginSuccess('');
                      setLoginModalOpen(true);
                    }}
                    disabled={!activeOrg}
                    className="shrink-0"
                  >
                    <UserPlus size={14} /> Adicionar login
                  </Button>
                )}
              </div>

              {loginSuccess && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-4 flex items-start gap-3 rounded-xl border border-success-border bg-success-bg p-3.5 text-success"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex flex-col gap-0.5">
                    <strong className="text-sm">Login criado com sucesso</strong>
                    <span className="text-xs">{loginSuccess}</span>
                  </div>
                </div>
              )}

              {loadingTeam ? (
                <Card className="mt-3 p-0">
                  <TableSkeleton columns={canManageTeam ? 4 : 3} rows={4} />
                </Card>
              ) : members.length === 0 ? (
                <p className="muted">Nenhum membro encontrado ou sem permissão de visualização.</p>
              ) : (
                <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 8, overflow: 'hidden', marginTop: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg-secondary)', textAlign: 'left' }}>
                        <th style={{ padding: '10px 14px' }}>ID do Usuário</th>
                        <th style={{ padding: '10px 14px' }}>Papel</th>
                        <th style={{ padding: '10px 14px' }}>Data de Ingresso</th>
                        {canManageTeam && <th style={{ padding: '10px 14px', textAlign: 'right' }}>Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.user_id} style={{ borderTop: '1px solid var(--color-border-secondary)' }}>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>
                            {m.display_name || m.user_id} {m.user_id === session.user.id && '(Você)'}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {canManageTeam && m.user_id !== session.user.id ? (
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
                          {canManageTeam && (
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

              <div style={{ marginTop: 28 }}>
                <h2>Agentes disponíveis</h2>
                <p className="muted">Agentes de IA ativos nesta organização.</p>
                {loadingTeam ? (
                  <Card className="mt-3 p-0">
                    <TableSkeleton columns={3} rows={3} />
                  </Card>
                ) : availableAgents.length === 0 ? (
                  <p className="muted">Nenhum agente disponível nesta organização.</p>
                ) : (
                  <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 8, overflow: 'hidden', marginTop: 12 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--color-bg-secondary)', textAlign: 'left' }}>
                          <th style={{ padding: '10px 14px' }}>Agente</th>
                          <th style={{ padding: '10px 14px' }}>Modelo</th>
                          <th style={{ padding: '10px 14px' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availableAgents.map((agent) => (
                          <tr key={agent.id} style={{ borderTop: '1px solid var(--color-border-secondary)' }}>
                            <td style={{ padding: '10px 14px' }}>
                              <strong>{agent.name}</strong>
                              {agent.description && <div className="muted">{agent.description}</div>}
                            </td>
                            <td style={{ padding: '10px 14px' }}>{agent.provider} · {agent.model}</td>
                            <td style={{ padding: '10px 14px' }}><span className="badge">{agent.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {isPlatformAdmin && settingsTab === 'invitations' && (
            <div style={{ marginTop: 20 }}>
              {canManageTeam && (
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
              {loadingTeam ? (
                <Card className="mt-3 p-0">
                  <TableSkeleton columns={isAdminOrOwner ? 4 : 3} rows={3} />
                </Card>
              ) : invitations.length === 0 ? (
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

          {isPlatformAdmin && settingsTab === 'api-keys' && (
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

              {canManageTeam && (
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
              {loadingTeam ? (
                <Card className="mt-3 p-0">
                  <TableSkeleton columns={isAdminOrOwner ? 6 : 5} rows={3} />
                </Card>
              ) : apiKeys.length === 0 ? (
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

          {isPlatformAdmin && settingsTab === 'new-org' && (
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
        </>

      {message && (
        <p role="status" style={{ marginTop: 20, color: 'var(--color-bg-accent)', fontWeight: 500 }}>
          {message}
        </p>
      )}

      <Modal
        isOpen={loginModalOpen}
        onClose={() => !busy && setLoginModalOpen(false)}
        title="Adicionar login"
        description={`O acesso será criado em ${activeOrganization?.name ?? 'a organização selecionada'}.`}
        maxWidth="lg"
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={() => setLoginModalOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" form="create-organization-login" variant="primary" loading={busy}>
              Criar login
            </Button>
          </>
        )}
      >
        <form id="create-organization-login" onSubmit={handleCreateLogin} className="flex flex-col gap-4">
          <Input
            label="Nome"
            required
            maxLength={120}
            autoComplete="off"
            value={loginDisplayName}
            onChange={(e) => setLoginDisplayName(e.target.value)}
            placeholder="Nome da pessoa"
          />
          <Input
            label="E-mail de acesso"
            type="email"
            required
            maxLength={320}
            autoComplete="off"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            placeholder="cliente@empresa.com"
          />
          <Input
            label="Senha temporária"
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            placeholder="No mínimo 8 caracteres"
            helperText="O e-mail já será confirmado e a pessoa poderá entrar imediatamente."
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-content-primary">
              Tipo da conta
              <select
                value={loginAccountRole}
                onChange={(e) => setLoginAccountRole(e.target.value as 'admin' | 'client')}
              >
                <option value="client">Cliente</option>
                <option value="admin">Administrador da plataforma</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-content-primary">
              Papel na organização
              <select value={loginMemberRole} onChange={(e) => setLoginMemberRole(e.target.value as MemberRole)}>
                <option value="viewer">Leitor</option>
                <option value="agent">Atendente</option>
                <option value="admin">Administrador</option>
                <option value="owner">Dono</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1.5 text-xs font-semibold text-content-primary">
            Plano contratado
            <select value={loginOrgTier} onChange={(e) => setLoginOrgTier(e.target.value as OrgTier)}>
              <option value="pre-venda">Pré-venda</option>
              <option value="vendedor">Vendedor</option>
              <option value="vendedor-senior">Vendedor sênior</option>
            </select>
            <span className="text-[11px] font-normal text-content-muted">
              O plano é da organização e será aplicado a todos os logins vinculados a ela.
            </span>
          </label>
        </form>
      </Modal>
    </div>
  </div>
  );
}

