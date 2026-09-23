import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, MiniMap, useReactFlow, type Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, ChevronsUpDown, Download, FileJson, Hash, Info, LayoutGrid, Maximize2, Minus, MoreHorizontal, Network, PanelLeftClose, PanelLeftOpen, Play, Plus, Redo2, RotateCcw, Save, Search, Settings2, ShieldAlert, Sparkles, Trash2, Undo2, Upload, X } from 'lucide-react';
import { PromptsView } from './PromptsView';
import { VariablesView } from './VariablesView';
import { flowGraphSchema, flowTestModeSchema, nodeTypeSchema, type FlowGraph } from '@sdr/shared';
import { catalog, categories, categoryColors, createBlankFlow, createSdrTemplate, validateGraph } from '@sdr/flow';
import { FlowNode, type CanvasNode } from './FlowNode';
import { SchemaForm } from './SchemaForm';
import { useBuilder } from './store';
import { useSession } from '../session';
import { useInstance } from '../context/InstanceContext';
import { PlaygroundModal } from './PlaygroundModal';
import { Badge, Button, DropdownMenu, IconButton, Input, Modal, Popover, SegmentedControl, Skeleton, Tooltip, confirmDialog, toast, type MenuItem } from '../components/ui';
import { formatDateTime } from '../lib/format';

const nodeTypes = { flowNode: FlowNode };
const PORT_LABELS: Record<string, string> = { pass: 'permitido', blocked: 'bloqueado', true: 'sim', false: 'não' };
const DRAFT_KEY = 'sdr-flow:editor-draft:v1';

interface SavedFlow {
  id: string;
  name: string;
  draft?: FlowGraph;
  graph?: FlowGraph;
  targetInstance?: string | null;
  published?: boolean;
  publishedVersion?: number;
  published_version_id?: string | null;
}

interface ActiveBinding {
  flowId: string;
  flow?: SavedFlow;
  name: string;
  version: number;
  publishedAt: string;
  instanceName: string;
}

interface InstanceOption {
  id?: string;
  name: string;
  phone?: string | null;
  status: string;
}

function Editor() {
  const state = useBuilder();
  const { graph, selectedId } = state;
  const { screenToFlowPosition, fitView, setViewport } = useReactFlow();
  const [fitRequested, setFitRequested] = useState(false);
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
  const { session, activeOrg, organizations } = useSession();
  const [activeTab, setActiveTab] = useState<'canvas' | 'prompts' | 'variables'>('canvas');
  const [query, setQuery] = useState('');
  // Routine status messages stay silent; problems surface as toasts next to the action.
  const setNotice = (message: string) => {
    if (/não |erro|falha|corrija|selecione|dê um nome|entre em|inválid|incompat|já está conectada/i.test(message)) toast.error(message);
  };
  const [showValidation, setShowValidation] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [showPlayground, setShowPlayground] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [savedFlows, setSavedFlows] = useState<SavedFlow[]>([]);
  const [loadingFlows, setLoadingFlows] = useState(true);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const { activeInstance, activeInstanceName, currentInstance, setActiveInstance } = useInstance();
  const targetInstance = activeInstanceName || currentInstance?.name || '';
  const managedFlowApi = Boolean(activeOrg && session?.access_token);
  const flowApiBase = managedFlowApi ? `/api/organizations/${activeOrg}/flows` : null;
  const flowApiHeaders: Record<string, string> = managedFlowApi && session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
  const [appColorMode, setAppColorMode] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('light') ? 'light' : 'dark'
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setAppColorMode(document.documentElement.classList.contains('light') ? 'light' : 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const [activeBindings, setActiveBindings] = useState<Record<string, ActiveBinding>>({});
  // Instance the auto-open last ran for: switching instance re-opens that instance's active flow.
  const autoOpenedForRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const autoOpenSuppressedRef = useRef(false);
  const [liveError, setLiveError] = useState<{ nodeId: string; error: string; timestamp: string } | null>(null);

  const upload = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const validation = useMemo(() => validateGraph(graph), [graph]);
  const invalidIds = new Set(showValidation ? validation.issues.map(issue => issue.nodeId) : []);

  const nodes: CanvasNode[] = graph.nodes.map(node => ({
    id: node.id,
    type: 'flowNode',
    position: node.position,
    measured: measurements[node.id],
    selected: node.id === selectedId,
    data: {
      node,
      invalid: invalidIds.has(node.id),
      liveError: liveError?.nodeId === node.id ? liveError.error : undefined,
    },
  }));

  const edges = graph.edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourcePort,
    targetHandle: 'input',
    label: edge.sourcePort === 'next' ? undefined : PORT_LABELS[edge.sourcePort] ?? edge.sourcePort,
    selected: selectedEdges.includes(edge.id),
    type: 'smoothstep',
  }));

  const selected = graph.nodes.find(node => node.id === selectedId);

  // Frame the start of the flow at a legible zoom. Computed from the layout positions (known
  // sizes) so it doesn't depend on React Flow having measured freshly replaced nodes yet.
  useEffect(() => {
    if (!fitRequested) return;
    const raf = requestAnimationFrame(() => {
      const bounds = canvas.current?.getBoundingClientRect();
      if (!bounds || graph.nodes.length === 0) return;
      const ordered = [...graph.nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
      const focus = graph.nodes.length > 6 ? ordered.slice(0, 5) : ordered;
      const minX = Math.min(...focus.map(n => n.position.x));
      const maxX = Math.max(...focus.map(n => n.position.x + 224));
      const minY = Math.min(...focus.map(n => n.position.y));
      const maxY = Math.max(...focus.map(n => n.position.y + 132));
      const zoom = Math.max(0.55, Math.min(1, bounds.width / (maxX - minX + 200), bounds.height / (maxY - minY + 160)));
      void setViewport({ x: bounds.width / 2 - ((minX + maxX) / 2) * zoom, y: 48 - minY * zoom, zoom }, { duration: 300 });
    });
    setFitRequested(false);
    return () => cancelAnimationFrame(raf);
  }, [fitRequested, graph.nodes]);

  const refreshData = async () => {
    if (!managedFlowApi || !flowApiBase) {
      setSavedFlows([]);
      setActiveBindings({});
      setLoadingFlows(false);
      return;
    }

    setLoadingFlows(true);
    try {
      const flowsRes = await fetch(flowApiBase, { headers: flowApiHeaders });
      if (!flowsRes.ok) return;
      const rawFlows = await flowsRes.json();
      if (!Array.isArray(rawFlows)) return;

      const flows = rawFlows.map((flow: any): SavedFlow => ({
        ...flow,
        graph: flow.draft,
        published: Boolean(flow.published_version_id),
      }));
      setSavedFlows(flows);

      // Same resolution the runtime uses (connection → agent → published flow), so what the
      // builder calls "ativo" is exactly what answers messages on this number.
      const activeData: Record<string, ActiveBinding> = {};
      const activeRes = await fetch(`/api/organizations/${activeOrg}/active-flows`, { headers: flowApiHeaders }).catch(() => null);
      if (activeRes?.ok) {
        const bindings = (await activeRes.json()) as Array<{
          connection: { id: string; name: string; instanceName: string };
          flow: { id: string; name: string; version: number; publishedAt: string };
        }>;
        for (const binding of Array.isArray(bindings) ? bindings : []) {
          const saved = flows.find(flow => flow.id === binding.flow.id);
          const entry: ActiveBinding = {
            flowId: binding.flow.id,
            flow: saved,
            name: binding.flow.name,
            version: binding.flow.version,
            publishedAt: binding.flow.publishedAt,
            instanceName: binding.connection.name,
          };
          for (const key of new Set([binding.connection.id, binding.connection.name, binding.connection.instanceName])) {
            if (key) activeData[key] = entry;
          }
        }
      }
      setActiveBindings(activeData);

      const queryId = new URLSearchParams(window.location.search).get('id');
      if (queryId) {
        const flowToOpen = flows.find(flow => flow.id === queryId);
        if (flowToOpen) {
          autoOpenSuppressedRef.current = true;
          openFlow(flowToOpen, `Fluxo "${flowToOpen.name}" carregado.`);
        }
      } else {
        autoOpenActive(activeData);
      }
    } catch {
      // Ignora erro no carregamento inicial silencioso
    } finally {
      setLoadingFlows(false);
    }
  };

  useEffect(() => {
    void refreshData();
  }, [managedFlowApi, activeOrg, session?.access_token, currentInstance?.agent_id, targetInstance]);

  /**
   * First load (and every instance switch) opens the flow that is active on the selected
   * instance, unless the user explicitly opened another flow or has unsaved edits.
   */
  function autoOpenActive(bindings: Record<string, ActiveBinding>) {
    if (new URLSearchParams(window.location.search).get('id')) return;
    const instanceKey = currentInstance?.id || targetInstance || '';
    if (!instanceKey || autoOpenedForRef.current === instanceKey) return;
    if (autoOpenSuppressedRef.current && autoOpenedForRef.current === null) return;
    if (dirtyRef.current) return;
    const binding = resolveActiveBinding(bindings);
    autoOpenedForRef.current = instanceKey;
    if (binding?.flow && openFlow(binding.flow, `Fluxo ativo "${binding.flow.name}" carregado.`)) {
      autoOpenSuppressedRef.current = true;
    }
  }

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) useBuilder.getState().redo();
        else useBuilder.getState().undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        useBuilder.getState().redo();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Live debugging: highlight the node that failed during a real execution.
  useEffect(() => {
    if (!flowId) { setLiveError(null); return; }
    let socket: WebSocket | null = null;

    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${proto}//${window.location.host}/ws`);
      socket.addEventListener('open', () => {
        socket?.send(JSON.stringify({ type: 'subscribe', flowId }));
      });
      socket.addEventListener('message', event => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.flowId && msg.flowId !== flowId) return;
          if (msg.type === 'execution:started') {
            setLiveError(null);
          } else if (msg.type === 'step:failed' && msg.payload?.nodeId) {
            setLiveError({ nodeId: msg.payload.nodeId, error: msg.payload.error || 'Erro desconhecido', timestamp: msg.timestamp });
          } else if (msg.type === 'step:complete' && msg.payload?.nodeId) {
            setLiveError(current => (current && current.nodeId === msg.payload.nodeId ? null : current));
          }
        } catch {
          // ignore malformed messages
        }
      });
    } catch {
      // WebSocket unavailable; live debugging simply stays off
    }

    return () => {
      socket?.close();
    };
  }, [flowId]);

  const focusNode = (nodeId: string) => {
    state.select(nodeId);
    void fitView({ nodes: [{ id: nodeId }], padding: 0.6, duration: 300 });
  };

  // Top-to-bottom reads like a conversation; the view then frames the start of the flow at a
  // legible zoom instead of shrinking a 17-block pipeline into one unreadable line.
  const layout = (input = graph) => {
    const dag = new dagre.graphlib.Graph();
    dag.setDefaultEdgeLabel(() => ({}));
    dag.setGraph({ rankdir: 'TB', nodesep: 56, ranksep: 64 });
    input.nodes.forEach(node => dag.setNode(node.id, { width: 224, height: 132 }));
    input.edges.forEach(edge => dag.setEdge(edge.source, edge.target));
    dagre.layout(dag);
    state.replace({
      ...input,
      nodes: input.nodes.map(node => ({
        ...node,
        position: { x: dag.node(node.id).x - 112, y: dag.node(node.id).y - 66 },
      })),
    });
    setFitRequested(true);
  };

  function resolveActiveBinding(bindings: Record<string, ActiveBinding>) {
    const keys = Array.from(
      new Set([targetInstance, activeInstance, currentInstance?.name, currentInstance?.id].filter((key): key is string => Boolean(key)))
    );
    return keys.map(key => bindings[key]).find(Boolean);
  }

  function openFlow(flow: SavedFlow, message: string) {
    const parsed = flowGraphSchema.safeParse(flow.graph || flow.draft);
    if (!parsed.success) {
      setNotice('O fluxo salvo tem um formato incompatível.');
      return false;
    }
    state.replace(parsed.data);
    state.setName(flow.name);
    setFlowId(flow.id);
    if (flow.targetInstance) setActiveInstance(flow.targetInstance);
    layout(parsed.data);
    if (message) setNotice(message);
    return true;
  }

  const connect = (connection: Connection) => {
    if (!connection.sourceHandle || connection.source === connection.target) return;
    if (graph.edges.some(edge => edge.source === connection.source && edge.sourcePort === connection.sourceHandle)) {
      setNotice('Esta saída já está conectada. Remova a conexão atual antes de criar outra.');
      return;
    }
    state.replace({
      ...graph,
      edges: [
        ...graph.edges,
        { id: crypto.randomUUID(), source: connection.source, target: connection.target, sourcePort: connection.sourceHandle },
      ],
    });
  };

  const newGraph = (kind: 'blank' | 'sdr') => {
    autoOpenSuppressedRef.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    state.replace(kind === 'sdr' ? createSdrTemplate() : createBlankFlow());
    state.setName(kind === 'sdr' ? 'Qualificação SDR' : 'Novo fluxo');
    setFlowId(null);
    setNotice('Novo rascunho aberto.');
    setShowValidation(false);
    layout(useBuilder.getState().graph);
  };

  async function save(publish = false) {
    if (publish && !validation.valid) {
      setShowValidation(true);
      setNotice('Corrija os pontos de validação antes de publicar.');
      return;
    }
    if (!state.name.trim()) {
      setNotice('Dê um nome ao fluxo antes de salvar.');
      return;
    }
    if (publish && !targetInstance) {
      setNotice('Selecione uma instância no topo (TopBar) para vincular e publicar este fluxo.');
      return;
    }
    if (!managedFlowApi || !flowApiBase) {
      setNotice('Entre em uma organização para salvar ou publicar fluxos.');
      return;
    }

    setBusy(true);
    try {
      // Fluxos são persistidos apenas no endpoint autenticado da organização ativa.
      const payload = { name: state.name, graph };

      const saveRes = await fetch(flowId ? `${flowApiBase}/${flowId}` : flowApiBase, {
        method: flowId ? 'PUT' : 'POST',
        headers: { ...flowApiHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!saveRes.ok) {
        const errJson = await saveRes.json().catch(() => null);
        throw new Error(errJson?.error || `Erro ao salvar (${saveRes.status})`);
      }

      const saved = (await saveRes.json()) as SavedFlow;
      setFlowId(saved.id);
      window.history.replaceState(null, '', `?id=${saved.id}`);

      // Salva rascunho local de segurança
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: state.name, graph, flowId: saved.id, targetInstance }));
      } catch {
        // Ignora falha de localStorage
      }

      // 2. Se for publicar, aciona rota de publicação
      if (publish) {
        const pubRes = await fetch(`${flowApiBase}/${saved.id}/publish`, {
          method: 'POST',
          headers: { ...flowApiHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph, targetInstance }),
        });

        if (!pubRes.ok) {
          const errJson = await pubRes.json().catch(() => null);
          throw new Error(errJson?.error || `Erro ao publicar (${pubRes.status})`);
        }

        const pubData = (await pubRes.json()) as { version?: number; targetInstance?: string };
        const isTest = Boolean(graph.testMode?.enabled);
        toast.success(`Versão ${pubData.version ?? 'nova'} publicada em ${targetInstance}`, {
          description: isTest ? `Modo teste: responde só a ${graph.testMode?.phone || 'número autorizado'}.` : 'Respondendo a todos os contatos.',
        });
      } else {
        toast.success('Fluxo salvo');
      }
      setSavedSnapshot(JSON.stringify({ name: state.name, graph }));

      await refreshData();
    } catch (error) {
      toast.error(publish ? 'Não foi possível publicar' : 'Não foi possível salvar', {
        description: error instanceof Error ? error.message : 'Tente novamente em instantes.',
      });
    } finally {
      setBusy(false);
    }
  }

  function restoreLocal() {
    try {
      const value = localStorage.getItem(DRAFT_KEY);
      if (!value) {
        setNotice('Nenhum rascunho local salvo.');
        return;
      }
      const draft = JSON.parse(value) as { name: unknown; graph: unknown; targetInstance?: string };
      const parsed = flowGraphSchema.parse(draft.graph);
      state.replace(parsed);
      state.setName(typeof draft.name === 'string' ? draft.name : 'Rascunho');
      if (draft.targetInstance) setActiveInstance(draft.targetInstance);
      setFlowId(null);
      layout(parsed);
      setNotice('Rascunho local recuperado.');
    } catch {
      setNotice('O rascunho local está inválido. Importe um JSON válido.');
    }
  }

  const handleSelectSavedFlow = (selectedFlowId: string) => {
    const flow = savedFlows.find(item => item.id === selectedFlowId);
    if (!flow) return;
    autoOpenSuppressedRef.current = true;
    if (!openFlow(flow, `Fluxo "${flow.name}" aberto para edição.`)) return;
    if (flow.targetInstance) setActiveInstance(flow.targetInstance);
    window.history.replaceState(null, '', `?id=${flow.id}`);
  };

  const activeBinding = resolveActiveBinding(activeBindings);
  const isInstanceActiveWithThisFlow = Boolean(flowId && activeBinding?.flowId === flowId);
  const instanceLabel = currentInstance?.name || targetInstance || 'esta instância';

  // "Salvo" vs "alterações não salvas": compare against the last graph that reached the server.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const snapshot = JSON.stringify({ name: state.name, graph });
  const dirty = flowId ? savedSnapshot !== null && savedSnapshot !== snapshot : graph.nodes.length > 0;
  // The untouched starter graph is not "work": it must not block opening the active flow.
  const pristineRef = useRef(snapshot);
  dirtyRef.current = flowId ? dirty : snapshot !== pristineRef.current;
  useEffect(() => {
    // A freshly opened or saved flow becomes the new baseline once its layout settles.
    if (flowId && savedSnapshot === null) setSavedSnapshot(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, savedSnapshot]);
  useEffect(() => {
    setSavedSnapshot(null);
  }, [flowId]);

  const [libraryOpen, setLibraryOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1280);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({ trigger: true });
  const [showSettings, setShowSettings] = useState(false);
  const librarySearchRef = useRef<HTMLInputElement>(null);
  const { zoomIn, zoomOut } = useReactFlow();
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsNarrow(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // ⌘S saves, "/" jumps to the block search.
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const inField = (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save(false);
      } else if (event.key === '/' && !inField) {
        event.preventDefault();
        setLibraryOpen(true);
        requestAnimationFrame(() => librarySearchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });

  useEffect(() => {
    if (!dirty || !flowId) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, flowId]);

  const removeNodesWithUndo = (ids: string[]) => {
    if (!ids.length) return;
    const labels = graph.nodes.filter(node => ids.includes(node.id)).map(node => node.label);
    state.remove(ids);
    toast.success(ids.length === 1 ? `"${labels[0] ?? 'Bloco'}" excluído` : `${ids.length} blocos excluídos`, {
      action: { label: 'Desfazer', onClick: () => useBuilder.getState().undo() },
    });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.name.replace(/[^\p{L}\p{N}_-]/gu, '_') || 'flow'}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const promptCount = graph.nodes.filter(
    n => typeof n.config.prompt === 'string' || typeof n.config.system === 'string' || n.type === 'context.knowledge' || n.type === 'output.send_text'
  ).length;

  const testModeValid = !graph.testMode?.enabled || flowTestModeSchema.safeParse(graph.testMode).success;
  const statusLabel = !flowId ? 'Rascunho novo' : busy ? 'Salvando…' : dirty ? 'Alterações não salvas' : 'Salvo';

  if (loadingFlows && savedFlows.length === 0) {
    return (
      <div role="status" aria-live="polite" className="flex h-full flex-col bg-canvas">
        <span className="sr-only">Carregando construtor de fluxos…</span>
        <div className="flex h-14 items-center justify-between border-b border-border bg-surface px-4" aria-hidden="true">
          <Skeleton className="h-8 w-64" rounded="lg" />
          <div className="flex gap-2">
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-8 w-24" rounded="lg" />)}
          </div>
        </div>
        <div className="flex min-h-0 flex-1" aria-hidden="true">
          <aside className="w-[248px] shrink-0 space-y-3 border-r border-border bg-surface p-3">
            <Skeleton className="h-8 w-full" rounded="lg" />
            {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-8 w-full" rounded="lg" />)}
          </aside>
          <div className="relative flex-1 overflow-hidden p-10">
            <Skeleton className="absolute left-[40%] top-[10%] h-28 w-52" rounded="lg" />
            <Skeleton className="absolute left-[40%] top-[38%] h-28 w-52" rounded="lg" />
            <Skeleton className="absolute left-[40%] top-[66%] h-28 w-52" rounded="lg" />
          </div>
        </div>
      </div>
    );
  }

  // The canvas needs a pointer and room; on phones show the flows read-only with their status.
  if (isNarrow) {
    return (
      <div className="h-full overflow-y-auto bg-canvas p-4">
        <h1 className="m-0 text-xl font-bold text-content">Fluxos</h1>
        <p className="m-0 mt-1 text-sm text-content-secondary">O editor de fluxos está disponível no computador.</p>
        <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {savedFlows.length === 0 && <p className="m-0 p-4 text-sm text-content-muted">Nenhum fluxo salvo ainda.</p>}
          {savedFlows.map(flow => (
            <div key={flow.id} className="flex items-center justify-between gap-3 p-4">
              <span className="min-w-0 truncate text-sm font-medium text-content">{flow.name}</span>
              <Badge variant={flow.published ? 'success' : 'default'} size="sm">
                {flow.published ? 'Publicado' : 'Rascunho'}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const flowMenu: MenuItem[] = [
    { label: 'Configurações do fluxo', icon: <Settings2 size={14} />, description: 'Limite de repetições', onSelect: () => setShowSettings(true) },
    { label: showJson ? 'Fechar JSON' : 'Ver JSON', icon: <FileJson size={14} />, onSelect: () => setShowJson(!showJson) },
    { type: 'separator' },
    { label: 'Exportar arquivo', icon: <Download size={14} />, onSelect: exportJson },
    { label: 'Importar arquivo…', icon: <Upload size={14} />, onSelect: () => upload.current?.click() },
  ];

  return (
    <div className="builder-page flex h-full flex-col bg-canvas text-content-primary">
      {/* One header row: which flow, its state, the three views, and the two things you ship with. */}
      <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-border bg-surface px-3 lg:px-4">
        <input
          aria-label="Nome do fluxo"
          maxLength={120}
          value={state.name}
          onChange={event => state.setName(event.target.value)}
          className="h-8 w-[clamp(120px,16vw,220px)] min-w-[120px] flex-shrink-0 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-content outline-none hover:border-border focus:border-brand"
        />
        <Popover
          align="start"
          width={300}
          className="p-1"
          aria-label="Trocar de fluxo"
          trigger={<IconButton label="Trocar de fluxo" icon={<ChevronsUpDown size={15} />} tooltip={false} />}
        >
          {close => (
            <>
              <div className="px-2.5 pb-1 pt-2 text-2xs font-medium text-content-muted">Fluxos salvos</div>
              {savedFlows.length === 0 && <p className="m-0 px-2.5 py-2 text-xs text-content-muted">Nenhum fluxo salvo ainda.</p>}
              {savedFlows.map(flow => (
                <button
                  key={flow.id}
                  type="button"
                  onClick={() => {
                    close();
                    handleSelectSavedFlow(flow.id);
                  }}
                  className="flex w-full min-h-0 items-center justify-start gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-xs text-content hover:bg-surface-elevated"
                >
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${flow.published ? 'bg-success' : 'bg-content-muted'}`} />
                  <span className="min-w-0 flex-1 truncate">{flow.name}</span>
                  {activeBinding?.flowId === flow.id ? (
                    <span className="flex-shrink-0 rounded-full border border-success/40 bg-success/10 px-1.5 text-2xs font-semibold text-content">Ativo · v{activeBinding.version}</span>
                  ) : (
                    <span className="flex-shrink-0 text-2xs text-content-muted">{flow.published ? 'publicado' : 'rascunho'}</span>
                  )}
                  {flow.id === flowId && <CheckCircle2 size={13} className="flex-shrink-0 text-brand-fg" />}
                </button>
              ))}
              <div className="my-1 h-px bg-border" />
              <button type="button" onClick={() => { close(); newGraph('blank'); }} className="flex w-full min-h-0 items-center justify-start gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-xs text-content hover:bg-surface-elevated">
                <Plus size={14} /> Novo fluxo em branco
              </button>
              <button type="button" onClick={() => { close(); newGraph('sdr'); }} className="flex w-full min-h-0 items-center justify-start gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-xs text-content hover:bg-surface-elevated">
                <Sparkles size={14} /> Novo a partir do modelo SDR
              </button>
              <button type="button" onClick={() => { close(); restoreLocal(); }} className="flex w-full min-h-0 items-center justify-start gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-xs text-content-secondary hover:bg-surface-elevated hover:text-content">
                <RotateCcw size={14} /> Recuperar rascunho deste navegador
              </button>
            </>
          )}
        </Popover>

        <span
          title={statusLabel}
          className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-2xs ${dirty && flowId ? 'text-warning' : 'text-content-muted'}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dirty && flowId ? 'bg-warning' : flowId ? 'bg-success' : 'bg-content-muted'}`} aria-hidden="true" />
          <span className={dirty && flowId ? '' : 'hidden 2xl:inline'}>{statusLabel}</span>
        </span>

        {/* Which flow answers on this number: the most important fact on this screen. */}
        {!loadingFlows && (
          isInstanceActiveWithThisFlow && activeBinding ? (
            <Tooltip content={`Responde às mensagens de ${instanceLabel}. Versão ${activeBinding.version} publicada em ${formatDateTime(activeBinding.publishedAt)}.`}>
              <span className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-success/40 bg-success/10 px-2.5 text-2xs font-semibold text-content">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                Fluxo ativo
                <span className="font-normal text-content-secondary">· v{activeBinding.version}</span>
              </span>
            </Tooltip>
          ) : activeBinding ? (
            <span
              title={`O fluxo que responde em ${instanceLabel} é "${activeBinding.name}" (v${activeBinding.version}).`}
              className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2.5 text-2xs text-content-secondary"
            >
              <span className="h-1.5 w-1.5 rounded-full border border-border-strong" aria-hidden="true" />
              <span className="hidden xl:inline">Inativo ·</span>
              <button
                type="button"
                onClick={async () => {
                  const target = activeBinding.flow ?? savedFlows.find(flow => flow.id === activeBinding.flowId);
                  if (!target) return;
                  if (
                    dirty &&
                    !(await confirmDialog({
                      title: 'Abrir o fluxo ativo?',
                      description: 'As alterações não salvas deste fluxo serão perdidas.',
                      confirmLabel: 'Descartar e abrir',
                      danger: true,
                    }))
                  )
                    return;
                  autoOpenSuppressedRef.current = true;
                  if (openFlow(target, '')) window.history.replaceState(null, '', `?id=${target.id}`);
                }}
                className="min-h-0 border-0 bg-transparent p-0 text-2xs font-semibold text-content hover:underline"
              >
                Abrir o ativo
              </button>
            </span>
          ) : (
            <Tooltip content={`Nenhum fluxo publicado responde em ${instanceLabel}. Publique este fluxo para ativá-lo.`}>
              <span className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-warning/40 bg-warning/10 px-2.5 text-2xs font-medium text-content">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
                Sem fluxo ativo
              </span>
            </Tooltip>
          )
        )}

        <SegmentedControl
          className="mx-auto"
          aria-label="Visão do fluxo"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'canvas', label: 'Canvas', icon: <LayoutGrid size={13} /> },
            { value: 'prompts', label: 'Prompts', icon: <Bot size={13} />, count: promptCount },
            { value: 'variables', label: 'Variáveis', icon: <Network size={13} /> },
          ]}
        />

        <Popover
          align="end"
          width={320}
          className="p-3"
          aria-label="Validação do fluxo"
          trigger={
            <button
              type="button"
              className={`flex h-8 min-h-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${
                validation.valid ? 'border-border bg-surface text-content-secondary hover:bg-surface-elevated' : 'border-warning-border bg-warning-bg text-warning'
              }`}
            >
              {validation.valid ? <CheckCircle2 size={14} className="text-success" /> : <AlertTriangle size={14} />}
              <span className="hidden whitespace-nowrap lg:inline">{validation.valid ? 'Sem problemas' : `${validation.issues.length} ${validation.issues.length === 1 ? 'problema' : 'problemas'}`}</span>
              {!validation.valid && <span className="lg:hidden">{validation.issues.length}</span>}
            </button>
          }
        >
          {close =>
            validation.valid ? (
              <p className="m-0 text-xs text-content-secondary">O gatilho está conectado e todos os caminhos terminam.</p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="m-0 mb-1 text-2xs font-medium text-content-muted">Corrija antes de publicar</p>
                {validation.issues.map((issue, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      close();
                      setShowValidation(true);
                      if (issue.nodeId) focusNode(issue.nodeId);
                    }}
                    className="flex min-h-0 items-start justify-start gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-xs text-content hover:bg-surface-elevated"
                  >
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-warning" />
                    <span>{issue.message}</span>
                  </button>
                ))}
              </div>
            )
          }
        </Popover>

        <Button
          variant="outline"
          onClick={() => {
            if (!managedFlowApi) return toast.error('Entre em uma organização para testar o fluxo.');
            if (!flowId) return toast.info('Salve o fluxo para testar', { description: 'O teste usa a versão salva e a base de conhecimento real.' });
            setShowPlayground(true);
          }}
        >
          <Play size={14} /> <span className="hidden lg:inline">Testar</span>
        </Button>
        <Tooltip content="Salvar alterações" shortcut="⌘S">
          <Button variant="outline" onClick={() => void save(false)} disabled={busy} aria-label="Salvar">
            <Save size={14} /> <span className="hidden lg:inline">Salvar</span>
          </Button>
        </Tooltip>

        {/* Publishing and "who does it answer" are one decision, so they live together. */}
        <Popover
          align="end"
          width={320}
          className="p-4"
          aria-label="Publicar fluxo"
          trigger={
            <Button variant="primary">
              <Upload size={14} /> Publicar <ChevronDown size={13} />
            </Button>
          }
        >
          {close => (
            <div className="flex flex-col gap-3">
              <div>
                <p className="m-0 text-sm font-semibold text-content">Publicar nova versão</p>
                <p className="m-0 mt-0.5 text-2xs text-content-secondary">
                  {targetInstance ? <>Passa a responder em <strong className="text-content">{targetInstance}</strong>.</> : 'Escolha uma instância no topo da página primeiro.'}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-2xs font-medium text-content-secondary">Responder a</span>
                <SegmentedControl
                  fullWidth
                  size="sm"
                  aria-label="Modo de resposta"
                  value={graph.testMode?.enabled ? 'test' : 'production'}
                  onChange={mode =>
                    state.replace({ ...graph, testMode: { enabled: mode === 'test', phone: graph.testMode?.phone || '' } })
                  }
                  options={[
                    { value: 'production', label: 'Todos os contatos' },
                    { value: 'test', label: 'Só um número (teste)' },
                  ]}
                />
                {graph.testMode?.enabled && (
                  <>
                    <input
                      type="tel"
                      autoComplete="off"
                      maxLength={50}
                      placeholder="+55 55 99999-9999"
                      aria-label="Número autorizado para teste"
                      value={graph.testMode.phone}
                      aria-invalid={!testModeValid}
                      onChange={event => state.replace({ ...graph, testMode: { enabled: true, phone: event.target.value } })}
                      className="h-9 rounded-lg border border-border bg-surface-elevated px-3 text-xs outline-none focus:border-brand aria-[invalid=true]:border-danger"
                    />
                    <span className="text-2xs text-content-muted">Os demais contatos são ignorados enquanto o teste estiver ativo.</span>
                  </>
                )}
              </div>
              {!validation.valid && (
                <p className="m-0 flex items-center gap-1.5 rounded-lg bg-warning-bg px-2.5 py-2 text-2xs text-warning">
                  <AlertTriangle size={13} /> {validation.issues.length} problema(s) impedem a publicação.
                </p>
              )}
              <Button
                variant="primary"
                size="lg"
                disabled={busy || !targetInstance || !validation.valid || !testModeValid}
                onClick={() => {
                  close();
                  void save(true);
                }}
              >
                {busy ? 'Publicando…' : 'Publicar versão'}
              </Button>
            </div>
          )}
        </Popover>
        <DropdownMenu aria-label="Mais opções do fluxo" width={240} items={flowMenu} trigger={<IconButton label="Mais opções" icon={<MoreHorizontal size={16} />} tooltip={false} />} />
        <input
          ref={upload}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 1_000_000) throw new Error('O limite é 1 MB.');
              const imported = flowGraphSchema.parse(JSON.parse(await file.text()));
              state.replace(imported);
              setFlowId(null);
              layout(imported);
              toast.success('Fluxo importado', { description: 'Revise a validação antes de publicar.' });
            } catch (error) {
              toast.error('Não foi possível importar', { description: error instanceof Error ? error.message : 'JSON inválido.' });
            } finally {
              event.target.value = '';
            }
          }}
        />
      </header>

      {/* The safety state stays visible while it is on. */}
      {graph.testMode?.enabled && (
        <div role="status" className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-warning-border bg-warning-bg px-4 py-1.5 text-xs text-warning">
          <span className="flex items-center gap-2">
            <ShieldAlert size={14} />
            Modo teste: responde só a <strong>{graph.testMode.phone || 'nenhum número definido'}</strong>
          </span>
          <button
            type="button"
            onClick={() => state.replace({ ...graph, testMode: { enabled: false, phone: graph.testMode?.phone || '' } })}
            className="min-h-0 border-0 bg-transparent p-0 text-xs font-semibold text-warning hover:underline"
          >
            Voltar para todos os contatos
          </button>
        </div>
      )}

      {activeTab === 'prompts' && (
        <div className="min-h-0 flex-1 overflow-hidden bg-canvas">
          <PromptsView onSelectNodeInCanvas={nodeId => { setActiveTab('canvas'); focusNode(nodeId); }} />
        </div>
      )}

      {activeTab === 'variables' && (
        <div className="min-h-0 flex-1 overflow-hidden bg-canvas">
          <VariablesView onSelectNodeInCanvas={nodeId => { setActiveTab('canvas'); focusNode(nodeId); }} />
        </div>
      )}

      {activeTab === 'canvas' && (
        <div className="editor-body">
          {libraryOpen ? (
            <aside className="flex w-[248px] flex-shrink-0 select-none flex-col border-r border-border bg-surface" aria-label="Biblioteca de blocos">
              <div className="flex items-center justify-between px-3 pb-2 pt-3">
                <h2 className="m-0 text-xs font-semibold text-content">Blocos</h2>
                <IconButton size="sm" label="Recolher biblioteca" icon={<PanelLeftClose size={15} />} onClick={() => setLibraryOpen(false)} />
              </div>
              <div className="px-3 pb-2">
                <Input
                  ref={librarySearchRef}
                  aria-label="Buscar blocos"
                  placeholder="Buscar blocos"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  leftIcon={<Search size={14} />}
                  rightIcon={<kbd className="text-2xs text-content-muted">/</kbd>}
                  className="!h-8"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-3">
                {Object.entries(categories).map(([category, label]) => {
                  const entries = Object.values(catalog).filter(
                    node => node.category === category && `${node.label} ${node.type}`.toLowerCase().includes(query.toLowerCase())
                  );
                  if (!entries.length) return null;
                  const open = Boolean(query) || Boolean(openCategories[category]);
                  return (
                    <section key={category} className="mb-0.5">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenCategories(current => ({ ...current, [category]: !open }))}
                        className="flex h-8 w-full min-h-0 items-center justify-start gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-xs font-medium text-content-secondary hover:bg-surface-elevated hover:text-content"
                      >
                        <ChevronRight size={13} className={`flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: categoryColors[category as keyof typeof categoryColors] }} />
                        <span className="flex-1">{label}</span>
                        {category === 'agent' && (
                          <Tooltip content="Usam o modelo e a chave do agente vinculado à instância (aba Agentes)">
                            <Info size={12} className="text-content-muted" />
                          </Tooltip>
                        )}
                        <span className="text-2xs tabular-nums text-content-muted">{entries.length}</span>
                      </button>
                      {open && (
                        <div className="mb-1 ml-3 border-l border-border pl-1.5">
                          {entries.map(node => (
                            <button
                              key={node.type}
                              type="button"
                              className="group flex h-8 w-full min-h-0 cursor-grab items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-xs text-content hover:bg-surface-elevated active:cursor-grabbing"
                              draggable
                              onDragStart={event => {
                                event.dataTransfer.setData('application/sdr-node', node.type);
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                              onClick={() => {
                                const bounds = canvas.current?.getBoundingClientRect();
                                state.add(
                                  node.type,
                                  screenToFlowPosition({
                                    x: (bounds?.left ?? 300) + (bounds?.width ?? 600) / 2,
                                    y: (bounds?.top ?? 200) + (bounds?.height ?? 400) / 2,
                                  })
                                );
                              }}
                            >
                              <span className="truncate">{node.label}</span>
                              <Plus size={13} className="flex-shrink-0 text-content-muted opacity-0 group-hover:opacity-100" />
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </aside>
          ) : (
            <div className="flex w-11 flex-shrink-0 flex-col items-center gap-1 border-r border-border bg-surface pt-3">
              <IconButton label="Abrir biblioteca de blocos" shortcut="/" icon={<PanelLeftOpen size={15} />} onClick={() => setLibraryOpen(true)} />
            </div>
          )}

          <div
            className="canvas"
            ref={canvas}
            onDragOver={event => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={event => {
              event.preventDefault();
              const type = nodeTypeSchema.safeParse(event.dataTransfer.getData('application/sdr-node'));
              if (type.success) state.add(type.data, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
            }}
          >
            <ReactFlow<CanvasNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              colorMode={appColorMode}
              minZoom={0.08}
              maxZoom={2}
              fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
              proOptions={{ hideAttribution: true }}
              snapToGrid
              snapGrid={[20, 20]}
              onConnect={connect}
              onNodeClick={(_event, node) => {
                state.select(node.id);
                setSelectedEdges([]);
              }}
              onPaneClick={() => {
                state.select(null);
                setSelectedEdges([]);
              }}
              onEdgeClick={(_event, edge) => {
                setSelectedEdges([edge.id]);
                state.select(null);
              }}
              onNodesChange={changes => {
                const dimensions = changes.filter(change => change.type === 'dimensions' && change.dimensions);
                if (dimensions.length) {
                  setMeasurements(current => {
                    const next = { ...current };
                    let changed = false;
                    for (const change of dimensions) {
                      if (
                        change.type === 'dimensions' &&
                        change.dimensions &&
                        (current[change.id]?.width !== change.dimensions.width || current[change.id]?.height !== change.dimensions.height)
                      ) {
                        next[change.id] = change.dimensions;
                        changed = true;
                      }
                    }
                    return changed ? next : current;
                  });
                }
                const removed = changes.filter(change => change.type === 'remove').map(change => change.id);
                if (removed.length) removeNodesWithUndo(removed);
                for (const change of changes) {
                  if (change.type === 'position' && change.position) {
                    state.move(change.id, change.position);
                    if (change.dragging === false) state.checkpoint();
                  }
                }
              }}
              onNodeDragStop={() => state.checkpoint()}
              onEdgesChange={changes => {
                const removed = changes.filter(change => change.type === 'remove').map(change => change.id);
                if (removed.length) {
                  state.replace({
                    ...useBuilder.getState().graph,
                    edges: useBuilder.getState().graph.edges.filter(edge => !removed.includes(edge.id)),
                  });
                }
              }}
            >
              <Background gap={24} size={1.2} color="var(--border-default)" />
              <MiniMap
                style={{ width: 140, height: 96, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8 }}
                maskColor="color-mix(in srgb, var(--bg-canvas) 75%, transparent)"
                pannable
                zoomable
                nodeColor={node => {
                  const found = graph.nodes.find(item => item.id === node.id);
                  return found ? categoryColors[catalog[found.type].category] : 'var(--accent-primary)';
                }}
              />
            </ReactFlow>

            {/* Canvas tools live on the canvas (undo, layout, zoom). */}
            <div className="absolute bottom-4 left-4 z-[5] flex items-center gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-elevated">
              <IconButton label="Desfazer" shortcut="⌘Z" icon={<Undo2 size={15} />} disabled={state.cursor === 0} onClick={state.undo} />
              <IconButton label="Refazer" shortcut="⇧⌘Z" icon={<Redo2 size={15} />} disabled={state.cursor === state.history.length - 1} onClick={state.redo} />
              <span className="mx-0.5 h-4 w-px bg-border" />
              <IconButton label="Organizar blocos" icon={<LayoutGrid size={15} />} onClick={() => layout()} />
              <span className="mx-0.5 h-4 w-px bg-border" />
              <IconButton label="Diminuir zoom" icon={<Minus size={15} />} onClick={() => void zoomOut({ duration: 150 })} />
              <IconButton label="Aumentar zoom" icon={<Plus size={15} />} onClick={() => void zoomIn({ duration: 150 })} />
              <IconButton label="Enquadrar tudo" icon={<Maximize2 size={14} />} onClick={() => void fitView({ padding: 0.2, duration: 250 })} />
            </div>

            {graph.nodes.length <= 2 && (
              <div className="absolute left-1/2 top-6 z-[5] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-elevated">
                <span className="text-xs text-content-secondary">Comece por um modelo pronto ou arraste blocos da biblioteca.</span>
                <Button size="sm" variant="primary" onClick={() => newGraph('sdr')}>
                  <Sparkles size={13} /> Usar modelo SDR
                </Button>
              </div>
            )}
            {liveError && (
              <div className="runtime-error-banner">
                <AlertTriangle size={15} />
                <div>
                  <strong>Falha em execução real do WhatsApp</strong>
                  <p>Bloco "{graph.nodes.find(n => n.id === liveError.nodeId)?.label || liveError.nodeId}": {liveError.error}</p>
                </div>
                <button onClick={() => focusNode(liveError.nodeId)}>Ver no bloco</button>
                <button aria-label="Fechar aviso" onClick={() => setLiveError(null)}><X size={14} /></button>
              </div>
            )}
            {showJson && (
              <div className="json-overlay">
                <div>
                  <strong>JSON do fluxo</strong>
                  <IconButton label="Fechar JSON" icon={<X size={16} />} onClick={() => setShowJson(false)} />
                </div>
                <pre>{JSON.stringify(graph, null, 2)}</pre>
              </div>
            )}
          </div>

          {selected && (
            <aside className="flex w-[300px] flex-shrink-0 flex-col overflow-y-auto border-l border-border bg-surface" aria-label="Configuração do bloco">
              <div className="flex items-start gap-2 border-b border-border p-4">
                <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: categoryColors[catalog[selected.type].category] }} />
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-sm font-semibold text-content">{catalog[selected.type].label}</h2>
                  <p className="m-0 mt-0.5 text-2xs text-content-muted">{categories[catalog[selected.type].category]}</p>
                </div>
                <DropdownMenu
                  aria-label="Ações do bloco"
                  items={[
                    { label: 'Mostrar no canvas', icon: <Maximize2 size={14} />, onSelect: () => focusNode(selected.id) },
                    {
                      label: 'Copiar ID técnico',
                      description: selected.type,
                      icon: <Hash size={14} />,
                      onSelect: () => {
                        void navigator.clipboard?.writeText(selected.id);
                        toast.success('ID copiado', { description: selected.id });
                      },
                    },
                    { type: 'separator' },
                    { label: 'Excluir bloco', icon: <Trash2 size={14} />, danger: true, shortcut: '⌫', onSelect: () => removeNodesWithUndo([selected.id]) },
                  ]}
                  trigger={<IconButton size="sm" label="Ações do bloco" icon={<MoreHorizontal size={15} />} tooltip={false} />}
                />
                <IconButton size="sm" label="Fechar" icon={<X size={15} />} onClick={() => state.select(null)} />
              </div>
              <div className="p-4">
                <SchemaForm key={selected.id} node={selected} />
              </div>
            </aside>
          )}
        </div>
      )}

      <Modal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        title="Configurações do fluxo"
        maxWidth="sm"
        footer={<Button variant="primary" onClick={() => setShowSettings(false)}>Concluir</Button>}
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-content-secondary">
            Limite de repetições por bloco
            <input
              type="number"
              min={1}
              max={20}
              value={graph.loopLimit ?? 5}
              onChange={event => state.replace({ ...graph, loopLimit: Math.max(1, Math.min(20, Number(event.target.value) || 5)) })}
              className="h-9 w-24 rounded-lg border border-border bg-surface-elevated px-3 text-sm"
            />
            <span className="text-2xs font-normal text-content-muted">
              Evita que uma conversa fique presa num ciclo. Cada bloco pode rodar até este número de vezes por mensagem.
            </span>
          </label>
          <div className="text-xs text-content-secondary">
            Instância: <strong className="text-content">{targetInstance || 'nenhuma selecionada'}</strong> · {graph.nodes.length} blocos · {graph.edges.length} conexões
          </div>
        </div>
      </Modal>

      <PlaygroundModal isOpen={showPlayground} onClose={() => setShowPlayground(false)} flowId={flowId} graph={graph} />
    </div>
  );
}

export function Builder() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
