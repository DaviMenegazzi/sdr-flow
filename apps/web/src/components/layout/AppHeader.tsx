import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Radio, Sparkles } from 'lucide-react';
import { useInstance } from '../../context/InstanceContext';
import { useSession } from '../../session';
import { Skeleton } from '../ui';

export function AppHeader() {
  const { activeInstance, setActiveInstance, instances, loading } = useInstance();
  const { can } = useSession();
  const location = useLocation();
  const current = instances.find((i) => i.name === activeInstance || i.id === activeInstance);
  const [instanceMenuOpen, setInstanceMenuOpen] = React.useState(false);
  const instanceMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!instanceMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!instanceMenuRef.current?.contains(event.target as Node)) setInstanceMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInstanceMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [instanceMenuOpen]);

  const getPageInfo = (path: string) => {
    if (path.startsWith('/flows')) return { title: 'Construtor de Fluxos', category: 'Automação' };
    if (path.startsWith('/connections')) return { title: 'Conexões WhatsApp', category: 'Operação' };
    if (path.startsWith('/integrations')) return { title: 'Integrações Externas', category: 'Dados' };
    if (path.startsWith('/knowledge')) return { title: 'Base de Conhecimento', category: 'Automação' };
    if (path.startsWith('/inbox')) return { title: 'Atendimento', category: 'Operação' };
    if (path.startsWith('/dashboard')) return { title: 'Indicadores', category: 'Inteligência' };
    if (path.startsWith('/templates')) return { title: 'Modelos SDR', category: 'Automação' };
    if (path.startsWith('/agents')) return { title: 'Agentes de IA', category: 'Automação' };
    if (path.startsWith('/admin')) return { title: 'Administração', category: 'Sistema' };
    if (path.startsWith('/settings')) return { title: 'Configurações', category: 'Sistema' };
    return { title: 'Visão Geral', category: 'Plataforma' };
  };

  const pageInfo = getPageInfo(location.pathname);
  const isConnected = current?.status === 'connected';

  return (
    <header className="app-header h-14 bg-surface border-b border-border flex items-center justify-between px-5 flex-shrink-0 z-10 select-none">
      <div className="app-header-breadcrumb flex items-center gap-2 text-xs min-w-0">
        <Link to="/dashboard" className="app-header-home flex items-center gap-2 font-semibold text-content-primary tracking-tight">
          <span className="app-header-mark" aria-hidden="true"><Sparkles size={13} /></span>
          <span>SDR Flow</span>
        </Link>
        <ChevronRight size={13} className="text-content-muted" />
        <span className="app-header-category text-content-muted font-medium">{pageInfo.category}</span>
        <ChevronRight size={13} className="text-content-muted" />
        <span className="app-header-title font-semibold text-content-primary truncate">{pageInfo.title}</span>
      </div>

      {can('instances:manage') && <div className="app-header-context flex items-center gap-2">
        {loading ? (
          <div role="status" aria-live="polite" className="w-64 rounded-xl border border-border bg-surface-elevated px-3 py-2">
            <span className="sr-only">Carregando instâncias…</span>
            <div className="flex items-center gap-2" aria-hidden="true">
              <Skeleton className="h-2 w-2 shrink-0" rounded="full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-2 w-16" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          </div>
        ) : (
        <div className="app-header-connection flex items-center gap-2 bg-surface-elevated border border-border px-2.5 py-1 rounded-xl text-xs transition-colors hover:border-border-strong">
          <span
            className={`app-header-status w-2 h-2 rounded-full flex-shrink-0 transition-[background-color,box-shadow] duration-150 ease-out ${
              isConnected
                ? 'bg-success shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse'
                : 'bg-content-muted'
            }`}
            title={isConnected ? 'WhatsApp Conectado' : 'Instância Desconectada'}
          />
          <div className="app-header-connection-copy">
            <span>Canal ativo</span>
            <strong>{current?.name || 'Nenhuma instância'}</strong>
          </div>
          <div className="app-header-select-wrap" ref={instanceMenuRef}>
            <button
              type="button"
              className="app-header-instance-trigger"
              aria-label="Instância ativa"
              aria-haspopup="listbox"
              aria-expanded={instanceMenuOpen}
              disabled={instances.length === 0}
              onClick={() => setInstanceMenuOpen((open) => !open)}
            >
              <span className="app-header-instance-value">{current?.name || 'Selecionar instância'}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {instanceMenuOpen && instances.length > 0 && (
              <div className="app-header-instance-menu" role="listbox" aria-label="Selecionar instância WhatsApp">
                {instances.map((inst) => {
                  const selected = activeInstance === inst.id || activeInstance === inst.name;
                  const connected = inst.status === 'connected';
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`app-header-instance-option ${selected ? 'is-selected' : ''}`}
                      onClick={() => {
                        setActiveInstance(inst.id);
                        setInstanceMenuOpen(false);
                      }}
                    >
                      <span className="app-header-instance-option-main">
                        <span className={`app-header-instance-option-dot ${connected ? 'is-connected' : ''}`} />
                        <span className="app-header-instance-option-copy">
                          <strong>{inst.name || inst.id}</strong>
                          <small>{inst.phone || 'Número não informado'}</small>
                        </span>
                      </span>
                      <span className="app-header-instance-option-mark">{selected ? '✓' : connected ? 'Ativo' : ''}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Link
            to="/connections"
            className="app-header-connection-action text-content-muted hover:text-brand-fg transition-colors ml-1 p-1"
            title="Gerenciar Conexões WhatsApp"
          >
            <Radio size={12} />
          </Link>
        </div>
        )}
      </div>}
    </header>
  );
}
