import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../session';
import type { FlowGraph } from '@sdr/shared';
import { PlaygroundModal } from '../builder/PlaygroundModal';
import { Button, Badge, Card, Input } from '../components/ui';
import {
  Radio,
  QrCode,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Copy,
  Plus,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Check,
  Workflow,
  ShieldAlert,
  Play,
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

export function ConnectionsPage() {
  const { session, activeOrg } = useSession();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeFlows, setActiveFlows] = useState<ActiveFlowBinding[]>([]);
  const [loadingActive, setLoadingActive] = useState(false);
  const [simulatingFlow, setSimulatingFlow] = useState<{ id: string; name: string; versionId: string; graph: FlowGraph } | null>(null);
  const activeFlowsRequest = useRef(0);

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
            setMessage('Conexão estabelecida com sucesso!');
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

  async function handleVerify(connId: string) {
    setMessage(`Verificando conexão...`);
    try {
      if (!activeOrg || !session?.access_token) throw new Error('Sessão indisponível.');
      const url = `/api/organizations/${activeOrg}/connections/${connId}/verify`;
      const headers = { Authorization: `Bearer ${session.access_token}` };

      const res = await fetch(url, { method: 'POST', headers });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Status verificado: ${data.status}`);
        void loadConnections();
      } else {
        setMessage(`Erro na verificação: ${data.error}`);
      }
    } catch {
      setMessage('Falha na comunicação com o servidor.');
    }
  }

  async function handleRestart(connId: string) {
    try {
      if (!activeOrg || !session?.access_token) throw new Error('Sessão indisponível.');
      const url = `/api/organizations/${activeOrg}/connections/${connId}/restart`;
      const headers = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };

      await fetch(url, { method: 'POST', headers });
      setMessage('Comando de reinício enviado à instância.');
      setTimeout(() => void loadConnections(), 2000);
    } catch {
      setMessage('Erro ao reiniciar instância.');
    }
  }

  async function handleDelete(connId: string) {
    if (!confirm('Deseja realmente remover esta conexão? O atendimento neste número será interrompido.')) return;
    try {
      if (!activeOrg || !session?.access_token) throw new Error('Sessão indisponível.');
      const url = `/api/organizations/${activeOrg}/connections/${connId}`;
      const headers = { Authorization: `Bearer ${session.access_token}` };

      const res = await fetch(url, { method: 'DELETE', headers });
      if (res.ok) {
        setMessage('Conexão removida com sucesso.');
        void loadConnections();
      }
    } catch {
      setMessage('Falha ao excluir conexão.');
    }
  }

  function copyWebhook(urlPath: string, id: string) {
    const fullUrl = `${window.location.origin}${urlPath}`;
    void navigator.clipboard.writeText(fullUrl);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 bg-canvas text-content">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand mb-1">
              <Radio className="w-3.5 h-3.5" /> TRANSPORTE & MENSAGERIA
            </div>
            <h1 className="text-2xl font-bold text-content tracking-tight">
              Conexões de WhatsApp
            </h1>
            <p className="text-sm text-content-secondary max-w-2xl mt-1">
              Conecte números via Evolution API (QR Code ao vivo) ou Meta Cloud API oficial com isolamento por organização.
            </p>
          </div>
          {!wizardOpen && (
            <Button variant="primary" size="sm" onClick={startWizard}>
              <Plus className="w-4 h-4" /> Nova Conexão
            </Button>
          )}
        </div>

      {message && (
        <div className="p-3.5 mb-6 rounded-lg bg-brand/10 border border-brand/20 text-brand text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {wizardOpen ? (
        <Card className="p-6 bg-surface border-border mb-8 max-w-2xl">
          {/* Steps Breadcrumb */}
          <div className="flex items-center gap-2 pb-4 mb-6 border-b border-border overflow-x-auto">
            {[
              { step: 1, label: '1. Identificação & Provedor' },
              { step: 2, label: '2. Credenciais' },
              { step: 3, label: provider === 'evolution' ? '3. Escanear QR Code' : '3. Validação' },
              { step: 4, label: '4. Conclusão' },
            ].map((s) => (
              <Badge
                key={s.step}
                variant={wizardStep === s.step ? 'accent' : 'outline'}
                size="sm"
              >
                {s.label}
              </Badge>
            ))}
          </div>

          {/* Wizard Step 1: Name and Provider */}
          {wizardStep === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold text-content m-0">Identificação da Conexão</h2>
                <p className="text-xs text-content-muted mt-1 mb-0">Defina um nome de referência e escolha o canal de transporte oficial ou Baileys.</p>
              </div>

              <Input
                label="Nome amigável da conexão"
                required
                placeholder="Ex: WhatsApp Comercial Matriz"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-content">Provedor de Conexão</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div
                    onClick={() => setProvider('evolution')}
                    className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${
                      provider === 'evolution'
                        ? 'border-brand bg-brand/5 shadow-xs'
                        : 'border-border bg-surface hover:border-border-hover'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-content mb-1.5">
                      <QrCode className="w-4 h-4 text-brand" /> Evolution API
                    </div>
                    <p className="text-[11px] text-content-muted m-0">
                      Conexão via QR Code ao vivo (Baileys). Ideal para números de teste e operações flexíveis.
                    </p>
                  </div>

                  <div
                    onClick={() => setProvider('meta')}
                    className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${
                      provider === 'meta'
                        ? 'border-brand bg-brand/5 shadow-xs'
                        : 'border-border bg-surface hover:border-border-hover'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-xs text-content mb-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-500" /> Meta Cloud API
                    </div>
                    <p className="text-[11px] text-content-muted m-0">
                      API Oficial do WhatsApp Business, com autenticação e templates aprovados pela Meta.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 mt-4">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!name.trim()}
                  onClick={() => setWizardStep(2)}
                >
                  Próximo <ArrowRight className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setWizardOpen(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Wizard Step 2: Credentials */}
          {wizardStep === 2 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold text-content m-0">Configurar Credenciais — {provider === 'evolution' ? 'Evolution API' : 'Meta Cloud API'}</h2>
                <p className="text-xs text-content-muted mt-1 mb-0">
                  {provider === 'evolution'
                    ? 'Informe o endpoint e a API key do seu container Evolution.'
                    : 'Informe os identificadores do aplicativo Meta for Developers e o Access Token permanente.'}
                </p>
              </div>

              {provider === 'evolution' ? (
                <>
                  <Input
                    label="URL do Servidor Evolution"
                    required
                    placeholder="http://localhost:8080 ou https://evolution.seudominio.com"
                    value={evolutionUrl}
                    onChange={(e) => setEvolutionUrl(e.target.value)}
                  />
                  <Input
                    label="API Key da Evolution"
                    type="password"
                    required
                    placeholder="Sua chave de autenticação apikey"
                    value={evolutionApiKey}
                    onChange={(e) => setEvolutionApiKey(e.target.value)}
                  />
                  <Input
                    label="Número de telefone (opcional - para pareamento)"
                    placeholder="Ex: 5511999999999"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <Input
                    label="Phone Number ID"
                    required
                    placeholder="Ex: 109876543210987"
                    value={metaPhoneNumberId}
                    onChange={(e) => setMetaPhoneNumberId(e.target.value)}
                  />
                  <Input
                    label="WABA ID (WhatsApp Business Account ID)"
                    required
                    placeholder="Ex: 987654321098765"
                    value={metaWabaId}
                    onChange={(e) => setMetaWabaId(e.target.value)}
                  />
                  <Input
                    label="Token de Acesso do Sistema (System User Token)"
                    type="password"
                    required
                    placeholder="EAAB..."
                    value={metaAccessToken}
                    onChange={(e) => setMetaAccessToken(e.target.value)}
                  />
                  <Input
                    label="App Secret (validação dos webhooks)"
                    type="password"
                    required
                    value={metaAppSecret}
                    onChange={e => setMetaAppSecret(e.target.value)}
                    autoComplete="off"
                  />
                  <Input
                    label="Token de verificação do webhook"
                    required
                    value={metaVerifyToken}
                    onChange={e => setMetaVerifyToken(e.target.value)}
                    autoComplete="off"
                    placeholder="Crie um token com pelo menos 16 caracteres"
                    helperText="Use este mesmo token ao cadastrar a URL do webhook no painel da Meta."
                  />
                </>
              )}

              <div className="flex items-center gap-2.5 mt-4">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    busy ||
                    (provider === 'evolution' && (!evolutionUrl || !evolutionApiKey)) ||
                    (provider === 'meta' && (!metaPhoneNumberId || !metaWabaId || !metaAccessToken || !metaAppSecret || metaVerifyToken.length < 16))
                  }
                  loading={busy}
                  onClick={handleCreateConnection}
                >
                  {provider === 'evolution' ? 'Criar Instância & Gerar QR' : 'Validar na Meta & Conectar'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setWizardStep(1)}>
                  Voltar
                </Button>
              </div>
            </div>
          )}

          {/* Wizard Step 3: Live QR for Evolution */}
          {wizardStep === 3 && (
            <div className="flex flex-col items-center text-center gap-4">
              <div>
                <h2 className="text-base font-semibold text-content m-0">Escanear QR Code no Celular</h2>
                <p className="text-xs text-content-muted mt-1 mb-0">
                  Abra o WhatsApp &gt; Dispositivos Conectados &gt; Conectar um aparelho e aponte a câmera para o código abaixo:
                </p>
              </div>

              {qrBase64 ? (
                <div className="p-4 bg-white dark:bg-zinc-900 border border-border rounded-xl inline-block shadow-sm">
                  <img
                    src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                    alt="WhatsApp QR Code"
                    className="w-60 h-60 block mx-auto"
                  />
                </div>
              ) : (
                <div className="p-10 bg-surface-muted rounded-xl flex flex-col items-center gap-3">
                  <RefreshCw className="w-7 h-7 text-brand animate-spin" />
                  <p className="text-xs text-content-muted m-0">Aguardando geração do QR Code real na Evolution...</p>
                </div>
              )}

              <div className="flex items-center gap-2.5 mt-2">
                <Button variant="outline" size="sm" onClick={() => createdConnectionId && void fetchLiveQr(createdConnectionId)}>
                  <RefreshCw className="w-3.5 h-3.5" /> Atualizar QR Code
                </Button>
                <Button variant="primary" size="sm" onClick={() => setWizardStep(4)}>
                  Já conectei
                </Button>
              </div>
            </div>
          )}

          {/* Wizard Step 4: Completion */}
          {wizardStep === 4 && (
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              <h2 className="text-base font-semibold text-content m-0">Conexão Estabelecida com Sucesso!</h2>
              <p className="text-xs text-content-muted max-w-sm m-0">
                O canal de WhatsApp está ativo, autenticado e pronto para receber e enviar mensagens pelo fluxo.
              </p>

              {phone && (
                <Card className="p-3.5 bg-surface-muted/50 border-border text-left w-full max-w-xs mt-2">
                  <span className="text-[11px] text-content-muted block">Número Vinculado:</span>
                  <div className="text-sm font-semibold text-content mt-0.5">
                    +{phone}
                  </div>
                </Card>
              )}

              <Button
                variant="primary"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setWizardOpen(false);
                  void loadConnections();
                }}
              >
                Concluir e Ver Conexões
              </Button>
            </div>
          )}
        </Card>
      ) : null}

      {/* Existing Connections Table */}
      <h2 className="text-base font-semibold text-content mb-3">Canais Ativos na Organização</h2>
      {loading ? (
        <p className="text-xs text-content-muted">Carregando conexões...</p>
      ) : connections.length === 0 ? (
        <Card className="p-4 bg-surface border-border">
          <p className="text-xs text-content-muted m-0">Nenhuma conexão cadastrada nesta organização. Clique em “Nova Conexão” para integrar seu WhatsApp.</p>
        </Card>
      ) : (
        <Card className="p-0 bg-surface border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-surface-muted/50 border-b border-border text-content-muted">
                  <th className="py-2.5 px-4 font-medium">Nome</th>
                  <th className="py-2.5 px-4 font-medium">Provedor</th>
                  <th className="py-2.5 px-4 font-medium">Número</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Webhook de Entrada</th>
                  <th className="py-2.5 px-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {connections.map((conn) => (
                  <tr key={conn.id} className="hover:bg-surface-muted/40 transition-colors">
                    <td className="py-3 px-4 font-semibold text-content">{conn.name}</td>
                    <td className="py-3 px-4">
                      <Badge variant="outline" size="sm" className="uppercase font-semibold">
                        {conn.provider === 'meta' ? 'Meta Cloud' : 'Evolution'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-mono text-content">
                      {conn.phone ? `+${conn.phone}` : <span className="text-content-muted">Não identificado</span>}
                    </td>
                    <td className="py-3 px-4">
                      {conn.status === 'connected' ? (
                        <Badge variant="success" size="sm" className="gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Conectado
                        </Badge>
                      ) : conn.status === 'connecting' ? (
                        <Badge variant="warning" size="sm" className="gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Aguardando QR
                        </Badge>
                      ) : conn.status === 'error' ? (
                        <Badge variant="danger" size="sm" className="gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          Erro
                        </Badge>
                      ) : (
                        <Badge variant="default" size="sm" className="gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                          Desconectado
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyWebhook(conn.webhook_url || '', conn.id)}
                        title="Copiar URL de webhook"
                      >
                        {copiedId === conn.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedId === conn.id ? 'Copiado!' : 'Copiar URL'}</span>
                      </Button>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {conn.provider === 'evolution' && conn.status !== 'connected' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setActiveQrModal(conn.name || conn.id)}
                          >
                            <QrCode className="w-3.5 h-3.5" /> QR Code
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleVerify(conn.id)}
                          title="Verificar integridade da conexão"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Sincronizar
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void handleDelete(conn.id)}
                          title="Remover conexão"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* FLUXOS ATIVOS & AUTOMAÇÕES */}
      <div className="mt-10 pt-6 border-t border-border">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-content m-0 flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-500" /> Fluxos Ativos & Automações do WhatsApp
            </h2>
            <p className="text-xs text-content-muted mt-1 mb-0">
              Veja qual fluxo da inteligência artificial está vinculado e operando em cada número.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void loadActiveFlows()}
              loading={loadingActive}
              title="Recarregar fluxos ativos"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingActive ? 'animate-spin' : ''}`} />
              {loadingActive ? 'Atualizando…' : 'Atualizar'}
            </Button>
            <Link to="/flows/new">
              <Button variant="primary" size="sm">
                <Workflow className="w-3.5 h-3.5" /> Abrir no Construtor
              </Button>
            </Link>
          </div>
        </div>

        {activeFlows.length === 0 ? (
          <Card className="p-4 bg-surface border-border">
            <p className="text-xs text-content-muted m-0">
              Nenhum fluxo publicado e vinculado às instâncias ainda. No <strong>Construtor de Fluxos</strong>, selecione a instância desejada e clique em <strong>Publicar</strong>.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeFlows.map(binding => {
              const { connection, flow } = binding;
              const isTest = Boolean(flow.graph.testMode?.enabled);
              const testPhone = flow.graph.testMode?.phone || '';
              const publishedAt = new Date(flow.publishedAt);
              const publishedAtText = Number.isNaN(publishedAt.getTime())
                ? '—'
                : publishedAt.toLocaleString('pt-BR');
              return (
                <Card
                  key={connection.id}
                  className={`p-4 bg-surface flex flex-col justify-between border ${
                    isTest ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-content-muted uppercase">
                        Instância: <strong className="text-content">{connection.instanceName}</strong>
                      </span>
                      <Badge
                        variant={isTest ? 'warning' : 'success'}
                        size="sm"
                        className="font-bold flex items-center gap-1.5"
                      >
                        {isTest ? (
                          <>
                            <ShieldAlert className="w-3 h-3" /> MODO TESTE
                          </>
                        ) : (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> PRODUÇÃO
                          </>
                        )}
                      </Badge>
                    </div>

                    <h3 className="text-sm font-bold text-content mt-1 mb-1">{flow.name}</h3>
                    <div className="text-[11px] text-content-muted mb-3">
                      Versão: <strong className="text-content">v{flow.version}</strong> · Publicado em: {publishedAtText}
                    </div>

                    {isTest ? (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-700 dark:text-amber-300 mb-3 flex flex-col gap-1">
                        <div className="font-semibold flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" /> Proteção de Teste Ativa
                        </div>
                        <div className="text-[11px]">Responde <strong>APENAS</strong> ao número autorizado:</div>
                        <div className="font-mono font-bold text-xs">{testPhone || '(não configurado)'}</div>
                        <div className="text-[10px] opacity-80">
                          Nenhum outro contato receberá mensagens da IA.
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-700 dark:text-emerald-300 mb-3 flex flex-col gap-1">
                        <div className="font-semibold flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> Atendimento Público Liberado
                        </div>
                        <div className="text-[11px]">A IA responderá a todos os contatos que enviarem mensagens nesta instância.</div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      onClick={() => setSimulatingFlow({ id: flow.id, name: flow.name, versionId: flow.versionId, graph: flow.graph })}
                      title="Abrir o simulador com IA para testar conversas deste fluxo sem enviar WhatsApp"
                    >
                      <Play className="w-3.5 h-3.5" /> Playground
                    </Button>
                    <Link to={`/flows/new?id=${encodeURIComponent(flow.id)}`}>
                      <Button variant="outline" size="sm">
                        <Workflow className="w-3.5 h-3.5" /> Editar
                      </Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL DO PLAYGROUND (SIMULADOR) */}
      {simulatingFlow && (
        <PlaygroundModal
          isOpen={Boolean(simulatingFlow)}
          onClose={() => setSimulatingFlow(null)}
          flowId={simulatingFlow.id}
          flowVersionId={simulatingFlow.versionId}
          graph={simulatingFlow.graph}
        />
      )}

      {/* QR Modal for existing connection */}
      {activeQrModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <Card className="p-6 bg-surface border-border max-w-sm w-full text-center flex flex-col items-center gap-4 shadow-xl">
            <div>
              <h2 className="text-base font-semibold text-content m-0">Escanear QR Code</h2>
              <p className="text-xs text-content-muted mt-1 mb-0">Abra o WhatsApp &gt; Dispositivos Conectados &gt; Conectar um aparelho e aponte a câmera.</p>
            </div>
            {qrBase64 ? (
              <div className="p-3 bg-white dark:bg-zinc-900 border border-border rounded-xl shadow-xs">
                <img
                  src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code"
                  className="w-52 h-52 block"
                />
              </div>
            ) : qrError ? (
              <div className="p-3 bg-danger/10 text-danger border border-danger/20 rounded-lg text-xs w-full">
                {qrError}
              </div>
            ) : (
              <div className="py-8 flex flex-col items-center gap-2">
                <RefreshCw className="w-6 h-6 text-brand animate-spin" />
                <p className="text-xs text-content-muted m-0">Aguardando QR Code da Evolution API...</p>
              </div>
            )}
            <Button variant="primary" size="sm" onClick={() => setActiveQrModal(null)}>
              Fechar
            </Button>
          </Card>
        </div>
      )}
    </div>
  </div>
  );
}
