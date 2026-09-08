import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, MiniMap, Controls, useReactFlow, useNodesInitialized, type Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { ArrowLeft, CheckCheck, ChevronRight, Download, FileJson, LayoutGrid, Play, Plus, Redo2, Save, Search, Trash2, Undo2, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { flowGraphSchema, flowTestModeSchema, nodeTypeSchema, type FlowGraph } from '@sdr/shared';
import { catalog, categories, categoryColors, createBlankFlow, createSdrTemplate, validateGraph } from '@sdr/flow';
import { FlowNode, type CanvasNode } from './FlowNode';
import { SchemaForm } from './SchemaForm';
import { useBuilder } from './store';
import { useSession } from '../session';
import { PlaygroundModal } from './PlaygroundModal';

const nodeTypes = { flowNode: FlowNode };
const DRAFT_KEY = 'sdr-flow:editor-draft:v1';
interface SavedFlow { id: string; name: string; draft: FlowGraph; published_version_id: string | null }
function Editor() {
  const state = useBuilder(); const { graph,selectedId } = state;
  const { screenToFlowPosition,fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const [fitRequested,setFitRequested] = useState(false);
  const [measurements,setMeasurements] = useState<Record<string,{ width: number; height: number }>>({});
  const { session,activeOrg,organizations } = useSession();
  const [query,setQuery] = useState(''), [notice,setNotice] = useState(''), [showValidation,setShowValidation] = useState(false), [showJson,setShowJson] = useState(false), [showPlayground,setShowPlayground] = useState(false), [busy,setBusy] = useState(false);
  const [flowId,setFlowId] = useState<string | null>(null), [savedFlows,setSavedFlows] = useState<SavedFlow[]>([]), [selectedEdges,setSelectedEdges] = useState<string[]>([]);
  const upload = useRef<HTMLInputElement>(null); const canvas = useRef<HTMLDivElement>(null);
  const validation = useMemo(() => validateGraph(graph),[graph]);
  const invalidIds = new Set(showValidation ? validation.issues.map(issue => issue.nodeId) : []);
  const nodes: CanvasNode[] = graph.nodes.map(node => ({ id: node.id, type: 'flowNode', position: node.position, measured: measurements[node.id], selected: node.id === selectedId, data: { node, invalid: invalidIds.has(node.id) } }));
  const edges = graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort, targetHandle: 'input', label: edge.sourcePort === 'next' ? undefined : edge.sourcePort, selected: selectedEdges.includes(edge.id), type: 'smoothstep' }));
  const selected = graph.nodes.find(node => node.id === selectedId);
  useEffect(() => {
    if (!nodesInitialized || !fitRequested) return;
    void fitView({ nodes: graph.nodes.map(node => ({ id: node.id })),padding: 0.15,duration: 300 });
    setFitRequested(false);
  },[nodesInitialized,fitRequested,graph.nodes,fitView]);
  async function api(path: string,init?: RequestInit) {
    const response = await fetch(`/api/organizations/${activeOrg}${path}`,{ ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` } });
    const result = await response.json() as unknown;
    if (!response.ok) throw new Error(typeof result === 'object' && result !== null && 'error' in result ? String(result.error) : `Operação recusada (${response.status}).`);
    return result;
  }
  useEffect(() => {
    let cancelled = false;
    setFlowId(null); setSavedFlows([]);
    if (session && activeOrg) void api('/flows').then(result => { if (!cancelled) setSavedFlows(result as SavedFlow[]); }).catch(error => { if (!cancelled) setNotice(String(error)); });
    return () => { cancelled = true; };
  },[session?.user.id,activeOrg]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) useBuilder.getState().redo(); else useBuilder.getState().undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); useBuilder.getState().redo(); }
    };
    window.addEventListener('keydown',listener); return () => window.removeEventListener('keydown',listener);
  },[]);
  const layout = (input = graph) => {
    const dag = new dagre.graphlib.Graph(); dag.setDefaultEdgeLabel(() => ({})); dag.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 90 });
    input.nodes.forEach(node => dag.setNode(node.id,{ width: 240,height: 145 }));
    input.edges.forEach(edge => dag.setEdge(edge.source,edge.target)); dagre.layout(dag);
    state.replace({ ...input,nodes: input.nodes.map(node => ({ ...node,position: { x: dag.node(node.id).x - 120,y: dag.node(node.id).y - 72 } })) });
    setFitRequested(true);
  };
  const connect = (connection: Connection) => {
    if (!connection.sourceHandle || connection.source === connection.target) return;
    if (graph.edges.some(edge => edge.source === connection.source && edge.sourcePort === connection.sourceHandle)) { setNotice('Esta saída já está conectada. Remova a conexão atual antes de criar outra.'); return; }
    state.replace({ ...graph,edges: [...graph.edges,{ id: crypto.randomUUID(),source: connection.source,target: connection.target,sourcePort: connection.sourceHandle }] });
  };
  const newGraph = (kind: 'blank'|'sdr') => {
    state.replace(kind === 'sdr' ? createSdrTemplate() : createBlankFlow()); state.setName(kind === 'sdr' ? 'Qualificação SDR' : 'Novo fluxo'); setFlowId(null); setNotice('Novo rascunho aberto. Use Desfazer para recuperar o grafo anterior.'); setShowValidation(false); layout(useBuilder.getState().graph);
  };
  async function save(publish = false) {
    if (publish && !validation.valid) { setShowValidation(true); setNotice('Corrija os pontos de validação antes de publicar.'); return; }
    if (!state.name.trim()) { setNotice('Dê um nome ao fluxo antes de salvar.'); return; }
    if (!session || !activeOrg) {
      if (publish) { setNotice('Entre e selecione uma organização em Configurações para publicar.'); return; }
      try { localStorage.setItem(DRAFT_KEY,JSON.stringify({ name: state.name,graph })); setNotice('Rascunho salvo neste navegador. A publicação exige uma organização.'); } catch { setNotice('Não foi possível salvar no navegador. Exporte o JSON para preservar seu trabalho.'); }
      return;
    }
    setBusy(true);
    try {
      const saved = await api(flowId ? `/flows/${flowId}` : '/flows',{ method: flowId ? 'PUT' : 'POST',body: JSON.stringify({ name: state.name,graph }) }) as SavedFlow;
      setFlowId(saved.id);
      if (publish) {
        const version = await api(`/flows/${saved.id}/publish`,{ method: 'POST',body: JSON.stringify(graph) }) as { version: number };
        setNotice(`Versão ${version.version} publicada no Supabase.`);
      } else setNotice('Rascunho salvo na organização.');
      setSavedFlows(await api('/flows') as SavedFlow[]);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Falha ao salvar.'); } finally { setBusy(false); }
  }
  function restoreLocal() {
    try {
      const value = localStorage.getItem(DRAFT_KEY); if (!value) { setNotice('Nenhum rascunho local salvo.'); return; }
      const draft = JSON.parse(value) as { name: unknown; graph: unknown }; const parsed = flowGraphSchema.parse(draft.graph);
      state.replace(parsed); state.setName(typeof draft.name === 'string' ? draft.name : 'Rascunho'); setFlowId(null); layout(parsed); setNotice('Rascunho local recuperado.');
    } catch { setNotice('O rascunho local está inválido. Importe um JSON válido.'); }
  }
  return <div className="builder-page">
    <header className="builder-header"><div className="breadcrumb"><Link to="/flows"><ArrowLeft size={16}/></Link><span>Fluxos</span><ChevronRight size={13}/><span>Construtor</span></div>
      <div className="title-row"><div><div className="flow-title"><input aria-label="Nome do fluxo" maxLength={120} value={state.name} onChange={event => state.setName(event.target.value)}/><span className="badge">Rascunho</span></div><p>Desenhe o caminho de cada conversa.</p></div><div className="header-actions"><button onClick={() => setShowPlayground(true)} title="Testar fluxo com contexto de lead"><Play size={15}/>Playground</button><button onClick={() => { setShowValidation(true); setNotice(validation.valid ? 'Grafo válido: todos os caminhos terminam.' : `${validation.issues.length} ponto(s) para revisar.`); }}><CheckCheck size={16}/>Validar</button><button onClick={() => void save()} disabled={busy}><Save size={16}/>Salvar</button><button className="primary" onClick={() => void save(true)} disabled={busy}><Upload size={15}/>{busy ? 'Salvando…' : 'Publicar'}</button></div></div>
    </header>
    <section aria-label="Configuração do Modo Teste" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--color-border-secondary)', background: 'var(--color-bg-secondary)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontWeight: 600 }}>
        <input type="checkbox" role="switch" checked={graph.testMode?.enabled ?? false} onChange={event => state.replace({ ...graph, testMode: { enabled: event.target.checked, phone: graph.testMode?.phone || '' } })} style={{ width: 16, margin: 0 }} />
        Modo Teste
      </label>
      {graph.testMode?.enabled && <>
        <label htmlFor="flow-test-phone" style={{ margin: 0 }}>Número autorizado</label>
        <input id="flow-test-phone" type="tel" autoComplete="off" maxLength={50} placeholder="+55 11 99999-9999" value={graph.testMode.phone}
          aria-invalid={!flowTestModeSchema.safeParse(graph.testMode).success} aria-describedby="flow-test-help"
          onChange={event => state.replace({ ...graph, testMode: { enabled: true, phone: event.target.value } })} style={{ width: 210 }} />
        <span id="flow-test-help" style={{ fontSize: 12 }}>Responde apenas a este número. Salve e publique para aplicar ao fluxo ativo.</span>
      </>}
      {!graph.testMode?.enabled && <span style={{ fontSize: 12 }}>Restrinja este fluxo a um único número do WhatsApp.</span>}
    </section>
    <div className="editor-toolbar"><div><button title="Desfazer (Ctrl+Z)" aria-label="Desfazer" disabled={state.cursor === 0} onClick={state.undo}><Undo2 size={16}/></button><button title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer" disabled={state.cursor === state.history.length-1} onClick={state.redo}><Redo2 size={16}/></button><span className="divider"/><button onClick={() => layout()}><LayoutGrid size={15}/>Organizar</button><button onClick={() => setShowJson(!showJson)}><FileJson size={15}/>JSON</button></div>
      <div><button onClick={() => { const blob = new Blob([JSON.stringify(graph,null,2)],{ type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${state.name.replace(/[^\p{L}\p{N}_-]/gu,'_') || 'flow'}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }}><Download size={15}/>Exportar</button><button onClick={() => upload.current?.click()}><Upload size={15}/>Importar</button><input ref={upload} type="file" accept=".json,application/json" hidden onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 1_000_000) throw new Error('O limite é 1 MB.'); const imported = flowGraphSchema.parse(JSON.parse(await file.text())); state.replace(imported); setFlowId(null); layout(imported); setNotice('Grafo importado. Valide antes de publicar.'); } catch (error) { setNotice(`Não foi possível importar: ${error instanceof Error ? error.message : 'JSON inválido.'}`); } finally { event.target.value = ''; } }}/></div>
    </div>
    <div className="editor-body"><aside className="node-library"><div className="library-heading"><h2>Biblioteca de nós</h2><span>31</span></div><p className="muted">Arraste para o canvas ou clique.</p><div className="search-input"><Search size={15}/><input aria-label="Buscar nós" placeholder="Buscar nós…" value={query} onChange={event => setQuery(event.target.value)}/></div>
      <div className="library-scroll">{Object.entries(categories).map(([category,label]) => { const entries = Object.values(catalog).filter(node => node.category === category && `${node.label} ${node.type}`.toLowerCase().includes(query.toLowerCase())); return entries.length > 0 && <section key={category}><h3>{label}</h3>{entries.map(node => <button key={node.type} className="library-node" draggable onDragStart={event => { event.dataTransfer.setData('application/sdr-node',node.type); event.dataTransfer.effectAllowed = 'move'; }} onClick={() => { const bounds = canvas.current?.getBoundingClientRect(); state.add(node.type,screenToFlowPosition({ x: (bounds?.left ?? 300)+(bounds?.width ?? 600)/2,y: (bounds?.top ?? 200)+(bounds?.height ?? 400)/2 })); }}><span className="category-dot" style={{ background: categoryColors[node.category] }}/>{node.label}<Plus size={13}/></button>)}</section>; })}</div>
      <div className="library-footer"><button onClick={() => newGraph('sdr')}>Usar modelo SDR<ChevronRight size={14}/></button><button onClick={() => newGraph('blank')}>Novo fluxo<Plus size={14}/></button><button onClick={restoreLocal}>Recuperar rascunho local</button></div>
    </aside>
    <div className="canvas" ref={canvas} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => { event.preventDefault(); const type = nodeTypeSchema.safeParse(event.dataTransfer.getData('application/sdr-node')); if (type.success) state.add(type.data,screenToFlowPosition({ x: event.clientX,y: event.clientY })); }}>
      <ReactFlow<CanvasNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.08} maxZoom={2} snapToGrid snapGrid={[20,20]} onConnect={connect}
        onNodeClick={(_event,node) => { state.select(node.id); setSelectedEdges([]); }} onPaneClick={() => { state.select(null); setSelectedEdges([]); }}
        onEdgeClick={(_event,edge) => { setSelectedEdges([edge.id]); state.select(null); }}
        onNodesChange={changes => {
          const dimensions = changes.filter(change => change.type === 'dimensions' && change.dimensions);
          if (dimensions.length) setMeasurements(current => { const next = { ...current }; let changed = false; for (const change of dimensions) if (change.type === 'dimensions' && change.dimensions && (current[change.id]?.width !== change.dimensions.width || current[change.id]?.height !== change.dimensions.height)) { next[change.id] = change.dimensions; changed = true; } return changed ? next : current; });
          const removed = changes.filter(change => change.type === 'remove').map(change => change.id); if (removed.length) state.remove(removed);
          for (const change of changes) if (change.type === 'position' && change.position) { state.move(change.id,change.position); if (change.dragging === false) state.checkpoint(); }
        }}
        onNodeDragStop={() => state.checkpoint()}
        onEdgesChange={changes => { const removed = changes.filter(change => change.type === 'remove').map(change => change.id); if (removed.length) state.replace({ ...useBuilder.getState().graph,edges: useBuilder.getState().graph.edges.filter(edge => !removed.includes(edge.id)) }); }}>
        <Background gap={20} size={1}/><Controls showInteractive={false}/><MiniMap style={{width:140,height:96}} pannable zoomable nodeColor={node => { const found = graph.nodes.find(item => item.id === node.id); return found ? categoryColors[catalog[found.type].category] : '#94a3b8'; }}/>
      </ReactFlow>
      {graph.nodes.length <= 2 && <div className="canvas-hint">Comece pela biblioteca. Conecte as saídas para criar sua conversa.</div>}
      {showJson && <div className="json-overlay"><div><strong>Grafo do fluxo</strong><button aria-label="Fechar JSON" onClick={() => setShowJson(false)}><X size={16}/></button></div><pre>{JSON.stringify(graph,null,2)}</pre></div>}
    </div>
    <aside className="inspector">{selected ? <><div className="inspector-heading"><span className="eyebrow">CONFIGURAÇÃO DO NÓ</span><button aria-label="Fechar configuração" onClick={() => state.select(null)}><X size={16}/></button></div><h2>{catalog[selected.type].label}</h2><code className="node-type">{selected.type}</code><SchemaForm key={selected.id} node={selected}/><button className="danger" onClick={() => state.remove([selected.id])}><Trash2 size={15}/>Excluir nó</button></>
      : <><span className="eyebrow">SEU FLUXO</span><h2>Uma conversa, passo a passo</h2><p className="muted">Selecione um nó para editar suas instruções, regras e saídas.</p><div className="flow-stats"><div><strong>{graph.nodes.length}</strong><span>nós</span></div><div><strong>{graph.edges.length}</strong><span>conexões</span></div></div><div className="info-card"><strong>Do primeiro contato à resposta</strong><p>Use o modelo SDR para explorar as etapas de qualificação, memória e atendimento humano.</p><button onClick={() => newGraph('sdr')}>Abrir modelo SDR<ChevronRight size={14}/></button></div><p className="runtime-note">Editor disponível. A execução das conversas será conectada na próxima etapa.</p></>}
      {savedFlows.length > 0 && <label className="saved-flow-select">Abrir fluxo da organização<select value={flowId ?? ''} onChange={event => { const flow = savedFlows.find(item => item.id === event.target.value); if (!flow) return; const parsed = flowGraphSchema.safeParse(flow.draft); if (!parsed.success) { setNotice('O fluxo salvo tem um formato incompatível.'); return; } state.replace(parsed.data); state.setName(flow.name); setFlowId(flow.id); layout(parsed.data); }}><option value="">Selecionar fluxo</option>{savedFlows.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}</select></label>}
      {showValidation && <div className="validation-panel"><h3>{validation.valid ? 'Tudo certo com o grafo' : 'Revisar antes de publicar'}</h3>{validation.valid ? <p>Gatilho único, saídas conectadas e caminhos com término.</p> : <ul>{validation.issues.map((issue,index) => <li key={index}><button onClick={() => state.select(issue.nodeId ?? null)}>{issue.message}</button></li>)}</ul>}</div>}
    </aside></div>
    <footer className="statusbar"><span><i className="status-dot"/>{session && activeOrg ? organizations.find(org => org.id === activeOrg)?.name : 'Rascunho local'}</span><span role="status" className="notice">{notice || 'Alterações no canvas ficam no rascunho até você salvar.'}</span><span>{graph.nodes.length} nós · {graph.edges.length} conexões</span></footer>
    <PlaygroundModal isOpen={showPlayground} onClose={() => setShowPlayground(false)} flowId={flowId} graph={graph} />
  </div>;
}
export function Builder() { return <ReactFlowProvider><Editor/></ReactFlowProvider>; }
