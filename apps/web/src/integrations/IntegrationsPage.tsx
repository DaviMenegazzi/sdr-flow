import { useState, useEffect } from 'react';
import {
  Calendar,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Trash2,
  Plus,
  ShieldCheck,
  Check,
  Radio,
  Layers,
  Sparkles,
  Link2,
  Unlink,
  ChevronRight,
  Database,
  ArrowRight,
  Info
} from 'lucide-react';

interface Integration {
  id: string;
  provider: 'google_calendar' | 'hubspot' | 'rdstation' | 'kommo';
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  accountEmail?: string;
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
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Google Calendar modal & config state
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [googleAuthCode, setGoogleAuthCode] = useState('');
  const [authStep, setAuthStep] = useState<'creds' | 'code'>('creds');
  const [submitting, setSubmitting] = useState(false);

  // Synchronized calendars list
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const fetchIntegrations = async () => {
    try {
      const res = await fetch('/api/integrations');
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
    setLoadingCalendars(true);
    try {
      const res = await fetch('/api/integrations/google/calendars');
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
    void fetchIntegrations();
  }, []);

  const googleIntegration = integrations.find(i => i.provider === 'google_calendar' && i.status === 'connected');

  useEffect(() => {
    if (googleIntegration) {
      void fetchCalendars();
    } else {
      setCalendars([]);
    }
  }, [googleIntegration]);

  const handleStartGoogleOAuth = async () => {
    if (!googleClientId.trim()) {
      setMessage({ type: 'error', text: 'Por favor, informe o Client ID do Google Cloud Console.' });
      return;
    }

    try {
      const res = await fetch(`/api/integrations/google/auth-url?clientId=${encodeURIComponent(googleClientId.trim())}`);
      const data = await res.json();
      if (res.ok && data.url) {
        window.open(data.url, '_blank', 'width=600,height=700');
        setAuthStep('code');
        setMessage({
          type: 'info',
          text: 'Janela do Google aberta. Faça login, autorize o acesso à Agenda e cole o código de autorização gerado abaixo.',
        });
      } else {
        setMessage({ type: 'error', text: data.error || 'Falha ao iniciar autenticação Google.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao comunicar com o servidor.' });
    }
  };

  const handleFinishGoogleOAuth = async () => {
    if (!googleAuthCode.trim()) {
      setMessage({ type: 'error', text: 'Cole o código de autorização fornecido pelo Google.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/integrations/google/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: googleAuthCode.trim(),
          clientId: googleClientId.trim(),
          clientSecret: googleClientSecret.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: 'Google Calendar conectado com sucesso!' });
        setShowGoogleModal(false);
        setGoogleAuthCode('');
        setAuthStep('creds');
        void fetchIntegrations();
      } else {
        setMessage({ type: 'error', text: data.error || 'Falha ao autorizar Google Calendar.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao conectar.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm('Deseja realmente desconectar esta integração? Os blocos de agenda no fluxo não poderão mais sincronizar eventos.')) return;
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Integração desconectada com sucesso.' });
        void fetchIntegrations();
      }
    } catch {
      setMessage({ type: 'error', text: 'Falha ao desconectar integração.' });
    }
  };

  return (
    <div className="page-content" style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-secondary)', fontSize: 12, marginBottom: 8 }}>
          <span>Painel</span>
          <ChevronRight size={13} />
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Conexões Externas & Integrações</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px', color: 'var(--color-text-primary)' }}>
              Integrações & Ferramentas Externas
            </h1>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 13, maxWidth: 650 }}>
              Conecte suas contas do Google Calendar, CRM e ferramentas de terceiros com um clique. Os nós do fluxo consomem automaticamente as conexões salvas aqui.
            </p>
          </div>
          <button
            onClick={() => { setLoading(true); void fetchIntegrations(); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 12px' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Alertas */}
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
        
        {/* Card Google Calendar */}
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
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Agendamento e consulta de agenda</span>
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
            Permite que o bot SDR consulte horários livres, marque reuniões e envie convites oficiais aos leads diretamente na agenda do consultor.
          </p>

          {googleIntegration ? (
            <div style={{ background: 'var(--color-bg-secondary)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>Conta Vinculada:</span>
                <strong style={{ color: 'var(--color-text-primary)' }}>{googleIntegration.accountEmail || 'Conectada via OAuth'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>Calendários Ativos:</span>
                <span>{loadingCalendars ? 'Carregando...' : `${calendars.length} encontrado(s)`}</span>
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--color-bg-secondary)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              Nenhuma conta do Google vinculada. Conecte via OAuth para habilitar os nós de agenda no fluxo.
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
                onClick={() => setShowGoogleModal(true)}
                style={{ width: '100%', fontSize: 13, padding: '9px 16px', background: '#2563eb', borderColor: '#2563eb' }}
              >
                <Link2 size={14} /> Conectar com Google
              </button>
            )}
          </div>
        </div>

        {/* Card HubSpot (Futuro / Modular) */}
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
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Sincronização de contatos e deals</span>
              </div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: '#fef3c7', padding: '3px 7px', borderRadius: 4 }}>
              EM BREVE
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
            Criação de novos leads e atualização de estágios no pipeline comercial do HubSpot assim que qualificados pela IA.
          </p>
          <div style={{ marginTop: 'auto' }}>
            <button disabled style={{ width: '100%', fontSize: 12, opacity: 0.6 }}>Em desenvolvimento</button>
          </div>
        </div>

        {/* Card RD Station (Futuro / Modular) */}
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
            Envio automático de leads qualificados para o funil do RD Station CRM com anotações e transcrições do atendimento.
          </p>
          <div style={{ marginTop: 'auto' }}>
            <button disabled style={{ width: '100%', fontSize: 12, opacity: 0.6 }}>Em desenvolvimento</button>
          </div>
        </div>

      </div>

      {/* Lista de Calendários Ativos (quando conectado) */}
      {googleIntegration && calendars.length > 0 && (
        <div style={{ marginTop: 32, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)', borderRadius: 12, padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={18} color="#2563eb" /> Calendários Disponíveis na Conta
          </h3>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
            Estes calendários já podem ser selecionados nos nós de agendamento do Construtor de Fluxos:
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

      {/* Modal Conexão Google Calendar OAuth */}
      {showGoogleModal && (
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
              maxWidth: 520,
              width: '100%',
              padding: 28,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              border: '1px solid var(--color-border-secondary)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Calendar size={22} color="#2563eb" />
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Conectar Google Calendar</h2>
              </div>
              <button
                onClick={() => { setShowGoogleModal(false); setAuthStep('creds'); }}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, padding: 4 }}
              >
                ✕
              </button>
            </div>

            {authStep === 'creds' ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
                  Para autenticar via Google OAuth, informe as credenciais do seu projeto no <strong>Google Cloud Console</strong>:
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>
                    Google Client ID
                    <input
                      type="text"
                      placeholder="ex: 123456789-abc.apps.googleusercontent.com"
                      value={googleClientId}
                      onChange={e => setGoogleClientId(e.target.value)}
                      style={{ marginTop: 6 }}
                    />
                  </label>

                  <label style={{ fontSize: 12, fontWeight: 600 }}>
                    Google Client Secret
                    <input
                      type="password"
                      placeholder="ex: GOCSPX-xxxxxxxx"
                      value={googleClientSecret}
                      onChange={e => setGoogleClientSecret(e.target.value)}
                      style={{ marginTop: 6 }}
                    />
                  </label>

                  <div style={{ background: 'var(--color-bg-secondary)', padding: '10px 12px', borderRadius: 6, fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    💡 <strong>URI de redirecionamento autorizada:</strong>
                    <code style={{ display: 'block', marginTop: 4, padding: 4, background: 'var(--color-bg-primary)', borderRadius: 4, wordBreak: 'break-all' }}>
                      {window.location.origin}/api/integrations/google/callback
                    </code>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowGoogleModal(false)}>Cancelar</button>
                  <button className="primary" onClick={() => void handleStartGoogleOAuth()} style={{ background: '#2563eb', borderColor: '#2563eb' }}>
                    Avançar para Login Google <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
                  Após conceder acesso na janela do Google, copie o <strong>código de autorização (code)</strong> da URL ou da tela e cole abaixo:
                </p>

                <label style={{ fontSize: 12, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                  Código de Autorização (Code)
                  <textarea
                    rows={3}
                    placeholder="Cole aqui o código gerado pelo Google..."
                    value={googleAuthCode}
                    onChange={e => setGoogleAuthCode(e.target.value)}
                    style={{ fontSize: 12 }}
                  />
                </label>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                  <button onClick={() => setAuthStep('creds')}>Voltar</button>
                  <button
                    className="primary"
                    disabled={submitting}
                    onClick={() => void handleFinishGoogleOAuth()}
                    style={{ background: '#16a34a', borderColor: '#16a34a' }}
                  >
                    {submitting ? 'Verificando...' : 'Finalizar Conexão'} <Check size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
