import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Layers,
  Link2,
  Unlink,
  ChevronRight,
  Database,
  ArrowRight,
  Info,
  Radio,
  Settings2,
  Lock
} from 'lucide-react';
import { useInstance } from '../context/InstanceContext';

interface Integration {
  id: string;
  provider: 'google_calendar' | 'hubspot' | 'rdstation' | 'kommo';
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  accountEmail?: string;
  instanceId?: string;
  connectedAt?: string;
  updatedAt?: string;
  hasRefreshToken?: boolean;
  hasAccessToken?: boolean;
  metadata?: Record<string, any>;
}

interface CalendarItem {
  id: string;
  summary: string;
  primary?: boolean;
  description?: string;
}

export function IntegrationsPage() {
  const { activeInstance, setActiveInstance, instances, loading: loadingInstances } = useInstance();

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Platform Google configuration state (from /api/settings)
  const [googlePlatformConfigured, setGooglePlatformConfigured] = useState(false);
  const [showAdminNoticeModal, setShowAdminNoticeModal] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  // Synchronized calendars list for active instance
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const fetchPlatformSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setGooglePlatformConfigured(Boolean(data.googleClientIdConfigured));
      }
    } catch {
      // ignore
    }
  };

  const fetchIntegrations = async () => {
    setLoading(true);
    try {
      const url = activeInstance
        ? `/api/integrations?instanceId=${encodeURIComponent(activeInstance)}`
        : '/api/integrations';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setIntegrations(Array.isArray(data) ? data : []);
      }
    } catch {
      setMessage({ type: 'error', text: 'Não foi possível carregar as conexões externas.' });
    } finally {
      setLoading(false);
    }
  };

  const fetchCalendars = async () => {
    if (!activeInstance) return;
    setLoadingCalendars(true);
    try {
      const res = await fetch(`/api/integrations/google/calendars?instanceId=${encodeURIComponent(activeInstance)}`);
      if (res.ok) {
        const data = await res.json();
        setCalendars(Array.isArray(data) ? data : []);
      } else {
        setCalendars([]);
      }
    } catch {
      setCalendars([]);
    } finally {
      setLoadingCalendars(false);
    }
  };

  useEffect(() => {
    void fetchPlatformSettings();
  }, []);

  useEffect(() => {
    void fetchIntegrations();
  }, [activeInstance]);

  const googleIntegration = integrations.find(
    i => i.provider === 'google_calendar' && i.status === 'connected' && (!i.instanceId || i.instanceId === activeInstance)
  );

  useEffect(() => {
    if (googleIntegration && activeInstance) {
      void fetchCalendars();
    } else {
      setCalendars([]);
    }
  }, [googleIntegration?.id, activeInstance]);

  // Listener para capturar quando o popup do Google fechar com sucesso
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_OAUTH_SUCCESS') {
        setConnectingGoogle(false);
        setMessage({
          type: 'success',
          text: `Google Calendar conectado com sucesso para a instância "${event.data.instanceId || activeInstance}" (${event.data.email || 'Conta Google'})!`,
        });
        void fetchIntegrations();
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [activeInstance]);

  const handleStartGoogleOAuth = async () => {
    if (!activeInstance) {
      setMessage({ type: 'error', text: 'Selecione ou conecte uma instância do WhatsApp primeiro.' });
      return;
    }

    if (!googlePlatformConfigured) {
      setShowAdminNoticeModal(true);
      return;
    }

    setConnectingGoogle(true);
    try {
      const res = await fetch(`/api/integrations/google/auth-url?instanceId=${encodeURIComponent(activeInstance)}`);
      const data = await res.json();
      if (res.ok && data.url) {
        const popup = window.open(data.url, 'google_oauth_popup', 'width=560,height=700,status=no,toolbar=no,menubar=no');
        setMessage({
          type: 'info',
          text: `Janela do Google aberta para a instância "${activeInstance}". Autorize o acesso para concluir automaticamente.`,
        });
        const timer = setInterval(() => {
          if (popup && popup.closed) {
            clearInterval(timer);
            setConnectingGoogle(false);
          }
        }, 1200);
      } else {
        setMessage({ type: 'error', text: data.error || 'Falha ao iniciar autenticação Google.' });
        setConnectingGoogle(false);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao comunicar com o servidor.' });
      setConnectingGoogle(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm(`Deseja realmente desconectar o Google Calendar da instância "${activeInstance}"?`)) return;
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        setMessage({ type: 'success', text: `Google Calendar desconectado da instância "${activeInstance}".` });
        void fetchIntegrations();
        setCalendars([]);
      }
    } catch {
      setMessage({ type: 'error', text: 'Falha ao desconectar integração.' });
    }
  };

  const currentInstanceObj = instances.find(i => i.name === activeInstance || i.id === activeInstance);

  return (
    <div className="page-content" style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header com Seletor de Instância */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-secondary)', fontSize: 12, marginBottom: 8 }}>
          <span>Painel</span>
          <ChevronRight size={13} />
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Conexões Externas & Integrações</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px', color: 'var(--color-text-primary)' }}>
              Integrações por Instância
            </h1>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 13, maxWidth: 650 }}>
              Cada instância do WhatsApp conecta sua própria agenda Google e ferramentas externas. Selecione a instância abaixo para gerenciar suas conexões.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Seletor de Instância Ativa */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                padding: '6px 12px',
                borderRadius: 8,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <Radio size={15} color={currentInstanceObj?.status === 'connected' ? '#16a34a' : '#94a3b8'} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Instância:</span>
              <select
                value={activeInstance}
                onChange={e => setActiveInstance(e.target.value)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontWeight: 700,
                  fontSize: 13,
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                {instances.length === 0 ? (
                  <option value="">Nenhuma instância encontrada</option>
                ) : (
                  instances.map(inst => (
                    <option key={inst.id} value={inst.name || inst.id}>
                      {inst.name || inst.id} {inst.phone ? `(${inst.phone})` : ''} {inst.status === 'connected' ? '🟢' : '⚪'}
                    </option>
                  ))
                )}
              </select>
            </div>

            <button
              onClick={() => { setLoading(true); void fetchIntegrations(); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 12px' }}
              title="Recarregar integrações"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Alerta de Status da Plataforma (se o admin não tiver configurado ainda) */}
      {!googlePlatformConfigured && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 24,
            fontSize: 13,
            background: '#fffbeb',
            color: '#b45309',
            border: '1px solid #fde68a',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertCircle size={18} color="#d97706" />
            <span>
              <strong>Credenciais globais do Google não configuradas:</strong> O administrador precisa cadastrar o Google Client ID e Secret nas configurações da plataforma para habilitar o login em 1 clique.
            </span>
          </div>
          <Link
            to="/settings"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              color: '#d97706',
              textDecoration: 'underline',
              whiteSpace: 'nowrap',
            }}
          >
            <Settings2 size={13} /> Configurar Agora
          </Link>
        </div>
      )}

      {/* Alertas dinâmicos */}
      {message && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 24,
            fontSize: 13,
            background: message.type === 'success' ? '#f0fdf4' : message.type === 'error' ? '#fef2f2' : '#eff6ff',
            color: message.type === 'success' ? '#15803d' : message.type === 'error' ? '#b91c1c' : '#1d4ed8',
            border: `1px solid ${message.type === 'success' ? '#bbf7d0' : message.type === 'error' ? '#fecaca' : '#bfdbfe'}`,
          }}
        >
          {message.type === 'success' && <CheckCircle2 size={16} />}
          {message.type === 'error' && <AlertCircle size={16} />}
          {message.type === 'info' && <Info size={16} />}
          <span style={{ flex: 1 }}>{message.text}</span>
          <button
            onClick={() => setMessage(null)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2, color: 'inherit', minHeight: 'auto' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Grid de Integrações */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
        
        {/* Card Google Calendar (1-Clique por Instância) */}
        <div
          style={{
            background: 'var(--color-bg-primary)',
            border: `1px solid ${googleIntegration ? '#16a34a44' : 'var(--color-border-secondary)'}`,
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            boxShadow: 'var(--shadow)',
            transition: 'border-color 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: '#2563eb12',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#2563eb',
                }}
              >
                <Calendar size={24} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>Google Calendar</h3>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  Instância: <strong>{activeInstance || 'Nenhuma'}</strong>
                </span>
              </div>
            </div>

            {googleIntegration ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#16a34a',
                  background: '#16a34a15',
                  padding: '4px 8px',
                  borderRadius: 6,
                }}
              >
                <CheckCircle2 size={13} /> Conectado
              </span>
            ) : (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                  background: 'var(--color-bg-secondary)',
                  padding: '4px 8px',
                  borderRadius: 6,
                }}
              >
                Desconectado
              </span>
            )}
          </div>

          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
            Vincula a agenda Google específica desta instância para que o bot SDR consulte horários livres, faça agendamentos e envie convites oficiais aos leads.
          </p>

          {googleIntegration ? (
            <div style={{ background: 'var(--color-bg-secondary)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>Conta Google:</span>
                <strong style={{ color: 'var(--color-text-primary)' }}>{googleIntegration.accountEmail || 'Conectada via OAuth'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>Calendários Ativos:</span>
                <span>{loadingCalendars ? 'Carregando...' : `${calendars.length} encontrado(s)`}</span>
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--color-bg-secondary)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              Nenhuma conta Google conectada para a instância <strong>{activeInstance}</strong>. Conecte com 1 clique abaixo.
            </div>
          )}

          <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
            {googleIntegration ? (
              <>
                <button
                  type="button"
                  onClick={() => void fetchCalendars()}
                  disabled={loadingCalendars}
                  style={{ flex: 1, fontSize: 12, padding: '8px 12px' }}
                >
                  <RefreshCw size={13} className={loadingCalendars ? 'animate-spin' : ''} />
                  Sincronizar
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnect(googleIntegration.id)}
                  style={{ color: '#dc2626', borderColor: '#fecaca', fontSize: 12, padding: '8px 12px' }}
                >
                  <Unlink size={13} /> Desconectar
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={connectingGoogle}
                onClick={() => void handleStartGoogleOAuth()}
                style={{
                  width: '100%',
                  fontSize: 13,
                  padding: '9px 16px',
                  background: '#2563eb',
                  borderColor: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {connectingGoogle ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Aguardando Login Google...
                  </>
                ) : (
                  <>
                    <Link2 size={14} /> Conectar com Google
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Card HubSpot (Modular) */}
        <div
          style={{
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow)',
            opacity: 0.85,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#ff7a5915', display: 'grid', placeItems: 'center', color: '#ff7a59' }}>
                <Layers size={24} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>HubSpot CRM</h3>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Sincronização de deals da instância</span>
              </div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: '#fef3c7', padding: '3px 7px', borderRadius: 4 }}>
              EM BREVE
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
            Criação de novos contatos e atualização de estágios no pipeline comercial do HubSpot para os leads da instância {activeInstance}.
          </p>
          <div style={{ marginTop: 'auto' }}>
            <button disabled style={{ width: '100%', fontSize: 12, opacity: 0.6 }}>Em desenvolvimento</button>
          </div>
        </div>

        {/* Card RD Station (Modular) */}
        <div
          style={{
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'var(--shadow)',
            opacity: 0.85,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#0087c915', display: 'grid', placeItems: 'center', color: '#0087c9' }}>
                <Database size={24} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>RD Station CRM</h3>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Conversões e oportunidades</span>
              </div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: '#fef3c7', padding: '3px 7px', borderRadius: 4 }}>
              EM BREVE
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
            Envio automático de oportunidades para o funil do RD Station CRM com anotações e transcrições da instância {activeInstance}.
          </p>
          <div style={{ marginTop: 'auto' }}>
            <button disabled style={{ width: '100%', fontSize: 12, opacity: 0.6 }}>Em desenvolvimento</button>
          </div>
        </div>

      </div>

      {/* Lista de Calendários Ativos para a Instância */}
      {googleIntegration && calendars.length > 0 && (
        <div style={{ marginTop: 32, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={18} color="#2563eb" /> Calendários Conectados na Instância "{activeInstance}"
          </h3>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
            Estes calendários estão sincronizados com a conta <strong>{googleIntegration.accountEmail}</strong> e disponíveis para os nós do Construtor de Fluxos:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {calendars.map(cal => (
              <div
                key={cal.id}
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border-secondary)',
                  background: 'var(--color-bg-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <strong style={{ fontSize: 13, display: 'block', color: 'var(--color-text-primary)' }}>{cal.summary}</strong>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}>{cal.id}</span>
                </div>
                {cal.primary && (
                  <span style={{ fontSize: 10, background: '#2563eb18', color: '#2563eb', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                    Principal
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de Aviso Administrativo (quando o admin ainda não colocou Client ID/Secret) */}
      {showAdminNoticeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: 'var(--color-bg-primary)',
              borderRadius: 14,
              maxWidth: 480,
              width: '100%',
              padding: 28,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              border: '1px solid var(--color-border-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f59e0b18', display: 'grid', placeItems: 'center', color: '#d97706' }}>
                <Lock size={20} />
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Configuração da Plataforma Necessária</h2>
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
              Para que qualquer cliente conecte seu Google Calendar com <strong>1 clique</strong>, o administrador da plataforma precisa cadastrar o <strong>Google Client ID</strong> e <strong>Google Client Secret</strong> no painel de configurações internas.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAdminNoticeModal(false)}>Voltar</button>
              <Link
                to="/settings"
                style={{
                  background: '#2563eb',
                  borderColor: '#2563eb',
                  color: '#fff',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '8px 14px',
                  borderRadius: 6,
                }}
              >
                Ir para Configurações <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
