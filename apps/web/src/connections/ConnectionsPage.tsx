import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../session';
import type { FlowGraph } from '@sdr/shared';
import { PlaygroundModal } from '../builder/PlaygroundModal';
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

  // Evolution fields (prefilled with VPS default values)
  const [evolutionUrl, setEvolutionUrl] = useState('http://127.0.0.1:8080');
  const [evolutionApiKey, setEvolutionApiKey] = useState('EvolutionApiSecretKey_2026');

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
  const [activeFlows, setActiveFlows] = useState<Record<string, { flowId: string; flow: any }>>({});
  const [loadingActive, setLoadingActive] = useState(false);
  const [simulatingFlow, setSimulatingFlow] = useState<{ id: string; name: string; graph: FlowGraph } | null>(null);

  async function loadActiveFlows() {
    setLoadingActive(true);
    try {
      const res = await fetch('/api/flows/active');
      if (res.ok) {
        const data = await res.json();
        setActiveFlows(data || {});
      }
    } catch (err) {
      console.error('Falha ao carregar fluxos ativos:', err);
    } finally {
      setLoadingActive(false);
    }
  }

  // Modal for viewing QR of existing connection
  const [activeQrModal, setActiveQrModal] = useState<string | null>(null);

  useEffect(() => {
    void loadConnections();
    void loadActiveFlows();
  }, [activeOrg, session?.access_token]);

  // Polling for QR / Connection status during wizard step 3
  useEffect(() => {
    if (wizardStep !== 3 || !createdConnectionId || provider !== 'evolution') return;

    let timer: any = null;
    let cancelled = false;

    async function pollQrAndStatus() {
      if (cancelled || !createdConnectionId) return;
      try {
        const url = activeOrg && session?.access_token
          ? `/api/organizations/${activeOrg}/connections/${createdConnectionId}/qr`
          : `/api/connections/evolution/qr/${encodeURIComponent(createdConnectionId)}`;
        const headers: Record<string, string> = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};

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
      if (activeOrg && session?.access_token) {
        const res = await fetch(`/api/organizations/${activeOrg}/connections`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setConnections(data);
          return;
        }
      }

      // Standalone direct Evolution mode
      const res = await fetch('/api/connections/instances');
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
    setEvolutionUrl('http://127.0.0.1:8080');
    setEvolutionApiKey('EvolutionApiSecretKey_2026');
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
      // 1. Multi-tenant Supabase Mode (se autenticado)
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

      // 2. Direct Evolution Standalone Mode (sem necessidade de login/Supabase)
      if (provider !== 'evolution') {
        setMessage('A conexão oficial Meta Cloud API requer autenticação de organização.');
        setBusy(false);
        return;
      }

      const res = await fetch('/api/connections/evolution/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          serverUrl: evolutionUrl.trim(),
          apiKey: evolutionApiKey.trim(),
          phone: phone.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao criar instância na Evolution.');
      }

      setCreatedConnectionId(data.id);
      if (data.qr?.base64) setQrBase64(data.qr.base64);
      if (data.qr?.code) setQrCodeString(data.qr.code);

      if (data.status === 'connected') {
        setWizardStep(4);
      } else {
        setWizardStep(3);
        // Garantir busca do QR code caso a resposta inicial venha vazia
        if (!data.qr?.base64) void fetchLiveQr(data.id);
      }

      void loadConnections();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro ao criar conexão.');
    } finally {
      setBusy(false);
    }
  }

  async function fetchLiveQr(connectionId: string) {
    try {
      const url = activeOrg && session?.access_token
        ? `/api/organizations/${activeOrg}/connections/${connectionId}/qr`
        : `/api/connections/evolution/qr/${encodeURIComponent(connectionId)}`;
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

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
      const url = activeOrg && session?.access_token
        ? `/api/organizations/${activeOrg}/connections/${connId}/verify`
        : `/api/connections/evolution/status/${encodeURIComponent(connId)}`;
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const res = await fetch(url, { method: activeOrg ? 'POST' : 'GET', headers });
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
      const url = activeOrg && session?.access_token
        ? `/api/organizations/${activeOrg}/connections/${connId}/restart`
        : `/api/connections/evolution/restart/${encodeURIComponent(connId)}`;
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json' };

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
      const url = activeOrg && session?.access_token
        ? `/api/organizations/${activeOrg}/connections/${connId}`
        : `/api/connections/evolution/${encodeURIComponent(connId)}`;
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

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
    <div className="page-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <span className="eyebrow">TRANSPORTE & MENSAGERIA</span>
          <h1>Conexões de WhatsApp</h1>
          <p className="muted">
            Conecte números via Evolution API (QR Code ao vivo) ou Meta Cloud API oficial com isolamento por organização.
          </p>
        </div>
        {!wizardOpen && (
          <button className="primary" onClick={startWizard} style={{ gap: 6 }}>
            <Plus size={16} /> Nova Conexão
          </button>
        )}
      </div>

      {message && (
        <div className="runtime-note" style={{ marginBottom: 20 }}>
          {message}
        </div>
      )}

      {wizardOpen ? (
        <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 12, padding: 30, background: 'var(--color-bg-primary)', marginBottom: 40 }}>
          {/* Steps Breadcrumb */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 28, borderBottom: '1px solid var(--color-border-secondary)', paddingBottom: 16 }}>
            {[
              { step: 1, label: '1. Identificação & Provedor' },
              { step: 2, label: '2. Credenciais' },
              { step: 3, label: provider === 'evolution' ? '3. Escanear QR Code' : '3. Validação' },
              { step: 4, label: '4. Conclusão' },
            ].map((s) => (
              <span
                key={s.step}
                style={{
                  fontSize: 12,
                  fontWeight: wizardStep === s.step ? 700 : 500,
                  color: wizardStep === s.step ? 'var(--color-bg-accent)' : 'var(--color-text-secondary)',
                }}
              >
                {s.label}
              </span>
            ))}
          </div>

          {/* Wizard Step 1: Name and Provider */}
          {wizardStep === 1 && (
            <div style={{ maxWidth: 540 }}>
              <h2>Identificação da Conexão</h2>
              <p className="muted">Defina um nome de referência e escolha o canal de transporte oficial ou Baileys.</p>

              <label style={{ marginBottom: 18 }}>
                Nome amigável da conexão
                <input
                  required
                  placeholder="Ex: WhatsApp Comercial Matriz"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <label style={{ marginBottom: 18 }}>
                Provedor de Conexão
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
                  <div
                    onClick={() => setProvider('evolution')}
                    style={{
                      border: provider === 'evolution' ? '2px solid var(--color-bg-accent)' : '1px solid var(--color-border-secondary)',
                      borderRadius: 10,
                      padding: 16,
                      cursor: 'pointer',
                      background: provider === 'evolution' ? 'var(--color-bg-light)' : 'var(--color-bg-primary)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 6 }}>
                      <QrCode size={18} color="var(--color-bg-accent)" /> Evolution API
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                      Conexão via QR Code ao vivo (Baileys). Ideal para números de teste e operações flexíveis.
                    </p>
                  </div>

                  <div
                    onClick={() => setProvider('meta')}
                    style={{
                      border: provider === 'meta' ? '2px solid var(--color-bg-accent)' : '1px solid var(--color-border-secondary)',
                      borderRadius: 10,
                      padding: 16,
                      cursor: 'pointer',
                      background: provider === 'meta' ? 'var(--color-bg-light)' : 'var(--color-bg-primary)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 6 }}>
                      <ShieldCheck size={18} color="#16a34a" /> Meta Cloud API
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                      API Oficial do WhatsApp Business, com autenticação e templates aprovados pela Meta.
                    </p>
                  </div>
                </div>
              </label>

              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button
                  className="primary"
                  disabled={!name.trim()}
                  onClick={() => setWizardStep(2)}
                  style={{ gap: 6 }}
                >
                  Próximo <ArrowRight size={15} />
                </button>
                <button onClick={() => setWizardOpen(false)}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Wizard Step 2: Credentials */}
          {wizardStep === 2 && (
            <div style={{ maxWidth: 540 }}>
              <h2>Configurar Credenciais — {provider === 'evolution' ? 'Evolution API' : 'Meta Cloud API'}</h2>
              <p className="muted">
                {provider === 'evolution'
                  ? 'Informe o endpoint e a API key do seu container Evolution.'
                  : 'Informe os identificadores do aplicativo Meta for Developers e o Access Token permanente.'}
              </p>

              {provider === 'evolution' ? (
                <>
                  <label style={{ marginBottom: 14 }}>
                    URL do Servidor Evolution
                    <input
                      required
                      placeholder="http://localhost:8080 ou https://evolution.seudominio.com"
                      value={evolutionUrl}
                      onChange={(e) => setEvolutionUrl(e.target.value)}
                    />
                  </label>
                  <label style={{ marginBottom: 14 }}>
                    API Key da Evolution
                    <input
                      type="password"
                      required
                      placeholder="Sua chave de autenticação apikey"
                      value={evolutionApiKey}
                      onChange={(e) => setEvolutionApiKey(e.target.value)}
                    />
                  </label>
                  <label style={{ marginBottom: 14 }}>
                    Número de telefone (opcional - para pareamento)
                    <input
                      placeholder="Ex: 5511999999999"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label style={{ marginBottom: 14 }}>
                    Phone Number ID
                    <input
                      required
                      placeholder="Ex: 109876543210987"
                      value={metaPhoneNumberId}
                      onChange={(e) => setMetaPhoneNumberId(e.target.value)}
                    />
                  </label>
                  <label style={{ marginBottom: 14 }}>
                    WABA ID (WhatsApp Business Account ID)
                    <input
                      required
                      placeholder="Ex: 987654321098765"
                      value={metaWabaId}
                      onChange={(e) => setMetaWabaId(e.target.value)}
                    />
                  </label>
                  <label style={{ marginBottom: 14 }}>
                    Token de Acesso do Sistema (System User Token)
                    <input
                      type="password"
                      required
                      placeholder="EAAB..."
                      value={metaAccessToken}
                      onChange={(e) => setMetaAccessToken(e.target.value)}
                    />
                  </label>
                  <label style={{ marginBottom: 14 }}>
                    App Secret (validação dos webhooks)
                    <input type="password" required value={metaAppSecret} onChange={e => setMetaAppSecret(e.target.value)} autoComplete="off" />
                  </label>
                  <label style={{ marginBottom: 14 }}>
                    Token de verificação do webhook
                    <input required value={metaVerifyToken} onChange={e => setMetaVerifyToken(e.target.value)} autoComplete="off" placeholder="Crie um token com pelo menos 16 caracteres" />
                  </label>
                  <p className="muted">Use este mesmo token ao cadastrar a URL do webhook no painel da Meta.</p>
                </>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (provider === 'evolution' && (!evolutionUrl || !evolutionApiKey)) ||
                    (provider === 'meta' && (!metaPhoneNumberId || !metaWabaId || !metaAccessToken || !metaAppSecret || metaVerifyToken.length < 16))
                  }
                  onClick={handleCreateConnection}
                >
                  {busy ? 'Validando & Conectando...' : provider === 'evolution' ? 'Criar Instância & Gerar QR' : 'Validar na Meta & Conectar'}
                </button>
                <button onClick={() => setWizardStep(1)}>Voltar</button>
              </div>
            </div>
          )}

          {/* Wizard Step 3: Live QR for Evolution */}
          {wizardStep === 3 && (
            <div style={{ maxWidth: 500, textAlign: 'center' }}>
              <h2>Escanear QR Code no Celular</h2>
              <p className="muted">
                Abra o WhatsApp &gt; Dispositivos Conectados &gt; Conectar um aparelho e aponte a câmera para o código abaixo:
              </p>

              {qrBase64 ? (
                <div style={{ margin: '20px auto', padding: 16, background: '#fff', border: '1px solid var(--color-border-secondary)', borderRadius: 12, display: 'inline-block' }}>
                  <img
                    src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                    alt="WhatsApp QR Code"
                    style={{ width: 240, height: 240, display: 'block' }}
                  />
                </div>
              ) : (
                <div style={{ padding: 40, background: 'var(--color-bg-secondary)', borderRadius: 12, margin: '20px auto' }}>
                  <RefreshCw size={28} className="spin" style={{ margin: '0 auto 12px', display: 'block' }} />
                  <p className="muted">Aguardando geração do QR Code real na Evolution...</p>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 20 }}>
                <button onClick={() => createdConnectionId && void fetchLiveQr(createdConnectionId)} style={{ gap: 6 }}>
                  <RefreshCw size={14} /> Atualizar QR Code
                </button>
                <button onClick={() => setWizardStep(4)}>Já conectei</button>
              </div>
            </div>
          )}

          {/* Wizard Step 4: Completion */}
          {wizardStep === 4 && (
            <div style={{ maxWidth: 500, textAlign: 'center', margin: '0 auto' }}>
              <CheckCircle2 size={48} color="#16a34a" style={{ margin: '0 auto 16px', display: 'block' }} />
              <h2>Conexão Estabelecida com Sucesso!</h2>
              <p className="muted">
                O canal de WhatsApp está ativo, autenticado e pronto para receber e enviar mensagens pelo fluxo.
              </p>

              {phone && (
                <div className="info-card" style={{ marginTop: 20, textAlign: 'left' }}>
                  <strong>Número Vinculado:</strong>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 4 }}>
                    +{phone}
                  </div>
                </div>
              )}

              <button
                className="primary"
                onClick={() => {
                  setWizardOpen(false);
                  void loadConnections();
                }}
                style={{ marginTop: 20 }}
              >
                Concluir e Ver Conexões
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* Existing Connections Table */}
      <h2>Canais Ativos na Organização</h2>
      {loading ? (
        <p className="muted">Carregando conexões...</p>
      ) : connections.length === 0 ? (
        <div className="info-card" style={{ marginTop: 16 }}>
          <p>Nenhuma conexão cadastrada nesta organização. Clique em “Nova Conexão” para integrar seu WhatsApp.</p>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--color-border-secondary)', borderRadius: 10, overflow: 'hidden', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px' }}>Nome</th>
                <th style={{ padding: '12px 16px' }}>Provedor</th>
                <th style={{ padding: '12px 16px' }}>Número</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px' }}>Webhook de Entrada</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((conn) => (
                <tr key={conn.id} style={{ borderTop: '1px solid var(--color-border-secondary)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{conn.name}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span className="badge" style={{ textTransform: 'uppercase' }}>
                      {conn.provider === 'meta' ? 'Meta Cloud' : 'Evolution'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>
                    {conn.phone ? `+${conn.phone}` : <span className="muted">Não identificado</span>}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        background:
                          conn.status === 'connected'
                            ? '#16a34a1a'
                            : conn.status === 'connecting'
                            ? '#ca8a041a'
                            : '#64748b1a',
                        color:
                          conn.status === 'connected'
                            ? '#16a34a'
                            : conn.status === 'connecting'
                            ? '#ca8a04'
                            : '#64748b',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background:
                            conn.status === 'connected'
                              ? '#16a34a'
                              : conn.status === 'connecting'
                              ? '#ca8a04'
                              : '#64748b',
                        }}
                      />
                      {conn.status === 'connected'
                        ? 'Conectado'
                        : conn.status === 'connecting'
                        ? 'Aguardando QR'
                        : conn.status === 'error'
                        ? 'Erro'
                        : 'Desconectado'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      onClick={() => copyWebhook(conn.webhook_url || '', conn.id)}
                      style={{ padding: '4px 8px', fontSize: 11, minHeight: 24, gap: 5 }}
                      title="Copiar URL de webhook"
                    >
                      {copiedId === conn.id ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                      <span>{copiedId === conn.id ? 'Copiado!' : 'Copiar URL'}</span>
                    </button>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {conn.provider === 'evolution' && conn.status !== 'connected' && (
                        <button
                          onClick={() => {
                            setActiveQrModal(conn.id);
                            void fetchLiveQr(conn.id);
                          }}
                          style={{ padding: '4px 8px', minHeight: 26, fontSize: 11, gap: 4 }}
                        >
                          <QrCode size={13} /> QR Code
                        </button>
                      )}
                      <button
                        onClick={() => void handleVerify(conn.id)}
                        style={{ padding: '4px 8px', minHeight: 26, fontSize: 11, gap: 4 }}
                        title="Verificar integridade da conexão"
                      >
                        <RefreshCw size={13} /> Sincronizar
                      </button>
                      <button
                        className="danger"
                        onClick={() => void handleDelete(conn.id)}
                        style={{ padding: '4px 8px', minHeight: 26, fontSize: 11 }}
                        title="Remover conexão"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* FLUXOS ATIVOS & AUTOMAÇÕES */}
      <div style={{ marginTop: 40, borderTop: '1px solid var(--color-border-secondary)', paddingTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Radio size={18} color="#16a34a" /> Fluxos Ativos & Automações do WhatsApp
            </h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Veja qual fluxo da inteligência artificial está vinculado e operando em cada número.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => void loadActiveFlows()}
              disabled={loadingActive}
              style={{ fontSize: 12, gap: 6, display: 'inline-flex', alignItems: 'center', padding: '6px 10px' }}
              title="Recarregar fluxos ativos"
            >
              <RefreshCw size={13} className={loadingActive ? 'animate-spin' : ''} /> {loadingActive ? 'Atualizando…' : 'Atualizar'}
            </button>
            <Link to="/flows/new" className="button primary" style={{ fontSize: 13, gap: 6, display: 'inline-flex', alignItems: 'center' }}>
              <Workflow size={14} /> Abrir no Construtor
            </Link>
          </div>
        </div>

        {Object.keys(activeFlows).length === 0 ? (
          <div className="info-card" style={{ padding: 18 }}>
            <p style={{ margin: 0 }}>
              Nenhum fluxo publicado e vinculado às instâncias ainda. No <strong>Construtor de Fluxos</strong>, selecione a instância desejada e clique em <strong>Publicar</strong>.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {Object.entries(activeFlows).map(([instName, binding]) => {
              const flow = binding.flow;
              const isTest = Boolean(flow?.graph?.testMode?.enabled);
              const testPhone = flow?.graph?.testMode?.phone || '';
              return (
                <div
                  key={instName}
                  style={{
                    border: isTest ? '1px solid #eab308' : '1px solid #16a34a',
                    background: isTest ? 'rgba(234, 179, 8, 0.04)' : 'rgba(22, 163, 74, 0.04)',
                    borderRadius: 10,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
                        Instância: <strong style={{ color: 'var(--color-text-primary)' }}>{instName}</strong>
                      </span>
                      <span
                        className="badge"
                        style={{
                          background: isTest ? '#ca8a0422' : '#16a34a22',
                          color: isTest ? '#b45309' : '#16a34a',
                          border: isTest ? '1px solid #ca8a04' : '1px solid #16a34a',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {isTest ? '⚠️ MODO TESTE ATIVO' : '🟢 MODO PRODUÇÃO'}
                      </span>
                    </div>

                    <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{flow?.name || 'Fluxo SDR'}</h3>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
                      Versão: <strong>v{flow?.publishedVersion || 1}</strong> · Publicado em: {flow?.publishedAt ? new Date(flow.publishedAt).toLocaleString('pt-BR') : 'Hoje'}
                    </div>

                    {isTest ? (
                      <div
                        style={{
                          padding: '10px 12px',
                          background: 'rgba(234, 179, 8, 0.12)',
                          border: '1px solid #eab308',
                          borderRadius: 6,
                          fontSize: 12,
                          color: '#854d0e',
                          marginBottom: 14,
                        }}
                      >
                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                          <ShieldAlert size={14} /> Proteção de Teste Ativa
                        </div>
                        <div>Responde <strong>APENAS</strong> ao número autorizado:</div>
                        <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, marginTop: 2 }}>{testPhone || '(não configurado)'}</div>
                        <div style={{ fontSize: 11, marginTop: 4, opacity: 0.9 }}>
                          Nenhum outro contato receberá mensagens da IA.
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: '10px 12px',
                          background: 'rgba(22, 163, 74, 0.08)',
                          border: '1px solid #16a34a',
                          borderRadius: 6,
                          fontSize: 12,
                          color: '#15803d',
                          marginBottom: 14,
                        }}
                      >
                        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                          <CheckCircle2 size={14} /> Atendimento Público Liberado
                        </div>
                        <div>A IA responderá a todos os contatos que enviarem mensagens nesta instância.</div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setSimulatingFlow({ id: flow?.id || binding.flowId, name: flow?.name || 'Fluxo SDR', graph: flow?.graph })}
                      style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center', padding: '6px 12px' }}
                      title="Abrir o simulador com IA para testar conversas deste fluxo sem enviar WhatsApp"
                    >
                      <Play size={14} /> Testar no Playground (Simulador)
                    </button>
                    <Link
                      to={`/flows/new?id=${encodeURIComponent(flow?.id || binding.flowId)}`}
                      className="button"
                      style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}
                    >
                      <Workflow size={14} /> Editar no Construtor
                    </Link>
                  </div>
                </div>
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
          graph={simulatingFlow.graph}
        />
      )}


            {/* QR Modal for existing connection */}
      {activeQrModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#00000080',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div style={{ background: 'var(--color-bg-primary)', padding: 30, borderRadius: 12, maxWidth: 420, width: '90%', textAlign: 'center' }}>
            <h2>Escanear QR Code</h2>
            <p className="muted">Abra o WhatsApp e aponte para reconectar.</p>
            {qrBase64 ? (
              <img
                src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt="QR Code"
                style={{ width: 220, height: 220, margin: '16px auto', display: 'block' }}
              />
            ) : (
              <p className="muted" style={{ margin: '30px 0' }}>Gerando QR Code...</p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => void fetchLiveQr(activeQrModal)}>Atualizar</button>
              <button className="primary" onClick={() => setActiveQrModal(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
