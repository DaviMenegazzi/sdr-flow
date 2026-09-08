import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps, type Node } from '@xyflow/react';
import { catalog, categoryColors, categories, portsFor } from '@sdr/flow';
import type { FlowNode as DomainNode } from '@sdr/shared';
import { ArrowRight, Bot, MessageCircle, ShieldCheck, CircleStop, Workflow } from 'lucide-react';

export type CanvasNode = Node<{ node: DomainNode; invalid: boolean },'flowNode'>;
export const FlowNode = memo(({ data, selected }: NodeProps<CanvasNode>) => {
  const { node, invalid } = data; const definition = catalog[node.type]; const ports = portsFor(node.type,node.config);
  const updateInternals = useUpdateNodeInternals();
  const portSignature = ports.join('|');
  useEffect(() => { updateInternals(node.id); },[node.id,portSignature,updateInternals]);
  const Icon = node.type === 'output.end' ? CircleStop : definition.category === 'trigger' ? MessageCircle : definition.category === 'agent' ? Bot : definition.category === 'guard' ? ShieldCheck : Workflow;
  return <div className={`flow-node ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''}`} style={{ '--node-color': categoryColors[definition.category] } as React.CSSProperties}>
    {!node.type.startsWith('trigger.') && <Handle type="target" position={Position.Left} id="input"/>}
    <div className="node-category"><Icon size={15}/>{categories[definition.category]}</div>
    <strong>{node.label}</strong>
    <p>{definition.label}</p>
    {ports.length > 0 && <div className="node-ports">{ports.map(port => <span key={port}>{port}<ArrowRight size={10}/></span>)}</div>}
    {ports.map((port,index) => <Handle key={`${port}-${index}`} id={port} type="source" position={Position.Right} style={{ top: `${((index+1)/(ports.length+1))*100}%` }} title={port}/>)}
  </div>;
});
