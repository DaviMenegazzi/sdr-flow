import React, { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps, type Node } from '@xyflow/react';
import { catalog, categoryColors, categories, portsFor } from '@sdr/flow';
import type { FlowNode as DomainNode } from '@sdr/shared';
import {
  ArrowRight,
  Bot,
  MessageCircle,
  ShieldCheck,
  CircleStop,
  Workflow,
  Calendar,
  Database,
  AlertTriangle,
} from 'lucide-react';

export type CanvasNode = Node<{ node: DomainNode; invalid: boolean; liveError?: string }, 'flowNode'>;

export const FlowNode = memo(({ data, selected }: NodeProps<CanvasNode>) => {
  const { node, invalid, liveError } = data;
  const definition = catalog[node.type];
  const ports = portsFor(node.type, node.config);
  const updateInternals = useUpdateNodeInternals();
  const portSignature = ports.join('|');

  useEffect(() => {
    updateInternals(node.id);
  }, [node.id, portSignature, updateInternals]);

  const Icon =
    node.type === 'output.end'
      ? CircleStop
      : definition.category === 'calendar' || node.type === 'integration.google_calendar'
      ? Calendar
      : node.type === 'context.storage'
      ? Database
      : definition.category === 'trigger'
      ? MessageCircle
      : definition.category === 'agent'
      ? Bot
      : definition.category === 'guard'
      ? ShieldCheck
      : definition.category === 'integration'
      ? Calendar
      : Workflow;

  const categoryColor = categoryColors[definition.category] || 'var(--accent-primary)';

  return (
    <div
      className={`relative w-[260px] bg-surface rounded-xl border transition-all duration-150 select-none shadow-subtle ${
        selected
          ? 'border-brand ring-2 ring-brand/30 shadow-elevated'
          : invalid
          ? 'border-danger ring-2 ring-danger/20'
          : liveError
          ? 'border-danger ring-2 ring-danger/30 animate-pulse'
          : 'border-border hover:border-border-strong hover:shadow-subtle'
      }`}
      style={{ '--node-color': categoryColor } as React.CSSProperties}
      title={liveError ? `Falha na última execução real: ${liveError}` : undefined}
    >
      {/* Top Category Accent Line */}
      <div
        className="h-1 w-full rounded-t-xl"
        style={{ backgroundColor: categoryColor }}
      />

      {/* Runtime Error Badge */}
      {liveError && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow-sm z-10 animate-bounce">
          <AlertTriangle size={11} />
        </div>
      )}

      {/* Target Handle (Left Input) */}
      {!node.type.startsWith('trigger.') && (
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          className="!w-3 !h-3 !-left-1.5 !bg-brand !border-2 !border-surface !rounded-full transition-transform hover:!scale-125"
        />
      )}

      {/* Node Body */}
      <div className="p-3.5 space-y-2">
        {/* Category Header Tag */}
        <div className="flex items-center justify-between">
          <div
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide"
            style={{
              backgroundColor: `${categoryColor}18`,
              color: categoryColor,
            }}
          >
            <Icon size={12} />
            <span>{categories[definition.category]}</span>
          </div>
          <span className="text-[9px] font-mono text-content-muted">#{node.id.slice(0, 5)}</span>
        </div>

        {/* Node Labels */}
        <div>
          <strong className="block text-xs font-semibold text-content-primary tracking-tight truncate">
            {node.label}
          </strong>
          <p className="text-[11px] text-content-secondary line-clamp-1 mt-0.5">
            {definition.label}
          </p>
        </div>

        {/* Ports / Output Handles */}
        {ports.length > 0 && (
          <div className="pt-2 border-t border-border/60 flex flex-wrap gap-1.5 justify-end">
            {ports.map((port) => (
              <span
                key={port}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-content-secondary bg-surface-elevated px-2 py-0.5 rounded"
              >
                {port}
                <ArrowRight size={10} className="text-content-muted" />
              </span>
            ))}
          </div>
        )}

        {/* Live Error Banner */}
        {liveError && (
          <div className="mt-2 pt-2 border-t border-danger/20 text-[10px] text-danger font-medium break-words leading-tight bg-danger-bg p-1.5 rounded">
            {liveError}
          </div>
        )}
      </div>

      {/* Source Handles (Right Outputs) */}
      {ports.map((port, index) => (
        <Handle
          key={`${port}-${index}`}
          id={port}
          type="source"
          position={Position.Right}
          style={{ top: `${((index + 1) / (ports.length + 1)) * 100}%` }}
          className="!w-3 !h-3 !-right-1.5 !bg-brand !border-2 !border-surface !rounded-full transition-transform hover:!scale-125"
          title={port}
        />
      ))}
    </div>
  );
});

FlowNode.displayName = 'FlowNode';
