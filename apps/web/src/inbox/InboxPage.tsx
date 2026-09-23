import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Pencil,
  Trash2,
  Plus,
  Check,
  Users,
  SlidersHorizontal,
  ArrowLeft,
  PanelRightClose,
  PanelRightOpen,
  MoreHorizontal,
  Copy,
  Hash,
  Thermometer,
} from 'lucide-react';
import { messagePreview } from '@sdr/shared';
import { useSession } from '../session';
import { useInstance } from '../context/InstanceContext';
import { buildAgentDebugExport, createAgentDebugFilename } from './debug-export';
import { Button, Input, Skeleton, SkeletonText, EmptyState, IconButton, Popover, DropdownMenu, Select, SegmentedControl, toast } from '../components/ui';
import { formatDayLabel, formatListTimestamp, formatPhone, formatRelative, formatTime, isSameDay } from '../lib/format';
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
  COLLECTING_INFORMATION: { label: 'Coletando informações', bg: '#8b5cf618', text: '#7c3aed', variant: 'accent' },
  PRESENTING_SOLUTION: { label: 'Apresentação', bg: '#06b6d418', text: '#0891b2', variant: 'info' },
  NEGOTIATING: { label: 'Negociação', bg: '#ec489918', text: '#db2777', variant: 'warning' },
  CONVERTED: { label: 'Convertido', bg: '#10b98118', text: '#059669', variant: 'success' },
  HUMAN_HANDOFF: { label: 'Encaminhado a humano', bg: '#ef444418', text: '#dc2626', variant: 'danger' },
  CLOSED: { label: 'Encerrado', bg: '#6b728018', text: '#4b5563', variant: 'default' },
};

// Stage dots use one ordinal ramp (earlier → later) plus reserved colors for the two outcomes.
const STAGE_DOT: Record<string, string> = {
  NEW_CONVERSATION: 'bg-content-muted',
  QUALIFYING: 'bg-brand/40',
  COLLECTING_INFORMATION: 'bg-brand/60',
  PRESENTING_SOLUTION: 'bg-brand/80',
  NEGOTIATING: 'bg-brand',
  CONVERTED: 'bg-success',
  HUMAN_HANDOFF: 'bg-warning',
  CLOSED: 'bg-border-strong',
};

// Lead temperature from the Laya classifier (leads.temperature / lead_score).
const TEMPERATURE_CONFIG: Record<'HOT' | 'WARM' | 'COLD', { label: string; text: string; fill: string }> = {
  HOT: { label: 'Quente', text: 'text-danger', fill: 'bg-danger' },
  WARM: { label: 'Morno', text: 'text-warning', fill: 'bg-warning' },
  COLD: { label: 'Frio', text: 'text-info', fill: 'bg-info' },
};

function humanizeKey(key: string) {
  const last = key.split('.').pop() ?? key;
  const text = last.replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStalled, setSyncStalled] = useState<boolean>(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [expandedDebugStep, setExpandedDebugStep] = useState<string | null>(null);
  const [editingMemoryPath, setEditingMemoryPath] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<string>('');
  const [memoryActionLoading, setMemoryActionLoading] = useState<boolean>(false);
  const [showAddMemoryField, setShowAddMemoryField] = useState<boolean>(false);
  const [newMemoryPath, setNewMemoryPath] = useState<string>('');
  const [newMemoryValue, setNewMemoryValue] = useState<string>('');
  const [contextPanelWidth, setContextPanelWidth] = useState<number>(300);
  const [isResizingContextPanel, setIsResizingContextPanel] = useState(false);
  // The lead panel is open by default only where there is room for it next to the thread.
  const [contextOpen, setContextOpen] = useState<boolean>(() => typeof window !== 'undefined' && window.innerWidth >= 1440);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contextPanelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const CONTEXT_PANEL_MIN_WIDTH = 220;
  const getContextPanelMaxWidth = () => Math.max(CONTEXT_PANEL_MIN_WIDTH, Math.min(480, window.innerWidth * 0.4));

  const startContextPanelResize = (e: React.MouseEvent) => {
    e.preventDefault();
    contextPanelResizeRef.current = { startX: e.clientX, startWidth: contextPanelWidth };
    setIsResizingContextPanel(true);
  };

  useEffect(() => {
    if (!isResizingContextPanel) return;
    const handleMouseMove = (e: MouseEvent) => {
      const start = contextPanelResizeRef.current;
      if (!start) return;
      const delta = start.startX - e.clientX;
      const maxWidth = getContextPanelMaxWidth();
      const nextWidth = Math.min(maxWidth, Math.max(CONTEXT_PANEL_MIN_WIDTH, start.startWidth + delta));
      setContextPanelWidth(nextWidth);
    };
    const handleMouseUp = () => {
      contextPanelResizeRef.current = null;
      setIsResizingContextPanel(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingContextPanel]);

  useEffect(() => {
    const handleWindowResize = () => {
      setContextPanelWidth(w => Math.min(w, getContextPanelMaxWidth()));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);
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

      // On phones the list is its own screen (master/detail), so nothing is auto-opened there.
      const wideScreen = typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches;
      setSelectedId(prev => {
        if (!prev && wideScreen && list.length > 0 && list[0]) return list[0].id;
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

  async function handleMemoryChange(path: string, options: { value?: string; delete?: boolean }) {
    if (!selectedConv || !inboxBaseUrl || !accessToken) return;
    setMemoryActionLoading(true);
    try {
      const res = await fetch(`${inboxBaseUrl}/conversations/${selectedConv.id}/lead-memory`, {
        method: 'PATCH',
        headers: getHeaders(true),
        body: JSON.stringify(
          options.delete ? { path, delete: true } : { path, value: options.value }
        ),
      });
      if (!res.ok) throw new Error('Falha ao atualizar memória do lead.');
      const updated = await res.json();
      setSelectedConv(updated);
      setEditingMemoryPath(null);
      setShowAddMemoryField(false);
      setNewMemoryPath('');
      setNewMemoryValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar memória do lead.');
    } finally {
      setMemoryActionLoading(false);
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
  type MemoryRow = { path: string; label: string; value: unknown; editable: boolean };
  const memoryRows: MemoryRow[] = [];
  for (const [key, value] of memoryEntries) {
    if (key === 'custom_fields' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        memoryRows.push({
          path: `custom_fields.${subKey}`,
          label: `custom_fields.${subKey}`,
          value: subValue,
          editable: typeof subValue !== 'object',
        });
      }
    } else {
      memoryRows.push({ path: key, label: key, value, editable: typeof value !== 'object' });
    }
  }

  const displayNameOf = (c: ConversationItem) =>
    c.lead.is_group ? c.lead.group_subject || c.lead.name || 'Grupo sem nome' : c.lead.name || formatPhone(c.lead.phone);
  const needsHuman = (c: ConversationItem) => c.handled_by === 'HUMAN' || c.stage === 'HUMAN_HANDOFF';
  const humanQueue = conversations.filter(needsHuman);
  const aiList = conversations.filter(c => !needsHuman(c));
  const orderedIds = [...humanQueue, ...aiList].map(c => c.id);
  const activeFilterCount = (stageFilter !== 'ALL' ? 1 : 0);
  const selectedConnection = connections.find(c => c.id === connectionFilter);

  // ↑/↓ move through the list like a mail client; the list container owns the shortcut.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = selectedId ? orderedIds.indexOf(selectedId) : -1;
    const next = orderedIds[event.key === 'ArrowDown' ? Math.min(orderedIds.length - 1, index + 1) : Math.max(0, index - 1)];
    if (next) {
      setSelectedId(next);
      document.getElementById(`conv-${next}`)?.focus();
    }
  };

  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [replyText]);

  const renderRow = (c: ConversationItem) => {
    const isSelected = c.id === selectedId;
    const stageConf = STAGE_CONFIG[c.stage];
    const waiting = needsHuman(c);
    const temperature = c.lead.temperature ? TEMPERATURE_CONFIG[c.lead.temperature] : null;
    return (
      <button
        key={c.id}
        id={`conv-${c.id}`}
        type="button"
        onClick={() => setSelectedId(c.id)}
        aria-current={isSelected ? 'true' : undefined}
        className={`inbox-row flex w-full min-h-0 flex-col items-stretch justify-start gap-1 rounded-none border-0 border-l-2 px-3.5 py-3 text-left outline-none transition-colors focus-visible:bg-surface-elevated ${
          isSelected ? 'border-l-brand bg-brand/5' : 'border-l-transparent bg-transparent hover:bg-surface-elevated'
        }`}
      >
        <span className="flex w-full items-center gap-2">
          {c.lead.is_group && <Users className="h-3.5 w-3.5 flex-shrink-0 text-content-muted" aria-label="Grupo" />}
          <strong className="min-w-0 flex-1 truncate text-xs font-semibold text-content">{displayNameOf(c)}</strong>
          <span className={`flex-shrink-0 text-2xs tabular-nums ${waiting ? 'font-semibold text-warning' : 'text-content-muted'}`}>
            {waiting ? formatRelative(c.last_message_at) : formatListTimestamp(c.last_message_at)}
          </span>
        </span>
        <span className="w-full truncate text-2xs text-content-secondary">
          {c.last_message ? messagePreview(c.last_message.message_type, c.last_message.content) : 'Nenhuma mensagem recente.'}
        </span>
        <span className="flex items-center gap-1.5 text-2xs text-content-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[c.stage] ?? 'bg-content-muted'}`} aria-hidden="true" />
          {stageConf?.label ?? c.stage}
          {c.handled_by === 'HUMAN' && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-info/30 bg-info/10 px-1.5 text-info">
              <User className="h-2.5 w-2.5" /> Humano
            </span>
          )}
          {temperature && (
            <span
              className={`ml-auto inline-flex items-center gap-0.5 font-medium tabular-nums ${temperature.text}`}
              title={`Lead ${temperature.label.toLowerCase()} · interesse ${c.lead.lead_score ?? '—'}/100`}
            >
              <Thermometer className="h-2.5 w-2.5" aria-hidden="true" />
              {c.lead.lead_score ?? temperature.label}
            </span>
          )}
        </span>
      </button>
    );
  };

  const conversationTitle = selectedConv ? displayNameOf(selectedConv) : '';

  return (
    <div className="inbox-page relative flex h-full w-full overflow-hidden bg-canvas">
      {/* LEFT: conversation list (full screen on phones until a conversation is opened) */}
      <section
        aria-label="Conversas"
        className={`w-full flex-shrink-0 flex-col border-r border-border bg-surface md:flex md:w-[300px] xl:w-[320px] ${selectedId ? 'hidden' : 'flex'}`}
      >
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Buscar nome ou telefone"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void loadConversations()}
              leftIcon={<Search className="h-3.5 w-3.5 text-content-muted" />}
              className="!h-8"
              aria-label="Buscar conversas"
            />
            <Popover
              align="end"
              width={272}
              className="p-3"
              trigger={
                <Button variant={activeFilterCount ? 'secondary' : 'outline'} size="md" aria-label="Filtros" className="flex-shrink-0 px-2.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {activeFilterCount > 0 && <span className="tabular-nums">{activeFilterCount}</span>}
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 text-2xs font-medium text-content-secondary">
                  Estágio
                  <Select
                    value={stageFilter}
                    onChange={setStageFilter}
                    options={[{ value: 'ALL', label: 'Todos os estágios' }, ...Object.entries(STAGE_CONFIG).map(([value, conf]) => ({ value, label: conf.label }))]}
                  />
                </label>
                {activeFilterCount > 0 && (
                  <button type="button" onClick={() => setStageFilter('ALL')} className="min-h-0 self-start border-0 bg-transparent p-0 text-2xs font-medium text-brand-fg hover:underline">
                    Limpar filtros
                  </button>
                )}
              </div>
            </Popover>
          </div>
          <SegmentedControl
            fullWidth
            size="sm"
            aria-label="Quem atende"
            value={agentFilter}
            onChange={setAgentFilter}
            options={[
              { value: 'ALL', label: 'Todos', count: agentFilter === 'ALL' ? conversations.length : undefined },
              { value: 'AI', label: 'IA', count: agentFilter === 'ALL' ? conversations.filter(c => c.handled_by !== 'HUMAN').length : undefined },
              { value: 'HUMAN', label: 'Humano', count: agentFilter === 'ALL' ? conversations.filter(c => c.handled_by === 'HUMAN').length : undefined },
            ]}
          />
          {connections.length > 1 && (
            <Select
              size="sm"
              appearance="chip"
              prefix="Instância:"
              value={connectionFilter}
              onChange={setConnectionFilter}
              options={[{ value: 'ALL', label: 'Todas' }, ...connections.map(c => ({ value: c.id, label: c.name }))]}
            />
          )}
          {syncStalled && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-warning-border bg-warning-bg px-2.5 py-1.5 text-2xs text-warning">
              <span className="flex items-center gap-1.5"><AlertCircle className="h-3 w-3" /> Lista desatualizada</span>
              <button
                type="button"
                onClick={() => {
                  listFailureStreak.current = 0;
                  detailFailureStreak.current = 0;
                  setSyncStalled(false);
                  void loadConversations();
                  if (selectedId) void loadConversationDetail(selectedId);
                }}
                className="min-h-0 border-0 bg-transparent p-0 font-semibold text-warning hover:underline"
              >
                Tentar agora
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto" onKeyDown={onListKeyDown}>
          {loadingList ? (
            <div role="status" aria-live="polite">
              <span className="sr-only">Carregando conversas…</span>
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="border-b border-border/40 p-3.5" aria-hidden="true">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-2.5 w-9" />
                  </div>
                  <Skeleton className="mb-2 h-3 w-11/12" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={<MessageSquare size={18} />}
              title="Nenhuma conversa aqui"
              description={activeFilterCount || searchTerm ? 'Tente limpar a busca ou os filtros.' : 'As conversas aparecem assim que um lead escrever no WhatsApp.'}
            />
          ) : (
            <>
              {humanQueue.length > 0 && (
                <div>
                  <div className="sticky top-0 z-[1] flex items-center gap-1.5 bg-surface/95 px-3.5 pb-1 pt-3 text-2xs font-semibold text-warning backdrop-blur">
                    <UserCheck className="h-3 w-3" /> Atendimento humano · {humanQueue.length}
                  </div>
                  <div className="divide-y divide-border/50">{humanQueue.map(renderRow)}</div>
                </div>
              )}
              {aiList.length > 0 && (
                <div>
                  {humanQueue.length > 0 && (
                    <div className="sticky top-0 z-[1] bg-surface/95 px-3.5 pb-1 pt-3 text-2xs font-semibold text-content-muted backdrop-blur">
                      Com a IA · {aiList.length}
                    </div>
                  )}
                  <div className="divide-y divide-border/50">{aiList.map(renderRow)}</div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* CENTER: thread */}
      <section aria-label="Conversa" className={`min-w-0 flex-1 flex-col bg-canvas md:flex ${selectedId ? 'flex' : 'hidden'}`}>
        {!selectedConv && (loadingList || loadingMessages) ? (
          <div role="status" aria-live="polite" className="flex h-full flex-col">
            <span className="sr-only">Carregando conversa…</span>
            <div className="flex h-14 items-center justify-between border-b border-border bg-surface px-5" aria-hidden="true">
              <SkeletonText lines={2} className="w-56" />
              <Skeleton className="h-8 w-28" />
            </div>
            <div className="flex flex-1 flex-col gap-5 p-6" aria-hidden="true">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className={`w-2/3 ${index % 2 ? 'self-end' : 'self-start'}`}>
                  <Skeleton className="mt-1.5 h-14 w-full" rounded="lg" />
                </div>
              ))}
            </div>
          </div>
        ) : selectedConv ? (
          <>
            <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:px-5">
              <IconButton
                className="md:hidden"
                label="Voltar para a lista"
                icon={<ArrowLeft size={16} />}
                onClick={() => {
                  setSelectedId(null);
                  setSelectedConv(null);
                }}
              />
              <div className="min-w-0 flex-1">
                <h2 className="m-0 truncate text-sm font-semibold text-content">{conversationTitle}</h2>
                <p className="m-0 truncate text-2xs text-content-muted">
                  {selectedConv.lead.is_group ? 'Grupo' : formatPhone(selectedConv.lead.phone)}
                  {selectedConv.connection && ` · ${selectedConv.connection.name}`}
                </p>
              </div>
              <Popover
                align="end"
                width={240}
                className="p-1"
                role="listbox"
                aria-label="Estágio da conversa"
                trigger={
                  <button
                    type="button"
                    className="flex h-7 min-h-0 flex-shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-2.5 text-xs font-medium text-content hover:border-border-strong"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[selectedConv.stage] ?? 'bg-content-muted'}`} />
                    <span className="hidden sm:inline">{STAGE_CONFIG[selectedConv.stage]?.label ?? selectedConv.stage}</span>
                    <ChevronDown className="h-3 w-3 text-content-muted" />
                  </button>
                }
              >
                {close => (
                  <>
                    <div className="px-2.5 pb-1 pt-2 text-2xs font-medium text-content-muted">Mover para o estágio</div>
                    {Object.entries(STAGE_CONFIG).map(([value, conf]) => (
                      <button
                        key={value}
                        type="button"
                        role="option"
                        aria-selected={value === selectedConv.stage}
                        onClick={() => {
                          close();
                          if (value !== selectedConv.stage) void handleStageChange(value);
                        }}
                        className="flex w-full min-h-0 items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-xs text-content hover:bg-surface-elevated focus:bg-surface-elevated"
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[value] ?? 'bg-content-muted'}`} />
                        <span className="flex-1">{conf.label}</span>
                        {value === selectedConv.stage && <Check className="h-3.5 w-3.5 text-brand-fg" />}
                      </button>
                    ))}
                  </>
                )}
              </Popover>
              <IconButton
                label={contextOpen ? 'Ocultar contexto do lead' : 'Mostrar contexto do lead'}
                icon={contextOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                onClick={() => {
                  setContextOpen(open => !open);
                  if (debugOpen) setDebugOpen(false);
                }}
              />
              <DropdownMenu
                aria-label="Mais ações da conversa"
                width={240}
                trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} tooltip={false} />}
                items={[
                  {
                    label: debugOpen ? 'Fechar debug do agente' : 'Debug do agente',
                    description: 'Acompanhar a próxima resposta, bloco a bloco',
                    icon: <Bug size={14} />,
                    onSelect: () => void openDebug(),
                  },
                  {
                    label: 'Copiar telefone',
                    icon: <Copy size={14} />,
                    disabled: selectedConv.lead.is_group,
                    onSelect: () => {
                      void navigator.clipboard?.writeText(selectedConv.lead.phone);
                      toast.success('Telefone copiado');
                    },
                  },
                  { type: 'separator' },
                  {
                    label: 'Copiar ID da conversa',
                    description: 'Para suporte técnico',
                    icon: <Hash size={14} />,
                    onSelect: () => {
                      void navigator.clipboard?.writeText(selectedConv.id);
                      toast.success('ID copiado', { description: selectedConv.id });
                    },
                  },
                ]}
              />
            </header>

            {error && (
              <div className="flex items-center gap-2 border-b border-danger/20 bg-danger/10 px-4 py-2 text-xs text-danger">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Fechar aviso" className="min-h-0 border-0 bg-transparent p-0 text-danger">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Who is answering — the one primary action of the thread lives here. */}
            {selectedConv.handled_by !== 'HUMAN' ? (
              <div className="flex items-center justify-between gap-3 border-b border-brand/20 bg-brand/5 px-4 py-2 text-xs md:px-5">
                <span className="flex min-w-0 items-center gap-2 text-content-secondary">
                  <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-brand-fg" />
                  <span className="truncate">A IA está respondendo esta conversa</span>
                </span>
                <Button size="sm" variant="primary" onClick={handleTakeover} loading={actionLoading}>
                  <UserCheck className="h-3.5 w-3.5" /> Assumir
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 border-b border-info/20 bg-info/5 px-4 py-2 text-xs md:px-5">
                <span className="flex min-w-0 items-center gap-2 text-content-secondary">
                  <User className="h-3.5 w-3.5 flex-shrink-0 text-info" />
                  <span className="truncate">Atendimento humano · a IA está pausada</span>
                </span>
                <Button size="sm" variant="secondary" onClick={handleRelease} loading={actionLoading}>
                  <Sparkles className="h-3.5 w-3.5" /> Devolver para a IA
                </Button>
              </div>
            )}

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-canvas px-4 py-5 md:px-6">
              {loadingMessages ? (
                <div role="status" aria-live="polite" className="flex flex-col gap-5 py-2">
                  <span className="sr-only">Carregando mensagens…</span>
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className={`w-2/3 ${index % 2 ? 'self-end' : 'self-start'}`} aria-hidden="true">
                      <Skeleton className="mt-1.5 h-14 w-full" rounded="lg" />
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="py-10 text-center text-xs text-content-muted">Nenhuma mensagem registrada nesta conversa.</div>
              ) : (
                messages.map((m, index) => {
                  const previous = messages[index - 1];
                  const daySeparator = !previous || !isSameDay(previous.created_at, m.created_at);
                  const isLead = m.direction === 'INBOUND';
                  const isAi = m.sender === 'ai';
                  const isHuman = m.sender === 'human';
                  const separator = daySeparator ? (
                    <div className="my-2 flex items-center gap-3 text-2xs font-medium text-content-muted" role="separator">
                      <span className="h-px flex-1 bg-border" />
                      {formatDayLabel(m.created_at)}
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  ) : null;

                  if (m.sender === 'system') {
                    return (
                      <React.Fragment key={m.id}>
                        {separator}
                        <div className="my-1 flex max-w-[90%] items-center gap-2 self-center rounded-lg border border-danger/20 bg-danger/10 px-3 py-1.5 text-xs text-danger">
                          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                          <span>{m.content}</span>
                          <span className="text-2xs text-danger/70">{formatTime(m.created_at)}</span>
                        </div>
                      </React.Fragment>
                    );
                  }

                  return (
                    <React.Fragment key={m.id}>
                      {separator}
                      <div className={`flex max-w-[85%] flex-col md:max-w-[72%] ${isLead ? 'items-start self-start' : 'items-end self-end'}`}>
                        <div className="mb-1 flex items-center gap-1 text-2xs text-content-muted">
                          {isLead ? (
                            <span>{m.sender_name || (selectedConv.lead.is_group ? 'Participante' : selectedConv.lead.name || 'Lead')}</span>
                          ) : isAi ? (
                            <>
                              <Sparkles className="h-2.5 w-2.5 text-brand-fg" />
                              <span>Agente IA</span>
                            </>
                          ) : (
                            <>
                              <User className="h-2.5 w-2.5 text-info" />
                              <span>{m.sender_name || 'Atendente'}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{formatTime(m.created_at)}</span>
                        </div>
                        <div
                          className={`whitespace-pre-wrap break-words px-3.5 py-2.5 text-[13px] leading-relaxed ${
                            isLead
                              ? 'rounded-2xl rounded-tl-sm border border-border bg-surface text-content'
                              : isHuman
                              ? 'rounded-2xl rounded-tr-sm border border-info/30 bg-info/15 text-content'
                              : 'rounded-2xl rounded-tr-sm border border-brand/30 bg-brand/15 text-content'
                          }`}
                        >
                          {messagePreview(m.message_type, m.content)}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="flex items-end gap-2 border-t border-border bg-surface p-3">
              <textarea
                ref={composerRef}
                rows={1}
                aria-label="Mensagem"
                placeholder="Escreva uma mensagem…"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (replyText.trim()) void handleSendMessage(e as unknown as React.FormEvent);
                  }
                }}
                className="max-h-36 min-h-[36px] flex-1 resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[13px] leading-5 text-content placeholder:text-content-muted focus:border-brand focus:outline-none"
              />
              <Button type="submit" variant="primary" size="lg" disabled={!replyText.trim()}>
                <Send className="h-3.5 w-3.5" />
                <span className={selectedConv.handled_by === 'HUMAN' ? '' : 'hidden sm:inline'}>
                  {selectedConv.handled_by === 'HUMAN' ? 'Enviar' : 'Assumir e enviar'}
                </span>
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-content-muted">
            <MessageSquare className="h-10 w-10 stroke-[1.2]" />
            <p className="m-0 text-sm">Selecione uma conversa para começar.</p>
            <p className="m-0 text-2xs">Dica: use ↑ e ↓ para navegar pela lista.</p>
          </div>
        )}
      </section>

      {/* RIGHT COLUMN: one-shot agent execution debugger */}
      {selectedConv && debugOpen && (
        <aside className="inbox-debug-panel absolute inset-y-0 right-0 z-20 max-w-[90vw] shadow-modal xl:relative xl:shadow-none" aria-label="Debug do agente">
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
            <div role="status" aria-live="polite" className="space-y-3 p-4">
              <span className="sr-only">Preparando a escuta…</span>
              <Skeleton className="h-16 w-full" rounded="lg" />
              <Skeleton className="h-24 w-full" rounded="lg" />
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="rounded-lg border border-border p-3" aria-hidden="true">
                  <SkeletonText lines={2} />
                </div>
              ))}
            </div>
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


      {/* RIGHT: lead context — collapsible; overlays the thread on narrower screens */}
      {selectedConv && !debugOpen && contextOpen && (
        <aside
          aria-label="Contexto do lead"
          className="absolute inset-y-0 right-0 z-20 flex w-[300px] max-w-[90vw] flex-shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-4 shadow-modal xl:relative xl:shadow-none"
          style={{ width: contextPanelWidth }}
        >
          <div
            className={`absolute bottom-0 left-0 top-0 -ml-0.5 hidden w-1.5 cursor-col-resize hover:bg-brand/40 xl:block ${isResizingContextPanel ? 'bg-brand/40' : ''}`}
            onMouseDown={startContextPanelResize}
            aria-hidden="true"
          />
          <section>
            <h3 className="m-0 mb-2 text-2xs font-semibold uppercase tracking-wider text-content-muted">Lead</h3>
            <p className="m-0 text-sm font-semibold text-content">{selectedConv.lead.name || 'Sem nome informado'}</p>
            <dl className="m-0 mt-2 flex flex-col gap-1.5 text-xs text-content-secondary">
              {!selectedConv.lead.is_group && (
                <div className="group flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-content-muted" />
                  <dd className="m-0 flex-1">{formatPhone(selectedConv.lead.phone)}</dd>
                  <IconButton
                    size="sm"
                    label="Copiar telefone"
                    icon={<Copy size={12} />}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => {
                      void navigator.clipboard?.writeText(selectedConv.lead.phone);
                      toast.success('Telefone copiado');
                    }}
                  />
                </div>
              )}
              {selectedConv.lead.city && (
                <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3 text-content-muted" /><dd className="m-0">{selectedConv.lead.city}</dd></div>
              )}
              {selectedConv.lead.interest && (
                <div className="flex items-center gap-1.5"><Tag className="h-3 w-3 text-content-muted" /><dd className="m-0">{selectedConv.lead.interest}</dd></div>
              )}
            </dl>
          </section>

          {(() => {
            const temperature = selectedConv.lead.temperature ? TEMPERATURE_CONFIG[selectedConv.lead.temperature] : null;
            const score = selectedConv.lead.lead_score;
            const funnelStage = selectedConv.lead.funnel_stage && selectedConv.lead.funnel_stage !== 'NEW_CONVERSATION'
              ? selectedConv.lead.funnel_stage
              : null;
            if (!temperature && !funnelStage) return null;
            return (
              <section>
                <h3 className="m-0 mb-2 text-2xs font-semibold uppercase tracking-wider text-content-muted">Qualificação</h3>
                {temperature && (
                  <>
                    <div className="flex items-center justify-between text-xs" title="Interesse de compra estimado pela IA">
                      <span className={`inline-flex items-center gap-1 font-medium ${temperature.text}`}>
                        <Thermometer className="h-3 w-3" aria-hidden="true" />
                        {temperature.label}
                      </span>
                      <span className="tabular-nums text-content-secondary">
                        <span className="font-semibold text-content">{score ?? '—'}</span> / 100
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
                      <div className={`h-full rounded-full ${temperature.fill}`} style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }} />
                    </div>
                  </>
                )}
                {funnelStage && (
                  <p className={`m-0 flex items-center gap-1.5 text-xs text-content-secondary ${temperature ? 'mt-2.5' : ''}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[funnelStage] ?? 'bg-content-muted'}`} aria-hidden="true" />
                    Etapa do funil: <span className="font-medium text-content">{STAGE_CONFIG[funnelStage]?.label ?? funnelStage}</span>
                  </p>
                )}
              </section>
            );
          })()}

          {selectedConv.deal && (
            <section>
              <h3 className="m-0 mb-2 text-2xs font-semibold uppercase tracking-wider text-content-muted">Oportunidade</h3>
              <div className="flex flex-col gap-1 text-xs text-content-secondary">
                <span className="font-medium text-content">{selectedConv.deal.title}</span>
                <span>Status: {selectedConv.deal.status}</span>
                {selectedConv.deal.score !== null && <span>Pontuação: {selectedConv.deal.score} / 100</span>}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="m-0 text-2xs font-semibold uppercase tracking-wider text-content-muted">Memória comercial</h3>
              <IconButton size="sm" label="Adicionar campo" icon={<Plus size={14} />} disabled={memoryActionLoading} onClick={() => setShowAddMemoryField(v => !v)} />
            </div>

            {showAddMemoryField && (
              <form
                className="mb-2 flex flex-col gap-1.5 rounded-lg border border-border bg-surface-elevated p-2.5"
                onSubmit={e => {
                  e.preventDefault();
                  if (newMemoryPath.trim()) void handleMemoryChange(newMemoryPath.trim(), { value: newMemoryValue });
                }}
              >
                <input autoFocus className="h-8 rounded-md border border-border bg-surface px-2 text-xs" placeholder="Campo (ex.: dependentes)" value={newMemoryPath} onChange={e => setNewMemoryPath(e.target.value)} />
                <input className="h-8 rounded-md border border-border bg-surface px-2 text-xs" placeholder="Valor" value={newMemoryValue} onChange={e => setNewMemoryValue(e.target.value)} />
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" type="button" onClick={() => { setShowAddMemoryField(false); setNewMemoryPath(''); setNewMemoryValue(''); }}>Cancelar</Button>
                  <Button size="sm" variant="primary" type="submit" disabled={!newMemoryPath.trim() || memoryActionLoading}>Adicionar</Button>
                </div>
              </form>
            )}

            {memoryRows.length === 0 ? (
              <p className="m-0 text-xs text-content-muted">A IA ainda não extraiu dados desta conversa.</p>
            ) : (
              <dl className="m-0 flex flex-col divide-y divide-border/60">
                {memoryRows.map(row => (
                  <div key={row.path} className="group flex items-start gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <dt className="text-2xs text-content-muted">{humanizeKey(row.label)}</dt>
                      {editingMemoryPath === row.path ? (
                        <form
                          className="mt-1"
                          onSubmit={e => {
                            e.preventDefault();
                            void handleMemoryChange(row.path, { value: memoryDraft });
                          }}
                        >
                          <input
                            autoFocus
                            className="h-8 w-full rounded-md border border-brand bg-surface-elevated px-2 text-xs"
                            value={memoryDraft}
                            onChange={e => setMemoryDraft(e.target.value)}
                            onBlur={() => setEditingMemoryPath(null)}
                            onKeyDown={e => e.key === 'Escape' && setEditingMemoryPath(null)}
                            aria-label={`Editar ${humanizeKey(row.label)}`}
                          />
                          <span className="mt-1 block text-2xs text-content-muted">Enter salva · Esc cancela</span>
                        </form>
                      ) : row.editable ? (
                        <dd className="m-0">
                          <button
                            type="button"
                            disabled={memoryActionLoading}
                            onClick={() => {
                              setEditingMemoryPath(row.path);
                              setMemoryDraft(String(row.value ?? ''));
                            }}
                            className="-mx-1 flex min-h-0 w-full justify-start rounded border-0 bg-transparent px-1 py-0.5 text-left text-xs font-medium text-content hover:bg-surface-elevated"
                            title="Clique para editar"
                          >
                            {String(row.value)}
                          </button>
                        </dd>
                      ) : (
                        <dd className="m-0 break-all text-xs font-medium text-content">{JSON.stringify(row.value)}</dd>
                      )}
                    </div>
                    <IconButton
                      size="sm"
                      variant="danger"
                      label={`Remover ${humanizeKey(row.label)}`}
                      icon={<X size={12} />}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      disabled={memoryActionLoading}
                      onClick={() => {
                        const previous = row.value;
                        void handleMemoryChange(row.path, { delete: true }).then(() =>
                          toast.success(`${humanizeKey(row.label)} removido`, {
                            action: row.editable ? { label: 'Desfazer', onClick: () => void handleMemoryChange(row.path, { value: String(previous ?? '') }) } : undefined,
                          })
                        );
                      }}
                    />
                  </div>
                ))}
              </dl>
            )}
          </section>
        </aside>
      )}
    </div>
  );
}
