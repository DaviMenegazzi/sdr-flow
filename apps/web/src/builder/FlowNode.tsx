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

  const categoryColor = categoryColors[definition.category] || '#2ee86b';
  const isTrigger = node.type.startsWith('trigger.');
  const isEnd = node.type === 'output.end';

  return (
    <div
      className={`flow-node-card relative w-[244px] bg-surface rounded-2xl border transition-all duration-150 select-none shadow-elevated ${
        selected
          ? 'border-[#2ee86b] ring-1 ring-[#2ee86b]/40 shadow-[0_0_24px_-4px_rgba(46,232,107,0.35)]'
          : invalid
          ? 'border-danger ring-1 ring-danger/30'
          : liveError
          ? 'border-danger ring-2 ring-danger/40 animate-pulse'
          : 'border-border hover:border-border-strong hover:shadow-[0_8px_24px_rgba(0,0,0,0.28)]'
      }`}
      style={{ '--node-color': categoryColor } as React.CSSProperties}
      title={liveError ? `Falha na execução: ${liveError}` : undefined}
    >
      {/* Top Accent Line */}
      <div
        className="h-1 w-full rounded-t-xl"
        style={{
          background: selected
            ? 'linear-gradient(90deg, #2ee86b, #10b981)'
            : categoryColor,
        }}
      />

      {/* Runtime Error Badge */}
      {liveError && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white flex items-center justify-center shadow-md z-10 animate-bounce">
          <AlertTriangle size={11} />
        </div>
      )}

      {/* Target Handle (Left Input) */}
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          className="!w-3 !h-3 !-left-1.5 !bg-brand !border-2 !border-surface !rounded-full transition-transform hover:!scale-125 shadow-[0_0_8px_rgba(46,232,107,0.6)] cursor-crosshair"
          title="Entrada do nó"
        />
      )}

      {/* Node Content */}
      <div className="flow-node-content p-3.5 space-y-2.5">
        {/* Header Tag + Status Badge */}
        <div className="flex items-center justify-between">
          <div
            className="flow-node-category inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-2xs font-semibold tracking-wide"
            style={{
              backgroundColor: `${categoryColor}18`,
              color: categoryColor,
            }}
          >
            <Icon size={12} />
            <span>{categories[definition.category]}</span>
          </div>

          {isTrigger && (
            <span className="inline-flex items-center gap-1 text-2xs font-semibold text-[#2ee86b] bg-[#2ee86b]/10 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2ee86b] animate-pulse" />
              Início
            </span>
          )}

          {isEnd && (
            <span className="text-2xs font-semibold text-content-muted bg-surface-elevated px-1.5 py-0.5 rounded">
              Fim
            </span>
          )}
        </div>

        {/* Node Labels */}
        <div>
          <strong className="flow-node-title block text-sm font-semibold text-content-primary tracking-tight line-clamp-2 leading-snug">
            {node.label}
          </strong>
          {node.label.trim().toLowerCase() !== definition.label.trim().toLowerCase() && (
            <p className="text-2xs text-content-secondary line-clamp-1 mt-0.5">
              {definition.label}
            </p>
          )}
        </div>

        {/* Output Ports with Aligned Handles */}
        {ports.length > 0 && (
          <div className="pt-2 border-t border-border/70 space-y-1">
            {ports.map((port) => (
              <div
                key={port}
                  className="flow-node-port relative flex items-center justify-between pl-2 pr-1.5 py-1 rounded-lg bg-surface-elevated border border-border/60 text-2xs font-medium text-content-secondary group hover:border-brand/40 hover:text-content-primary transition-colors"
              >
                <span className="truncate pr-1">
                  {port === 'next'
                    ? 'Próximo passo'
                    : port === 'pass'
                    ? 'Permitido'
                    : port === 'blocked'
                    ? 'Bloqueado'
                    : port === 'true'
                    ? 'Verdadeiro'
                    : port === 'false'
                    ? 'Falso'
                    : port}
                </span>
                <span className="flex items-center gap-1 text-content-muted group-hover:text-[#2ee86b] transition-colors text-2xs font-mono">
                  {port}
                  <ArrowRight size={10} />
                </span>
                <Handle
                  id={port}
                  type="source"
                  position={Position.Right}
                  className="!w-2.5 !h-2.5 !-right-2.5 !bg-brand !border-2 !border-surface !rounded-full transition-transform hover:!scale-125 shadow-[0_0_8px_rgba(46,232,107,0.6)] cursor-crosshair"
                  title={`Saída: ${port}`}
                />
              </div>
            ))}
          </div>
        )}

        {/* Live Error Banner */}
        {liveError && (
          <div className="mt-2 pt-2 border-t border-danger/20 text-2xs text-danger font-medium break-words leading-tight bg-danger-bg p-1.5 rounded">
            {liveError}
          </div>
        )}
      </div>
    </div>
  );
});

FlowNode.displayName = 'FlowNode';
