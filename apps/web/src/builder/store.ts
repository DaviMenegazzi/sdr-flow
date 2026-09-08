// Adapted from AutoGen Studio builder/store.tsx (MIT, Microsoft).
// One graph owns both canvas and serialization; snapshots are deeply cloned.
import { create } from 'zustand';
import { createBlankFlow, makeNode } from '@sdr/flow';
import type { FlowGraph, FlowNode, NodeType } from '@sdr/shared';

const MAX_HISTORY = 50;
interface BuilderState {
  graph: FlowGraph; name: string; selectedId: string | null;
  history: FlowGraph[]; cursor: number;
  setName(name: string): void;
  select(id: string | null): void;
  replace(graph: FlowGraph, resetHistory?: boolean): void;
  add(type: NodeType, position: { x: number; y: number }): void;
  update(id: string, update: Partial<Pick<FlowNode,'label'|'config'>>): void;
  remove(ids: string[]): void;
  move(id: string, position: { x: number; y: number }): void;
  checkpoint(): void;
  undo(): void; redo(): void;
}
const initial = createBlankFlow();
export const useBuilder = create<BuilderState>((set,get) => ({
  graph: initial, name: 'Meu primeiro fluxo', selectedId: null, history: [structuredClone(initial)], cursor: 0,
  setName: name => set({ name }), select: selectedId => set({ selectedId }),
  replace: (graph, resetHistory = false) => {
    const copy = structuredClone(graph);
    if (resetHistory) { set({ graph: copy, history: [structuredClone(copy)], cursor: 0, selectedId: null }); return; }
    if (JSON.stringify(copy) === JSON.stringify(get().history[get().cursor])) { set({ graph: copy }); return; }
    const history = [...get().history.slice(0,get().cursor+1),structuredClone(copy)].slice(-MAX_HISTORY);
    set({ graph: copy, history, cursor: history.length-1, selectedId: copy.nodes.some(node => node.id === get().selectedId) ? get().selectedId : null });
  },
  add: (type, position) => {
    const id = crypto.randomUUID();
    get().replace({ ...get().graph, nodes: [...get().graph.nodes,makeNode(type,id,position.x,position.y)] });
    set({ selectedId: id });
  },
  update: (id, update) => get().replace({ ...get().graph, nodes: get().graph.nodes.map(node => node.id === id ? { ...node, ...update } : node) }),
  remove: ids => get().replace({ ...get().graph, nodes: get().graph.nodes.filter(node => !ids.includes(node.id)), edges: get().graph.edges.filter(edge => !ids.includes(edge.source) && !ids.includes(edge.target)) }),
  move: (id, position) => set(state => ({ graph: { ...state.graph, nodes: state.graph.nodes.map(node => node.id === id ? { ...node, position } : node) } })),
  checkpoint: () => get().replace(get().graph),
  undo: () => { const { cursor,history } = get(); if (cursor > 0) set({ cursor: cursor-1, graph: structuredClone(history[cursor-1]!), selectedId: null }); },
  redo: () => { const { cursor,history } = get(); if (cursor < history.length-1) set({ cursor: cursor+1, graph: structuredClone(history[cursor+1]!), selectedId: null }); },
}));
