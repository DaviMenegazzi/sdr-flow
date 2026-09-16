import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  Workflow,
  Radio,
  Users,
  Plug,
  BookOpen,
  MessageSquare,
  BarChart3,
  Blocks,
  Settings2,
  Moon,
  Sun,
  LogOut,
  Shield,
  ScrollText,
} from 'lucide-react';
import { useSession } from '../../session';

interface AppSidebarProps {
  dark: boolean;
  onToggleTheme: () => void;
}

export function AppSidebar({ dark, onToggleTheme }: AppSidebarProps) {
  const { session, profile, signOut, activeOrg, organizations } = useSession();
  const currentOrg = organizations.find((o) => o.id === activeOrg);

  const userEmail = session?.user?.email ?? '';
  const displayName =
    (session?.user?.user_metadata?.display_name as string | undefined) ||
    userEmail.split('@')[0] ||
    'Usuário';

  const getInitials = (text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return 'SF';
    const parts = cleaned.split(/\s+/);
    if (parts.length > 1 && parts[0] && parts[1]) {
      return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
    }
    return cleaned.slice(0, 2).toUpperCase();
  };

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 ${
      isActive
        ? 'bg-brand/10 text-brand font-semibold shadow-xs'
        : 'text-content-secondary hover:text-content-primary hover:bg-surface-elevated'
    }`;

  return (
    <aside className="w-56 bg-surface border-r border-border flex flex-col h-full flex-shrink-0 select-none z-20">
      {/* Brand Header */}
      <div className="p-4 pb-3 border-b border-border/60">
        <Link to="/flows/new" className="flex flex-col gap-1 group">
          <div className="flex items-center gap-2">
            <div className="flex items-baseline font-black text-xl tracking-tight select-none">
              <span className="text-content-primary font-black">pro</span>
              <span className="text-content-muted font-mono font-normal">(</span>
              <span className="text-[#2ee86b] font-black drop-shadow-[0_0_12px_rgba(46,232,107,0.4)]">digi</span>
              <span className="text-content-muted font-mono font-normal">)</span>
            </div>
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#2ee86b]/10 text-[#2ee86b] border border-[#2ee86b]/30 shadow-[0_0_8px_rgba(46,232,107,0.15)]">
              SDR Flow
            </span>
          </div>
          <span className="text-[10px] text-content-muted truncate max-w-[170px] pl-0.5">
            {currentOrg?.name || 'Workspace'}
          </span>
        </Link>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Operação */}
        <div>
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-content-muted">
            Operação
          </span>
          <div className="mt-1 space-y-0.5">
            <NavLink to="/inbox" className={navItemClass}>
              <MessageSquare size={16} />
              <span>Atendimento (Inbox)</span>
            </NavLink>
            <NavLink to="/connections" className={navItemClass}>
              <Radio size={16} />
              <span>WhatsApp Instâncias</span>
            </NavLink>
          </div>
        </div>

        {/* Automação & IA */}
        <div>
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-content-muted">
            Automação & IA
          </span>
          <div className="mt-1 space-y-0.5">
            <NavLink to="/flows/new" className={navItemClass}>
              <Workflow size={16} />
              <span>Construtor de Fluxos</span>
            </NavLink>
            <NavLink to="/templates" className={navItemClass}>
              <Blocks size={16} />
              <span>Modelos SDR</span>
            </NavLink>
            <NavLink to="/agents" className={navItemClass}>
              <Users size={16} />
              <span>Agentes de IA</span>
            </NavLink>
            <NavLink to="/knowledge" className={navItemClass}>
              <BookOpen size={16} />
              <span>Base Conhecimento</span>
            </NavLink>
          </div>
        </div>

        {/* Inteligência & Dados */}
        <div>
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-content-muted">
            Inteligência & Dados
          </span>
          <div className="mt-1 space-y-0.5">
            <NavLink to="/dashboard" className={navItemClass}>
              <BarChart3 size={16} />
              <span>Indicadores (KPIs)</span>
            </NavLink>
            <NavLink to="/logs" className={navItemClass}>
              <ScrollText size={16} />
              <span>Logs de Execução</span>
            </NavLink>
            <NavLink to="/integrations" className={navItemClass}>
              <Plug size={16} />
              <span>Integrações Externas</span>
            </NavLink>
          </div>
        </div>

        {/* Sistema */}
        <div>
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-content-muted">
            Sistema
          </span>
          <div className="mt-1 space-y-0.5">
            <NavLink to="/settings" className={navItemClass}>
              <Settings2 size={16} />
              <span>Configurações</span>
            </NavLink>
            {profile?.role === 'admin' && (
              <NavLink to="/admin" className={navItemClass}>
                <Shield size={16} />
                <span>Administração</span>
              </NavLink>
            )}
          </div>
        </div>
      </div>

      {/* Footer: Theme Toggle & User Info */}
      <div className="p-3 border-t border-border/60 bg-surface-subtle/50 space-y-2">
        <button
          type="button"
          onClick={onToggleTheme}
          className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium text-content-secondary hover:text-content-primary hover:bg-surface-elevated transition-colors"
          title={dark ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}
        >
          <span className="flex items-center gap-2">
            {dark ? <Sun size={15} className="text-warning" /> : <Moon size={15} className="text-content-secondary" />}
            <span>{dark ? 'Modo Claro' : 'Modo Escuro'}</span>
          </span>
          <span className="text-[10px] px-1.5 py-0.5 bg-surface-elevated border border-border rounded text-content-muted font-mono">
            {dark ? 'Dark' : 'Light'}
          </span>
        </button>

        {/* User Card */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-surface border border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-brand/10 border border-brand/20 text-brand font-bold text-xs flex items-center justify-center flex-shrink-0">
              {getInitials(displayName)}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-content-primary truncate">
                {displayName}
              </span>
              <span className="text-[10px] text-content-muted truncate">
                {profile?.role || 'membro'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="p-1.5 text-content-muted hover:text-danger hover:bg-danger/10 rounded-md transition-colors"
            title="Sair da Plataforma"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
