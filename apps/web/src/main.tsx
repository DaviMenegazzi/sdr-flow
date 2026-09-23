import React, { useState, useEffect, Suspense, lazy, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Workflow, ArrowUpRight, RefreshCw } from 'lucide-react';
import { SessionProvider, useSession } from './session';
import type { Capability } from '@sdr/shared';
import { InstanceProvider } from './context/InstanceContext';
import { AuthCallback, AuthGate, ForgotPasswordPage, LoginPage, NotFoundPage, RegisterPage, ResetPasswordPage } from './auth-pages';
import { AppSidebar } from './components/layout/AppSidebar';
import { AppHeader } from './components/layout/AppHeader';
import { ConfirmHost, Skeleton, Toaster } from './components/ui';
import '@fontsource-variable/inter';
import '@fontsource/sora/700.css';
import './styles.css';

// Fase 5 (11.4): every main route below is code-split — shell, auth and navigation (imported
// above) are the only things that must stay in the initial chunk. Settings lives in its own
// module (settings/SettingsPage), so it is split like the other pages.
const Builder = lazy(() => import('./builder/Builder').then(m => ({ default: m.Builder })));
const ConnectionsPage = lazy(() => import('./connections/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })));
const AgentsPage = lazy(() => import('./agents/AgentsPage').then(m => ({ default: m.AgentsPage })));
const AgentEditorPage = lazy(() => import('./agents/AgentEditorPage').then(m => ({ default: m.AgentEditorPage })));
const AdminPage = lazy(() => import('./admin/AdminPage').then(m => ({ default: m.AdminPage })));
const IntegrationsPage = lazy(() => import('./integrations/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
const KnowledgePage = lazy(() => import('./knowledge/KnowledgePage').then(m => ({ default: m.KnowledgePage })));
const TrainingPage = lazy(() => import('./training/TrainingPage').then(m => ({ default: m.TrainingPage })));
const InboxPage = lazy(() => import('./inbox/InboxPage').then(m => ({ default: m.InboxPage })));
const DashboardPage = lazy(() => import('./metrics/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ExecutionLogPage = lazy(() => import('./logs/ExecutionLogPage').then(m => ({ default: m.ExecutionLogPage })));
const Settings = lazy(() => import('./settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const BillingPage = lazy(() => import('./billing/BillingPage').then(m => ({ default: m.BillingPage })));
const BillingReturnPage = lazy(() => import('./billing/BillingReturnPage').then(m => ({ default: m.BillingReturnPage })));
// Public pages (LP and pricing) live in their own chunks so the app shell stays small.
const LandingPage = lazy(() => import('./billing/LandingPage').then(m => ({ default: m.LandingPage })));
const PricingPage = lazy(() => import('./billing/PricingPage').then(m => ({ default: m.PricingPage })));

function RouteLoadingFallback() {
  return (
    <div role="status" aria-live="polite" className="flex-1 p-6 md:p-8">
      <span className="sr-only">Carregando…</span>
      <div className="mx-auto max-w-6xl space-y-6" aria-hidden="true">
        <div className="space-y-2">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-40 w-full" rounded="lg" />)}
        </div>
        <Skeleton className="h-72 w-full" rounded="lg" />
      </div>
    </div>
  );
}

function RequireCapability({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { can, loading } = useSession();
  if (loading) return <RouteLoadingFallback />;
  return can(capability) ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

// A lazy route's chunk can fail to load (a new deploy invalidated the old hashed filename while
// this tab was still open) — that throws during render, which Suspense alone does not catch
// (11.6.10: "falha de chunk apresenta estado recuperável"). A full reload always recovers since
// it fetches the current manifest.
class RouteErrorBoundary extends React.Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-content-muted">
          <p className="text-sm m-0">Não foi possível carregar esta página.</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-fg bg-transparent border-0 cursor-pointer underline hover:no-underline"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedApp() {
  const location = useLocation();
  // Below md the sidebar is an off-canvas drawer opened from the header.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('sdr-flow:theme');
      return saved ? saved === 'dark' : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    // Keep the browser chrome (status bar / tab strip) in step with the app theme.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0a' : '#ffffff');
    try {
      localStorage.setItem('sdr-flow:theme', dark ? 'dark' : 'light');
    } catch {
      // Theme still works without storage.
    }
  }, [dark]);

  return (
    <InstanceProvider>
      <div className="flex h-[100dvh] w-full overflow-hidden bg-canvas text-content-primary">
        <AppSidebar dark={dark} onToggleTheme={() => setDark(!dark)} mobileOpen={navOpen} />
        {navOpen && (
          <div
            className="md:hidden fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm motion-overlay"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
        )}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <AppHeader onOpenNav={() => setNavOpen(true)} />
          <main className="flex-1 min-h-0 overflow-auto flex flex-col bg-canvas">
            <RouteErrorBoundary>
            <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/flows/new" element={<RequireCapability capability="flows:read"><Builder /></RequireCapability>} />
              <Route path="/flows" element={<RequireCapability capability="flows:read"><Builder /></RequireCapability>} />
              <Route path="/connections" element={<RequireCapability capability="instances:manage"><ConnectionsPage /></RequireCapability>} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/:agentId" element={<AgentEditorPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/integrations" element={<RequireCapability capability="integrations:manage"><IntegrationsPage /></RequireCapability>} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/training" element={<TrainingPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/logs" element={<RequireCapability capability="flows:read"><ExecutionLogPage /></RequireCapability>} />
              <Route
                path="/templates"
                element={
                  <RequireCapability capability="flows:read"><div className="p-8 max-w-4xl mx-auto w-full">
                    <span className="text-2xs font-bold uppercase tracking-wider text-brand-fg">
                      BIBLIOTECA DE MODELOS
                    </span>
                    <h1 className="text-2xl font-bold tracking-tight text-content-primary mt-2">
                      Modelos SDR
                    </h1>
                    <p className="text-xs text-content-secondary mt-1 max-w-xl">
                      Modelos prontos e parametrizados para qualificação, agendamento de consultas e atendimento humanizado.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                      <Link
                        to="/flows/new"
                        className="group p-6 rounded-xl bg-surface border border-border hover:border-brand transition-[border-color,box-shadow] duration-200 ease-out shadow-subtle hover:shadow-elevated flex flex-col justify-between"
                      >
                        <div>
                          <div className="w-10 h-10 rounded-lg bg-brand/10 text-brand-fg flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                            <Workflow size={22} />
                          </div>
                          <h2 className="text-base font-semibold text-content-primary group-hover:text-brand-fg transition-colors">
                            Qualificação SDR Vida Card
                          </h2>
                          <p className="text-xs text-content-secondary mt-2 leading-relaxed">
                            Modo teste, guardas de segurança comercial, qualificação progressiva, memória de lead e encaminhamento para vendedor humano.
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-brand-fg mt-6">
                          <span>Abrir e editar modelo</span>
                          <ArrowUpRight size={14} />
                        </div>
                      </Link>
                    </div>
                  </div></RequireCapability>
                }
              />
              <Route path="/settings" element={<Settings />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/billing/return" element={<BillingReturnPage />} />
              <Route path="*" element={<Navigate to="/404" replace />} />
            </Routes>
            </Suspense>
            </RouteErrorBoundary>
          </main>
        </div>
      </div>
    </InstanceProvider>
  );
}


function PublicFallback() {
  return <div role="status" aria-live="polite" className="dark min-h-[100dvh] bg-canvas"><span className="sr-only">Carregando…</span></div>;
}

function App(){return <SessionProvider><BrowserRouter><Suspense fallback={<PublicFallback/>}><Routes><Route path="/" element={<LandingPage/>}/><Route path="/pricing" element={<PricingPage/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<RegisterPage/>}/><Route path="/forgot-password" element={<ForgotPasswordPage/>}/><Route path="/reset-password" element={<ResetPasswordPage/>}/><Route path="/auth/callback" element={<AuthCallback/>}/><Route path="/404" element={<NotFoundPage/>}/><Route path="/*" element={<AuthGate><ProtectedApp/></AuthGate>}/></Routes></Suspense><Toaster/><ConfirmHost/></BrowserRouter></SessionProvider>}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
