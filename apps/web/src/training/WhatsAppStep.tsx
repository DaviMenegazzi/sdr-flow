import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronLeft, QrCode, ShieldCheck, Smartphone } from 'lucide-react';
import { Button, Card, Input, Skeleton } from '../components/ui';
import { formatPhone } from '../lib/format';
import { useSession } from '../session';
import { SupportHint } from './support';

export type OnboardingConnection = { id: string; name: string; provider: 'evolution' | 'meta'; status: string; phone: string | null };

/** Connections of the active organization, shared by the onboarding resume logic and the WhatsApp step. */
export function useConnections() {
  const { activeOrg, session } = useSession();
  const token = session?.access_token;
  const [connections, setConnections] = useState<OnboardingConnection[] | null>(null);
  const reload = useCallback(async () => {
    if (!activeOrg || !token) return;
    try {
      const response = await fetch(`/api/organizations/${activeOrg}/connections`, { headers: { Authorization: `Bearer ${token}` } });
      setConnections(response.ok ? await response.json() : []);
    } catch { setConnections([]); }
  }, [activeOrg, token]);
  useEffect(() => { void reload(); }, [reload]);
  const connected = connections?.find(connection => connection.status === 'connected') ?? null;
  return { connections, connected, loading: connections === null, reload };
}

type Mode = 'choose' | 'qr' | 'meta';

export function WhatsAppStep({ connections, onNext, onBack, canEdit }: {
  connections: ReturnType<typeof useConnections>; onNext: () => void; onBack: () => void; canEdit: boolean;
}) {
  const { activeOrg, session } = useSession();
  const token = session?.access_token;
  const [mode, setMode] = useState<Mode>('choose');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({ phoneNumberId: '', wabaId: '', accessToken: '', appSecret: '' });
  const [metaResult, setMetaResult] = useState<{ webhook: string; verifyToken: string } | null>(null);
  const base = `/api/organizations/${activeOrg}/connections`;
  const headers = { Authorization: `Bearer ${token || ''}`, 'Content-Type': 'application/json' };

  const create = async (payload: Record<string, unknown>) => {
    const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `Não foi possível conectar (${response.status}).`);
    return data as OnboardingConnection & { webhook_url?: string };
  };

  // QR Code: reuse a pending QR connection instead of creating another instance (each one takes an agent slot).
  const startQr = async () => {
    setMode('qr'); setError(''); setQr(null);
    const pending = connections.connections?.find(connection => connection.provider === 'evolution' && connection.status !== 'connected');
    if (pending) { setConnectionId(pending.id); return; }
    setBusy(true);
    try { setConnectionId((await create({ name: 'WhatsApp principal', provider: 'evolution' })).id); void connections.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o QR Code.'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (mode !== 'qr' || !connectionId || !token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`${base}/${connectionId}/qr`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok && (data?.connected || data?.status === 'connected')) { await connections.reload(); return; }
        if (data?.base64) { setQr(data.base64); setError(''); }
        else if (!response.ok || data?.error) setError(data?.error || `Erro ${response.status} ao gerar o QR Code.`);
      } catch { if (!cancelled) setError('Falha na comunicação com o servidor.'); }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, connectionId, token]);

  const submitMeta = async () => {
    setBusy(true); setError('');
    const verifyToken = crypto.randomUUID().replace(/-/g, '');
    try {
      const created = await create({ name: 'WhatsApp Business', provider: 'meta', credentials: {
        phoneNumberId: meta.phoneNumberId.trim(), wabaId: meta.wabaId.trim(), accessToken: meta.accessToken.trim(),
        ...(meta.appSecret.trim() ? { appSecret: meta.appSecret.trim() } : {}), verifyToken,
      } });
      setMetaResult({ webhook: `${window.location.origin}/api/webhooks/meta/${created.id}`, verifyToken });
      void connections.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a conexão.'); }
    finally { setBusy(false); }
  };

  const heading = <div>
    <p className="text-xs font-semibold uppercase tracking-wider text-brand">Etapa 1 · WhatsApp</p>
    <h1 className="mt-3 text-2xl font-bold tracking-tight text-content sm:text-3xl">Conecte o WhatsApp que o SDR vai atender</h1>
    <p className="mt-2 text-sm text-content-secondary">É por este número que o SDR conversa com os seus leads. Nenhuma mensagem é enviada até você terminar o treinamento.</p>
  </div>;

  if (connections.loading) return <div className="space-y-4"><Skeleton className="h-9 w-full" /><Skeleton className="h-32 w-full" rounded="lg" /></div>;

  if (connections.connected && !metaResult) {
    const connected = connections.connected;
    return <div className="onboarding-step space-y-6">
      {heading}
      <Card className="flex items-center gap-4 p-5">
        <CheckCircle2 className="h-8 w-8 shrink-0 text-success" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-content">WhatsApp conectado</p>
          <p className="text-xs tabular-nums text-content-secondary">{connected.phone ? formatPhone(connected.phone) : connected.name}</p>
        </div>
      </Card>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onBack}><ChevronLeft className="h-4 w-4" /> Voltar</Button>
        <Button variant="primary" size="lg" onClick={onNext}>Continuar <ArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>;
  }

  return <div className="onboarding-step space-y-6">
    {heading}
    {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{error}</p>}

    {mode === 'choose' && <div role="radiogroup" aria-label="Como conectar" className="grid gap-3 sm:grid-cols-2">
      {([
        { id: 'qr', icon: QrCode, title: 'Escanear QR Code', text: 'Use o WhatsApp ou o WhatsApp Business do seu celular. Leva menos de 1 minuto.', badge: 'Mais rápido', action: startQr },
        { id: 'meta', icon: ShieldCheck, title: 'WhatsApp Business API', text: 'Para quem já tem a API oficial da Meta configurada.', badge: 'API oficial', action: () => { setMode('meta'); setError(''); } },
      ] as const).map(option => <button key={option.id} type="button" onClick={option.action} disabled={!canEdit || busy}
        className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface p-5 text-left transition-colors hover:border-success-border hover:bg-surface-elevated disabled:opacity-50">
        <span className="flex w-full items-center justify-between"><option.icon className="h-6 w-6 text-brand" /><span className="rounded-full bg-brand-subtle px-2 py-0.5 text-2xs font-semibold text-brand">{option.badge}</span></span>
        <span className="text-sm font-semibold text-content">{option.title}</span>
        <span className="text-xs leading-relaxed text-content-secondary">{option.text}</span>
      </button>)}
    </div>}

    {mode === 'qr' && <Card className="flex flex-col items-center gap-5 p-6 sm:flex-row sm:items-start">
      <div className="shrink-0 rounded-xl border border-border bg-white p-3">
        {qr ? <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR Code do WhatsApp" className="block h-52 w-52" />
          : <div role="status" aria-live="polite"><span className="sr-only">Gerando o QR Code…</span><Skeleton className="h-52 w-52" rounded="lg" /></div>}
      </div>
      <ol className="space-y-3 text-sm text-content-secondary">
        <li className="flex gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span>Abra o WhatsApp no celular do número comercial.</span></li>
        <li className="flex gap-2"><span className="w-4 shrink-0 text-center font-semibold text-brand">2</span><span>Toque em <b className="text-content">Mais opções › Dispositivos conectados</b>.</span></li>
        <li className="flex gap-2"><span className="w-4 shrink-0 text-center font-semibold text-brand">3</span><span>Toque em <b className="text-content">Conectar um aparelho</b> e aponte para o código.</span></li>
        <li className="text-xs text-content-muted">A tela avança sozinha quando conectar. O código se renova a cada poucos segundos.</li>
      </ol>
    </Card>}

    {mode === 'meta' && !metaResult && <Card className="space-y-4 p-5">
      <p className="text-xs text-content-secondary">Copie estes dados do app no Meta for Developers (WhatsApp › Configuração da API). Eles ficam guardados criptografados.</p>
      <Input label="ID do número de telefone" required value={meta.phoneNumberId} onChange={event => setMeta({ ...meta, phoneNumberId: event.target.value })} />
      <Input label="ID da conta do WhatsApp Business (WABA)" required value={meta.wabaId} onChange={event => setMeta({ ...meta, wabaId: event.target.value })} />
      <Input label="Token de acesso permanente" required type="password" value={meta.accessToken} onChange={event => setMeta({ ...meta, accessToken: event.target.value })} />
      <Input label="Chave secreta do app (opcional)" type="password" value={meta.appSecret} onChange={event => setMeta({ ...meta, appSecret: event.target.value })} />
      <div className="flex justify-end"><Button variant="primary" onClick={submitMeta} loading={busy} disabled={busy || !meta.phoneNumberId.trim() || !meta.wabaId.trim() || !meta.accessToken.trim()}>Salvar e conectar</Button></div>
    </Card>}

    {metaResult && <Card className="space-y-3 p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-content"><CheckCircle2 className="h-5 w-5 text-success" /> Dados salvos. Falta registrar o webhook na Meta</p>
      <p className="text-xs text-content-secondary">No app da Meta, em WhatsApp › Configuração › Webhook, cole os valores abaixo e assine o campo <b className="text-content">messages</b>.</p>
      <Input label="URL de callback" readOnly value={metaResult.webhook} onFocus={event => event.target.select()} />
      <Input label="Token de verificação" readOnly value={metaResult.verifyToken} onFocus={event => event.target.select()} />
      <div className="flex justify-end"><Button variant="primary" size="lg" onClick={onNext}>Continuar <ArrowRight className="h-4 w-4" /></Button></div>
    </Card>}

    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="ghost" onClick={mode === 'choose' || metaResult ? onBack : () => { setMode('choose'); setError(''); }}><ChevronLeft className="h-4 w-4" /> Voltar</Button>
      {!metaResult && <Button variant="ghost" size="sm" onClick={onNext}>Conectar depois</Button>}
    </div>
    <SupportHint context="Conectar WhatsApp" />
  </div>;
}
