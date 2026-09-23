import React, { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Check, ChevronDown, Copy, KeyRound, MoreHorizontal, Plus, Trash2, User, UserPlus, Users } from 'lucide-react';
import type { MemberRole, OrgTier } from '@sdr/shared';
import { supabase, useSession } from '../session';
import {
  Button,
  Checkbox,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageContainer,
  PageHeader,
  Select,
  TableSkeleton,
  confirmDialog,
  toast,
  type MenuItem,
} from '../components/ui';
import { formatDate, formatRelative } from '../lib/format';

interface Member {
  organization_id: string;
  user_id: string;
  display_name?: string | null;
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

type Section = 'general' | 'members' | 'api-keys' | 'new-org' | 'profile';

export const ROLES: Array<{ value: MemberRole; label: string; description: string }> = [
  { value: 'owner', label: 'Dono', description: 'Tudo, inclusive plano e exclusão da organização.' },
  { value: 'admin', label: 'Administrador', description: 'Gerencia membros, conexões, fluxos e integrações.' },
  { value: 'agent', label: 'Atendente', description: 'Atende conversas e assume o atendimento da IA.' },
  { value: 'viewer', label: 'Leitor', description: 'Só visualiza conversas e indicadores.' },
];
const roleLabel = (role: MemberRole) => ROLES.find(r => r.value === role)?.label ?? role;

const SCOPES = [
  { id: 'flows:read', label: 'Consultar fluxos' },
  { id: 'flows:write', label: 'Criar e editar fluxos' },
  { id: 'executions:read', label: 'Consultar execuções' },
  { id: 'executions:write', label: 'Disparar nova execução' },
];

const TIERS: Record<string, string> = { 'pre-venda': 'Pré-Venda', vendedor: 'Vendedor', 'vendedor-senior': 'Pro' };

/** Settings as a sidebar of sections: organization first, "my account" last. */
export function SettingsPage() {
  const { session, organizations, activeOrg, activeRole, activeTier, profile, setActiveOrg, reload } = useSession();
  const [params, setParams] = useSearchParams();

  const isAdminOrOwner = activeRole === 'owner' || activeRole === 'admin';
  const isPlatformAdmin = profile?.platformRole === 'admin' || profile?.role === 'admin';
  const canManageTeam = isPlatformAdmin && isAdminOrOwner;
  const activeOrganization = organizations.find(org => org.id === activeOrg);

  const sections: Array<{ id: Section; label: string; icon: React.ReactNode; group: string }> = [
    { id: 'general', label: 'Geral', icon: <Building2 size={15} />, group: 'Organização' },
    { id: 'members', label: 'Membros', icon: <Users size={15} />, group: 'Organização' },
    ...(isPlatformAdmin
      ? ([
          { id: 'api-keys', label: 'Chaves de API', icon: <KeyRound size={15} />, group: 'Organização' },
          { id: 'new-org', label: 'Nova organização', icon: <Plus size={15} />, group: 'Organização' },
        ] as const)
      : []),
    { id: 'profile', label: 'Perfil', icon: <User size={15} />, group: 'Minha conta' },
  ];
  const requested = params.get('section') as Section | null;
  const section: Section = sections.some(s => s.id === requested) ? (requested as Section) : 'members';
  const goTo = (next: Section) => setParams({ section: next }, { replace: true });

  const [loadingTeam, setLoadingTeam] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [busy, setBusy] = useState(false);

  const headers = (json = false): Record<string, string> => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  });

  async function loadTeamData(): Promise<boolean> {
    if (!activeOrg || !session?.access_token) {
      setLoadingTeam(false);
      return false;
    }
    try {
      const [membersRes, invitesRes, keysRes] = await Promise.all([
        fetch(`/api/organizations/${activeOrg}/members`, { headers: headers() }),
        isPlatformAdmin ? fetch(`/api/organizations/${activeOrg}/invitations`, { headers: headers() }) : Promise.resolve(null),
        isPlatformAdmin ? fetch(`/api/organizations/${activeOrg}/api-keys`, { headers: headers() }) : Promise.resolve(null),
      ]);
      if (!membersRes.ok) return false;
      setMembers(await membersRes.json());
      if (invitesRes?.ok) setInvitations(await invitesRes.json());
      if (keysRes?.ok) setApiKeys(await keysRes.json());
      return true;
    } catch {
      return false;
    } finally {
      setLoadingTeam(false);
    }
  }

  useEffect(() => {
    setLoadingTeam(true);
    void loadTeamData();
  }, [activeOrg, session?.access_token, isPlatformAdmin]);

  async function request(path: string, init: RequestInit, fallback: string) {
    const res = await fetch(path, init);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || fallback);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  async function updateRole(member: Member, role: MemberRole, undoable = true) {
    const previous = member.role;
    try {
      await request(
        `/api/organizations/${activeOrg}/members/${member.user_id}`,
        { method: 'PATCH', headers: headers(true), body: JSON.stringify({ role }) },
        'Não foi possível alterar o papel.'
      );
      await loadTeamData();
      if (undoable) {
        toast.success(`${member.display_name || 'Membro'} agora é ${roleLabel(role)}`, {
          action: { label: 'Desfazer', onClick: () => void updateRole({ ...member, role }, previous, false) },
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível alterar o papel.');
    }
  }

  async function removeMember(member: Member) {
    const ok = await confirmDialog({
      title: `Remover ${member.display_name || 'este membro'}?`,
      description: 'A pessoa perde o acesso imediatamente. Para voltar, ela precisa de um novo convite.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await request(`/api/organizations/${activeOrg}/members/${member.user_id}`, { method: 'DELETE', headers: headers() }, 'Falha ao remover.');
      toast.success('Membro removido');
      await loadTeamData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao remover o membro.');
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    try {
      await request(`/api/organizations/${activeOrg}/invitations/${invitation.id}`, { method: 'DELETE', headers: headers() }, 'Falha ao cancelar.');
      toast.success('Convite cancelado');
      await loadTeamData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao cancelar o convite.');
    }
  }

  async function revokeKey(key: ApiKeyItem) {
    const ok = await confirmDialog({
      title: `Revogar "${key.name}"?`,
      description: 'Os sistemas que usam esta chave param de funcionar na hora. Não dá para desfazer.',
      confirmLabel: 'Revogar chave',
      danger: true,
    });
    if (!ok) return;
    try {
      await request(`/api/organizations/${activeOrg}/api-keys/${key.id}`, { method: 'DELETE', headers: headers() }, 'Falha ao revogar.');
      toast.success('Chave revogada');
      await loadTeamData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao revogar a chave.');
    }
  }

  // ---- modals ----
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('agent');
  const [inviteToken, setInviteToken] = useState<{ email: string; token: string } | null>(null);

  const [loginOpen, setLoginOpen] = useState(false);
  const [login, setLogin] = useState({ name: '', email: '', password: '', accountRole: 'client' as 'admin' | 'client', memberRole: 'agent' as MemberRole, tier: (activeTier ?? 'pre-venda') as OrgTier });

  const [keyOpen, setKeyOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyRole, setKeyRole] = useState<MemberRole>('viewer');
  const [keyScopes, setKeyScopes] = useState<string[]>(['flows:read']);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const [newOrgName, setNewOrgName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');

  async function sendInvitation(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await request(
        `/api/organizations/${activeOrg}/invitations`,
        { method: 'POST', headers: headers(true), body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) },
        'Falha ao criar o convite.'
      );
      setInviteOpen(false);
      setInviteEmail('');
      setInviteToken({ email: data?.email ?? inviteEmail, token: data?.token ?? '' });
      await loadTeamData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar o convite.');
    } finally {
      setBusy(false);
    }
  }

  async function createLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await request(
        `/api/admin/organizations/${activeOrg}/logins`,
        {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({
            displayName: login.name.trim(),
            email: login.email.trim(),
            password: login.password,
            accountRole: login.accountRole,
            memberRole: login.memberRole,
            orgTier: login.tier,
          }),
        },
        'Falha ao criar o login.'
      );
      setLoginOpen(false);
      setLogin(l => ({ ...l, name: '', email: '', password: '' }));
      await Promise.allSettled([loadTeamData(), reload()]);
      toast.success(`${data?.email ?? 'Login'} já pode entrar`, { description: `Acesso a ${activeOrganization?.name ?? 'esta organização'}.` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar o login.');
    } finally {
      setBusy(false);
    }
  }

  async function createKey(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await request(
        `/api/organizations/${activeOrg}/api-keys`,
        { method: 'POST', headers: headers(true), body: JSON.stringify({ name: keyName.trim(), role: keyRole, scopes: keyScopes }) },
        'Falha ao criar a chave.'
      );
      setKeyOpen(false);
      setKeyName('');
      setCreatedKey(data?.rawKey ?? null);
      await loadTeamData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar a chave.');
    } finally {
      setBusy(false);
    }
  }

  async function createOrg(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('create_organization', { org_name: newOrgName.trim() });
      if (error) throw error;
      await reload();
      setActiveOrg(String(data));
      setNewOrgName('');
      toast.success('Organização criada');
      goTo('members');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível criar a organização.');
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvitation(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await request(
        '/api/invitations/accept',
        { method: 'POST', headers: headers(true), body: JSON.stringify({ token: invitationCode.trim() }) },
        'Falha ao aceitar o convite.'
      );
      setInvitationCode('');
      await reload();
      if (data?.organizationId) setActiveOrg(data.organizationId);
      toast.success('Convite aceito', { description: 'A organização já aparece no seletor da barra lateral.' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao aceitar o convite.');
    } finally {
      setBusy(false);
    }
  }

  const copy = (text: string, label: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copiado`),
      () => toast.error('Não foi possível copiar.')
    );

  const groups = Array.from(new Set(sections.map(s => s.group)));

  return (
    <PageContainer wide>
      <PageHeader title="Configurações" description={activeOrganization ? activeOrganization.name : undefined} />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Seções das configurações" className="flex gap-4 overflow-x-auto md:flex-col md:self-start">
          {groups.map(group => (
            <div key={group} className="flex gap-1 md:flex-col">
              <span className="hidden px-2.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-content-muted md:block">{group}</span>
              {sections
                .filter(s => s.group === group)
                .map(item => {
                  const active = item.id === section;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => goTo(item.id)}
                      className={`flex h-8 min-h-0 flex-shrink-0 items-center justify-start gap-2 whitespace-nowrap rounded-lg border-0 px-2.5 text-left text-xs ${
                        active ? 'bg-surface-elevated font-semibold text-content' : 'bg-transparent text-content-secondary hover:bg-surface-elevated hover:text-content'
                      }`}
                    >
                      <span className="text-content-muted">{item.icon}</span>
                      {item.label}
                    </button>
                  );
                })}
            </div>
          ))}
        </nav>

        <section className="min-w-0 max-w-4xl">
          {section === 'general' && (
            <Panel title="Geral">
              <dl className="m-0 divide-y divide-border rounded-xl border border-border bg-surface text-xs">
                <Row label="Organização" value={activeOrganization?.name ?? '—'} />
                <Row label="Plano" value={activeTier ? TIERS[activeTier] ?? activeTier : '—'} />
                <Row label="Seu papel" value={activeRole ? roleLabel(activeRole) : '—'} />
                <Row label="Membros" value={loadingTeam ? '…' : String(members.length)} />
              </dl>
              <p className="m-0 text-2xs text-content-muted">Para trocar de organização, use o seletor no topo da barra lateral.</p>
            </Panel>
          )}

          {section === 'members' && (
            <Panel
              title="Membros"
              description="Quem acessa esta organização e o que cada pessoa pode fazer."
              action={
                isPlatformAdmin && (
                  <Button variant="primary" onClick={() => setInviteOpen(true)}>
                    <UserPlus size={15} /> Convidar pessoa
                  </Button>
                )
              }
            >
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                {loadingTeam ? (
                  <TableSkeleton columns={3} rows={3} />
                ) : members.length === 0 ? (
                  <EmptyState title="Nenhum membro" description="Convide a primeira pessoa do time." />
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-2xs text-content-muted">
                        <th className="px-4 py-2 font-medium">Pessoa</th>
                        <th className="px-4 py-2 font-medium">Papel</th>
                        <th className="hidden px-4 py-2 font-medium sm:table-cell">Desde</th>
                        <th className="w-12" />
                      </tr>
                    </thead>
                    <tbody>
                      {members.map(member => {
                        const me = member.user_id === session?.user.id;
                        const editable = canManageTeam && !me;
                        return (
                          <tr key={member.user_id} className="border-b border-border last:border-0">
                            <td className="px-4 py-3">
                              <p className="m-0 font-medium text-content">
                                {member.display_name || 'Sem nome'}
                                {me && <span className="ml-1.5 font-normal text-content-muted">(você)</span>}
                              </p>
                              {me && session?.user.email && <p className="m-0 text-2xs text-content-muted">{session.user.email}</p>}
                            </td>
                            <td className="px-4 py-3">
                              {editable ? (
                                <DropdownMenu
                                  align="start"
                                  width={280}
                                  aria-label={`Papel de ${member.display_name || 'membro'}`}
                                  items={ROLES.map(
                                    (role): MenuItem => ({
                                      label: (
                                        <span className="flex items-center gap-1.5">
                                          {role.label}
                                          {role.value === member.role && <Check size={13} className="text-brand-fg" />}
                                        </span>
                                      ),
                                      description: role.description,
                                      onSelect: () => role.value !== member.role && void updateRole(member, role.value),
                                    })
                                  )}
                                  trigger={
                                    <button
                                      type="button"
                                      className="flex h-7 min-h-0 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-xs text-content hover:bg-surface-elevated"
                                    >
                                      {roleLabel(member.role)} <ChevronDown size={13} className="text-content-muted" />
                                    </button>
                                  }
                                />
                              ) : (
                                <span className="px-1.5 text-content-secondary">{roleLabel(member.role)}</span>
                              )}
                            </td>
                            <td className="hidden whitespace-nowrap px-4 py-3 text-content-secondary sm:table-cell" title={formatDate(member.created_at)}>
                              {formatRelative(member.created_at)}
                            </td>
                            <td className="px-2 text-right">
                              {editable && (
                                <DropdownMenu
                                  aria-label="Mais ações"
                                  items={[{ label: 'Remover da organização…', icon: <Trash2 size={14} />, danger: true, onSelect: () => void removeMember(member) }]}
                                  trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} size="sm" tooltip={false} />}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {isPlatformAdmin && invitations.length > 0 && (
                <div>
                  <h3 className="m-0 mb-2 text-xs font-semibold text-content">Convites pendentes ({invitations.length})</h3>
                  <ul className="m-0 list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface p-0">
                    {invitations.map(invitation => (
                      <li key={invitation.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                        <span className="min-w-0 flex-1 truncate text-content">{invitation.email}</span>
                        <span className="text-content-secondary">{roleLabel(invitation.role)}</span>
                        <span className="hidden text-content-muted sm:inline" title={formatDate(invitation.expires_at)}>
                          expira em {formatDate(invitation.expires_at)}
                        </span>
                        <DropdownMenu
                          aria-label="Ações do convite"
                          items={[{ label: 'Cancelar convite', icon: <Trash2 size={14} />, danger: true, onSelect: () => void revokeInvitation(invitation) }]}
                          trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} size="sm" tooltip={false} />}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          )}

          {section === 'api-keys' && isPlatformAdmin && (
            <Panel
              title="Chaves de API"
              description="Use para integrar outros sistemas ao SDR Flow. Envie a chave no cabeçalho X-API-Key."
              action={
                <Button variant="primary" onClick={() => setKeyOpen(true)}>
                  <Plus size={15} /> Criar chave
                </Button>
              }
            >
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                {loadingTeam ? (
                  <TableSkeleton columns={3} rows={2} />
                ) : apiKeys.length === 0 ? (
                  <EmptyState icon={<KeyRound size={20} />} title="Nenhuma chave" description="Crie uma chave quando precisar conectar outro sistema." />
                ) : (
                  <ul className="m-0 list-none divide-y divide-border p-0">
                    {apiKeys.map(key => (
                      <li key={key.id} className="flex items-center gap-3 px-4 py-3 text-xs">
                        <div className="min-w-0 flex-1">
                          <p className="m-0 font-medium text-content">{key.name}</p>
                          <p className="m-0 truncate text-2xs text-content-muted">
                            <code>{key.key_prefix}…</code> · {roleLabel(key.role)} · {key.scopes.map(s => SCOPES.find(x => x.id === s)?.label ?? s).join(', ')}
                          </p>
                        </div>
                        <span className="hidden whitespace-nowrap text-content-muted sm:inline">
                          {key.last_used_at ? `usada ${formatRelative(key.last_used_at)}` : 'nunca usada'}
                        </span>
                        <DropdownMenu
                          aria-label="Ações da chave"
                          items={[{ label: 'Revogar…', icon: <Trash2 size={14} />, danger: true, onSelect: () => void revokeKey(key) }]}
                          trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} size="sm" tooltip={false} />}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          )}

          {section === 'new-org' && isPlatformAdmin && (
            <Panel title="Nova organização" description="Você vira o dono da nova organização, com controle total.">
              <form onSubmit={createOrg} className="flex max-w-md flex-col gap-3">
                <Input label="Nome da empresa" required maxLength={120} value={newOrgName} onChange={e => setNewOrgName(e.target.value)} placeholder="Ex.: Vida Card Matriz" />
                <div>
                  <Button type="submit" variant="primary" loading={busy} disabled={!newOrgName.trim()}>
                    Criar organização
                  </Button>
                </div>
              </form>
            </Panel>
          )}

          {section === 'profile' && (
            <Panel title="Perfil">
              <dl className="m-0 divide-y divide-border rounded-xl border border-border bg-surface text-xs">
                <Row label="E-mail" value={session?.user.email ?? '—'} />
                <Row label="Conta" value={isPlatformAdmin ? 'Administrador da plataforma' : 'Cliente'} />
              </dl>
              <form onSubmit={acceptInvitation} className="flex max-w-md flex-col gap-2">
                <h3 className="m-0 text-xs font-semibold text-content">Recebeu um convite?</h3>
                <p className="m-0 text-2xs text-content-muted">Cole o código do convite para entrar em outra organização.</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input aria-label="Código do convite" value={invitationCode} onChange={e => setInvitationCode(e.target.value)} placeholder="Código do convite" />
                  </div>
                  <Button type="submit" variant="outline" loading={busy} disabled={!invitationCode.trim()}>
                    Aceitar
                  </Button>
                </div>
              </form>
            </Panel>
          )}
        </section>
      </div>

      {/* Invite */}
      <Modal
        isOpen={inviteOpen}
        onClose={() => !busy && setInviteOpen(false)}
        title="Convidar pessoa"
        description={`Para ${activeOrganization?.name ?? 'esta organização'}.`}
        maxWidth="md"
      >
        <form onSubmit={sendInvitation} className="flex flex-col gap-4">
          <Input label="E-mail" type="email" required autoFocus value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="pessoa@empresa.com" />
          <RolePicker value={inviteRole} onChange={setInviteRole} />
          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => {
                setInviteOpen(false);
                setLogin(l => ({ ...l, email: inviteEmail, memberRole: inviteRole }));
                setLoginOpen(true);
              }}
              className="min-h-0 border-0 bg-transparent p-0 text-xs text-content-secondary hover:text-content hover:underline"
            >
              Criar login com senha
            </button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                Gerar convite
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(inviteToken)} onClose={() => setInviteToken(null)} title="Convite criado" description={`Envie este código para ${inviteToken?.email}. Ela aceita em Configurações › Perfil.`} maxWidth="md">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs">{inviteToken?.token}</code>
          <Button variant="primary" onClick={() => inviteToken && copy(inviteToken.token, 'Código')}>
            <Copy size={14} /> Copiar
          </Button>
        </div>
      </Modal>

      {/* Login with password (platform admin) */}
      <Modal
        isOpen={loginOpen}
        onClose={() => !busy && setLoginOpen(false)}
        title="Criar login com senha"
        description={`A pessoa entra direto em ${activeOrganization?.name ?? 'esta organização'}, sem confirmar e-mail.`}
        maxWidth="lg"
      >
        <form onSubmit={createLogin} className="flex flex-col gap-4">
          <Input label="Nome" required maxLength={120} autoComplete="off" value={login.name} onChange={e => setLogin(l => ({ ...l, name: e.target.value }))} />
          <Input label="E-mail" type="email" required maxLength={320} autoComplete="off" value={login.email} onChange={e => setLogin(l => ({ ...l, email: e.target.value }))} />
          <Input
            label="Senha temporária"
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            value={login.password}
            onChange={e => setLogin(l => ({ ...l, password: e.target.value }))}
            helperText="No mínimo 8 caracteres."
          />
          <RolePicker value={login.memberRole} onChange={value => setLogin(l => ({ ...l, memberRole: value }))} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Tipo da conta">
              <Select
                fullWidth
                aria-label="Tipo da conta"
                value={login.accountRole}
                onChange={value => setLogin(l => ({ ...l, accountRole: value }))}
                options={[
                  { value: 'client', label: 'Cliente' },
                  { value: 'admin', label: 'Administrador da plataforma' },
                ]}
              />
            </Field>
            <Field label="Plano da organização">
              <Select
                fullWidth
                aria-label="Plano da organização"
                value={login.tier}
                onChange={value => setLogin(l => ({ ...l, tier: value }))}
                options={[
                  { value: 'pre-venda', label: 'Pré-Venda' },
                  { value: 'vendedor', label: 'Vendedor' },
                  { value: 'vendedor-senior', label: 'Pro' },
                ]}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => setLoginOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Criar login
            </Button>
          </div>
        </form>
      </Modal>

      {/* API key */}
      <Modal isOpen={keyOpen} onClose={() => !busy && setKeyOpen(false)} title="Criar chave de API" maxWidth="md">
        <form onSubmit={createKey} className="flex flex-col gap-4">
          <Input label="Nome" required autoFocus value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="Ex.: CRM interno" />
          <Field label="Age como">
            <Select
              fullWidth
              aria-label="Papel da chave"
              value={keyRole}
              onChange={setKeyRole}
              options={ROLES.filter(r => r.value !== 'owner').map(r => ({ value: r.value, label: r.label, description: r.description }))}
            />
          </Field>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-xs font-medium text-content-secondary">Pode</legend>
            {SCOPES.map(scope => (
              <Checkbox
                key={scope.id}
                checked={keyScopes.includes(scope.id)}
                onChange={() => setKeyScopes(prev => (prev.includes(scope.id) ? prev.filter(s => s !== scope.id) : [...prev, scope.id]))}
                label={scope.label}
                description={scope.id}
              />
            ))}
          </fieldset>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => setKeyOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!keyName.trim() || keyScopes.length === 0}>
              Criar chave
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(createdKey)}
        onClose={() => setCreatedKey(null)}
        title="Copie a chave agora"
        description="Por segurança, ela não aparece de novo. Se perder, revogue e crie outra."
        maxWidth="md"
      >
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs">{createdKey}</code>
          <Button variant="primary" onClick={() => createdKey && copy(createdKey, 'Chave')}>
            <Copy size={14} /> Copiar
          </Button>
        </div>
      </Modal>
    </PageContainer>
  );
}

function Panel({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="m-0 text-base font-semibold text-content">{title}</h2>
          {description && <p className="m-0 mt-1 text-xs text-content-secondary">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-content-secondary">{label}</dt>
      <dd className="m-0 text-right font-medium text-content">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-content-secondary">{label}</span>
      {children}
    </div>
  );
}

function RolePicker({ value, onChange }: { value: MemberRole; onChange: (role: MemberRole) => void }) {
  return (
    <Field label="Papel">
      <Select
        fullWidth
        aria-label="Papel"
        value={value}
        onChange={onChange}
        options={ROLES.map(r => ({ value: r.value, label: r.label, description: r.description }))}
      />
    </Field>
  );
}
