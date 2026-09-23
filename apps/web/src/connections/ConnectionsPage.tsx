import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../session';
import type { FlowGraph } from '@sdr/shared';
import { PlaygroundModal } from '../builder/PlaygroundModal';
import {
  confirmDialog,
  toast,
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageContainer,
  PageHeader,
  Skeleton,
  TableSkeleton,
  type MenuItem,
} from '../components/ui';
import { formatPhone, formatDateTime } from '../lib/format';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  MoreHorizontal,
  Play,
  Plus,
  Power,
  QrCode,
  Radio,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Workflow,
} from 'lucide-react';

interface Connection {
  id: string;
  name: string;
  provider: 'evolution' | 'meta';
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  phone: string | null;
  provider_instance_id: string | null;
  created_at: string;
  webhook_url?: string;
  agent_id?: string | null;
}

interface ActiveFlowBinding {
  connection: {
    id: string;
    name: string;
    instanceName: string;
  };
  flow: {
    id: string;
    name: string;
    versionId: string;
    version: number;
    publishedAt: string;
    graph: FlowGraph;
  };
}

const STATUS_META: Record<Connection['status'], { dot: string; label: string }> = {
  connected: { dot: 'bg-success', label: 'Conectado' },
  connecting: { dot: 'bg-warning', label: 'Aguardando QR Code' },
  disconnected: { dot: 'bg-content-muted', label: 'Desconectado' },
  error: { dot: 'bg-danger', label: 'Erro' },
};

const PROVIDER_LABEL: Record<Connection['provider'], string> = {
  evolution: 'QR Code · Evolution',
  meta: 'API oficial da Meta',
};

export function ConnectionsPage() {
  const { session, activeOrg } = useSession();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // Wizard states
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<'evolution' | 'meta'>('evolution');
  const [phone, setPhone] = useState('');

  // Provider credentials are always supplied explicitly and stored encrypted by the API.
  const [evolutionUrl, setEvolutionUrl] = useState('');
  const [evolutionApiKey, setEvolutionApiKey] = useState('');

  // Meta fields
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState('');
  const [metaWabaId, setMetaWabaId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaAppSecret, setMetaAppSecret] = useState('');
  const [metaVerifyToken, setMetaVerifyToken] = useState('');

  // Live QR & Active Connection state
  const [createdConnectionId, setCreatedConnectionId] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrCodeString, setQrCodeString] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeFlows, setActiveFlows] = useState<ActiveFlowBinding[]>([]);
  const [loadingActive, setLoadingActive] = useState(true);
  const [simulatingFlow, setSimulatingFlow] = useState<{ id: string; name: string; versionId: string; graph: FlowGraph } | null>(null);
  const activeFlowsRequest = useRef(0);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  async function loadAgentNames() {
    if (!session?.access_token) return;
    try {
      const res = await fetch('/api/me/agents', {
        headers: { Authorization: `Bearer ${session.access_token}`, ...(activeOrg ? { 'X-Organization-Id': activeOrg } : {}) },
      });
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, string> = {};
      for (const agent of (data.agents ?? []) as Array<{ id: string; name: string }>) map[agent.id] = agent.name;
      setAgentNames(map);
    } catch {
      // Agent names are a convenience column; the table still works without them.
    }
  }

  async function loadActiveFlows() {
    const requestId = ++activeFlowsRequest.current;
    setLoadingActive(true);
    try {
      if (!activeOrg || !session?.access_token) {
        if (requestId === activeFlowsRequest.current) setActiveFlows([]);
        return;
      }
      const res = await fetch(`/api/organizations/${encodeURIComponent(activeOrg)}/active-flows`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (requestId === activeFlowsRequest.current) setActiveFlows(Array.isArray(data) ? data : []);
      } else {
        if (requestId === activeFlowsRequest.current) setActiveFlows([]);
      }
    } catch (err) {
      console.error('Falha ao carregar fluxos ativos:', err);
      if (requestId === activeFlowsRequest.current) setActiveFlows([]);
    } finally {
      if (requestId === activeFlowsRequest.current) setLoadingActive(false);
    }
  }

  // Modal for viewing QR of existing connection
  const [activeQrModal, setActiveQrModal] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    void loadConnections();
    void loadActiveFlows();
    void loadAgentNames();
  }, [activeOrg, session?.access_token]);

  // Polling for QR when the existing-connection QR modal is open
  useEffect(() => {
    if (!activeQrModal) return;
    let timer: any = null;
    let cancelled = false;

    async function pollQr() {
      if (cancelled || !activeQrModal) return;
      try {
        if (!activeOrg || !session?.access_token) return;
        const url = `/api/organizations/${activeOrg}/connections/${activeQrModal}/qr`;
        const headers = { Authorization: `Bearer ${session.access_token}` };
        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.connected || data.status === 'connected') {
            setActiveQrModal(null);
            toast.success('WhatsApp conectado');
            void loadConnections();
            return;
          }
          if (data.base64) { setQrBase64(data.base64); setQrError(null); }
          else if (data.error) setQrError(data.error);
          if (data.code) setQrCodeString(data.code);
        } else {
          const err = await res.json().catch(() => null);
          setQrError(err?.error || `Erro ${res.status}`);
        }
      } catch {
        setQrError('Falha na comunicação com o servidor.');
      }
      if (!cancelled) timer = setTimeout(pollQr, 3000);
    }

    setQrBase64(null);
    setQrError(null);
    void pollQr();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [activeQrModal, activeOrg, session?.access_token]);

  // Polling for QR / Connection status during wizard step 3
  useEffect(() => {
    if (wizardStep !== 3 || !createdConnectionId || provider !== 'evolution') return;

    let timer: any = null;
    let cancelled = false;

    async function pollQrAndStatus() {
      if (cancelled || !createdConnectionId) return;
      try {
        if (!activeOrg || !session?.access_token) return;
        const url = `/api/organizations/${activeOrg}/connections/${createdConnectionId}/qr`;
        const headers = { Authorization: `Bearer ${session.access_token}` };

        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.connected || data.status === 'connected') {
            setWizardStep(4);
            void loadConnections();
            return;
          }
          if (data.base64) setQrBase64(data.base64);
          if (data.code) setQrCodeString(data.code);
        }
      } catch {
        // Ignored in dev
      }

      if (!cancelled) {
        timer = setTimeout(pollQrAndStatus, 2500);
      }
    }

    void pollQrAndStatus();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [wizardStep, createdConnectionId, activeOrg, session?.access_token, provider]);

  async function loadConnections() {
    setLoading(true);
    try {
      if (!activeOrg || !session?.access_token) { setConnections([]); return; }
      const res = await fetch(`/api/organizations/${activeOrg}/connections`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (res.ok) {
        const data = await res.json();
        setConnections(data);
      }
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  }

  function startWizard() {
    setWizardStep(1);
    setName('');
    setProvider('evolution');
    setPhone('');
    setEvolutionUrl('');
    setEvolutionApiKey('');
    setMetaPhoneNumberId('');
    setMetaWabaId('');
    setMetaAccessToken('');
    setMetaAppSecret('');
    setMetaVerifyToken('');
    setCreatedConnectionId(null);
    setQrBase64(null);
    setQrCodeString(null);
    setMessage('');
    setWizardOpen(true);
  }

  async function handleCreateConnection() {
    if (!name.trim()) {
      setMessage('Informe um nome para a conexão.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      if (activeOrg && session?.access_token) {
        const payload: any = {
          name: name.trim(),
          provider,
          phone: phone.trim() || undefined,
        };

        if (provider === 'evolution') {
          payload.credentials = {
            serverUrl: evolutionUrl.trim(),
            apiKey: evolutionApiKey.trim(),
          };
        } else {
          payload.credentials = {
            phoneNumberId: metaPhoneNumberId.trim(),
            wabaId: metaWabaId.trim(),
            accessToken: metaAccessToken.trim(),
            appSecret: metaAppSecret.trim(),
            verifyToken: metaVerifyToken.trim(),
          };
        }

        const res = await fetch(`/api/organizations/${activeOrg}/connections`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Falha ao criar conexão.');
        }

        setCreatedConnectionId(data.id);
        if (data.setupWarning) setMessage(data.setupWarning);
        if (data.phone) setPhone(data.phone);

        if (provider === 'evolution') {
          setWizardStep(3);
          void fetchLiveQr(data.id);
        } else {
          setWizardStep(4);
        }
        void loadConnections();
        return;
      }
      throw new Error('Sessão ou organização indisponível. Entre novamente antes de criar a conexão.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro ao criar conexão.');
    } finally {
      setBusy(false);
    }
  }

  async function fetchLiveQr(connectionId: string) {
    try {
      if (!activeOrg || !session?.access_token) return;
      const url = `/api/organizations/${activeOrg}/connections/${connectionId}/qr`;
      const headers = { Authorization: `Bearer ${session.access_token}` };

      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.base64) setQrBase64(data.base64);
        if (data.code) setQrCodeString(data.code);
        if (data.connected) {
          setWizardStep(4);
          void loadConnections();
        }
      }
    } catch {
      // Ignored
    }
  }

  /** Asks the provider for the real status. Returns it, or null when the check itself failed. */
  async function handleVerify(connId: string, quiet = false): Promise<string | null> {
    setVerifyingId(connId);
    try {
      if (!activeOrg || !session?.access_token) throw new Error('Sessão indisponível.');
      const url = `/api/organizations/${activeOrg}/connections/${connId}/verify`;
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const res = await fetch(url, { method: 'POST', headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
      if (!quiet) {
        if (data.status === 'connected') toast.success('Conectado e respondendo');
        else toast.info(`Status: ${STATUS_META[data.status as Connection['status']]?.label ?? data.status}`);
      }
      void loadConnections();
      return typeof data.status === 'string' ? data.status : null;
    } catch (err) {
      toast.error('Não foi possível verificar', { description: err instanceof Error ? err.message : undefined });
      return null;
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleRestart(connId: string) {
    try {
      if (!activeOrg || !session?.access_token) throw new Error('Sessão indisponível.');
      const url = `/api/organizations/${activeOrg}/connections/${connId}/restart`;
      const headers = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };

      const res = await fetch(url, { method: 'POST', headers });
      if (!res.ok) throw new Error();
      toast.info('Reinício solicitado', { description: 'O status é atualizado em alguns segundos.' });
      setTimeout(() => void loadConnections(), 2000);
    } catch {
      toast.error('Não foi possível reiniciar a instância.');
    }
  }

  async function handleDelete(connId: string) {
    if (!(await confirmDialog({ title: 'Remover conexão?', description: 'O atendimento automático neste número para imediatamente e o histórico deixa de receber mensagens novas.', confirmLabel: 'Remover conexão', danger: true }))) return;
    try {
      if (!activeOrg || !session?.access_token) throw new Error('Sessão indisponível.');
      const url = `/api/organizations/${activeOrg}/connections/${connId}`;
      const headers = { Authorization: `Bearer ${session.access_token}` };

      const res = await fetch(url, { method: 'DELETE', headers });
      if (!res.ok) throw new Error();
      toast.success('Conexão removida');
      void loadConnections();
    } catch {
      toast.error('Não foi possível remover a conexão.');
    }
  }

  function copyWebhook(urlPath: string) {
    const fullUrl = `${window.location.origin}${urlPath}`;
    void navigator.clipboard.writeText(fullUrl).then(
      () => toast.success('URL do webhook copiada', { description: 'Cole no painel do provedor.' }),
      () => toast.error('Não foi possível copiar a URL.')
    );
  }

  /** "Já conectei" asks the provider instead of assuming it worked. */
  async function confirmConnected() {
    if (!createdConnectionId) return;
    const status = await handleVerify(createdConnectionId, true);
    if (status === 'connected') setWizardStep(4);
    else if (status) setMessage('Ainda não conectou. Escaneie o QR Code e aguarde alguns segundos.');
  }

  const flowByConnection = new Map(activeFlows.map(binding => [binding.connection.id, binding]));
  const connectedCount = connections.filter(c => c.status === 'connected').length;

  const rowMenu = (conn: Connection): MenuItem[] => {
    const binding = flowByConnection.get(conn.id);
    return [
      { label: 'Copiar URL do webhook', icon: <Copy size={14} />, onSelect: () => copyWebhook(conn.webhook_url || '') },
      { label: 'Verificar status', icon: <RefreshCw size={14} />, onSelect: () => void handleVerify(conn.id) },
      ...(conn.provider === 'evolution'
        ? [{ label: 'Reiniciar instância', icon: <Power size={14} />, onSelect: () => void handleRestart(conn.id) } as MenuItem]
        : []),
      ...(binding
        ? ([
            { type: 'separator' },
            {
              label: 'Simular conversa do fluxo',
              icon: <Play size={14} />,
              description: 'Sem enviar WhatsApp',
              onSelect: () =>
                setSimulatingFlow({ id: binding.flow.id, name: binding.flow.name, versionId: binding.flow.versionId, graph: binding.flow.graph }),
            },
          ] as MenuItem[])
        : []),
      { type: 'separator' },
      { label: 'Remover conexão…', icon: <Trash2 size={14} />, danger: true, onSelect: () => void handleDelete(conn.id) },
    ];
  };

  const wizardTitle =
    wizardStep === 1 ? 'Nova conexão' : wizardStep === 2 ? 'Credenciais' : wizardStep === 3 ? 'Escaneie o QR Code' : 'Conectado';
  const steps = ['Número', 'Credenciais', provider === 'evolution' ? 'QR Code' : 'Validação', 'Pronto'];

  return (
    <PageContainer>
      <PageHeader
        title="Conexões WhatsApp"
        description={
          loading
            ? 'Carregando…'
            : connections.length === 0
            ? 'Conecte um número para a IA começar a atender.'
            : `${connections.length} ${connections.length === 1 ? 'número' : 'números'} · ${connectedCount} ${connectedCount === 1 ? 'conectado' : 'conectados'}`
        }
        actions={
          <Button variant="primary" onClick={startWizard}>
            <Plus size={16} /> Nova conexão
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <TableSkeleton columns={5} rows={3} />
        ) : connections.length === 0 ? (
          <EmptyState
            icon={<Radio size={20} />}
            title="Nenhum número conectado"
            description="Conecte por QR Code em menos de um minuto, ou use a API oficial da Meta."
            action={
              <Button variant="primary" onClick={startWizard}>
                <Plus size={16} /> Conectar WhatsApp
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-2xs text-content-muted">
                  <th className="px-4 py-2 font-medium">Nome</th>
                  <th className="px-4 py-2 font-medium">Número</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="hidden px-4 py-2 font-medium lg:table-cell">Agente</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Fluxo publicado</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {connections.map(conn => {
                  const meta = STATUS_META[conn.status] ?? STATUS_META.disconnected;
                  const binding = flowByConnection.get(conn.id);
                  const isTest = Boolean(binding?.flow.graph.testMode?.enabled);
                  const needsQr = conn.provider === 'evolution' && conn.status !== 'connected';
                  return (
                    <tr key={conn.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50">
                      <td className="px-4 py-3">
                        <p className="m-0 font-medium text-content">{conn.name}</p>
                        <p className="m-0 text-2xs text-content-muted">{PROVIDER_LABEL[conn.provider]}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-content-secondary">
                        {conn.phone ? formatPhone(conn.phone) : <span className="text-content-muted">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center gap-1.5 font-medium text-content">
                            <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
                            {meta.label}
                          </span>
                          {needsQr ? (
                            <Button size="sm" variant="outline" onClick={() => setActiveQrModal(conn.name || conn.id)}>
                              <QrCode size={14} /> Reconectar
                            </Button>
                          ) : conn.status === 'error' ? (
                            <Button size="sm" variant="outline" loading={verifyingId === conn.id} onClick={() => void handleVerify(conn.id)}>
                              Verificar de novo
                            </Button>
                          ) : null}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-content-secondary lg:table-cell">
                        {conn.agent_id ? (
                          <Link to={`/agents/${conn.agent_id}`} className="hover:text-content hover:underline">
                            {agentNames[conn.agent_id] ?? 'Agente'}
                          </Link>
                        ) : (
                          <span className="text-content-muted">—</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {binding ? (
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/flows/new?id=${encodeURIComponent(binding.flow.id)}`}
                              className="truncate text-content-secondary hover:text-content hover:underline"
                              title={`Publicado em ${formatDateTime(binding.flow.publishedAt)}`}
                            >
                              {binding.flow.name} · v{binding.flow.version}
                            </Link>
                            {isTest && (
                              <span
                                className="flex-shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 text-2xs font-medium text-content"
                                title={`Responde só a ${binding.flow.graph.testMode?.phone ? formatPhone(binding.flow.graph.testMode.phone) : 'número não configurado'}`}
                              >
                                Teste
                              </span>
                            )}
                          </div>
                        ) : loadingActive ? (
                          <Skeleton className="h-3 w-24" />
                        ) : (
                          <Link to="/flows" className="text-content-muted hover:text-content">
                            Publicar um fluxo →
                          </Link>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <DropdownMenu
                          aria-label={`Ações de ${conn.name}`}
                          width={240}
                          items={rowMenu(conn)}
                          trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} size="sm" tooltip={false} />}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* The wizard is a focused task, so it gets its own layer instead of pushing the table down. */}
      <Modal
        isOpen={wizardOpen}
        onClose={() => !busy && setWizardOpen(false)}
        maxWidth="lg"
        title={wizardTitle}
        description={
          <ol className="m-0 mt-2 flex list-none items-center gap-1.5 p-0 text-2xs">
            {steps.map((label, index) => {
              const n = index + 1;
              const state = n < wizardStep ? 'done' : n === wizardStep ? 'current' : 'next';
              return (
                <li key={label} className="flex items-center gap-1.5">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ${
                      state === 'current' ? 'bg-brand text-canvas' : state === 'done' ? 'bg-brand/20 text-brand-fg' : 'bg-surface-elevated text-content-muted'
                    }`}
                  >
                    {n}
                  </span>
                  <span className={state === 'current' ? 'font-medium text-content' : 'text-content-muted'}>{label}</span>
                  {n < steps.length && <span className="text-content-muted">·</span>}
                </li>
              );
            })}
          </ol>
        }
      >
        {message && wizardStep !== 4 && (
          <div className="mb-4 rounded-lg border border-border bg-surface-elevated p-3 text-xs text-content-secondary">{message}</div>
        )}

        {wizardStep === 1 && (
          <div className="flex flex-col gap-4">
            <Input
              label="Nome da conexão"
              required
              autoFocus
              placeholder="Ex.: WhatsApp Comercial"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-content-secondary">Como conectar</span>
              <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    { id: 'evolution', icon: <QrCode size={16} />, title: 'QR Code (rápido)', text: 'Escaneie com o celular. Bom para começar e para testes.', tech: 'Evolution API' },
                    { id: 'meta', icon: <ShieldCheck size={16} />, title: 'API oficial da Meta', text: 'Para operação em escala, com templates aprovados.', tech: 'Meta Cloud API' },
                  ] as const
                ).map(option => {
                  const selected = provider === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setProvider(option.id)}
                      className={`flex min-h-0 flex-col items-start justify-start gap-1 rounded-xl border p-3.5 text-left transition-colors duration-150 ease-out ${
                        selected ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-border bg-surface hover:border-border-strong'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-content">
                        <span className={selected ? 'text-brand-fg' : 'text-content-muted'}>{option.icon}</span>
                        {option.title}
                      </span>
                      <span className="text-xs text-content-secondary">{option.text}</span>
                      <span className="text-2xs text-content-muted">{option.tech}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setWizardOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" disabled={!name.trim()} onClick={() => setWizardStep(2)}>
                Continuar <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        )}

        {wizardStep === 2 && (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-xs text-content-secondary">
              {provider === 'evolution'
                ? 'Endereço e chave do seu servidor Evolution. Ficam guardados criptografados.'
                : 'Dados do app no Meta for Developers. Ficam guardados criptografados.'}
            </p>
            {provider === 'evolution' ? (
              <>
                <Input
                  label="URL do servidor"
                  required
                  placeholder="https://evolution.seudominio.com"
                  value={evolutionUrl}
                  onChange={e => setEvolutionUrl(e.target.value)}
                />
                <Input
                  label="API key"
                  type="password"
                  required
                  autoComplete="off"
                  value={evolutionApiKey}
                  onChange={e => setEvolutionApiKey(e.target.value)}
                />
                <Input
                  label="Número (opcional)"
                  placeholder="Ex.: 55 55 99999-0000"
                  helperText="Só para parear pelo código em vez do QR Code."
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input label="Phone Number ID" required value={metaPhoneNumberId} onChange={e => setMetaPhoneNumberId(e.target.value)} />
                  <Input label="WABA ID" required value={metaWabaId} onChange={e => setMetaWabaId(e.target.value)} />
                </div>
                <Input
                  label="Token de acesso (System User)"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder="EAAB…"
                  value={metaAccessToken}
                  onChange={e => setMetaAccessToken(e.target.value)}
                />
                <Input
                  label="App Secret"
                  type="password"
                  required
                  autoComplete="off"
                  helperText="Usado para validar as mensagens que a Meta envia."
                  value={metaAppSecret}
                  onChange={e => setMetaAppSecret(e.target.value)}
                />
                <Input
                  label="Token de verificação do webhook"
                  required
                  autoComplete="off"
                  placeholder="Pelo menos 16 caracteres"
                  helperText="Use o mesmo token ao cadastrar o webhook no painel da Meta."
                  value={metaVerifyToken}
                  onChange={e => setMetaVerifyToken(e.target.value)}
                />
              </>
            )}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setWizardStep(1)}>
                Voltar
              </Button>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  (provider === 'evolution' && (!evolutionUrl || !evolutionApiKey)) ||
                  (provider === 'meta' && (!metaPhoneNumberId || !metaWabaId || !metaAccessToken || !metaAppSecret || metaVerifyToken.length < 16))
                }
                loading={busy}
                onClick={handleCreateConnection}
              >
                {provider === 'evolution' ? 'Gerar QR Code' : 'Validar na Meta'}
              </Button>
            </div>
          </div>
        )}

        {wizardStep === 3 && (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="m-0 text-xs text-content-secondary">
              No celular: WhatsApp › Dispositivos conectados › Conectar um aparelho. A tela avança sozinha quando conectar.
            </p>
            {qrBase64 ? (
              <div className="inline-block rounded-xl border border-border bg-white p-4">
                <img
                  src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code do WhatsApp"
                  className="mx-auto block h-60 w-60"
                />
              </div>
            ) : (
              <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
                <span className="sr-only">Gerando o QR Code…</span>
                <Skeleton className="h-60 w-60" rounded="lg" />
              </div>
            )}
            <div className="flex w-full justify-between gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => createdConnectionId && void fetchLiveQr(createdConnectionId)}>
                <RefreshCw size={14} /> Novo QR Code
              </Button>
              <Button variant="primary" loading={verifyingId === createdConnectionId} onClick={() => void confirmConnected()}>
                Já escaneei
              </Button>
            </div>
          </div>
        )}

        {wizardStep === 4 && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <CheckCircle2 size={40} className="text-success" />
            <p className="m-0 text-sm font-semibold text-content">{name || 'WhatsApp'} está conectado</p>
            {phone && <p className="m-0 text-xs tabular-nums text-content-secondary">{formatPhone(phone)}</p>}
            <p className="m-0 max-w-sm text-xs text-content-secondary">
              Para a IA responder, escolha um agente para este número e publique um fluxo.
            </p>
            {message && <p className="m-0 max-w-sm text-2xs text-warning">{message}</p>}
            <div className="mt-2 flex w-full justify-end gap-2 border-t border-border pt-4">
              <Link to="/flows">
                <Button variant="ghost">
                  <Workflow size={14} /> Abrir construtor
                </Button>
              </Link>
              <Button
                variant="primary"
                onClick={() => {
                  setWizardOpen(false);
                  void loadConnections();
                }}
              >
                Concluir
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {simulatingFlow && (
        <PlaygroundModal
          isOpen={Boolean(simulatingFlow)}
          onClose={() => setSimulatingFlow(null)}
          flowId={simulatingFlow.id}
          flowVersionId={simulatingFlow.versionId}
          graph={simulatingFlow.graph}
        />
      )}

      <Modal
        isOpen={Boolean(activeQrModal)}
        onClose={() => setActiveQrModal(null)}
        maxWidth="sm"
        title="Reconectar WhatsApp"
        description="No celular: WhatsApp › Dispositivos conectados › Conectar um aparelho."
      >
        <div className="flex flex-col items-center gap-4">
          {qrBase64 ? (
            <div className="rounded-xl border border-border bg-white p-3">
              <img
                src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt="QR Code do WhatsApp"
                className="block h-52 w-52"
              />
            </div>
          ) : qrError ? (
            <div className="w-full rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs text-danger">{qrError}</div>
          ) : (
            <div role="status" aria-live="polite">
              <span className="sr-only">Gerando o QR Code…</span>
              <Skeleton className="h-52 w-52" rounded="lg" />
            </div>
          )}
          <p className="m-0 text-2xs text-content-muted">A janela fecha sozinha quando conectar.</p>
        </div>
      </Modal>
    </PageContainer>
  );
}
