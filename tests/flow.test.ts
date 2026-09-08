import { describe,it,expect } from 'vitest';
import { catalog,createBlankFlow,createSdrTemplate,makeNode,validateGraph } from '../packages/flow/src/index.js';
import { nodeTypes, type FlowGraph } from '../packages/shared/src/index.js';

const codes = (graph: unknown) => validateGraph(graph).issues.map(issue => issue.code);
describe('Flow publication boundary',() => {
  it('accepts the starter and the structural SDR template',() => {
    expect(validateGraph(createBlankFlow())).toMatchObject({ valid: true,issues: [] });
    expect(validateGraph(createSdrTemplate())).toMatchObject({ valid: true,issues: [] });
  });
  it.each(nodeTypes)('%s has valid defaults and an object form schema',type => {
    expect(catalog[type].schema.safeParse(catalog[type].defaults).success).toBe(true);
    expect(catalog[type].jsonSchema.type).toBe('object');
  });
  it('rejects unknown node types and incompatible graph revisions',() => {
    expect(codes({ ...createBlankFlow(),schemaVersion: 2 })).toContain('schema');
    const graph = createBlankFlow(); (graph.nodes[0] as { type: string }).type = 'execute.shell';
    expect(codes(graph)).toContain('schema');
  });
  it('requires exactly one trigger and forbids incoming trigger edges',() => {
    const graph = createBlankFlow(); graph.nodes.push(makeNode('trigger.manual','second')); graph.edges.push({ id:'to-trigger',source:'end',sourcePort:'next',target:'start' });
    expect(codes(graph)).toEqual(expect.arrayContaining(['trigger_count','trigger_incoming']));
  });
  it('rejects duplicate node and edge identifiers',() => {
    const graph = createBlankFlow(); graph.nodes.push(structuredClone(graph.nodes[0]!)); graph.edges.push(structuredClone(graph.edges[0]!));
    expect(codes(graph)).toEqual(expect.arrayContaining(['duplicate_node','duplicate_edge']));
  });
  it('rejects disconnected nodes and missing targets',() => {
    const graph = createBlankFlow(); graph.nodes.push(makeNode('output.end','orphan')); graph.edges[0]!.target='missing';
    expect(codes(graph)).toEqual(expect.arrayContaining(['unreachable','dangling_edge','no_termination']));
  });
  it('requires every guard output, including the blocked branch',() => {
    const graph = createSdrTemplate(); graph.edges=graph.edges.filter(edge => edge.id !== 'test-blocked');
    expect(validateGraph(graph).issues).toContainEqual(expect.objectContaining({ code:'required_port',nodeId:'test' }));
  });
  it('forbids multiple targets on one port',() => {
    const graph = createBlankFlow(); graph.edges.push({ ...graph.edges[0]!,id:'fanout' }); expect(codes(graph)).toContain('required_port');
  });
  it('rejects unknown ports and outgoing terminal edges',() => {
    const graph = createBlankFlow(); graph.edges.push({ id:'from-end',source:'end',sourcePort:'next',target:'end' });
    expect(codes(graph)).toEqual(expect.arrayContaining(['unknown_port','cycle']));
  });
  it('rejects cycles even when an alternate branch reaches the end',() => {
    const graph = createSdrTemplate(); graph.edges.find(edge => edge.id === 'branch-reply')!.target='memory';
    expect(codes(graph)).toEqual(expect.arrayContaining(['cycle','no_termination']));
  });
  it('validates config and does not mutate the caller graph when applying defaults',() => {
    const graph = createSdrTemplate(); graph.nodes.find(node => node.id === 'buffer')!.config={ windowSeconds:-1 };
    expect(codes(graph)).toContain('config');
    graph.nodes.find(node => node.id === 'buffer')!.config={};
    expect(validateGraph(graph).graph!.nodes.find(node => node.id === 'buffer')!.config.windowSeconds).toBe(5);
    expect(graph.nodes.find(node => node.id === 'buffer')!.config).toEqual({});
  });
  it('validates switch output names and the default branch',() => {
    const graph: FlowGraph = { schemaVersion:1,nodes:[makeNode('trigger.manual','start'),makeNode('flow.switch','switch'),makeNode('output.end','end')],edges:[{id:'a',source:'start',sourcePort:'next',target:'switch'}] };
    for (const port of ['interesse','suporte','default']) graph.edges.push({id:port,source:'switch',sourcePort:port,target:'end'});
    expect(validateGraph(graph).valid).toBe(true);
    graph.nodes[1]!.config.cases=['default']; expect(codes(graph)).toContain('duplicate_port');
  });
  it('enforces both wait-for-reply outcomes',() => {
    const graph=createBlankFlow(); graph.nodes.push(makeNode('flow.wait_reply','wait')); graph.edges[0]!.target='wait'; graph.edges.push({id:'reply',source:'wait',sourcePort:'reply',target:'end'});
    expect(codes(graph)).toContain('required_port');
  });
});
