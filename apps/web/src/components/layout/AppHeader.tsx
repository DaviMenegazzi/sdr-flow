import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, Menu, Settings2 } from 'lucide-react';
import { useInstance } from '../../context/InstanceContext';
import { useSession } from '../../session';
import { Popover, Skeleton } from '../ui';
import { formatPhone } from '../../lib/format';

const PAGES: Array<{ prefix: string; title: string; category: string }> = [
  { prefix: '/flows', title: 'Construtor de Fluxos', category: 'Automação' },
  { prefix: '/templates', title: 'Modelos SDR', category: 'Automação' },
  { prefix: '/agents', title: 'Agentes de IA', category: 'Automação' },
  { prefix: '/knowledge', title: 'Base de Conhecimento', category: 'Automação' },
  { prefix: '/connections', title: 'Conexões WhatsApp', category: 'Operação' },
  { prefix: '/inbox', title: 'Atendimento', category: 'Operação' },
  { prefix: '/dashboard', title: 'Indicadores', category: 'Dados' },
  { prefix: '/logs', title: 'Logs de Execução', category: 'Dados' },
  { prefix: '/integrations', title: 'Integrações', category: 'Dados' },
  { prefix: '/settings', title: 'Configurações', category: 'Conta' },
  { prefix: '/admin', title: 'Administração', category: 'Conta' },
];

export function AppHeader({ onOpenNav }: { onOpenNav?: () => void }) {
  const { activeInstance, setActiveInstance, instances, loading } = useInstance();
  const { can } = useSession();
  const location = useLocation();
  const current = instances.find(i => i.name === activeInstance || i.id === activeInstance);
  const page = PAGES.find(p => location.pathname.startsWith(p.prefix));
  const isConnected = current?.status === 'connected';

  return (
    <header className="app-header flex h-14 flex-shrink-0 select-none items-center justify-between gap-3 border-b border-border bg-surface px-4 md:px-5">
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        {onOpenNav && (
          <button
            type="button"
            onClick={onOpenNav}
            aria-label="Abrir menu"
            className="-ml-1 mr-1 flex h-8 w-8 min-h-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-content-secondary hover:bg-surface-elevated hover:text-content md:hidden"
          >
            <Menu size={18} />
          </button>
        )}
        {page && (
          <>
            <span className="hidden text-content-muted sm:inline">{page.category}</span>
            <ChevronRight size={13} className="hidden text-content-muted sm:inline" />
            <span className="truncate font-semibold text-content">{page.title}</span>
          </>
        )}
      </div>

      {can('instances:manage') &&
        (loading ? (
          <div role="status" aria-live="polite" className="w-44">
            <span className="sr-only">Carregando instâncias…</span>
            <Skeleton className="h-8 w-full" rounded="lg" />
          </div>
        ) : (
          <Popover
            align="end"
            width={288}
            className="p-1"
            aria-label="Instância ativa"
            trigger={
              <button
                type="button"
                className="flex h-8 min-h-0 max-w-[240px] items-center gap-2 rounded-full border border-border bg-surface-elevated px-3 text-xs text-content hover:border-border-strong"
              >
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${isConnected ? 'bg-success' : 'bg-content-muted'}`}
                  aria-hidden="true"
                />
                <span className="truncate font-medium">{current?.name || 'Selecionar instância'}</span>
                <ChevronDown size={13} className="flex-shrink-0 text-content-muted" />
              </button>
            }
          >
            {close => (
              <>
                <div className="px-2.5 pb-1 pt-2 text-2xs font-medium text-content-muted">
                  Instância usada no Atendimento, Indicadores e Logs
                </div>
                {instances.length === 0 && (
                  <p className="m-0 px-2.5 py-2 text-xs text-content-secondary">Nenhum número conectado ainda.</p>
                )}
                {instances.map(inst => {
                  const selected = activeInstance === inst.id || activeInstance === inst.name;
                  const connected = inst.status === 'connected';
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => {
                        setActiveInstance(inst.id);
                        close();
                      }}
                      className="flex w-full min-h-0 items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left hover:bg-surface-elevated"
                    >
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${connected ? 'bg-success' : 'bg-content-muted'}`} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-xs font-medium text-content">{inst.name || inst.id}</span>
                        <span className="truncate text-2xs text-content-muted">
                          {connected ? formatPhone(inst.phone) : 'Desconectada'}
                        </span>
                      </span>
                      {selected && <Check size={14} className="flex-shrink-0 text-brand-fg" />}
                    </button>
                  );
                })}
                <div className="my-1 h-px bg-border" />
                <Link
                  to="/connections"
                  onClick={close}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-content-secondary hover:bg-surface-elevated hover:text-content"
                >
                  <Settings2 size={14} /> Gerenciar conexões
                </Link>
              </>
            )}
          </Popover>
        ))}
    </header>
  );
}
