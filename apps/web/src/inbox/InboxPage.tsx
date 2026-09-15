import { useState, useEffect, useMemo, useRef } from 'react';
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
  Bug,
  X,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  RotateCcw,
  Square,
  Download,
} from 'lucide-react';
import { useSession } from '../session';
import { useInstance } from '../context/InstanceContext';
import { buildAgentDebugExport, createAgentDebugFilename } from './debug-export';
import { Button, Badge, Input } from '../components/ui';
import {
  applyRealtimeEvent,
  type ConversationItem,
  type MessageItem,
  type InboxFilters,
} from './inbox-state';

interface DebugEvent {
  type: 'execution:started' | 'step:start' | 'step:complete' | 'step:failed' | 'execution:completed';
  executionId: string;
  timestamp: string;
  conversationId?: string;
  debugSessionId?: string;
  payload?: Record<string, any>;
}

interface DebugSession {
  id: string;
  organizationId: string;
  conversationId: string;
  connectionId: string;
  status: 'armed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
  armedAt: string;
  expiresAt: string;
  startedAt?: string;
  finishedAt?: string;
  executionId?: string;
  flow: {
    id: string;
    name: string;
    version: string;
    nodes: Array<{ id: string; type: string; label: string }>;
    graph?: {
      schemaVersion: 1;
      nodes: Array<{ id: string; type: string; label: string; position: { x: number; y: number }; config: Record<string, unknown> }>;
      edges: Array<{ id: string; source: string; target: string; sourcePort: string }>;
      testMode?: { enabled: boolean; phone: string };
      loopLimit?: number;
    };
  };
  events: DebugEvent[];
  report?: {
    outcome: 'success' | 'warning' | 'error';
    title: string;
    summary: string;
    steps: number;
    durationMs: number;
    tokens: { input: number; output: number };
    issues: Array<{ severity: 'warning' | 'error'; code: string; message: string; nodeId?: string }>;
  };
}

const STAGE_CONFIG: Record<string, { label: string; bg: string; text: string; variant: 'info' | 'warning' | 'accent' | 'success' | 'danger' | 'default' }> = {
  NEW_CONVERSATION: { label: 'Nova Conversa', bg: '#3b82f618', text: '#2563eb', variant: 'info' },
  QUALIFYING: { label: 'Qualificando', bg: '#f59e0b18', text: '#d97706', variant: 'warning' },
  COLLECTING_INFORMATION: { label: 'Coleta de Info', bg: '#8b5cf618', text: '#7c3aed', variant: 'accent' },
  PRESENTING_SOLUTION: { label: 'Apresentação', bg: '#06b6d418', text: '#0891b2', variant: 'info' },
  NEGOTIATING: { label: 'Negociação', bg: '#ec489918', text: '#db2777', variant: 'warning' },
  CONVERTED: { label: 'Convertido', bg: '#10b98118', text: '#059669', variant: 'success' },
  HUMAN_HANDOFF: { label: 'Humano / Handoff', bg: '#ef444418', text: '#dc2626', variant: 'danger' },
  CLOSED: { label: 'Encerrado', bg: '#6b728018', text: '#4b5563', variant: 'default' },
};

export function InboxPage() {
  const { session, activeOrg } = useSession();
  const { activeInstance } = useInstance();

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
  const [syncStalled, setSyncStalled] = useState<boolean>(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [expandedDebugStep, setExpandedDebugStep] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listFailureStreak = useRef(0);
  const detailFailureStreak = useRef(0);
  const debugSocketRef = useRef<WebSocket | null>(null);

  // Fase 5 (11.3): refs mirror the latest state for the realtime message handler below, so the
  // WebSocket effect never needs to reconnect just because a conversation was selected or a
  // filter changed — it reads the current value through these instead of re-subscribing.
  const conversationsRef = useRef<ConversationItem[]>([]);
  const messagesRef = useRef<MessageItem[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const filtersRef = useRef<InboxFilters>({ connectionId: 'ALL', stage: 'ALL', handledBy: 'ALL' });
  const inboxSocketRef = useRef<WebSocket | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);

  const accessToken = session?.access_token;
  const hasInboxAccess = Boolean(activeOrg && accessToken);
  const inboxBaseUrl = hasInboxAccess ? `/api/organizations/${activeOrg}/inbox` : null;

  const getHeaders = (hasBody = false) => {
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  };

  async function loadDebugSession(conversationId: string, silent = false): Promise<DebugSession | null> {
    if (!inboxBaseUrl || !accessToken) {
      if (!silent) setDebugError('Selecione uma organização para consultar o debug.');
      return null;
    }
    try {
      const res = await fetch(`${inboxBaseUrl}/conversations/${conversationId}/debug`, { headers: getHeaders() });
      if (!res.ok) throw new Error('Não foi possível consultar o debug.');
      const data = await res.json();
      const next = (data.session || null) as DebugSession | null;
      setDebugSession(next);
      if (!silent) setDebugError(null);
      return next;
    } catch (err) {
      if (!silent) setDebugError(err instanceof Error ? err.message : 'Falha ao consultar o debug.');
      return null;
    }
  }

  async function armDebugSession() {
    if (!selectedConv) return;
    if (!inboxBaseUrl || !accessToken) {
      setDebugError('Selecione uma organização para iniciar o debug.');
      setDebugOpen(true);
      return;
    }
    setDebugLoading(true);
    setDebugError(null);
    setExpandedDebugStep(null);
    try {
      const res = await fetch(`${inboxBaseUrl}/conversations/${selectedConv.id}/debug`, {
        method: 'POST',
        headers: getHeaders(true),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível iniciar o debug.');
      setDebugSession(data.session);
      setDebugOpen(true);
    } catch (err) {
      setDebugError(err instanceof Error ? err.message : 'Falha ao iniciar o debug.');
      setDebugOpen(true);
    } finally {
      setDebugLoading(false);
    }
  }

  async function openDebug() {
    if (!selectedConv) return;
    if (debugOpen) {
      setDebugOpen(false);
      return;
    }
    if (!inboxBaseUrl || !accessToken) {
      setDebugError('Selecione uma organização para consultar o debug.');
      setDebugOpen(true);
      return;
    }
    setDebugOpen(true);
    setDebugLoading(true);
    const existing = await loadDebugSession(selectedConv.id, true);
    setDebugLoading(false);
    if (!existing) await armDebugSession();
  }

  async function stopDebugSession() {
    if (!selectedConv) return;
    if (!inboxBaseUrl || !accessToken) {
      setDebugError('Selecione uma organização para encerrar o debug.');
      return;
    }
    setDebugLoading(true);
    try {
      const res = await fetch(`${inboxBaseUrl}/conversations/${selectedConv.id}/debug`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('Não foi possível encerrar a escuta.');
      const data = await res.json();
      setDebugSession(data.session || null);
    } catch (err) {
      setDebugError(err instanceof Error ? err.message : 'Falha ao encerrar o debug.');
    } finally {
      setDebugLoading(false);
    }
  }

  useEffect(() => {
    setDebugSession(null);
    setDebugError(null);
    setExpandedDebugStep(null);
    if (debugOpen && selectedId && hasInboxAccess) void loadDebugSession(selectedId, true);
  }, [selectedId, hasInboxAccess]);

  useEffect(() => {
    if (!debugOpen || !selectedId || !debugSession?.id || !hasInboxAccess) return;
    const status = debugSession?.status;
    if (status && !['armed', 'running'].includes(status)) return;
    const interval = window.setInterval(() => void loadDebugSession(selectedId, true), 1200);
    return () => window.clearInterval(interval);
  }, [debugOpen, selectedId, debugSession?.status, hasInboxAccess, inboxBaseUrl]);

  useEffect(() => {
    if (!debugOpen || !selectedId || !debugSession?.id || !activeOrg || !accessToken || !inboxBaseUrl) return;
    const debugSessionId = debugSession.id;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${window.location.host}/ws?token=${encodeURIComponent(accessToken)}`);
      debugSocketRef.current = socket;
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
          type: 'subscribe',
          organizationId: debugSession?.organizationId || activeOrg || undefined,
          conversationId: selectedId,
          debugSessionId,
        }));
      });
      socket.addEventListener('message', event => {
        try {
          const message = JSON.parse(event.data);
          if (message.conversationId === selectedId && message.debugSessionId) {
            void loadDebugSession(selectedId, true);
          }
        } catch {
          // Polling keeps the panel current if a malformed frame is received.
        }
      });
      return () => {
        socket.close();
        if (debugSocketRef.current === socket) debugSocketRef.current = null;
      };
    } catch {
      // Polling is the fallback when WebSocket is unavailable.
    }
  }, [debugOpen, selectedId, debugSession?.id, debugSession?.organizationId, activeOrg, accessToken, inboxBaseUrl]);

  const debugSteps = useMemo(() => {
    const steps = new Map<string, {
      key: string;
      sequence: number;
      nodeId: string;
      nodeType: string;
      status: 'running' | 'success' | 'error';
      input?: unknown;
      output?: unknown;
      durationMs?: number;
      error?: string;
    }>();
    for (const event of debugSession?.events || []) {
      if (!event.type.startsWith('step:')) continue;
      const payload = event.payload || {};
      const sequence = Number(payload.sequence || 0);
      const nodeId = String(payload.nodeId || 'unknown');
      const key = `${sequence}:${nodeId}`;
      const previous = steps.get(key);
      steps.set(key, {
        key,
        sequence,
        nodeId,
        nodeType: String(payload.nodeType || previous?.nodeType || 'unknown'),
        status: event.type === 'step:start' ? (previous?.status || 'running') : event.type === 'step:failed' || payload.error ? 'error' : 'success',
        input: payload.input ?? previous?.input,
        output: payload.output ?? previous?.output,
        durationMs: payload.durationMs ?? previous?.durationMs,
        error: payload.error || previous?.error,
      });
    }
    return Array.from(steps.values()).sort((a, b) => a.sequence - b.sequence);
  }, [debugSession]);

  function downloadDebugJson() {
    if (!debugSession?.report || !selectedConv) return;
    const exportedAt = new Date().toISOString();
    const payload = buildAgentDebugExport({
      session: debugSession,
      conversation: selectedConv,
      messages,
      steps: debugSteps,
      exportedAt,
    });
    const filename = createAgentDebugFilename({
      conversationLabel: selectedConv.lead.name || selectedConv.lead.phone,
      sessionId: debugSession.id,
      executionId: debugSession.executionId,
      exportedAt,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  }

  useEffect(() => {
    async function loadConnections() {
      if (!activeOrg || !accessToken) {
        setConnections([]);
        return;
      }

      try {
        const res = await fetch(`/api/organizations/${activeOrg}/connections`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          setConnections([]);
          return;
        }
        const data = await res.json();
        const list: Array<{ id: string; name: string; provider: string; status: string }> = Array.isArray(data) ? data : [];
        setConnections(list);
        if (activeInstance) {
          const matching = list.find(c => c.name === activeInstance || c.id === activeInstance);
          if (matching) {
            setConnectionFilter(matching.id);
          }
        }
      } catch {
        setConnections([]);
      }
    }
    void loadConnections();
  }, [activeOrg, accessToken]);

  useEffect(() => {
    if (activeInstance) {
      const matching = connections.find(c => c.name === activeInstance || c.id === activeInstance);
      setConnectionFilter(matching?.id || activeInstance);
      setSelectedId(null);
      setSelectedConv(null);
      setMessages([]);
    }
  }, [activeInstance, connections]);

  async function loadConversations(isBackground = false) {
    if (!inboxBaseUrl || !accessToken) {
      listAbortRef.current?.abort();
      if (!isBackground) setLoadingList(false);
      return;
    }
    if (!isBackground) {
      setLoadingList(true);
      setError(null);
    }
    // Abort any still-in-flight list fetch (11.3.9) — a fast filter/search change must never
    // let a stale response land after a newer one.
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    try {
      const params = new URLSearchParams();
      if (connectionFilter !== 'ALL') params.set('connectionId', connectionFilter);
      if (stageFilter !== 'ALL') params.set('stage', stageFilter);
      if (agentFilter !== 'ALL') params.set('handledBy', agentFilter);
      if (searchTerm.trim()) params.set('search', searchTerm.trim());

      const res = await fetch(`${inboxBaseUrl}/conversations?${params.toString()}`, {
        headers: getHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Erro ao listar conversas');
      const data = await res.json();
      const list: ConversationItem[] = data.conversations || [];
      setConversations(list);
      listFailureStreak.current = 0;
      if (detailFailureStreak.current === 0) setSyncStalled(false);

      setSelectedId(prev => {
        if (!prev && list.length > 0 && list[0]) return list[0].id;
        return prev;
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      listFailureStreak.current += 1;
      if (isBackground) {
        // eslint-disable-next-line no-console
        console.warn('[inbox] Falha ao atualizar lista de conversas em segundo plano:', err);
        if (listFailureStreak.current >= 3) setSyncStalled(true);
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao carregar lista de conversas.');
      }
    } finally {
      if (!isBackground) {
        setLoadingList(false);
      }
    }
  }

  async function loadConversationDetail(id: string, isBackground = false) {
    if (!inboxBaseUrl || !accessToken) {
      if (!isBackground) setLoadingMessages(false);
      return;
    }
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
      detailFailureStreak.current = 0;
      if (listFailureStreak.current === 0) setSyncStalled(false);
    } catch (err) {
      detailFailureStreak.current += 1;
      if (isBackground) {
        // eslint-disable-next-line no-console
        console.warn('[inbox] Falha ao atualizar mensagens em segundo plano:', err);
        if (detailFailureStreak.current >= 3) setSyncStalled(true);
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao carregar mensagens.');
      }
    } finally {
      if (!isBackground) {
        setLoadingMessages(false);
      }
    }
  }

  // Fase 5 (11.3): refs mirror the latest state so the WebSocket message handler below always
  // reads current data without needing to resubscribe on every conversation click or filter
  // change (see the WS effect further down).
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    filtersRef.current = { connectionId: connectionFilter, stage: stageFilter, handledBy: agentFilter };
  }, [connectionFilter, stageFilter, agentFilter]);

  // Load the conversation list snapshot on mount and whenever filters/search change. The
  // WebSocket effect below applies incremental deltas afterwards — this REST call only fires
  // again reactively (a realtime event that needs a full resync, a reconnect, filters changing)
  // rather than on a fixed timer (11.3.1/11.3.6). Search is debounced 250-400ms (11.3.10); the
  // very first load stays immediate so the page doesn't sit blank for the debounce window.
  const initialListLoadDone = useRef(false);
  useEffect(() => {
    if (!hasInboxAccess) {
      initialListLoadDone.current = false;
      return;
    }
    if (!initialListLoadDone.current) {
      initialListLoadDone.current = true;
      void loadConversations(false);
      return;
    }
    const timer = window.setTimeout(() => {
      void loadConversations(false);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [hasInboxAccess, inboxBaseUrl, stageFilter, agentFilter, connectionFilter, searchTerm]);

  // Load the detail snapshot once when the selected conversation changes. Subsequent updates to
  // this conversation arrive as inbox:message.created / inbox:conversation.updated deltas.
  useEffect(() => {
    if (!selectedId || !hasInboxAccess) return;
    void loadConversationDetail(selectedId, false);
  }, [hasInboxAccess, inboxBaseUrl, selectedId]);

  // Authenticated organizations start optimistic (assume the socket will come up) and only fall
  // back after it has been down for a defined grace period (11.3.6/11.3.7).
  const [wsDown, setWsDown] = useState(false);
  const fallbackActive = wsDown;

  useEffect(() => {
    if (!hasInboxAccess || !accessToken || !activeOrg) return;
    const websocketToken = accessToken;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let downgradeTimer: number | undefined;
    let attempt = 0;

    function scheduleReconnect() {
      if (cancelled) return;
      attempt += 1;
      const base = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
      const jitter = Math.random() * base * 0.3;
      reconnectTimer = window.setTimeout(connect, base + jitter);
    }

    function connect() {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws?token=${encodeURIComponent(websocketToken)}`);
      socket = ws;
      inboxSocketRef.current = ws;

      ws.addEventListener('open', () => {
        if (cancelled) return;
        attempt = 0;
        if (downgradeTimer) { window.clearTimeout(downgradeTimer); downgradeTimer = undefined; }
        setWsDown(false);
        ws.send(JSON.stringify({ type: 'subscribe', channel: 'inbox', organizationId: activeOrg }));
        // A fresh connection (first open or reconnect) may have missed events — refetch a
        // snapshot to cover the gap instead of trusting deltas alone (11.3.4).
        void loadConversations(true);
        if (selectedIdRef.current) void loadConversationDetail(selectedIdRef.current, true);
      });

      ws.addEventListener('message', event => {
        let msg: any;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!msg || typeof msg.type !== 'string') return;
        if (!msg.type.startsWith('inbox:') && msg.type !== 'system:resync_required') return;

        const delta = applyRealtimeEvent(
          { conversations: conversationsRef.current, messages: messagesRef.current, selectedId: selectedIdRef.current },
          msg,
          filtersRef.current
        );
        setConversations(delta.conversations);
        setMessages(delta.messages);
        if (delta.selectedConvPatch) {
          const patch = delta.selectedConvPatch;
          setSelectedConv(prev => (prev && prev.id === patch.id ? { ...prev, ...patch } : prev));
        }
        if (delta.needsListRefresh) void loadConversations(true);
        if (delta.needsFullResync) {
          void loadConversations(true);
          if (selectedIdRef.current) void loadConversationDetail(selectedIdRef.current, true);
        }
      });

      ws.addEventListener('close', () => {
        if (cancelled) return;
        if (inboxSocketRef.current === ws) inboxSocketRef.current = null;
        if (!downgradeTimer) {
          downgradeTimer = window.setTimeout(() => setWsDown(true), 10000);
        }
        scheduleReconnect();
      });

      ws.addEventListener('error', () => ws.close());
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (downgradeTimer) window.clearTimeout(downgradeTimer);
      socket?.close();
      if (inboxSocketRef.current === socket) inboxSocketRef.current = null;
    };
  }, [hasInboxAccess, accessToken, activeOrg]);

  // The only remaining timer-based refresh: engaged solely while the WebSocket is unavailable
  // (down past the grace period), at a reduced cadence — never the old 4/5s intervals (11.3.7).
  // Cancelled the moment the socket comes back up.
  useEffect(() => {
    if (!fallbackActive || !hasInboxAccess) return;
    const interval = window.setInterval(() => {
      void loadConversations(true);
      if (selectedIdRef.current) void loadConversationDetail(selectedIdRef.current, true);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [fallbackActive, hasInboxAccess, inboxBaseUrl]);

  // Background tabs throttle setInterval heavily (sometimes to once a minute
  // or less), which can make the inbox look frozen for a while even though
  // nothing is broken. Force an immediate refresh whenever the tab regains
  // focus so it never stays stale for longer than the user was away.
  useEffect(() => {
    if (!hasInboxAccess) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void loadConversations(true);
      if (selectedId) void loadConversationDetail(selectedId, true);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [hasInboxAccess, inboxBaseUrl, selectedId, stageFilter, agentFilter, connectionFilter, searchTerm]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleTakeover() {
    if (!selectedConv || !inboxBaseUrl || !accessToken) return;
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
    if (!selectedConv || !inboxBaseUrl || !accessToken) return;
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
    if (!selectedConv || !inboxBaseUrl || !accessToken) return;
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
    if (!replyText.trim() || !selectedConv || !inboxBaseUrl || !accessToken) return;

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
    <div className="inbox-page flex h-full w-full overflow-hidden bg-canvas">
      {/* LEFT COLUMN: Filters & Conversation List */}
      <div className="inbox-conversation-list w-80 border-r border-border flex flex-col flex-shrink-0 bg-surface">
        {/* Inbox Header */}
        <div className="p-3.5 border-b border-border flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-brand" />
              <h2 className="text-sm font-semibold text-content m-0">Inbox</h2>
              {syncStalled && (
                <Badge variant="danger" size="sm" className="gap-1">
                  <AlertCircle className="w-3 h-3" /> Desatualizado
                </Badge>
              )}
            </div>
            <button
              onClick={() => {
                listFailureStreak.current = 0;
                detailFailureStreak.current = 0;
                setSyncStalled(false);
                void loadConversations();
                if (selectedId) void loadConversationDetail(selectedId);
              }}
              className="p-1 rounded text-content-muted hover:text-content hover:bg-surface-muted transition-colors border-0 bg-transparent cursor-pointer"
              title="Atualizar lista"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Search Input */}
          <Input
            placeholder="Buscar por nome, telefone..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void loadConversations()}
            leftIcon={<Search className="w-3.5 h-3.5 text-content-muted" />}
          />

          {/* Agent Filter Tabs */}
          <div className="flex p-0.5 bg-surface-muted rounded-lg border border-border/60 gap-1">
            {(['ALL', 'AI', 'HUMAN'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setAgentFilter(tab)}
                className={`flex-1 text-xs py-1 rounded-md font-medium transition-all border-0 cursor-pointer ${
                  agentFilter === tab
                    ? 'bg-surface text-content shadow-xs font-semibold'
                    : 'bg-transparent text-content-muted hover:text-content'
                }`}
              >
                {tab === 'ALL' ? 'Todos' : tab === 'AI' ? 'IA' : 'Humano'}
              </button>
            ))}
          </div>

          {/* Stage Filter Dropdown */}
          <select
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value)}
            className="w-full text-xs py-1.5 px-2.5 bg-surface border border-border rounded-lg text-content focus:outline-none focus:ring-1 focus:ring-brand"
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
        <div className="flex-1 overflow-y-auto divide-y divide-border/40">
          {loadingList ? (
            <div className="p-6 text-center text-xs text-content-muted">
              Carregando conversas...
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-xs text-content-muted">
              Nenhuma conversa encontrada neste filtro.
            </div>
          ) : (
            conversations.map(c => {
              const isSelected = c.id === selectedId;
              const stageConf = STAGE_CONFIG[c.stage] || { label: c.stage, variant: 'default' as const };
              const displayName = c.lead.name || c.lead.phone;
              const timeStr = c.last_message_at
                ? new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';

              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`p-3.5 cursor-pointer transition-colors border-l-2 ${
                    isSelected
                      ? 'bg-brand/5 border-l-brand'
                      : 'border-l-transparent hover:bg-surface-muted/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <strong className="text-xs font-semibold text-content truncate max-w-[180px]">
                      {displayName}
                    </strong>
                    <span className="text-[10px] text-content-muted">{timeStr}</span>
                  </div>

                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Badge variant={stageConf.variant} size="sm">
                      {stageConf.label}
                    </Badge>
                    <Badge
                      variant={c.handled_by === 'HUMAN' ? 'success' : 'accent'}
                      size="sm"
                      className="gap-1"
                    >
                      {c.handled_by === 'HUMAN' ? <User className="w-2.5 h-2.5" /> : <Sparkles className="w-2.5 h-2.5" />}
                      {c.handled_by === 'HUMAN' ? 'Humano' : 'IA'}
                    </Badge>
                  </div>

                  <p className="text-[11px] text-content-muted truncate m-0">
                    {c.last_message?.content || 'Nenhuma mensagem recente.'}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* CENTER COLUMN: Chat Thread */}
      <div className="flex-1 flex flex-col min-w-0 bg-canvas">
        {selectedConv ? (
          <>
            {/* Active Conversation Top Bar */}
            <div className="inbox-conversation-header h-14 px-6 border-b border-border flex items-center justify-between gap-4 bg-surface flex-shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-content m-0 flex items-center gap-2 truncate">
                  {selectedConv.lead.name || 'Lead sem nome'}
                  <span className="text-xs font-normal text-content-muted">
                    {selectedConv.lead.phone}
                  </span>
                </h2>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-content-muted">
                  {selectedConv.connection && <span>Conexão: {selectedConv.connection.name}</span>}
                  <span>•</span>
                  <span>ID: {selectedConv.id.slice(0, 8)}</span>
                </div>
              </div>

              <div className="inbox-conversation-actions flex items-center gap-2 flex-shrink-0">
                <Button
                  className="inbox-conversation-action"
                  onClick={() => void openDebug()}
                  disabled={debugLoading}
                  variant={debugOpen ? 'primary' : 'outline'}
                  size="sm"
                  title="Ouvir e inspecionar a próxima execução do agente nesta conversa"
                >
                  {debugLoading ? <LoaderCircle className="animate-spin w-3.5 h-3.5" /> : <Bug className="w-3.5 h-3.5" />}
                  {debugOpen ? 'Fechar debug' : debugSession?.status === 'armed' ? 'Debug aguardando' : 'Debug do agente'}
                </Button>

                {/* Stage Dropdown */}
                <select
                  value={selectedConv.stage}
                  onChange={e => handleStageChange(e.target.value)}
                  className="inbox-stage-select text-xs py-1.5 px-2 bg-surface border border-border rounded-lg text-content focus:outline-none focus:ring-1 focus:ring-brand"
                >
                  {Object.entries(STAGE_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>

                {/* Takeover / Release Button */}
                {selectedConv.handled_by === 'HUMAN' ? (
                  <Button
                    className="inbox-conversation-action"
                    onClick={handleRelease}
                    disabled={actionLoading}
                    variant="accent"
                    size="sm"
                    title="Devolver controle para o fluxo de IA"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Devolver para IA
                  </Button>
                ) : (
                  <Button
                    className="inbox-conversation-action"
                    onClick={handleTakeover}
                    disabled={actionLoading}
                    variant="success"
                    size="sm"
                    title="Pausar a IA e assumir o atendimento humano"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    Assumir Conversa
                  </Button>
                )}
              </div>
            </div>

            {/* Error Notification */}
            {error && (
              <div className="px-4 py-2 bg-danger/10 border-b border-danger/20 text-danger text-xs flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Bot Active Warning Banner */}
            {selectedConv.handled_by !== 'HUMAN' && (
              <div className="px-5 py-2 bg-brand/10 border-b border-brand/20 flex items-center justify-between text-xs text-brand-600 dark:text-brand-400">
                <span className="flex items-center gap-2">
                  <Bot className="w-3.5 h-3.5 text-brand" />
                  O agente SDR autônomo está respondendo ativamente a este lead.
                </span>
                <button
                  onClick={handleTakeover}
                  disabled={actionLoading}
                  className="text-xs font-semibold underline hover:no-underline text-brand bg-transparent border-0 cursor-pointer"
                >
                  Assumir Agora
                </button>
              </div>
            )}

            {/* Messages Thread */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3.5 bg-canvas">
              {loadingMessages ? (
                <div className="text-center text-xs text-content-muted py-10">
                  Carregando mensagens...
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-xs text-content-muted py-10">
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
                      <div key={m.id} className="self-center max-w-[90%] flex flex-col items-center gap-1 my-1">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{m.content}</span>
                        </div>
                        <span className="text-[10px] text-content-muted">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col max-w-[75%] ${
                        isLead ? 'self-start items-start' : 'self-end items-end'
                      }`}
                    >
                      {/* Sender Label */}
                      <div className="text-[10px] text-content-muted mb-1 flex items-center gap-1">
                        {isLead ? (
                          <span>{selectedConv.lead.name || 'Lead'}</span>
                        ) : isAi ? (
                          <>
                            <Sparkles className="w-2.5 h-2.5 text-brand" />
                            <span className="text-brand font-semibold">SDR Flow IA</span>
                          </>
                        ) : (
                          <>
                            <User className="w-2.5 h-2.5 text-emerald-500" />
                            <span className="text-emerald-500 font-semibold">Atendente Humano</span>
                          </>
                        )}
                        <span>•</span>
                        <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      {/* Bubble */}
                      <div
                        className={`px-3.5 py-2.5 text-[13px] leading-relaxed break-words shadow-xs ${
                          isLead
                            ? 'rounded-2xl rounded-tl-xs bg-surface text-content border border-border'
                            : isHuman
                            ? 'rounded-2xl rounded-tr-xs bg-emerald-600 text-white'
                            : 'rounded-2xl rounded-tr-xs bg-brand text-white'
                        }`}
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
              className="p-3.5 border-t border-border flex gap-2.5 bg-surface"
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
                className="flex-1 px-3.5 py-2 bg-surface-muted/50 border border-border rounded-lg text-xs text-content placeholder:text-content-muted focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!replyText.trim()}
              >
                <Send className="w-3.5 h-3.5" />
                Enviar
              </Button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-content-muted gap-3">
            <MessageSquare className="w-12 h-12 stroke-[1.2]" />
            <p className="m-0 text-sm">Selecione uma conversa ao lado para iniciar o atendimento.</p>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: one-shot agent execution debugger */}
      {selectedConv && debugOpen && (
        <aside className="inbox-debug-panel" aria-label="Debug do agente">
          <div className="inbox-debug-heading">
            <div>
              <span className="eyebrow">DEBUG DO AGENTE</span>
              <h2>Próxima resposta</h2>
            </div>
            <button aria-label="Fechar debug" onClick={() => setDebugOpen(false)}><X size={16} /></button>
          </div>

          {debugError && (
            <div className="debug-callout debug-callout-error">
              <AlertCircle size={15} />
              <span>{debugError}</span>
            </div>
          )}

          {debugLoading && !debugSession ? (
            <div className="debug-empty"><LoaderCircle className="debug-spin" size={24} /><span>Preparando a escuta…</span></div>
          ) : !debugSession ? (
            <div className="debug-empty">
              <Bug size={30} />
              <strong>Escute uma execução real</strong>
              <p>O debug começa agora e captura apenas a próxima mensagem recebida nesta conversa.</p>
              <button className="primary" onClick={() => void armDebugSession()} disabled={debugLoading}><Radio size={14} />Ouvir próxima mensagem</button>
            </div>
          ) : (
            <>
              <div className="debug-flow-card">
                <div><span>Fluxo ativo</span><strong>{debugSession.flow.name}</strong></div>
                <span className="debug-version">{debugSession.flow.version}</span>
              </div>

              {debugSession.status === 'armed' && (
                <div className="debug-listening">
                  <span className="debug-live-dot" />
                  <div><strong>Aguardando a próxima mensagem</strong><p>Assim que o lead escrever, os blocos aparecerão abaixo em tempo real.</p></div>
                </div>
              )}

              {debugSession.status === 'running' && (
                <div className="debug-listening running">
                  <LoaderCircle className="debug-spin" size={16} />
                  <div><strong>Agente executando agora</strong><p>Acompanhando cada bloco percorrido.</p></div>
                </div>
              )}

              {debugSteps.length > 0 && (
                <div className="debug-timeline">
                  {debugSteps.map((step, index) => {
                    const node = debugSession.flow.nodes.find(item => item.id === step.nodeId);
                    const expanded = expandedDebugStep === step.key;
                    return (
                      <div className={`debug-step ${step.status}`} key={step.key}>
                        <div className="debug-step-line"><span /></div>
                        <button className="debug-step-card" onClick={() => setExpandedDebugStep(expanded ? null : step.key)}>
                          <span className="debug-step-icon">
                            {step.status === 'running' ? <LoaderCircle className="debug-spin" size={14} /> : step.status === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                          </span>
                          <span className="debug-step-copy">
                            <small>PASSO {index + 1} · {node?.type || step.nodeType}</small>
                            <strong>{node?.label || step.nodeId}</strong>
                            <em>{step.status === 'running' ? 'Executando…' : step.status === 'error' ? step.error || 'Falhou' : `${step.durationMs || 0} ms`}</em>
                          </span>
                          <ChevronDown className={expanded ? 'expanded' : ''} size={15} />
                        </button>
                        {expanded && (
                          <div className="debug-step-details">
                            {step.error && <div className="debug-detail-error"><strong>Erro</strong><p>{step.error}</p></div>}
                            <details open={Boolean(step.error)}><summary>Entrada do bloco</summary><pre>{JSON.stringify(step.input ?? null, null, 2)}</pre></details>
                            <details><summary>Saída do bloco</summary><pre>{JSON.stringify(step.output ?? null, null, 2)}</pre></details>
                            <div className="debug-node-id">ID do nó: {step.nodeId}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {debugSession.report && (
                <div className={`debug-report ${debugSession.report.outcome}`}>
                  <div className="debug-report-title">
                    {debugSession.report.outcome === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                    <div><strong>{debugSession.report.title}</strong><p>{debugSession.report.summary}</p></div>
                  </div>
                  <div className="debug-report-stats">
                    <span><strong>{debugSession.report.steps}</strong> blocos</span>
                    <span><strong>{debugSession.report.durationMs}</strong> ms</span>
                    <span><strong>{debugSession.report.tokens.input + debugSession.report.tokens.output}</strong> tokens</span>
                  </div>
                  {debugSession.report.issues.map((issue, index) => (
                    <button
                      className="debug-issue"
                      key={`${issue.code}:${index}`}
                      onClick={() => issue.nodeId && setExpandedDebugStep(debugSteps.find(step => step.nodeId === issue.nodeId)?.key || null)}
                    >
                      <AlertCircle size={13} /><span>{issue.message}</span>
                    </button>
                  ))}
                </div>
              )}

              {debugSession.report && (
                <button
                  className="debug-download"
                  onClick={downloadDebugJson}
                  title="Inclui o fluxo usado, a linha do tempo bruta, entradas, saídas, erros, mensagens da janela e o relatório final."
                >
                  <Download size={15} />
                  Baixar JSON completo do debug
                </button>
              )}

              <div className="debug-actions">
                {['armed', 'running'].includes(debugSession.status) ? (
                  <button onClick={() => void stopDebugSession()} disabled={debugLoading}><Square size={13} />Parar escuta</button>
                ) : (
                  <button className="primary" onClick={() => void armDebugSession()} disabled={debugLoading}><RotateCcw size={13} />Ouvir novamente</button>
                )}
                <small>Esta escuta expira em 15 minutos e não captura mensagens anteriores.</small>
              </div>
            </>
          )}
        </aside>
      )}

      {/* RIGHT COLUMN: Lead & Commercial Context */}
      {selectedConv && !debugOpen && (
        <div className="inbox-context-panel w-64 border-l border-border p-4 overflow-y-auto flex-shrink-0 bg-surface flex flex-col gap-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">
            CONTEXTO DO LEAD
          </span>

          {/* Lead Card */}
          <div className="p-3 rounded-lg bg-surface-muted/50 border border-border flex flex-col gap-2">
            <strong className="text-xs font-semibold text-content block">
              {selectedConv.lead.name || 'Sem nome informado'}
            </strong>
            <div className="flex flex-col gap-1.5 text-xs text-content-muted">
              <span className="flex items-center gap-1.5">
                <Phone className="w-3 h-3 text-content-muted" /> {selectedConv.lead.phone}
              </span>
              {selectedConv.lead.city && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-content-muted" /> {selectedConv.lead.city}
                </span>
              )}
              {selectedConv.lead.interest && (
                <span className="flex items-center gap-1.5">
                  <Tag className="w-3 h-3 text-content-muted" /> {selectedConv.lead.interest}
                </span>
              )}
            </div>
          </div>

          {/* Deal Card */}
          {selectedConv.deal && (
            <div className="p-3 rounded-lg bg-surface-muted/50 border border-border flex flex-col gap-2">
              <strong className="text-xs font-semibold text-content flex items-center gap-1.5">
                <Briefcase className="w-3 h-3 text-brand" />
                Negócio no CRM
              </strong>
              <div className="text-xs text-content-muted flex flex-col gap-1">
                <span>Título: <span className="text-content font-medium">{selectedConv.deal.title}</span></span>
                <span>Status: <strong className="text-content">{selectedConv.deal.status}</strong></span>
                {selectedConv.deal.score !== null && <span>Pontuação: <span className="text-content font-medium">{selectedConv.deal.score} / 100</span></span>}
              </div>
            </div>
          )}

          {/* Commercial Memory */}
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">
            MEMÓRIA COMERCIAL
          </span>

          {memoryEntries.length === 0 ? (
            <p className="text-xs text-content-muted italic m-0">
              Nenhum dado comercial extraído ainda.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {memoryEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="p-2.5 rounded-lg bg-surface-muted/40 border border-border text-xs"
                >
                  <span className="text-content-muted block text-[9px] uppercase tracking-wide mb-0.5">
                    {key}
                  </span>
                  <span className="text-content break-words font-medium">
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
