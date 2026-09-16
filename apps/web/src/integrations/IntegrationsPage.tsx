import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Unlink,
  Copy,
  Check,
  ShieldCheck,
  ServerCog,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import { useSession } from '../session';
import { Button, Badge, Card } from '../components/ui';

interface CalendarAccount {
  id: string;
  organization_id: string;
  provider: 'google_calendar';
  account_email: string;
  account_name: string | null;
  status: 'connected' | 'expired' | 'revoked' | 'error';
  created_at: string;
  updated_at: string;
}

interface CalendarItem {
  id: string;
  summary: string;
  primary?: boolean;
  description?: string;
}

export function IntegrationsPage() {
  const { session, activeOrg, activeRole } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [showCalendars, setShowCalendars] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const isAdmin = activeRole === 'owner' || activeRole === 'admin';

  // Process URL feedback params
  useEffect(() => {
    const googleParam = searchParams.get('google');
    const errorParam = searchParams.get('error');

    if (googleParam === 'connected') {
      setActionSuccess('Conta Google Calendar conectada com sucesso para esta organização!');
      searchParams.delete('google');
      setSearchParams(searchParams, { replace: true });
    } else if (errorParam) {
      setActionError(`Erro na autorização do Google: ${decodeURIComponent(errorParam)}`);
      searchParams.delete('error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const fetchAccounts = async () => {
    if (!activeOrg || !session?.access_token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/organizations/${encodeURIComponent(activeOrg)}/integrations/calendar/accounts`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAccounts(Array.isArray(data) ? data : []);
      } else {
        setAccounts([]);
      }
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAccounts();
  }, [activeOrg, session?.access_token]);

  const primaryAccount = accounts[0];

  const fetchCalendars = async (accountId: string) => {
    if (!activeOrg || !session?.access_token) return;
    setLoadingCalendars(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/organizations/${encodeURIComponent(activeOrg)}/integrations/calendar/accounts/${encodeURIComponent(accountId)}/calendars`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        setCalendars(Array.isArray(data) ? data : []);
        setShowCalendars(true);
      } else {
        const err = await res.json().catch(() => ({}));
        setActionError(err.error || 'Não foi possível consultar os calendários desta conta.');
      }
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setLoadingCalendars(false);
    }
  };

  const handleStartGoogleOAuth = async () => {
    if (!activeOrg || !session?.access_token) return;
    setConnecting(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/organizations/${encodeURIComponent(activeOrg)}/integrations/google/auth-url`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.authUrl) {
          window.location.href = data.authUrl;
          return;
        }
      }
      const err = await res.json().catch(() => ({}));
      setActionError(err.error || 'Não foi possível iniciar o login com o Google.');
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    if (!activeOrg || !session?.access_token) return;
    if (!window.confirm('Tem certeza que deseja desconectar esta conta Google Calendar?')) return;

    try {
      const res = await fetch(
        `/api/organizations/${encodeURIComponent(activeOrg)}/integrations/calendar/accounts/${encodeURIComponent(accountId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (res.ok) {
        setActionSuccess('Conta Google desconectada com sucesso.');
        setShowCalendars(false);
        setCalendars([]);
        await fetchAccounts();
      } else {
        const err = await res.json().catch(() => ({}));
        setActionError(err.error || 'Não foi possível desconectar a conta.');
      }
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const copyCalendarId = (id: string) => {
    void navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 sm:p-10">
      <header>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
          <ShieldCheck size={15} />
          Conexões Multi-inquilino Seguras
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-content-primary">Conexões Externas</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-content-secondary">
          Conecte ferramentas externas como o Google Calendar diretamente à sua organização. As credenciais são criptografadas e isoladas no banco de dados com segurança nível empresarial (RLS).
        </p>
      </header>

      {actionSuccess && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-400">
          <CheckCircle2 size={18} className="shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-400">
          <AlertCircle size={18} className="shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Card Google Calendar */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <CalendarDays size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-content">Google Calendar</h2>
                {primaryAccount ? (
                  <Badge variant="accent" size="sm">
                    CONECTADO
                  </Badge>
                ) : (
                  <Badge variant="outline" size="sm">
                    DISPONÍVEL
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-content-secondary leading-relaxed max-w-xl">
                Permite que os nós de fluxo <code className="rounded bg-surface-secondary px-1 py-0.5 text-content">calendar.availability</code> e <code className="rounded bg-surface-secondary px-1 py-0.5 text-content">calendar.create_event</code> consultem horários livres e criem agendamentos automaticamente na sua agenda.
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {loading ? (
              <Button variant="secondary" size="sm" disabled>
                <RefreshCw size={14} className="animate-spin mr-1.5" /> Carregando...
              </Button>
            ) : primaryAccount ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchCalendars(primaryAccount.id)}
                  disabled={loadingCalendars}
                >
                  <Calendar size={14} className="mr-1.5" />
                  {loadingCalendars ? 'Consultando...' : showCalendars ? 'Atualizar Agendas' : 'Ver Agendas'}
                </Button>
                {isAdmin && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void handleDisconnect(primaryAccount.id)}
                  >
                    <Unlink size={14} className="mr-1.5" /> Desconectar
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={() => void handleStartGoogleOAuth()}
                disabled={connecting || !isAdmin}
                title={!isAdmin ? 'Apenas administradores podem conectar integrações' : undefined}
              >
                {connecting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin mr-1.5" /> Conectando...
                  </>
                ) : (
                  <>
                    <ExternalLink size={14} className="mr-1.5" /> Conectar com Google
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Informações da conta conectada */}
        {primaryAccount && (
          <div className="mt-5 pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between text-xs text-content-secondary gap-2">
            <div>
              Conta autorizada: <strong className="text-content">{primaryAccount.account_email}</strong>
              {primaryAccount.account_name && primaryAccount.account_name !== primaryAccount.account_email && (
                <span className="ml-1 text-content-muted">({primaryAccount.account_name})</span>
              )}
            </div>
            <div className="text-content-muted">
              Conectado em: {new Date(primaryAccount.created_at).toLocaleDateString('pt-BR', { dateStyle: 'short' })}
            </div>
          </div>
        )}

        {/* Lista de Calendários Disponíveis */}
        {showCalendars && calendars.length > 0 && (
          <div className="mt-6 pt-5 border-t border-border">
            <h3 className="text-sm font-bold text-content mb-1 flex items-center gap-2">
              <Calendar size={16} className="text-brand" /> Agendas Disponíveis nesta Conta
            </h3>
            <p className="text-xs text-content-secondary mb-4">
              Copie o ID da agenda desejada e utilize no campo <code className="text-content font-mono">calendarId</code> dos nós do seu fluxo.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {calendars.map(cal => (
                <div
                  key={cal.id}
                  className="rounded-lg border border-border bg-surface-secondary/60 p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <strong className="text-xs text-content font-semibold truncate block">{cal.summary}</strong>
                      {cal.primary && (
                        <span className="shrink-0 rounded bg-brand/10 text-brand px-1.5 py-0.2 text-[10px] font-bold">
                          Principal
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-content-muted block truncate mt-0.5" title={cal.id}>
                      {cal.id}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyCalendarId(cal.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] font-medium text-content transition-colors hover:bg-surface-hover"
                    title="Copiar ID da Agenda"
                  >
                    {copiedId === cal.id ? (
                      <>
                        <Check size={12} className="text-emerald-400" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> Copiar ID
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Informação sobre Fallback do Servidor */}
        <div className="mt-5 rounded-xl border border-border bg-surface-elevated/40 p-4 text-xs text-content-secondary">
          <div className="flex items-center gap-2 font-semibold text-content-primary">
            <ServerCog size={15} className="text-brand" />
            Isolamento e Fallback Seguro
          </div>
          <p className="mt-1.5 leading-relaxed">
            Quando você conecta uma conta Google nesta tela, ela se torna exclusiva para a organização ativa. Se nenhuma conta estiver conectada, o motor de execução do servidor recorrerá de forma transparente ao <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">GOOGLE_CALENDAR_CREDENTIALS_JSON</code> configurado no ambiente da VPS.
          </p>
        </div>
      </Card>

      <div>
        <Link
          to="/flows"
          className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-content-primary transition-colors hover:bg-surface-elevated"
        >
          Voltar aos fluxos
        </Link>
      </div>
    </main>
  );
}
