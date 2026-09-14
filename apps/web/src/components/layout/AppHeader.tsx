import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Radio } from 'lucide-react';
import { useInstance } from '../../context/InstanceContext';

export function AppHeader() {
  const { activeInstance, setActiveInstance, instances } = useInstance();
  const location = useLocation();
  const current = instances.find((i) => i.name === activeInstance || i.id === activeInstance);

  const getPageInfo = (path: string) => {
    if (path.startsWith('/flows')) return { title: 'Construtor de Fluxos', category: 'Automação' };
    if (path.startsWith('/connections')) return { title: 'WhatsApp (Instâncias)', category: 'Operação' };
    if (path.startsWith('/integrations')) return { title: 'Integrações Externas', category: 'Dados' };
    if (path.startsWith('/knowledge')) return { title: 'Base de Conhecimento', category: 'Automação' };
    if (path.startsWith('/inbox')) return { title: 'Inbox de Atendimento', category: 'Operação' };
    if (path.startsWith('/dashboard')) return { title: 'Painel de Indicadores', category: 'Inteligência' };
    if (path.startsWith('/templates')) return { title: 'Biblioteca de Modelos', category: 'Automação' };
    if (path.startsWith('/agents')) return { title: 'Agentes de IA', category: 'Automação' };
    if (path.startsWith('/admin')) return { title: 'Administração de Contas', category: 'Sistema' };
    if (path.startsWith('/settings')) return { title: 'Configurações', category: 'Sistema' };
    return { title: 'Visão Geral', category: 'Plataforma' };
  };

  const pageInfo = getPageInfo(location.pathname);
  const isConnected = current?.status === 'connected';

  return (
    <header className="h-12 bg-surface border-b border-border flex items-center justify-between px-5 flex-shrink-0 z-10 select-none">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-content-secondary tracking-tight">SDR Flow</span>
        <ChevronRight size={13} className="text-content-muted" />
        <span className="text-content-muted font-medium">{pageInfo.category}</span>
        <ChevronRight size={13} className="text-content-muted" />
        <span className="font-semibold text-content-primary">{pageInfo.title}</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Instance Selector Pill */}
        <div className="flex items-center gap-2 bg-surface-elevated border border-border px-3 py-1 rounded-lg text-xs transition-colors hover:border-border-strong">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 transition-all ${
              isConnected
                ? 'bg-success shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse'
                : 'bg-content-muted'
            }`}
            title={isConnected ? 'WhatsApp Conectado' : 'Instância Desconectada'}
          />
          <span className="text-[11px] font-medium text-content-secondary">Instância:</span>
          <select
            value={activeInstance}
            onChange={(e) => setActiveInstance(e.target.value)}
            className="bg-transparent font-semibold text-xs text-content-primary cursor-pointer outline-none border-none p-0 pr-1"
          >
            {instances.length === 0 ? (
              <option value="">Nenhuma instância</option>
            ) : (
              instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name || inst.id} {inst.phone ? `(${inst.phone})` : ''} {inst.status === 'connected' ? '●' : '○'}
                </option>
              ))
            )}
          </select>
          <Link
            to="/connections"
            className="text-content-muted hover:text-brand transition-colors ml-1 p-0.5"
            title="Gerenciar Conexões WhatsApp"
          >
            <Radio size={12} />
          </Link>
        </div>
      </div>
    </header>
  );
}
