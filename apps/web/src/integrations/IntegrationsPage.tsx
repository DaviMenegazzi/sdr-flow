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
  Lock,
  X,
} from 'lucide-react';
import { useInstance } from '../context/InstanceContext';
import { Button, Badge, Card } from '../components/ui';

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
  const { activeInstance, instances, loading: loadingInstances } = useInstance();

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
    <div className="h-full overflow-y-auto p-6 md:p-8 bg-canvas text-content">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header com Seletor de Instância */}
        <div>
          <div className="flex items-center gap-1.5 text-xs text-content-muted mb-2">
            <span>Painel</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-content font-medium">Conexões Externas & Integrações</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-content tracking-tight">
                Integrações por Instância
              </h1>
              <p className="text-sm text-content-secondary max-w-xl mt-1">
                Cada instância do WhatsApp conecta sua própria agenda Google e ferramentas externas. Gerencie as conexões para a instância selecionada no topo.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Indicador de Instância Ativa */}
              <div className="flex items-center gap-2 bg-surface border border-border px-3 py-1.5 rounded-lg shadow-sm">
                <Radio className={`w-3.5 h-3.5 ${currentInstanceObj?.status === 'connected' ? 'text-success' : 'text-content-muted'}`} />
                <span className="text-xs text-content-secondary font-medium">Instância:</span>
                <strong className="text-xs text-content font-semibold">
                  {currentInstanceObj?.name || activeInstance || 'Nenhuma'}
                  {currentInstanceObj?.phone ? ` (${currentInstanceObj.phone})` : ''}
                </strong>
              </div>

              <Button
                variant="outline"
                size="icon"
                onClick={() => { setLoading(true); void fetchIntegrations(); }}
                title="Recarregar integrações"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </div>

        {/* Alerta de Status da Plataforma */}
        {!googlePlatformConfigured && (
          <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                <strong>Credenciais globais do Google não configuradas:</strong> O administrador precisa cadastrar o Google Client ID e Secret nas configurações da plataforma para habilitar o login em 1 clique.
              </span>
            </div>
            <Link
              to="/settings"
              className="inline-flex items-center gap-1.5 text-xs font-semibold underline whitespace-nowrap shrink-0 hover:opacity-80"
            >
              <Settings2 className="w-3.5 h-3.5" /> Configurar Agora
            </Link>
          </div>
        )}

        {/* Alertas dinâmicos */}
        {message && (
          <div
            className={`flex items-center gap-2.5 p-3.5 rounded-lg text-sm border ${
              message.type === 'success'
                ? 'bg-success/10 border-success/20 text-success'
                : message.type === 'error'
                ? 'bg-danger/10 border-danger/20 text-danger'
                : 'bg-info/10 border-info/20 text-info'
            }`}
          >
            {message.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {message.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
            {message.type === 'info' && <Info className="w-4 h-4 shrink-0" />}
            <span className="flex-1 text-xs font-medium">{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-current opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Grid de Integrações */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Card Google Calendar */}
          <Card
            className={`p-6 flex flex-col justify-between relative transition-colors ${
              googleIntegration ? 'border-success/40 ring-1 ring-success/20' : ''
            }`}
          >
            <div>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-content">Google Calendar</h3>
                    <span className="text-xs text-content-secondary">
                      Instância: <strong className="text-content font-medium">{activeInstance || 'Nenhuma'}</strong>
                    </span>
                  </div>
                </div>

                {googleIntegration ? (
                  <Badge variant="success" size="sm">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Conectado
                  </Badge>
                ) : (
                  <Badge variant="default" size="sm">
                    Desconectado
                  </Badge>
                )}
              </div>

              <p className="text-xs text-content-secondary leading-relaxed mb-4">
                Vincula a agenda Google específica desta instância para que o bot SDR consulte horários livres, faça agendamentos e envie convites oficiais aos leads.
              </p>

              {googleIntegration ? (
                <div className="bg-surface-secondary border border-border/60 rounded-lg p-3 mb-4 text-xs space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-content-secondary">Conta Google:</span>
                    <strong className="text-content font-medium truncate max-w-[160px]">
                      {googleIntegration.accountEmail || 'Conectada via OAuth'}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-content-secondary">Calendários Ativos:</span>
                    <span className="text-content font-medium">
                      {loadingCalendars ? 'Carregando...' : `${calendars.length} encontrado(s)`}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-surface-secondary border border-border/60 rounded-lg p-3 mb-4 text-xs text-content-secondary">
                  Nenhuma conta Google conectada para a instância <strong className="text-content">{activeInstance}</strong>. Conecte com 1 clique abaixo.
                </div>
              )}
            </div>

            <div className="pt-2 flex gap-2">
              {googleIntegration ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => void fetchCalendars()}
                    disabled={loadingCalendars}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingCalendars ? 'animate-spin' : ''}`} />
                    Sincronizar
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => void handleDisconnect(googleIntegration.id)}
                  >
                    <Unlink className="w-3.5 h-3.5 mr-1" /> Desconectar
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  className="w-full"
                  disabled={connectingGoogle}
                  onClick={() => void handleStartGoogleOAuth()}
                >
                  {connectingGoogle ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> Aguardando Login Google...
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 mr-1.5" /> Conectar com Google
                    </>
                  )}
                </Button>
              )}
            </div>
          </Card>

          {/* Card HubSpot (Modular) */}
          <Card className="p-6 flex flex-col justify-between opacity-80">
            <div>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-warning/10 text-warning flex items-center justify-center shrink-0">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-content">HubSpot CRM</h3>
                    <span className="text-xs text-content-secondary">Sincronização de deals</span>
                  </div>
                </div>
                <Badge variant="warning" size="sm">
                  EM BREVE
                </Badge>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed mb-4">
                Criação de novos contatos e atualização de estágios no pipeline comercial do HubSpot para os leads da instância {activeInstance}.
              </p>
            </div>
            <div className="pt-2">
              <Button variant="secondary" size="sm" disabled className="w-full text-xs">
                Em desenvolvimento
              </Button>
            </div>
          </Card>

          {/* Card RD Station (Modular) */}
          <Card className="p-6 flex flex-col justify-between opacity-80">
            <div>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-info/10 text-info flex items-center justify-center shrink-0">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-content">RD Station CRM</h3>
                    <span className="text-xs text-content-secondary">Conversões e oportunidades</span>
                  </div>
                </div>
                <Badge variant="warning" size="sm">
                  EM BREVE
                </Badge>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed mb-4">
                Envio automático de oportunidades para o funil do RD Station CRM com anotações e transcrições da instância {activeInstance}.
              </p>
            </div>
            <div className="pt-2">
              <Button variant="secondary" size="sm" disabled className="w-full text-xs">
                Em desenvolvimento
              </Button>
            </div>
          </Card>
        </div>

        {/* Lista de Calendários Ativos para a Instância */}
        {googleIntegration && calendars.length > 0 && (
          <Card className="p-6">
            <h3 className="text-sm font-bold text-content mb-1 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-brand" /> Calendários Conectados na Instância "{activeInstance}"
            </h3>
            <p className="text-xs text-content-secondary mb-4">
              Estes calendários estão sincronizados com a conta <strong className="text-content">{googleIntegration.accountEmail}</strong> e disponíveis para os nós do Construtor de Fluxos:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {calendars.map(cal => (
                <div
                  key={cal.id}
                  className="p-3 rounded-lg border border-border bg-surface-secondary flex items-center justify-between gap-2.5"
                >
                  <div className="min-w-0">
                    <strong className="text-xs text-content font-medium block truncate">{cal.summary}</strong>
                    <span className="text-[11px] text-content-muted block truncate">{cal.id}</span>
                  </div>
                  {cal.primary && (
                    <Badge variant="accent" size="sm" className="shrink-0">
                      Principal
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Modal de Aviso Administrativo */}
        {showAdminNoticeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-warning/10 text-warning flex items-center justify-center shrink-0">
                  <Lock className="w-5 h-5" />
                </div>
                <h2 className="text-base font-bold text-content">Configuração da Plataforma Necessária</h2>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed mb-6">
                Para que qualquer cliente conecte seu Google Calendar com <strong className="text-content">1 clique</strong>, o administrador da plataforma precisa cadastrar o <strong className="text-content">Google Client ID</strong> e <strong className="text-content">Google Client Secret</strong> no painel de configurações internas.
              </p>
              <div className="flex justify-end gap-2.5">
                <Button variant="secondary" onClick={() => setShowAdminNoticeModal(false)}>
                  Voltar
                </Button>
                <Link to="/settings">
                  <Button variant="primary">
                    Ir para Configurações <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
