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
  const [activeBindings, setActiveBindings] = useState<Record<string, { flowId: string; flow?: any }>>({});
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
    try {
      const activeRes = await fetch('/api/flows/active');
      if (activeRes.ok) {
        const active = await activeRes.json();
        if (typeof active === 'object' && active !== null) {
          setActiveBindings(active);
        }
      }

      const flowsRes = await fetch('/api/flows');
      if (flowsRes.ok) {
        const flows = await flowsRes.json();
        if (Array.isArray(flows)) {
          setSavedFlows(flows);
          const queryId = new URLSearchParams(window.location.search).get('id');
          if (queryId) {
            const flowToOpen = flows.find((f: any) => f.id === queryId);
            if (flowToOpen) {
              const candidateGraph = flowToOpen.graph || flowToOpen.draft;
              const parsed = flowGraphSchema.safeParse(candidateGraph);
              if (parsed.success) {
                state.replace(parsed.data);
                state.setName(flowToOpen.name);
                setFlowId(flowToOpen.id);
                if (flowToOpen.targetInstance) setActiveInstance(flowToOpen.targetInstance);
                layout(parsed.data);
                setNotice(`Fluxo "${flowToOpen.name}" carregado.`);
              }
            }
          }
        }
      }
    } catch {
      // Ignora erro no carregamento inicial silencioso
    }
  };

  useEffect(() => {
    void refreshData();
  }, []);

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
    dag.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 90 });
    input.nodes.forEach(node => dag.setNode(node.id, { width: 240, height: 145 }));
    input.edges.forEach(edge => dag.setEdge(edge.source, edge.target));
    dagre.layout(dag);
    state.replace({
      ...input,
      nodes: input.nodes.map(node => ({
        ...node,
        position: { x: dag.node(node.id).x - 120, y: dag.node(node.id).y - 72 },
      })),
    });
    setFitRequested(true);
  };

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

    setBusy(true);
    try {
      // 1. Salva o fluxo na API
      const payload = {
        id: flowId || undefined,
        name: state.name,
        graph,
        targetInstance: targetInstance || undefined,
      };

      const saveRes = await fetch(flowId ? `/api/flows/${flowId}` : '/api/flows', {
        method: flowId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        const pubRes = await fetch(`/api/flows/${saved.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph, targetInstance }),
        });

        if (!pubRes.ok) {
          const errJson = await pubRes.json().catch(() => null);
          throw new Error(errJson?.error || `Erro ao publicar (${pubRes.status})`);
        }

        const pubData = (await pubRes.json()) as { version: number; targetInstance?: string };
        const isTest = Boolean(graph.testMode?.enabled);
        setNotice(
          `🎉 Versão ${pubData.version} publicada e ATIVADA no WhatsApp "${targetInstance}"! (${isTest ? '⚠️ MODO TESTE ATIVO para ' + (graph.testMode?.phone || 'número autorizado') : '🟢 MODO PRODUÇÃO'})`
        );
      } else {
        setNotice('✅ Fluxo e configurações salvos com sucesso!');
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
    const candidateGraph = flow.graph || flow.draft;
    const parsed = flowGraphSchema.safeParse(candidateGraph);
    if (!parsed.success) {
      setNotice('O fluxo salvo tem um formato incompatível.');
      return;
    }
    state.replace(parsed.data);
    state.setName(flow.name);
    setFlowId(flow.id);
    if (flow.targetInstance) setActiveInstance(flow.targetInstance);
    window.history.replaceState(null, '', `?id=${flow.id}`);
    layout(parsed.data);
    setNotice(`Fluxo "${flow.name}" aberto para edição.`);
  };

  const isInstanceActiveWithThisFlow = targetInstance && activeBindings[targetInstance]?.flowId === flowId;

  return (
    <div className="builder-page flex flex-col h-full bg-canvas text-content-primary">
      <header className="bg-surface border-b border-border px-6 py-3.5 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/flows"
              className="p-1.5 rounded-lg text-content-muted hover:text-content-primary hover:bg-surface-elevated transition-colors"
              title="Voltar aos Fluxos"
            >
              <ArrowLeft size={16} />
            </Link>
            <div className="flex flex-col min-w-0">
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

          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPlayground(true)}
              title="Testar fluxo com IA"
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
      <div className="bg-surface border-b border-border px-6 flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('canvas')}
          className={`flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-all duration-150 -mb-[1px] ${
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
          className={`flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-all duration-150 -mb-[1px] ${
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
          className={`flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-all duration-150 -mb-[1px] ${
            activeTab === 'variables'
              ? 'border-brand text-brand font-semibold'
              : 'border-transparent text-content-secondary hover:text-content-primary hover:border-border'
          }`}
        >
          <Network size={14} />
          <span>Mapa de Variáveis</span>
        </button>
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
          <section
            aria-label="Configuração do Modo Teste"
            className={`flex items-center flex-wrap gap-3 px-6 py-2.5 border-b text-xs transition-all flex-shrink-0 ${
              graph.testMode?.enabled
                ? 'bg-warning-bg border-warning-border text-warning'
                : 'bg-surface-elevated/40 border-border text-content-secondary'
            }`}
          >
            <label className="flex items-center gap-2 m-0 font-semibold cursor-pointer">
              <input
                type="checkbox"
                role="switch"
                checked={graph.testMode?.enabled ?? false}
                onChange={event => state.replace({ ...graph, testMode: { enabled: event.target.checked, phone: graph.testMode?.phone || '' } })}
                className="w-4 h-4 accent-brand cursor-pointer"
              />
              <span>{graph.testMode?.enabled ? '⚠️ Modo Teste Ativado' : 'Modo Teste'}</span>
            </label>
            {graph.testMode?.enabled && (
              <>
                <label htmlFor="flow-test-phone" className="m-0 font-medium">Número autorizado:</label>
                <input
                  id="flow-test-phone"
                  type="tel"
                  autoComplete="off"
                  maxLength={50}
                  placeholder="+55 55 99999-9999"
                  value={graph.testMode.phone}
                  aria-invalid={!flowTestModeSchema.safeParse(graph.testMode).success}
                  aria-describedby="flow-test-help"
                  onChange={event => state.replace({ ...graph, testMode: { enabled: true, phone: event.target.value } })}
                  className="w-48 py-1 px-2.5 rounded-lg border border-warning-border bg-surface text-content-primary text-xs outline-none focus:ring-1 focus:ring-warning"
                />
                <span id="flow-test-help" className="text-xs font-semibold flex items-center gap-1.5 text-warning">
                  <ShieldAlert size={14} /> Responde EXCLUSIVAMENTE a este número. Outros contatos serão ignorados.
                </span>
              </>
            )}
            {!graph.testMode?.enabled && (
              <span className="text-xs text-content-muted">
                Restrinja este fluxo a um único número do WhatsApp para testar com segurança antes de abrir para o público.
              </span>
            )}
          </section>

          <div className="bg-surface border-b border-border px-6 py-2 flex items-center justify-between gap-2 text-xs flex-shrink-0">
            <div className="flex items-center gap-1.5">
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
              <label title="Máximo de vezes que cada nó pode ser executado em loops" className="flex items-center gap-1.5 text-content-secondary text-xs font-medium cursor-default">
                <Repeat size={13} /> Loop:
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={graph.loopLimit ?? 5}
                  onChange={event => state.replace({ ...graph, loopLimit: Math.max(1, Math.min(20, Number(event.target.value) || 5)) })}
                  className="w-12 py-0.5 px-1.5 rounded-md border border-border bg-surface text-center text-xs font-mono outline-none focus:ring-1 focus:ring-brand"
                />
              </label>
            </div>
            <div className="flex items-center gap-1.5">
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
        <aside className="node-library">
          <div className="library-heading">
            <h2>Biblioteca de nós</h2>
            <span>{Object.keys(catalog).length}</span>
          </div>
          <p className="muted">Arraste para o canvas ou clique.</p>
          <div className="search-input">
            <Search size={15} />
            <input aria-label="Buscar nós" placeholder="Buscar nós…" value={query} onChange={event => setQuery(event.target.value)} />
          </div>
          <div className="library-scroll">
            {Object.entries(categories).map(([category, label]) => {
              const entries = Object.values(catalog).filter(
                node => node.category === category && `${node.label} ${node.type}`.toLowerCase().includes(query.toLowerCase())
              );
              return (
                entries.length > 0 && (
                  <section key={category}>
                    <h3>{label}</h3>
                    {entries.map(node => (
                      <button
                        key={node.type}
                        className="library-node"
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
                        <span className="category-dot" style={{ background: categoryColors[node.category] }} />
                        {node.label}
                        <Plus size={13} />
                      </button>
                    ))}
                  </section>
                )
              );
            })}
          </div>
          <div className="library-footer">
            <button onClick={() => newGraph('sdr')}>Usar modelo SDR<ChevronRight size={14} /></button>
            <button onClick={() => newGraph('blank')}>Novo fluxo<Plus size={14} /></button>
            <button onClick={restoreLocal}>Recuperar rascunho local</button>
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
          <ReactFlow<CanvasNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
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
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              style={{ width: 140, height: 96 }}
              pannable
              zoomable
              nodeColor={node => {
                const found = graph.nodes.find(item => item.id === node.id);
                return found ? categoryColors[catalog[found.type].category] : '#94a3b8';
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

        <aside className="inspector">
          {selected ? (
            <>
              <div className="inspector-heading">
                <span className="eyebrow">CONFIGURAÇÃO DO NÓ</span>
                <button aria-label="Fechar configuração" onClick={() => state.select(null)}><X size={16} /></button>
              </div>
              <h2>{catalog[selected.type].label}</h2>
              <code className="node-type">{selected.type}</code>
              <SchemaForm key={selected.id} node={selected} />
              <button className="danger" onClick={() => state.remove([selected.id])}><Trash2 size={15} />Excluir nó</button>
            </>
          ) : (
            <>
              <span className="eyebrow">SEU FLUXO</span>
              <h2>Uma conversa, passo a passo</h2>
              <p className="muted">Selecione um nó para editar suas instruções, regras e saídas.</p>
              <div className="flow-stats">
                <div><strong>{graph.nodes.length}</strong><span>nós</span></div>
                <div><strong>{graph.edges.length}</strong><span>conexões</span></div>
              </div>
              <div className="info-card">
                <strong>Instância Vinculada:</strong>
                <p style={{ marginTop: 4, fontWeight: 600, color: targetInstance ? '#16a34a' : 'inherit' }}>
                  {targetInstance ? `WhatsApp: ${targetInstance}` : 'Nenhuma (Selecione na barra lateral)'}
                </p>
                <button onClick={() => newGraph('sdr')}>Abrir modelo SDR<ChevronRight size={14} /></button>
              </div>
            </>
          )}

          {savedFlows.length > 0 && (
            <label className="saved-flow-select" style={{ marginTop: 20 }}>
              Abrir Fluxo Salvo
              <select value={flowId ?? ''} onChange={event => handleSelectSavedFlow(event.target.value)}>
                <option value="">-- Selecionar fluxo salvo --</option>
                {savedFlows.map(flow => (
                  <option key={flow.id} value={flow.id}>
                    {flow.name} {flow.published ? `(v${flow.publishedVersion || 1})` : '(rascunho)'}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showValidation && (
            <div className="validation-panel">
              <h3>{validation.valid ? 'Tudo certo com o grafo' : 'Revisar antes de publicar'}</h3>
              {validation.valid ? (
                <p>Gatilho único, saídas conectadas e caminhos com término.</p>
              ) : (
                <ul>
                  {validation.issues.map((issue, index) => (
                    <li key={index}><button onClick={() => state.select(issue.nodeId ?? null)}>{issue.message}</button></li>
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
