import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  ExternalLink,
  Lock,
  MoreHorizontal,
  RefreshCw,
  Unlink,
} from 'lucide-react';
import { useSession } from '../session';
import {
  confirmDialog,
  toast,
  Button,
  DropdownMenu,
  IconButton,
  PageContainer,
  PageHeader,
  Popover,
  Skeleton,
  SkeletonText,
} from '../components/ui';
import { formatDate } from '../lib/format';

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
  const { session, activeOrg, activeRole, activeTier, can } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [showCalendars, setShowCalendars] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isAdmin = activeRole === 'owner' || activeRole === 'admin';

  // Process URL feedback params
  useEffect(() => {
    const googleParam = searchParams.get('google');
    const errorParam = searchParams.get('error');

    if (googleParam === 'connected') {
      toast.success('Google Agenda conectada');
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
    if (!(await confirmDialog({ title: 'Desconectar Google Agenda?', description: 'Os agentes deixam de consultar horários e de marcar consultas nesta agenda.', confirmLabel: 'Desconectar', danger: true }))) return;

    try {
      const res = await fetch(
        `/api/organizations/${encodeURIComponent(activeOrg)}/integrations/calendar/accounts/${encodeURIComponent(accountId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (res.ok) {
        toast.success('Google Agenda desconectada');
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

  const accountLabel: Record<CalendarAccount['status'], { dot: string; text: string }> = {
    connected: { dot: 'bg-success', text: 'Conectada' },
    expired: { dot: 'bg-warning', text: 'Autorização expirada' },
    revoked: { dot: 'bg-danger', text: 'Acesso revogado' },
    error: { dot: 'bg-danger', text: 'Erro' },
  };

  const locked = !can('integrations:manage');
  const gatesUnlocked = can('payment_gates:manage');
  const gates = [
    { id: 'asaas', name: 'Asaas', initial: 'A', desc: 'Pix e boleto na conversa, com baixa automática.' },
    { id: 'mercado_pago', name: 'Mercado Pago', initial: 'M', desc: 'Link de pagamento na conversa.' },
    { id: 'stripe', name: 'Stripe', initial: 'S', desc: 'Cartão nacional e internacional, assinaturas.' },
  ];

  if (locked) {
    return (
      <PageContainer>
        <PageHeader title="Integrações" description="Conecte a agenda e os meios de pagamento que a IA usa na conversa." />
        <div className="flex flex-col items-center rounded-xl border border-border bg-surface p-8 text-center">
          <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-elevated text-content-muted">
            <Lock size={20} />
          </span>
          <p className="m-0 text-sm font-semibold text-content">Disponível a partir do plano Vendedor</p>
          <p className="m-0 mt-1 max-w-md text-xs text-content-secondary">
            O plano atual ({activeTier || 'Pré-Venda'}) inclui Atendimento, Indicadores e Agentes. No Vendedor você conecta o Google Agenda; no Pro, também os pagamentos.
          </p>
          <Link to="/settings" className="mt-4">
            <Button variant="primary">Ver planos</Button>
          </Link>
        </div>
      </PageContainer>
    );
  }

  const status = primaryAccount ? accountLabel[primaryAccount.status] ?? accountLabel.error : null;

  return (
    <PageContainer>
      <PageHeader title="Integrações" description="Conecte a agenda e os meios de pagamento que a IA usa na conversa." />

      {actionError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          <AlertCircle size={16} className="shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="min-h-0 border-0 bg-transparent p-0 text-xs font-semibold text-danger">
            Fechar
          </button>
        </div>
      )}

      {/* Every integration has the same shape: logo, name, one line, status, one action. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <article className="flex flex-col rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface-elevated text-content">
              <CalendarDays size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-content">Google Agenda</p>
              <p className="m-0 mt-0.5 text-xs text-content-secondary">Os agentes consultam horários livres e marcam reuniões na sua agenda.</p>
            </div>
            {primaryAccount && isAdmin && (
              <DropdownMenu
                aria-label="Ações do Google Agenda"
                items={[
                  { label: 'Conectar outra conta', icon: <ExternalLink size={14} />, onSelect: () => void handleStartGoogleOAuth() },
                  { type: 'separator' },
                  { label: 'Desconectar…', icon: <Unlink size={14} />, danger: true, onSelect: () => void handleDisconnect(primaryAccount.id) },
                ]}
                trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} size="sm" tooltip={false} />}
              />
            )}
          </div>

          <div className="mt-auto pt-4">
            {loading ? (
              <Skeleton className="h-8 w-full" />
            ) : primaryAccount && status ? (
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 flex items-center gap-1.5 text-xs font-medium text-content">
                    <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" /> {status.text}
                  </p>
                  <p className="m-0 mt-0.5 truncate text-2xs text-content-muted" title={primaryAccount.account_email}>
                    {primaryAccount.account_email} · desde {formatDate(primaryAccount.created_at)}
                  </p>
                </div>
                {primaryAccount.status === 'connected' ? (
                  <Popover
                    align="end"
                    width={320}
                    className="p-1"
                    trigger={
                      <Button size="sm" variant="outline" onClick={() => !showCalendars && void fetchCalendars(primaryAccount.id)}>
                        Agendas
                      </Button>
                    }
                  >
                    <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
                      <span className="text-2xs font-medium text-content-muted">Agendas desta conta</span>
                      <button
                        type="button"
                        aria-label="Atualizar agendas"
                        onClick={() => void fetchCalendars(primaryAccount.id)}
                        className="flex min-h-0 items-center border-0 bg-transparent p-0 text-content-muted hover:text-content"
                      >
                        <RefreshCw size={12} className={loadingCalendars ? 'animate-spin' : ''} />
                      </button>
                    </div>
                    {loadingCalendars && calendars.length === 0 ? (
                      <div className="p-2.5">
                        <SkeletonText lines={3} />
                      </div>
                    ) : calendars.length === 0 ? (
                      <p className="m-0 px-2.5 py-2 text-xs text-content-secondary">Nenhuma agenda encontrada.</p>
                    ) : (
                      calendars.map(cal => (
                        <div key={cal.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-surface-elevated">
                          <div className="min-w-0 flex-1">
                            <p className="m-0 truncate text-xs text-content">
                              {cal.summary}
                              {cal.primary && <span className="ml-1.5 text-2xs text-content-muted">Principal</span>}
                            </p>
                            <p className="m-0 truncate text-2xs text-content-muted" title={cal.id}>
                              {cal.id}
                            </p>
                          </div>
                          <IconButton
                            label={copiedId === cal.id ? 'Copiado' : 'Copiar ID da agenda'}
                            size="sm"
                            icon={copiedId === cal.id ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                            onClick={() => copyCalendarId(cal.id)}
                          />
                        </div>
                      ))
                    )}
                  </Popover>
                ) : (
                  isAdmin && (
                    <Button size="sm" variant="primary" onClick={() => void handleStartGoogleOAuth()} loading={connecting}>
                      Reautorizar
                    </Button>
                  )
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs text-content-secondary">
                  <span className="h-2 w-2 rounded-full border border-border-strong" aria-hidden="true" /> Não conectada
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void handleStartGoogleOAuth()}
                  loading={connecting}
                  disabled={!isAdmin}
                  title={!isAdmin ? 'Só administradores conectam integrações' : undefined}
                >
                  Conectar
                </Button>
              </div>
            )}
          </div>
        </article>

        {gates.map(gate => (
          <article key={gate.id} className="flex flex-col rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface-elevated text-sm font-bold text-content">
                {gate.initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-semibold text-content">{gate.name}</p>
                <p className="m-0 mt-0.5 text-xs text-content-secondary">{gate.desc}</p>
              </div>
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 pt-4">
              <span className="flex items-center gap-1.5 text-xs text-content-secondary">
                <span className="h-2 w-2 rounded-full border border-border-strong" aria-hidden="true" /> Não conectado
              </span>
              {gatesUnlocked ? (
                <span className="text-2xs font-medium text-content-muted" title="A configuração pelo painel ainda não está disponível">
                  Em breve
                </span>
              ) : (
                <Link to="/settings" className="flex items-center gap-1 text-2xs font-medium text-content-secondary hover:text-content">
                  <Lock size={11} /> Plano Pro
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>

      {isAdmin && (
        <details className="group mt-6 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-content-secondary">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-content">
            <CreditCard size={14} className="text-content-muted" /> Detalhes técnicos
            <ChevronRight size={14} className="ml-auto text-content-muted transition-transform group-open:rotate-90" />
          </summary>
          <ul className="m-0 mt-2 space-y-1.5 pl-6 leading-relaxed">
            <li>
              As credenciais ficam criptografadas e isoladas por organização. A conta Google conectada aqui vale só para a organização ativa.
            </li>
            <li>
              Sem conta conectada, o servidor usa a credencial <code className="text-2xs">GOOGLE_CALENDAR_CREDENTIALS_JSON</code> do ambiente, se existir.
            </li>
            <li>
              Nos fluxos, os nós <code className="text-2xs">calendar.availability</code> e <code className="text-2xs">calendar.create_event</code> usam o ID da agenda (copie em Agendas).
            </li>
          </ul>
        </details>
      )}
    </PageContainer>
  );
}
