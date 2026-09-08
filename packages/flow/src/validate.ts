import { flowGraphSchema, type FlowGraph } from '@sdr/shared';
import { catalog, portsFor } from './catalog.js';

export interface ValidationIssue { code: string; message: string; nodeId?: string; edgeId?: string }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[]; graph?: FlowGraph }
export function validateGraph(input: unknown): ValidationResult {
  const parsed = flowGraphSchema.safeParse(input);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map(issue => ({ code: 'schema', message: `${issue.path.join('.')}: ${issue.message}` })) };
  const graph = parsed.data;
  const issues: ValidationIssue[] = [];
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const add = (code: string, message: string, nodeId?: string, edgeId?: string) => issues.push({ code, message, nodeId, edgeId });
  if (byId.size !== graph.nodes.length) add('duplicate_node', 'Há identificadores de nós duplicados.');
  if (new Set(graph.edges.map(edge => edge.id)).size !== graph.edges.length) add('duplicate_edge', 'Há identificadores de conexões duplicados.');
  const triggers = graph.nodes.filter(node => node.type.startsWith('trigger.'));
  if (triggers.length !== 1) add('trigger_count', 'O fluxo precisa de exatamente um gatilho.');
  for (const node of graph.nodes) {
    const config = catalog[node.type].schema.safeParse(node.config);
    if (!config.success) for (const issue of config.error.issues) add('config', `${node.label} · ${issue.path.join('.')}: ${issue.message}`, node.id);
    else node.config = config.data as typeof node.config;
    const ports = portsFor(node.type, node.config);
    if (new Set(ports).size !== ports.length) add('duplicate_port', 'Os nomes das saídas devem ser únicos e diferentes de default.', node.id);
    for (const port of ports) {
      const outgoing = graph.edges.filter(edge => edge.source === node.id && edge.sourcePort === port);
      if (outgoing.length !== 1) add('required_port', `${node.label}: conecte a saída “${port}” a um único destino.`, node.id);
    }
  }
  for (const edge of graph.edges) {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    if (!source || !target) { add('dangling_edge', 'Uma conexão aponta para um nó inexistente.', undefined, edge.id); continue; }
    if (!portsFor(source.type, source.config).includes(edge.sourcePort)) add('unknown_port', 'A conexão usa uma saída inexistente.', source.id, edge.id);
    if (target.type.startsWith('trigger.')) add('trigger_incoming', 'Gatilhos não aceitam conexões de entrada.', target.id, edge.id);
  }
  const adjacent = (id: string) => graph.edges.filter(edge => edge.source === id).map(edge => edge.target).filter(id => byId.has(id));
  const reached = new Set<string>();
  const visit = (id: string) => { if (reached.has(id)) return; reached.add(id); adjacent(id).forEach(visit); };
  if (triggers[0]) visit(triggers[0].id);
  graph.nodes.filter(node => !reached.has(node.id)).forEach(node => add('unreachable', `${node.label} não está conectado ao gatilho.`, node.id));
  // Initial runtime contract is a DAG: even a cycle with an exit can loop forever.
  // Wait/resume is represented by explicit nodes, never by back edges.
  const active = new Set<string>(), complete = new Set<string>();
  const detectCycle = (id: string) => {
    if (active.has(id)) { add('cycle', 'Ciclo detectado. Use Esperar resposta para representar uma espera.', id); return; }
    if (complete.has(id)) return;
    active.add(id); adjacent(id).forEach(detectCycle); active.delete(id); complete.add(id);
  };
  graph.nodes.forEach(node => detectCycle(node.id));
  const terminating = new Set(graph.nodes.filter(node => node.type === 'output.end').map(node => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      const next = adjacent(node.id);
      if (!terminating.has(node.id) && next.length > 0 && next.every(id => terminating.has(id))) { terminating.add(node.id); changed = true; }
    }
  }
  graph.nodes.filter(node => !terminating.has(node.id)).forEach(node => add('no_termination', `${node.label} tem um caminho sem término garantido.`, node.id));
  return { valid: issues.length === 0, issues, graph };
}
