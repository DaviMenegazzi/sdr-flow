import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, MiniMap, Controls, useReactFlow, useNodesInitialized, type Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { ArrowLeft, CheckCheck, ChevronRight, Download, FileJson, LayoutGrid, Play, Plus, Redo2, Repeat, Save, Search, Trash2, Undo2, Upload, X, ShieldAlert, CheckCircle2, Radio, AlertTriangle, Bot, Network } from 'lucide-react';
import { PromptsView } from './PromptsView';
import { VariablesView } from './VariablesView';
import { Link } from 'react-router-dom';
import { flowGraphSchema, flowTestModeSchema, nodeTypeSchema, type FlowGraph } from '@sdr/shared';
import { catalog, categories, categoryColors, createBlankFlow, createSdrTemplate, validateGraph } from '@sdr/flow';
import { FlowNode, type CanvasNode } from './FlowNode';
import { SchemaForm } from './SchemaForm';
import { useBuilder } from './store';
import { useSession } from '../session';
import { useInstance } from '../context/InstanceContext';
import { PlaygroundModal } from './PlaygroundModal';
import { Button, Badge } from '../components/ui';

const nodeTypes = { flowNode: FlowNode };
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

interface InstanceOption {
  id?: string;
  name: string;
  phone?: string | null;
  status: string;
}

function Editor() {
  const state = useBuilder();
  const { graph, selectedId } = state;
  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [fitRequested, setFitRequested] = useState(false);
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
  const { session, activeOrg, organizations } = useSession();
  const [activeTab, setActiveTab] = useState<'canvas' | 'prompts' | 'variables'>('canvas');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [showPlayground, setShowPlayground] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [savedFlows, setSavedFlows] = useState<SavedFlow[]>([]);
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
  const [activeBindings, setActiveBindings] = useState<Record<string, { flowId: string; flow?: any }>>({});
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
    label: edge.sourcePort === 'next' ? undefined : edge.sourcePort,
    selected: selectedEdges.includes(edge.id),
    type: 'smoothstep',
  }));

  const selected = graph.nodes.find(node => node.id === selectedId);

  useEffect(() => {
    if (!nodesInitialized || !fitRequested) return;
    void fitView({ nodes: graph.nodes.map(node => ({ id: node.id })), padding: 0.15, duration: 300 });
    setFitRequested(false);
  }, [nodesInitialized, fitRequested, graph.nodes, fitView]);

  const refreshData = async () => {
    if (!managedFlowApi || !flowApiBase) {
      setSavedFlows([]);
      setActiveBindings({});
      return;
    }

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

      const activeData: Record<string, { flowId: string; flow?: SavedFlow }> = {};
      if (currentInstance?.agent_id) {
        const agentRes = await fetch(`/api/me/agents/${currentInstance.agent_id}`, { headers: flowApiHeaders });
        if (agentRes.ok) {
          const agent = await agentRes.json();
          const activeFlow = agent.flow_id
            ? flows.find(flow => flow.id === agent.flow_id && flow.published_version_id)
            : flows.find(flow => flow.published_version_id);
          if (activeFlow) {
            const keys = [targetInstance, activeInstance, currentInstance.id, currentInstance.name]
              .filter((key): key is string => Boolean(key));
            for (const key of new Set(keys)) {
              activeData[key] = { flowId: activeFlow.id, flow: activeFlow };
            }
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
        const activeFlow = resolveActiveBinding(activeData)?.flow;
        if (activeFlow && !autoOpenSuppressedRef.current && openFlow(activeFlow, `Fluxo ativo "${activeFlow.name}" carregado.`)) {
          autoOpenSuppressedRef.current = true;
        }
      }
    } catch {
      // Ignora erro no carregamento inicial silencioso
    }
  };

  useEffect(() => {
    void refreshData();
  }, [managedFlowApi, activeOrg, session?.access_token, currentInstance?.agent_id, targetInstance]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('id') || autoOpenSuppressedRef.current) return;
    const activeFlow = resolveActiveBinding(activeBindings)?.flow;
    if (!activeFlow) return;
    if (openFlow(activeFlow, `Fluxo ativo "${activeFlow.name}" carregado.`)) {
      autoOpenSuppressedRef.current = true;
    }
  }, [activeBindings, activeInstance, targetInstance, currentInstance?.id, currentInstance?.name]);

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

  const layout = (input = graph) => {
    const dag = new dagre.graphlib.Graph();
    dag.setDefaultEdgeLabel(() => ({}));
    dag.setGraph({ rankdir: 'LR', nodesep: 64, ranksep: 76 });
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

  function resolveActiveBinding(bindings: Record<string, { flowId: string; flow?: SavedFlow }>) {
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
    setNotice(message);
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
        setNotice(
          `Versão ${pubData.version ?? 'nova'} publicada e ativada no WhatsApp "${targetInstance}" (${isTest ? 'Modo Teste restrito a ' + (graph.testMode?.phone || 'número autorizado') : 'Modo Produção ativo'}).`
        );
      } else {
        setNotice('Fluxo e configurações salvos com sucesso.');
      }

      await refreshData();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao salvar fluxo.');
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

  const isInstanceActiveWithThisFlow = targetInstance && activeBindings[targetInstance]?.flowId === flowId;

  return (
    <div className="builder-page flex flex-col h-full bg-canvas text-content-primary">
      <header className="builder-workspace-header bg-surface border-b border-border px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/flows"
              className="builder-back p-1.5 rounded-lg text-content-muted hover:text-content-primary hover:bg-surface-elevated transition-colors"
              title="Voltar aos Fluxos"
            >
              <ArrowLeft size={16} />
            </Link>
            <div className="flex flex-col min-w-0">
              <span className="builder-kicker"><Network size={12} /> EDITOR DE AUTOMAÇÃO</span>
              <div className="flex items-center gap-2">
                <input
                  aria-label="Nome do fluxo"
                  maxLength={120}
                  value={state.name}
                  onChange={event => state.setName(event.target.value)}
                  className="font-bold text-base bg-transparent text-content-primary outline-none border-b border-transparent hover:border-border focus:border-brand transition-colors py-0.5 px-1 max-w-[280px]"
                />
                <Badge variant={flowId ? 'default' : 'warning'} size="sm">
                  {flowId ? 'Salvo' : 'Rascunho'}
                </Badge>
                {isInstanceActiveWithThisFlow && (
                  <Badge variant="success" size="sm">
                    ● Ativo no WhatsApp
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-content-muted truncate mt-0.5">
                Desenhe o caminho de cada conversa e conecte ao WhatsApp.
              </p>
            </div>
          </div>

          <div className="builder-header-actions flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!managedFlowApi) {
                  setNotice('Entre em uma organização para testar o fluxo com a base de conhecimento real.');
                  return;
                }
                if (!flowId) {
                  setNotice('Salve o fluxo antes de abrir o Playground.');
                  return;
                }
                setShowPlayground(true);
              }}
              title={flowId ? 'Testar o fluxo salvo com dados da organização' : 'Salve o fluxo antes de abrir o Playground'}
            >
              <Play size={14} />
              <span>Playground</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowValidation(true);
                setNotice(validation.valid ? 'Grafo válido: todos os caminhos terminam.' : `${validation.issues.length} ponto(s) para revisar.`);
              }}
            >
              <CheckCheck size={14} />
              <span>Validar</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void save(false)}
              disabled={busy}
            >
              <Save size={14} />
              <span>{busy ? 'Salvando…' : 'Salvar'}</span>
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void save(true)}
              disabled={busy}
              title="Publica e ativa para a instância selecionada"
            >
              <Upload size={14} />
              <span>{busy ? 'Publicando…' : 'Publicar'}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Abas Superiores do Builder (Visual, Prompts, Variáveis) */}
      <div className="builder-tabs bg-surface border-b border-border px-6 flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('canvas')}
          className={`builder-tab flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-all duration-150 -mb-[1px] ${
            activeTab === 'canvas'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-content-secondary hover:text-content-primary hover:border-border'
          }`}
        >
          <LayoutGrid size={14} />
          <span>Construtor Visual</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('prompts')}
          className={`builder-tab flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-all duration-150 -mb-[1px] ${
            activeTab === 'prompts'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-content-secondary hover:text-content-primary hover:border-border'
          }`}
        >
          <Bot size={14} />
          <span>Prompts & Conhecimento</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-brand/10 text-brand">
            {graph.nodes.filter(n => typeof n.config.prompt === 'string' || typeof n.config.system === 'string' || n.type === 'context.knowledge' || n.type === 'output.send_text').length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('variables')}
          className={`builder-tab flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-all duration-150 -mb-[1px] ${
            activeTab === 'variables'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-content-secondary hover:text-content-primary hover:border-border'
          }`}
        >
          <Network size={14} />
          <span>Mapa de Variáveis</span>
        </button>

        {activeTab === 'canvas' && !graph.testMode?.enabled && (
          <div className="builder-inline-mode ml-auto" role="status" aria-label="Modo de operação">
            <span className="builder-inline-mode-badge">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Produção Livre
            </span>
            <span className="builder-inline-mode-copy hidden lg:inline">
              Responde a qualquer contato no WhatsApp
            </span>
            <button
              type="button"
              className="builder-test-trigger"
              onClick={() => state.replace({ ...graph, testMode: { enabled: true, phone: graph.testMode?.phone || '' } })}
              title="Ativar trava de segurança para restringir respostas a um único número"
            >
              <ShieldAlert size={12} />
              <span>Trava de teste</span>
            </button>
          </div>
        )}
      </div>

      {activeTab === 'prompts' && (
        <div className="flex-1 min-h-0 bg-surface overflow-hidden">
          <PromptsView onSelectNodeInCanvas={nodeId => { setActiveTab('canvas'); focusNode(nodeId); }} />
        </div>
      )}

      {activeTab === 'variables' && (
        <div className="flex-1 min-h-0 bg-surface overflow-hidden">
          <VariablesView onSelectNodeInCanvas={nodeId => { setActiveTab('canvas'); focusNode(nodeId); }} />
        </div>
      )}

      {activeTab === 'canvas' && (
        <>
          {/* Barra de Configuração do Modo Teste */}
          {graph.testMode?.enabled ? (
            <div
              role="region"
              aria-label="Configuração do Modo Teste"
                className="builder-mode-strip builder-mode-strip-test bg-amber-950/25 border-b border-amber-500/30 px-6 py-2 flex items-center justify-between gap-3 text-xs flex-shrink-0"
            >
              <div className="flex items-center flex-wrap gap-2.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  Trava de Teste Ativa
                </span>
                <span className="h-4 w-px bg-amber-500/30" />
                <div className="flex items-center gap-2">
                  <label htmlFor="flow-test-phone" className="text-[11px] font-semibold text-amber-200">
                    Número autorizado:
                  </label>
                  <input
                    id="flow-test-phone"
                    type="tel"
                    autoComplete="off"
                    maxLength={50}
                    placeholder="+55 55 99999-9999"
                    value={graph.testMode.phone}
                    aria-invalid={!flowTestModeSchema.safeParse(graph.testMode).success}
                    onChange={event => state.replace({ ...graph, testMode: { enabled: true, phone: event.target.value } })}
                    className="w-48 py-1 px-2.5 rounded-lg border border-amber-500/40 bg-black/60 text-amber-100 text-xs font-mono outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/50 placeholder:text-amber-500/40"
                  />
                </div>
                <span className="text-[11px] text-amber-300/80 hidden md:inline">
                  Responde <strong>exclusivamente</strong> a este contato. Demais são ignorados.
                </span>
              </div>
              <button
                type="button"
                onClick={() => state.replace({ ...graph, testMode: { enabled: false, phone: graph.testMode?.phone || '' } })}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-amber-300 hover:text-white hover:bg-amber-500/20 border border-amber-500/30 transition-colors"
                title="Desativar trava de teste e voltar ao modo produção"
              >
                <X size={13} />
                <span>Desativar</span>
              </button>
            </div>
          ) : (
            <div
              role="region"
              aria-label="Configuração do Modo Teste"
                className="builder-mode-strip builder-mode-strip-normal bg-surface-elevated/30 border-b border-border px-6 py-2 flex items-center justify-between gap-4 text-xs flex-shrink-0"
            >
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Produção Livre
                </span>
                <span className="text-[11px] text-content-muted hidden sm:inline">
                  O fluxo responderá a qualquer contato que enviar mensagem no WhatsApp.
                </span>
              </div>
              <button
                type="button"
                onClick={() => state.replace({ ...graph, testMode: { enabled: true, phone: graph.testMode?.phone || '' } })}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold text-content-secondary bg-surface-elevated hover:bg-surface border border-border hover:border-brand/40 hover:text-content-primary transition-all cursor-pointer"
                title="Ativar trava de segurança para restringir respostas a um único número"
              >
                <ShieldAlert size={13} className="text-amber-400" />
                <span>Ativar Trava de Teste</span>
              </button>
            </div>
          )}

          <div className="builder-toolbar bg-surface border-b border-border px-6 py-2 flex items-center justify-between gap-2 text-xs flex-shrink-0">
            <div className="builder-toolbar-start">
              {savedFlows.length > 0 && (
                <div className="builder-flow-picker">
                  <label htmlFor="builder-flow-picker">
                    <span className="builder-flow-picker-dot" />
                    Fluxo ativo
                  </label>
                  <select
                    id="builder-flow-picker"
                    aria-label="Abrir fluxo salvo"
                    value={flowId ?? ''}
                    onChange={event => handleSelectSavedFlow(event.target.value)}
                  >
                    <option value="">Selecionar fluxo salvo</option>
                    {savedFlows.map(flow => (
                      <option key={flow.id} value={flow.id}>
                        {flow.name} {flow.published ? `(v${flow.publishedVersion || 1})` : '(rascunho)'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="builder-tool-group flex items-center gap-1.5">
                <Button size="sm" variant="ghost" title="Desfazer (Ctrl+Z)" aria-label="Desfazer" disabled={state.cursor === 0} onClick={state.undo}>
                  <Undo2 size={14} />
                </Button>
                <Button size="sm" variant="ghost" title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer" disabled={state.cursor === state.history.length - 1} onClick={state.redo}>
                  <Redo2 size={14} />
                </Button>
                <span className="h-4 w-px bg-border mx-1" />
                <Button size="sm" variant="ghost" onClick={() => layout()}>
                  <LayoutGrid size={14} /> Organizar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowJson(!showJson)}>
                  <FileJson size={14} /> JSON
                </Button>
                <span className="h-4 w-px bg-border mx-1" />
                <label title="Máximo de vezes que cada nó pode ser executado em loops" className="builder-loop-control text-content-secondary text-xs font-medium cursor-default">
                  <Repeat size={13} /> Loop:
                  <input
                    aria-label="Limite de loop"
                    type="number"
                    min={1}
                    max={20}
                    value={graph.loopLimit ?? 5}
                    onChange={event => state.replace({ ...graph, loopLimit: Math.max(1, Math.min(20, Number(event.target.value) || 5)) })}
                    className="w-12 py-0.5 px-1.5 rounded-md border border-border bg-surface text-center text-xs font-mono outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
              </div>
            </div>
            <div className="builder-tool-group flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download = `${state.name.replace(/[^\p{L}\p{N}_-]/gu, '_') || 'flow'}.json`;
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download size={13} /> Exportar
              </Button>
              <Button size="sm" variant="outline" onClick={() => upload.current?.click()}>
                <Upload size={13} /> Importar
              </Button>
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
                    setNotice('Grafo importado. Valide antes de publicar.');
                  } catch (error) {
                    setNotice(`Não foi possível importar: ${error instanceof Error ? error.message : 'JSON inválido.'}`);
                  } finally {
                    event.target.value = '';
                  }
                }}
              />
            </div>
          </div>

      <div className="editor-body">
        <aside className="node-library w-[260px] bg-surface border-r border-border flex-shrink-0 flex flex-col p-4 select-none" aria-label="Biblioteca de nós">
          <div className="flex items-center justify-between mb-2">
            <div className="library-heading-copy">
              <span className="library-kicker">BLOCOS</span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-content-primary">Biblioteca de nós</h2>
            </div>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-surface-elevated text-[#2ee86b]">
              {Object.keys(catalog).length}
            </span>
          </div>
          <p className="text-[11px] text-content-muted mb-3">Arraste para o canvas ou clique para adicionar.</p>

          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted" />
            <input
              aria-label="Buscar nós"
              placeholder="Buscar blocos…"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-elevated border border-border text-xs text-content-primary placeholder:text-content-muted focus:border-brand outline-none transition-colors"
            />
          </div>

          <div className="library-scroll flex-1 overflow-y-auto space-y-4 pr-1">
            {Object.entries(categories).map(([category, label]) => {
              const entries = Object.values(catalog).filter(
                node => node.category === category && `${node.label} ${node.type}`.toLowerCase().includes(query.toLowerCase())
              );
              return (
                entries.length > 0 && (
                  <section key={category} className="space-y-1.5">
                    <h3 className="text-[10px] font-bold tracking-wider uppercase text-content-muted px-1">
                      {label}
                    </h3>
                    <div className="space-y-1">
                      {entries.map(node => (
                        <button
                          key={node.type}
                          className="w-full flex items-center justify-between p-2 rounded-lg bg-surface-elevated/60 hover:bg-surface-elevated border border-border/40 hover:border-brand/40 text-left text-xs font-medium text-content-primary transition-all cursor-grab active:cursor-grabbing group shadow-sm"
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
                          <span className="flex items-center gap-2 truncate">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: categoryColors[node.category] }}
                            />
                            <span className="truncate">{node.label}</span>
                          </span>
                          <Plus size={13} className="text-content-muted group-hover:text-brand transition-colors flex-shrink-0 ml-1" />
                        </button>
                      ))}
                    </div>
                  </section>
                )
              );
            })}
          </div>

          <div className="library-footer pt-3 mt-2 border-t border-border space-y-1.5 flex-shrink-0">
            <button
              onClick={() => newGraph('sdr')}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold text-brand bg-brand/10 hover:bg-brand/15 border border-brand/30 transition-colors cursor-pointer"
            >
              <span>Usar Modelo SDR</span>
              <ChevronRight size={14} />
            </button>
            <button
              onClick={() => newGraph('blank')}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium text-content-secondary hover:text-content-primary bg-surface-elevated/40 hover:bg-surface-elevated border border-border/40 transition-colors cursor-pointer"
            >
              <span>Novo Fluxo</span>
              <Plus size={13} />
            </button>
            <button
              onClick={restoreLocal}
              className="w-full text-center px-3 py-1.5 rounded-lg text-[11px] text-content-muted hover:text-content-secondary transition-colors cursor-pointer"
            >
              Recuperar rascunho local
            </button>
          </div>
        </aside>

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
          <div className="canvas-chrome" aria-hidden="true">
            <div>
              <span className="canvas-chrome-kicker">WORKSPACE</span>
              <strong>Fluxo de conversa</strong>
            </div>
            <span className="canvas-chrome-count">{graph.nodes.length} nós <i /> {graph.edges.length} conexões</span>
          </div>
          <ReactFlow<CanvasNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            colorMode={appColorMode}
            fitView
            minZoom={0.08}
            maxZoom={2}
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
              if (removed.length) state.remove(removed);
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
            <Background gap={24} size={1.2} color="rgba(255, 255, 255, 0.08)" />
            <Controls showInteractive={false} />
            <MiniMap
              style={{
                width: 140,
                height: 96,
                backgroundColor: '#141414',
                border: '1px solid #242424',
                borderRadius: 8,
              }}
              maskColor="rgba(10, 10, 10, 0.75)"
              pannable
              zoomable
              nodeColor={node => {
                const found = graph.nodes.find(item => item.id === node.id);
                return found ? categoryColors[catalog[found.type].category] : '#2ee86b';
              }}
            />
          </ReactFlow>
          {graph.nodes.length <= 2 && (
            <div className="canvas-hint">Comece pela biblioteca. Conecte as saídas para criar sua conversa.</div>
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
                <strong>Grafo do fluxo</strong>
                <button aria-label="Fechar JSON" onClick={() => setShowJson(false)}><X size={16} /></button>
              </div>
              <pre>{JSON.stringify(graph, null, 2)}</pre>
            </div>
          )}
        </div>

        <aside className="inspector w-[300px] bg-surface border-l border-border flex-shrink-0 flex flex-col p-5 overflow-y-auto" aria-label="Inspector do fluxo">
          {selected ? (
            <div className="space-y-4">
              <div className="inspector-heading flex items-center justify-between pb-3 border-b border-border">
                <span className="inspector-kicker text-[10px] font-bold uppercase tracking-wider text-brand">
                  Configuração do Nó
                </span>
                <button
                  aria-label="Fechar configuração"
                  onClick={() => state.select(null)}
                  className="p-1 rounded text-content-muted hover:text-content-primary hover:bg-surface-elevated transition-colors cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              <div>
                <h2 className="text-base font-bold text-content-primary tracking-tight">
                  {catalog[selected.type].label}
                </h2>
                <code className="text-[10px] font-mono text-content-muted bg-surface-elevated px-2 py-0.5 rounded mt-1 inline-block">
                  {selected.type}
                </code>
              </div>

              <div className="pt-1">
                <SchemaForm key={selected.id} node={selected} />
              </div>

              <div className="pt-4 border-t border-border">
                <button
                  onClick={() => state.remove([selected.id])}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                  <span>Excluir Nó</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="inspector-heading pb-3 border-b border-border">
                <div>
                <span className="inspector-kicker text-[10px] font-bold uppercase tracking-wider text-content-muted">
                  Visão Geral do Fluxo
                </span>
                <h2 className="text-sm font-bold text-content-primary mt-1">
                  Editor de Conversas
                </h2>
                <p className="text-[11px] text-content-muted mt-0.5">
                  Selecione um bloco no canvas para configurar suas instruções e regras.
                </p>
                </div>
              </div>

              <div className="flow-stats grid grid-cols-2 gap-2">
                <div className="flow-stat-card p-3 rounded-xl bg-surface-elevated/60 border border-border/50 text-center">
                  <strong className="block text-xl font-bold text-content-primary">{graph.nodes.length}</strong>
                  <span className="text-[10px] text-content-muted uppercase tracking-wider">Nós</span>
                </div>
                <div className="flow-stat-card p-3 rounded-xl bg-surface-elevated/60 border border-border/50 text-center">
                  <strong className="block text-xl font-bold text-brand">{graph.edges.length}</strong>
                  <span className="text-[10px] text-content-muted uppercase tracking-wider">Conexões</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-surface-elevated/40 border border-border/40 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-content-secondary">Instância WhatsApp:</span>
                  <span className={`font-mono text-[11px] font-bold ${targetInstance ? 'text-[#2ee86b]' : 'text-amber-400'}`}>
                    {targetInstance || 'Não vinculada'}
                  </span>
                </div>
                <p className="text-[11px] text-content-muted leading-relaxed">
                  {targetInstance
                    ? `Este fluxo responderá mensagens recebidas pela instância "${targetInstance}".`
                    : 'Selecione uma instância na barra superior para vincular e publicar.'}
                </p>
                <button
                  onClick={() => newGraph('sdr')}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold text-brand bg-brand/10 hover:bg-brand/20 border border-brand/20 transition-colors cursor-pointer"
                >
                  <span>Carregar Modelo SDR</span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}

          {showValidation && (
            <div className="mt-5 p-3.5 rounded-xl bg-surface-elevated/60 border border-border space-y-2">
              <h3 className="text-xs font-bold text-content-primary">
                {validation.valid ? 'Tudo certo com o grafo' : 'Pontos de Atenção'}
              </h3>
              {validation.valid ? (
                <p className="text-[11px] text-brand">Gatilho conectado e todos os caminhos possuem término válido.</p>
              ) : (
                <ul className="space-y-1.5 text-[11px]">
                  {validation.issues.map((issue, index) => (
                    <li key={index}>
                      <button
                        onClick={() => state.select(issue.nodeId ?? null)}
                        className="text-left text-red-400 hover:underline hover:text-red-300"
                      >
                        • {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
        </>
      )}

      <footer className="statusbar">
        <span>
          <i className="status-dot" style={{ background: currentInstance?.status === 'connected' ? '#16a34a' : '#ca8a04' }} />
          {targetInstance ? `Instância ativa: ${targetInstance}` : 'Nenhuma instância selecionada no topo'}
        </span>
        <span role="status" className="notice">{notice || 'Alterações no canvas ficam no rascunho até você salvar.'}</span>
        <span>{graph.nodes.length} nós · {graph.edges.length} conexões</span>
      </footer>

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
