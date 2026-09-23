import React from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Workflow,
  Radio,
  Users,
  Plug,
  BookOpen,
  MessageSquare,
  BarChart3,
  Settings2,
  Moon,
  Sun,
  LogOut,
  Shield,
  ScrollText,
  ChevronsUpDown,
  Check,
  Plus,
  CreditCard,
  Sparkles,
} from 'lucide-react';
import { useSession } from '../../session';
import { ProdigiWordmark } from './ProdigiWordmark';
import { DropdownMenu, Popover, type MenuItem } from '../ui';

interface AppSidebarProps {
  dark: boolean;
  onToggleTheme: () => void;
  /** Mobile only: whether the off-canvas drawer is open. Always visible from md up. */
  mobileOpen?: boolean;
}

const tierLabels: Record<string, string> = {
  'pre-venda': 'Pré-Venda',
  vendedor: 'Vendedor',
  'vendedor-senior': 'Sênior',
};

const roleLabels: Record<string, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  agent: 'Atendente',
  viewer: 'Leitor',
};

function initials(text: string) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  return (parts[0] ?? 'SF').slice(0, 2).toUpperCase();
}

export function AppSidebar({ dark, onToggleTheme, mobileOpen = false }: AppSidebarProps) {
  const { session, profile, signOut, activeOrg, organizations, activeTier, activeRole, can, setActiveOrg } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const currentOrg = organizations.find(o => o.id === activeOrg);
  const tierName = activeTier ? tierLabels[activeTier] || activeTier.charAt(0).toUpperCase() + activeTier.slice(1) : null;
  const isPlatformAdmin = profile?.role === 'admin';

  const userEmail = session?.user?.email ?? '';
  const displayName =
    (session?.user?.user_metadata?.display_name as string | undefined) || userEmail.split('@')[0] || 'Usuário';

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-150 ease-out ${
      isActive ? 'bg-brand/10 text-brand-fg font-semibold' : 'text-content-secondary hover:bg-surface-elevated hover:text-content'
    }`;

  const section = (label: string, children: React.ReactNode) => (
    <div>
      <span className="px-2.5 text-2xs font-semibold uppercase tracking-wider text-content-muted">{label}</span>
      <div className="mt-1 space-y-0.5">{children}</div>
    </div>
  );

  const userMenu: MenuItem[] = [
    { type: 'label', label: userEmail || displayName },
    {
      label: dark ? 'Mudar para tema claro' : 'Mudar para tema escuro',
      icon: dark ? <Sun size={14} /> : <Moon size={14} />,
      onSelect: onToggleTheme,
    },
    { label: 'Configurações', icon: <Settings2 size={14} />, onSelect: () => navigate('/settings') },
    ...(isPlatformAdmin
      ? [{ label: 'Administração', icon: <Shield size={14} />, onSelect: () => navigate('/admin') } as MenuItem]
      : []),
    { type: 'separator' },
    { label: 'Sair', icon: <LogOut size={14} />, onSelect: () => void signOut() },
  ];

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-64 md:static md:z-20 md:w-56 md:translate-x-0 bg-surface border-r border-border flex flex-col h-full flex-shrink-0 select-none transition-transform duration-[320ms] ease-drawer motion-reduce:transition-none ${
        mobileOpen ? 'translate-x-0 shadow-modal' : '-translate-x-full'
      }`}
      aria-label="Navegação principal"
    >
      <div className="px-3 pb-3 pt-4">
        <Link to="/dashboard" className="sidebar-brand-link ml-1.5" aria-label="Prodigi — ir para os indicadores">
          <ProdigiWordmark />
        </Link>

        {/* Organization switcher: the active organization is global context, so it lives here. */}
        <Popover
          align="start"
          width={232}
          className="p-1"
          block
          trigger={
            <button
              type="button"
              className="mt-3 flex h-9 w-full min-h-0 items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 text-left text-xs text-content hover:border-border-strong"
            >
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-medium">{currentOrg?.name || 'Organização'}</span>
              {tierName && (
                <span className="flex-shrink-0 rounded-full border border-success-border bg-brand-subtle px-1.5 text-2xs font-semibold text-brand-fg">
                  {tierName}
                </span>
              )}
              <ChevronsUpDown size={13} className="flex-shrink-0 text-content-muted" />
            </button>
          }
        >
          {close => (
            <>
              <div className="px-2.5 pb-1 pt-2 text-2xs font-medium text-content-muted">Organizações</div>
              {organizations.map(org => (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => {
                    setActiveOrg(org.id);
                    close();
                  }}
                  className="flex w-full min-h-0 items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-xs text-content hover:bg-surface-elevated"
                >
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {org.id === activeOrg && <Check size={14} className="text-brand-fg" />}
                </button>
              ))}
              {isPlatformAdmin && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      navigate('/settings?section=new-org');
                    }}
                    className="flex w-full min-h-0 items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-xs text-content-secondary hover:bg-surface-elevated hover:text-content"
                  >
                    <Plus size={14} /> Nova organização
                  </button>
                </>
              )}
            </>
          )}
        </Popover>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {section(
          'Operação',
          <>
            {can('inbox:read') && (
              <NavLink to="/inbox" className={navItemClass}>
                <MessageSquare size={16} />
                <span>Atendimento</span>
              </NavLink>
            )}
            {can('instances:manage') && (
              <NavLink to="/connections" className={navItemClass}>
                <Radio size={16} />
                <span>Conexões WhatsApp</span>
              </NavLink>
            )}
          </>
        )}
        {section(
          'Automação & IA',
          <>
            {can('flows:read') && (
              <NavLink to="/flows" className={({ isActive }) => navItemClass({ isActive: isActive || location.pathname.startsWith('/templates') })}>
                <Workflow size={16} />
                <span>Construtor de Fluxos</span>
              </NavLink>
            )}
            <NavLink to="/agents" className={navItemClass}>
              <Users size={16} />
              <span>Agentes de IA</span>
            </NavLink>
            <NavLink to="/knowledge" className={navItemClass}>
              <BookOpen size={16} />
              <span>Base de Conhecimento</span>
            </NavLink>
            <NavLink to="/training" className={navItemClass}>
              <Sparkles size={16} />
              <span>Treinar meu SDR</span>
            </NavLink>
          </>
        )}
        {section(
          'Dados',
          <>
            {can('dashboard:read') && (
              <NavLink to="/dashboard" className={navItemClass}>
                <BarChart3 size={16} />
                <span>Indicadores</span>
              </NavLink>
            )}
            {can('flows:read') && (
              <NavLink to="/logs" className={navItemClass}>
                <ScrollText size={16} />
                <span>Logs de Execução</span>
              </NavLink>
            )}
            {can('integrations:manage') && (
              <NavLink to="/integrations" className={navItemClass}>
                <Plug size={16} />
                <span>Integrações</span>
              </NavLink>
            )}
          </>
        )}
        {section(
          'Conta',
          <>
            <NavLink to="/billing" className={navItemClass}>
              <CreditCard size={16} />
              <span>Plano e cobrança</span>
            </NavLink>
          </>
        )}
      </nav>

      {/* Upgrade entry point: only the owner can buy, and only while a higher plan exists. */}
      {activeRole === 'owner' && activeTier !== 'vendedor-senior' && (
        <div className="px-3 pb-2">
          <Link
            to="/billing"
            className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/10 px-2.5 py-2 text-xs font-semibold text-brand-fg no-underline transition-colors hover:border-brand/60"
          >
            <Sparkles size={14} aria-hidden="true" />
            Fazer upgrade do plano
          </Link>
        </div>
      )}

      {/* One place for everything that is "mine": theme, settings, admin, sign out. */}
      <div className="border-t border-border p-3">
        <DropdownMenu
          side="top"
          align="start"
          width={232}
          block
          aria-label="Menu da conta"
          items={userMenu}
          trigger={
            <button
              type="button"
              className="flex w-full min-h-0 items-center gap-2.5 rounded-lg border-0 bg-transparent p-1.5 text-left hover:bg-surface-elevated"
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-brand/20 bg-brand/10 text-2xs font-bold text-brand-fg">
                {initials(displayName)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-semibold text-content">{displayName}</span>
                <span className="truncate text-2xs text-content-muted">
                  {(activeRole && roleLabels[activeRole]) || (isPlatformAdmin ? 'Administrador' : 'Membro')}
                </span>
              </span>
              <ChevronsUpDown size={13} className="flex-shrink-0 text-content-muted" />
            </button>
          }
        />
      </div>
    </aside>
  );
}
