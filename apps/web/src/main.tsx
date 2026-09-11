import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  Workflow,
  Settings2,
  Moon,
  Sun,
  Blocks,
  ArrowUpRight,
  MessageSquare,
  BarChart3,
  Radio,
  BookOpen,
  Plug,
  ChevronRight
} from 'lucide-react';
import { IntegrationsPage } from './integrations/IntegrationsPage';
import { Builder } from './builder/Builder';
import { SessionProvider, Settings } from './session';
import { InstanceProvider, useInstance } from './context/InstanceContext';
import { ConnectionsPage } from './connections/ConnectionsPage';
import { KnowledgePage } from './knowledge/KnowledgePage';
import { InboxPage } from './inbox/InboxPage';
import { DashboardPage } from './metrics/DashboardPage';
import './styles.css';

function GlobalTopHeader() {
  const { activeInstance, setActiveInstance, instances } = useInstance();
  const location = useLocation();
  const current = instances.find(i => i.name === activeInstance || i.id === activeInstance);

  const getPageTitle = (path: string) => {
    if (path.startsWith('/flows')) return 'Fluxos & Agentes';
    if (path.startsWith('/connections')) return 'WhatsApp (Instâncias)';
    if (path.startsWith('/integrations')) return 'Integrações Externas';
    if (path.startsWith('/knowledge')) return 'Base de Conhecimento';
    if (path.startsWith('/inbox')) return 'Inbox de Atendimento';
    if (path.startsWith('/dashboard')) return 'Painel de Indicadores';
    if (path.startsWith('/templates')) return 'Biblioteca de Modelos';
    if (path.startsWith('/settings')) return 'Configurações da Plataforma';
    return 'Visão Geral';
  };

  return (
    <header
      style={{
        height: 48,
        borderBottom: '1px solid var(--color-border-secondary)',
        background: 'var(--color-bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>SDR Flow</span>
        <ChevronRight size={13} />
        <span>{getPageTitle(location.pathname)}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-secondary)',
            padding: '4px 10px',
            borderRadius: 8,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: current?.status === 'connected' ? '#16a34a' : '#94a3b8',
              boxShadow: current?.status === 'connected' ? '0 0 0 2px #16a34a22' : 'none',
            }}
            title={current?.status === 'connected' ? 'WhatsApp Conectado' : 'Instância Desconectada'}
          />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Instância:</span>
          <select
            value={activeInstance}
            onChange={e => setActiveInstance(e.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              fontWeight: 700,
              fontSize: 12,
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              outline: 'none',
              padding: '0 4px',
            }}
          >
            {instances.length === 0 ? (
              <option value="">Nenhuma instância</option>
            ) : (
              instances.map(inst => (
                <option key={inst.id} value={inst.name || inst.id}>
                  {inst.name || inst.id} {inst.phone ? `(${inst.phone})` : ''} {inst.status === 'connected' ? '🟢' : '⚪'}
                </option>
              ))
            )}
          </select>
        </div>
      </div>
    </header>
  );
}

function App() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('sdr-flow:theme') === 'dark';
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    document.documentElement.className = dark ? 'dark' : 'light';
    try {
      localStorage.setItem('sdr-flow:theme', dark ? 'dark' : 'light');
    } catch {
      // Theme still works without storage.
    }
  }, [dark]);

  return (
    <SessionProvider>
      <InstanceProvider>
        <BrowserRouter>
          <div className="app-shell">
            <nav className="app-sidebar" aria-label="Navegação principal">
              <Link className="brand" to="/flows/new" title="SDR Flow">
                <Workflow size={27} />
              </Link>
              <div className="sidebar-links">
                <NavLink to="/flows/new" aria-label="Construtor" title="Construtor">
                  <Workflow size={21} />
                  <span>Fluxos</span>
                </NavLink>
                <NavLink to="/connections" aria-label="WhatsApp" title="WhatsApp">
                  <Radio size={21} />
                  <span>WhatsApp</span>
                </NavLink>
                <NavLink to="/integrations" aria-label="Integrações" title="Integrações">
                  <Plug size={21} />
                  <span>Integrações</span>
                </NavLink>
                <NavLink to="/knowledge" aria-label="Base de Conhecimento" title="Base de Conhecimento">
                  <BookOpen size={21} />
                  <span>Conhecimento</span>
                </NavLink>
                <NavLink to="/inbox" aria-label="Inbox" title="Inbox">
                  <MessageSquare size={21} />
                  <span>Inbox</span>
                </NavLink>
                <NavLink to="/dashboard" aria-label="Painel de Indicadores" title="Painel">
                  <BarChart3 size={21} />
                  <span>Painel</span>
                </NavLink>
                <NavLink to="/templates" aria-label="Biblioteca" title="Biblioteca">
                  <Blocks size={21} />
                  <span>Modelos</span>
                </NavLink>
              </div>
              <div className="sidebar-bottom">
                <button
                  onClick={() => setDark(!dark)}
                  aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'}
                  title="Alternar tema"
                >
                  {dark ? <Sun size={20} /> : <Moon size={20} />}
                </button>
                <NavLink to="/settings" title="Configurações" aria-label="Configurações">
                  <Settings2 size={21} />
                </NavLink>
                <span className="avatar">SF</span>
              </div>
            </nav>
            <main style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
              <GlobalTopHeader />
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                <Routes>
                  <Route path="/flows/new" element={<Builder />} />
                  <Route path="/flows" element={<Builder />} />
                  <Route path="/connections" element={<ConnectionsPage />} />
                  <Route path="/integrations" element={<IntegrationsPage />} />
                  <Route path="/knowledge" element={<KnowledgePage />} />
                  <Route path="/inbox" element={<InboxPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route
                    path="/templates"
                    element={
                      <div className="page-content">
                        <span className="eyebrow">BIBLIOTECA</span>
                        <h1>Comece com um caminho pronto</h1>
                        <p className="muted">Modelos editáveis para desenhar o atendimento da sua operação.</p>
                        <Link className="template-card" to="/flows/new">
                          <Workflow size={32} />
                          <h2>Qualificação SDR</h2>
                          <p>Modo teste, guardas, memória comercial, decisão, CRM e encaminhamento humano.</p>
                          <span>
                            Abra o construtor e escolha “Usar modelo SDR”. <ArrowUpRight size={15} />
                          </span>
                        </Link>
                      </div>
                    }
                  />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/flows/new" replace />} />
                </Routes>
              </div>
            </main>
          </div>
        </BrowserRouter>
      </InstanceProvider>
    </SessionProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
