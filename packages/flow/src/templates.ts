import type { FlowGraph, NodeType } from '@sdr/shared';
import { catalog } from './catalog.js';

export function makeNode(type: NodeType, id: string, x = 0, y = 0) {
  return { id, type, label: catalog[type].label, position: { x, y }, config: structuredClone(catalog[type].defaults) };
}
export function createBlankFlow(): FlowGraph {
  return { schemaVersion: 1, nodes: [makeNode('trigger.message_received', 'start', 80, 160), makeNode('output.end', 'end', 440, 160)], edges: [{ id: 'start-end', source: 'start', sourcePort: 'next', target: 'end' }] };
}
// Structural translation of the SDR orchestrator. Execution adapters are a later milestone.
export function createSdrTemplate(): FlowGraph {
  const pipeline: Array<[string, NodeType]> = [
    ['start', 'trigger.message_received'], ['test', 'guard.test_mode'], ['chat', 'guard.chat_type'],
    ['human', 'guard.human_takeover'], ['phone', 'input.normalize'], ['buffer', 'input.buffer'],
    ['media', 'input.media'], ['memory', 'context.memory'], ['decide', 'agent.decide'],
    ['lead', 'action.update_lead'], ['stage', 'action.update_stage'], ['crm', 'action.crm_sync'], ['branch', 'flow.condition'],
  ];
  const nodes = pipeline.map(([id,type], index) => makeNode(type, id, index * 300, 180));
  nodes.push(makeNode('action.handoff', 'handoff', 3900, 60), makeNode('output.send_text', 'reply', 4200, 180), makeNode('output.end', 'end', 4500, 180), makeNode('output.end', 'blocked', 900, 520));
  const edges: FlowGraph['edges'] = pipeline.slice(0, -1).map(([id,type], index) => ({ id: `${id}-next`, source: id, sourcePort: type.startsWith('guard.') ? 'pass' : 'next', target: pipeline[index + 1]![0] }));
  for (const id of ['test','chat','human']) edges.push({ id: `${id}-blocked`, source: id, sourcePort: 'blocked', target: 'blocked' });
  edges.push(
    { id: 'branch-handoff', source: 'branch', sourcePort: 'true', target: 'handoff' },
    { id: 'branch-reply', source: 'branch', sourcePort: 'false', target: 'reply' },
    { id: 'handoff-reply', source: 'handoff', sourcePort: 'next', target: 'reply' },
    { id: 'reply-end', source: 'reply', sourcePort: 'next', target: 'end' },
  );
  return { schemaVersion: 1, nodes, edges };
}
