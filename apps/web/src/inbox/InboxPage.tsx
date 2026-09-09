import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Search,
  UserCheck,
  Bot,
  Send,
  User,
  Clock,
  Sparkles,
  Phone,
  MapPin,
  Tag,
  Briefcase,
  AlertCircle,
  RefreshCw,
  Radio,
} from 'lucide-react';
import { useSession } from '../session';

interface ConversationItem {
  id: string;
  stage: string;
  bot_paused: boolean;
  handled_by: 'AI' | 'HUMAN' | 'SYSTEM';
  assigned_user_id: string | null;
  last_message_at: string | null;
  created_at: string;
  lead: {
    id: string;
    phone: string;
    name: string | null;
    city: string | null;
    interest: string | null;
    urgency: string | null;
    memory: Record<string, unknown>;
  };
  connection?: {
    id: string;
    name: string;
    provider: string;
    phone_number: string | null;
  } | null;
  deal?: {
    id: string;
    title: string;
    status: string;
    score: number | null;
  } | null;
  last_message?: {
    id: string;
    sender: string;
    direction: string;
    content: string;
    created_at: string;
  } | null;
}

interface MessageItem {
  id: string;
  sender: 'lead' | 'ai' | 'human' | 'system';
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  created_at: string;
}

const STAGE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  NEW_CONVERSATION: { label: 'Nova Conversa', bg: '#3b82f618', text: '#2563eb' },
  QUALIFYING: { label: 'Qualificando', bg: '#f59e0b18', text: '#d97706' },
  COLLECTING_INFORMATION: { label: 'Coleta de Info', bg: '#8b5cf618', text: '#7c3aed' },
  PRESENTING_SOLUTION: { label: 'Apresentação', bg: '#06b6d418', text: '#0891b2' },
  NEGOTIATING: { label: 'Negociação', bg: '#ec489918', text: '#db2777' },
  CONVERTED: { label: 'Convertido', bg: '#10b98118', text: '#059669' },
  HUMAN_HANDOFF: { label: 'Humano / Handoff', bg: '#ef444418', text: '#dc2626' },
  CLOSED: { label: 'Encerrado', bg: '#6b728018', text: '#4b5563' },
};

export function InboxPage() {
  const { session, activeOrg } = useSession();

  const [connections, setConnections] = useState<Array<{ id: string; name: string; provider: string; status: string }>>([]);
  const [connectionFilter, setConnectionFilter] = useState<string>('ALL');

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<ConversationItem | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);

  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [agentFilter, setAgentFilter] = useState<'ALL' | 'AI' | 'HUMAN'>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const [replyText, setReplyText] = useState<string>('');
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isStandalone = !activeOrg || !session?.access_token || activeOrg === 'standalone-org';
  const inboxBaseUrl = isStandalone ? '/api/inbox' : `/api/organizations/${activeOrg}/inbox`;

  const getHeaders = (hasBody = false) => {
    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  };

  useEffect(() => {
    async function loadConnections() {
      const merged: Array<{ id: string; name: string; provider: string; status: string }> = [];
      const seen = new Set<string>();

      // Load org connections if authenticated
      if (session && activeOrg && !isStandalone) {
        try {
          const res = await fetch(`/api/organizations/${activeOrg}/connections`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const data = await res.json();
            for (const c of Array.isArray(data) ? data : []) {
              merged.push(c);
              seen.add(c.provider_instance_id || c.name);
            }
          }
        } catch {}
      }

      // Also load standalone instances to fill gaps
      try {
        const res = await fetch('/api/connections/instances');
        if (res.ok) {
          const data = await res.json();
          for (const inst of Array.isArray(data) ? data : []) {
            if (!seen.has(inst.name)) {
              merged.push({ id: inst.id, name: inst.name, provider: inst.provider, status: inst.status });
            }
          }
        }
      } catch {}

      setConnections(merged);
    }
    void loadConnections();
  }, [session, activeOrg, isStandalone]);

  async function loadConversations(isBackground = false) {
    if (!isBackground) {
      setLoadingList(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams();
      if (connectionFilter !== 'ALL') params.set('connectionId', connectionFilter);
      if (stageFilter !== 'ALL') params.set('stage', stageFilter);
      if (agentFilter !== 'ALL') params.set('handledBy', agentFilter);
      if (searchTerm.trim()) params.set('search', searchTerm.trim());

      const res = await fetch(`${inboxBaseUrl}/conversations?${params.toString()}`, {
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('Erro ao listar conversas');
      const data = await res.json();
      const list: ConversationItem[] = data.conversations || [];
      setConversations(list);

      setSelectedId(prev => {
        if (!prev && list.length > 0 && list[0]) return list[0].id;
        return prev;
      });
    } catch (err) {
      if (!isBackground) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar lista de conversas.');
      }
    } finally {
      if (!isBackground) {
        setLoadingList(false);
      }
    }
  }

  async function loadConversationDetail(id: string, isBackground = false) {
    if (!isBackground) {
      setLoadingMessages(true);
    }
    try {
      const res = await fetch(`${inboxBaseUrl}/conversations/${id}`, {
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('Erro ao carregar conversa');
      const data = await res.json();
      setSelectedConv(data.conversation);
      setMessages(data.messages || []);
    } catch (err) {
      if (!isBackground) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar mensagens.');
      }
    } finally {
      if (!isBackground) {
        setLoadingMessages(false);
      }
    }
  }

  // Load conversations when filters change, and poll every 5 seconds
  useEffect(() => {
    loadConversations(false);
    const interval = setInterval(() => {
      loadConversations(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [inboxBaseUrl, stageFilter, agentFilter, connectionFilter, searchTerm]);

  // Load conversation detail when selectedId changes, and poll every 4 seconds
  useEffect(() => {
    if (!selectedId) return;
    loadConversationDetail(selectedId, false);
    const interval = setInterval(() => {
      loadConversationDetail(selectedId, true);
    }, 4000);
    return () => clearInterval(interval);
  }, [inboxBaseUrl, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleTakeover() {
    if (!selectedConv) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${inboxBaseUrl}/conversations/${selectedConv.id}/takeover`, {
        method: 'POST',
        headers: getHeaders(true),
      });
      if (!res.ok) throw new Error('Falha ao assumir conversa.');
      const updated = await res.json();
      setSelectedConv(updated);
      setConversations(prev => prev.map(c => (c.id === updated.id ? { ...c, handled_by: updated.handled_by, bot_paused: updated.bot_paused } : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no takeover.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRelease() {
    if (!selectedConv) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${inboxBaseUrl}/conversations/${selectedConv.id}/release`, {
        method: 'POST',
        headers: getHeaders(true),
      });
      if (!res.ok) throw new Error('Falha ao devolver conversa.');
      const updated = await res.json();
      setSelectedConv(updated);
      setConversations(prev => prev.map(c => (c.id === updated.id ? { ...c, handled_by: updated.handled_by, bot_paused: updated.bot_paused } : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no release.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStageChange(newStage: string) {
    if (!selectedConv) return;
    try {
      const res = await fetch(`${inboxBaseUrl}/conversations/${selectedConv.id}/stage`, {
        method: 'PATCH',
        headers: getHeaders(true),
        body: JSON.stringify({ stage: newStage }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar estágio.');
      const updated = await res.json();
      setSelectedConv(prev => (prev ? { ...prev, stage: updated.stage } : null));
      setConversations(prev => prev.map(c => (c.id === updated.id ? { ...c, stage: updated.stage } : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar estágio.');
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim() || !selectedConv) return;

    const content = replyText.trim();
    setReplyText('');

    try {
      const res = await fetch(`${inboxBaseUrl}/conversations/${selectedConv.id}/messages`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('Falha ao enviar mensagem.');
      const newMsg = await res.json();
      setMessages(prev => [...prev, newMsg]);
      // If was AI, automatically takeover
      if (selectedConv.handled_by !== 'HUMAN') {
        setSelectedConv(prev => (prev ? { ...prev, handled_by: 'HUMAN', bot_paused: true } : null));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar mensagem.');
    }
  }

  const memoryEntries = selectedConv?.lead.memory ? Object.entries(selectedConv.lead.memory) : [];

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--color-bg-primary)' }}>
      {/* LEFT COLUMN: Filters & Conversation List */}
      <div
        style={{
          width: '320px',
          borderRight: '1px solid var(--color-border-secondary)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          background: 'var(--color-bg-primary)',
        }}
      >
        {/* Inbox Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--color-border-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={19} color="var(--color-bg-accent)" />
              <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Inbox</h2>
            </div>
            <button
              onClick={() => { void loadConversations(); }}
              style={{ minHeight: '28px', padding: '4px 8px', border: 0, background: 'transparent' }}
              title="Atualizar lista"
            >
              <RefreshCw size={14} className={loadingList ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Connection Selector */}
          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', color: 'var(--color-text-secondary)' }}>
              <Radio size={12} /> Instância WhatsApp
            </label>
            <select
              value={connectionFilter}
              onChange={e => { setConnectionFilter(e.target.value); setSelectedId(null); setSelectedConv(null); }}
              style={{ fontSize: '12px', padding: '7px 10px', borderRadius: '6px', width: '100%' }}
            >
              <option value="ALL">{connections.length > 0 ? 'Todas as instâncias' : 'Nenhuma instância encontrada'}</option>
              {connections.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.provider}{c.status === 'connected' ? ' · conectado' : ''})
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="search-input" style={{ marginBottom: '10px' }}>
            <Search size={14} />
            <input
              type="text"
              placeholder="Buscar por nome, telefone..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void loadConversations()}
            />
          </div>

          {/* Agent Filter Tabs */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
            {(['ALL', 'AI', 'HUMAN'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setAgentFilter(tab)}
                style={{
                  flex: 1,
                  fontSize: '11px',
                  minHeight: '26px',
                  padding: '4px',
                  borderRadius: '5px',
                  border: 0,
                  background: agentFilter === tab ? 'var(--color-bg-accent)' : 'var(--color-bg-secondary)',
                  color: agentFilter === tab ? '#fff' : 'var(--color-text-secondary)',
                  fontWeight: agentFilter === tab ? 600 : 400,
                }}
              >
                {tab === 'ALL' ? 'Todos' : tab === 'AI' ? 'IA' : 'Humano'}
              </button>
            ))}
          </div>

          {/* Stage Filter Dropdown */}
          <select
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value)}
            style={{ fontSize: '11px', padding: '6px 8px', borderRadius: '5px' }}
          >
            <option value="ALL">Todos os Estágios</option>
            {Object.entries(STAGE_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* Conversation Cards List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingList ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              Carregando conversas...
            </div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
              Nenhuma conversa encontrada neste filtro.
            </div>
          ) : (
            conversations.map(c => {
              const isSelected = c.id === selectedId;
              const stageConf = STAGE_CONFIG[c.stage] || { label: c.stage, bg: '#e2e8f0', text: '#475569' };
              const displayName = c.lead.name || c.lead.phone;
              const timeStr = c.last_message_at
                ? new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';

              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--color-border-secondary)',
                    background: isSelected ? 'var(--color-bg-secondary)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <strong style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {displayName}
                    </strong>
                    <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{timeStr}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: stageConf.bg,
                        color: stageConf.text,
                        fontWeight: 600,
                      }}
                    >
                      {stageConf.label}
                    </span>
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: c.handled_by === 'HUMAN' ? '#10b98118' : '#8b5cf618',
                        color: c.handled_by === 'HUMAN' ? '#059669' : '#7c3aed',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      {c.handled_by === 'HUMAN' ? <User size={10} /> : <Sparkles size={10} />}
                      {c.handled_by === 'HUMAN' ? 'Humano' : 'IA'}
                    </span>
                  </div>

                  <p
                    style={{
                      margin: 0,
                      fontSize: '11px',
                      color: 'var(--color-text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.last_message?.content || 'Nenhuma mensagem recente.'}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* CENTER COLUMN: Chat Thread */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--color-bg-primary)' }}>
        {selectedConv ? (
          <>
            {/* Active Conversation Top Bar */}
            <div
              style={{
                padding: '14px 24px',
                borderBottom: '1px solid var(--color-border-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                background: 'var(--color-bg-primary)',
              }}
            >
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {selectedConv.lead.name || 'Lead sem nome'}
                  <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--color-text-secondary)' }}>
                    {selectedConv.lead.phone}
                  </span>
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  {selectedConv.connection && <span>Conexão: {selectedConv.connection.name}</span>}
                  <span>•</span>
                  <span>ID: {selectedConv.id.slice(0, 8)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Stage Dropdown */}
                <select
                  value={selectedConv.stage}
                  onChange={e => handleStageChange(e.target.value)}
                  style={{ fontSize: '12px', padding: '6px 10px', minHeight: '32px', width: 'auto' }}
                >
                  {Object.entries(STAGE_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>

                {/* Takeover / Release Button */}
                {selectedConv.handled_by === 'HUMAN' ? (
                  <button
                    onClick={handleRelease}
                    disabled={actionLoading}
                    className="primary"
                    style={{ background: '#7c3aed', borderColor: '#7c3aed', fontSize: '12px' }}
                    title="Devolver controle para o fluxo de IA"
                  >
                    <Sparkles size={14} />
                    Devolver para IA
                  </button>
                ) : (
                  <button
                    onClick={handleTakeover}
                    disabled={actionLoading}
                    style={{ fontSize: '12px', background: '#059669', color: '#fff', borderColor: '#059669' }}
                    title="Pausar a IA e assumir o atendimento humano"
                  >
                    <UserCheck size={14} />
                    Assumir Conversa
                  </button>
                )}
              </div>
            </div>

            {/* Error Notification */}
            {error && (
              <div
                style={{
                  padding: '8px 16px',
                  background: '#fef2f2',
                  borderBottom: '1px solid #fee2e2',
                  color: '#dc2626',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {/* Bot Active Warning Banner */}
            {selectedConv.handled_by !== 'HUMAN' && (
              <div
                style={{
                  padding: '8px 20px',
                  background: '#8b5cf612',
                  borderBottom: '1px solid #8b5cf622',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  color: '#6d28d9',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Bot size={14} />
                  O agente SDR autônomo está respondendo ativamente a este lead.
                </span>
                <button
                  onClick={handleTakeover}
                  disabled={actionLoading}
                  style={{ minHeight: '24px', padding: '2px 8px', fontSize: '10px' }}
                >
                  Assumir Agora
                </button>
              </div>
            )}

            {/* Messages Thread */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                background: 'var(--canvas)',
              }}
            >
              {loadingMessages ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '40px' }}>
                  Carregando mensagens...
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '40px' }}>
                  Nenhuma mensagem registrada nesta conversa.
                </div>
              ) : (
                messages.map(m => {
                  const isLead = m.direction === 'INBOUND';
                  const isAi = m.sender === 'ai';
                  const isHuman = m.sender === 'human';
                  const isSystem = m.sender === 'system';

                  if (isSystem) {
                    return (
                      <div
                        key={m.id}
                        style={{
                          alignSelf: 'center',
                          maxWidth: '90%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px',
                          margin: '6px 0',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: '#ef444414',
                            border: '1px solid #ef444440',
                            color: '#b91c1c',
                            fontSize: '12px',
                            lineHeight: '1.5',
                            wordBreak: 'break-word',
                          }}
                        >
                          <AlertCircle size={13} style={{ flexShrink: 0 }} />
                          <span>{m.content}</span>
                        </div>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isLead ? 'flex-start' : 'flex-end',
                        maxWidth: '75%',
                        alignSelf: isLead ? 'flex-start' : 'flex-end',
                      }}
                    >
                      {/* Sender Label Badge */}
                      <div
                        style={{
                          fontSize: '10px',
                          color: 'var(--color-text-secondary)',
                          marginBottom: '3px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {isLead ? (
                          <span>{selectedConv.lead.name || 'Lead'}</span>
                        ) : isAi ? (
                          <>
                            <Sparkles size={11} color="#8b5cf6" />
                            <span style={{ color: '#8b5cf6', fontWeight: 600 }}>SDR Flow IA</span>
                          </>
                        ) : (
                          <>
                            <User size={11} color="#059669" />
                            <span style={{ color: '#059669', fontWeight: 600 }}>Atendente Humano</span>
                          </>
                        )}
                        <span>•</span>
                        <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      {/* Bubble */}
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: isLead ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
                          background: isLead
                            ? 'var(--color-bg-primary)'
                            : isHuman
                            ? '#059669'
                            : '#6366f1',
                          color: isLead ? 'var(--color-text-primary)' : '#ffffff',
                          border: isLead ? '1px solid var(--color-border-secondary)' : 'none',
                          fontSize: '13px',
                          lineHeight: '1.5',
                          wordBreak: 'break-word',
                          boxShadow: 'var(--shadow)',
                        }}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Reply Box */}
            <form
              onSubmit={handleSendMessage}
              style={{
                padding: '16px 20px',
                borderTop: '1px solid var(--color-border-secondary)',
                display: 'flex',
                gap: '10px',
                background: 'var(--color-bg-primary)',
              }}
            >
              <input
                type="text"
                placeholder={
                  selectedConv.handled_by === 'HUMAN'
                    ? 'Digite sua resposta como atendente humano...'
                    : 'Digite sua mensagem (a conversa será assumida automaticamente)...'
                }
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                style={{ flex: 1, padding: '10px 14px' }}
              />
              <button
                type="submit"
                className="primary"
                disabled={!replyText.trim()}
                style={{ padding: '0 18px', minHeight: '38px' }}
              >
                <Send size={15} />
                Enviar
              </button>
            </form>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-secondary)',
              gap: '12px',
            }}
          >
            <MessageSquare size={48} strokeWidth={1.2} />
            <p style={{ margin: 0, fontSize: '14px' }}>Selecione uma conversa ao lado para iniciar o atendimento.</p>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: Lead & Commercial Context */}
      {selectedConv && (
        <div
          style={{
            width: '280px',
            borderLeft: '1px solid var(--color-border-secondary)',
            padding: '20px',
            overflowY: 'auto',
            flexShrink: 0,
            background: 'var(--color-bg-light)',
          }}
        >
          <span className="eyebrow" style={{ marginBottom: '14px', display: 'block' }}>
            CONTEXTO DO LEAD
          </span>

          {/* Lead Card */}
          <div className="info-card" style={{ padding: '12px', marginBottom: '16px' }}>
            <strong style={{ fontSize: '13px', display: 'block', marginBottom: '8px' }}>
              {selectedConv.lead.name || 'Sem nome informado'}
            </strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Phone size={12} /> {selectedConv.lead.phone}
              </span>
              {selectedConv.lead.city && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MapPin size={12} /> {selectedConv.lead.city}
                </span>
              )}
              {selectedConv.lead.interest && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Tag size={12} /> {selectedConv.lead.interest}
                </span>
              )}
            </div>
          </div>

          {/* Deal Card */}
          {selectedConv.deal && (
            <div className="info-card" style={{ padding: '12px', marginBottom: '16px' }}>
              <strong style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Briefcase size={13} color="var(--color-bg-accent)" />
                Negócio no CRM
              </strong>
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span>Título: {selectedConv.deal.title}</span>
                <span>Status: <strong>{selectedConv.deal.status}</strong></span>
                {selectedConv.deal.score !== null && <span>Pontuação: {selectedConv.deal.score} / 100</span>}
              </div>
            </div>
          )}

          {/* Commercial Memory */}
          <span className="eyebrow" style={{ marginBottom: '10px', display: 'block' }}>
            MEMÓRIA COMERCIAL
          </span>

          {memoryEntries.length === 0 ? (
            <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
              Nenhum dado comercial extraído ainda.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {memoryEntries.map(([key, value]) => (
                <div
                  key={key}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'var(--color-bg-primary)',
                    border: '1px solid var(--color-border-secondary)',
                    fontSize: '11px',
                  }}
                >
                  <span style={{ color: 'var(--color-text-secondary)', display: 'block', fontSize: '9px', textTransform: 'uppercase', marginBottom: '2px' }}>
                    {key}
                  </span>
                  <span style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
