import React from 'react';
import {
  Bot,
  KeyRound,
  Edit3,
  Archive,
  Play,
  Smartphone,
  Radio,
  Zap,
  TrendingUp,
  MessageSquare,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { Badge, Button, Card } from '../components/ui';
import type { Agent, Instance } from './types';

interface AgentCardProps {
  agent: Agent;
  assignedInstances: Instance[];
  onEdit: (agent: Agent) => void;
  onArchive: (agent: Agent) => void;
  onSimulate: (agent: Agent) => void;
}

export function AgentCard({
  agent,
  assignedInstances,
  onEdit,
  onArchive,
  onSimulate,
}: AgentCardProps) {
  const isDefault = agent.is_default;
  const hasKey = agent.hasOpenaiKey;

  return (
    <Card className="group relative flex flex-col justify-between p-5 bg-surface border-border hover:border-border-strong hover:shadow-elevated transition-all duration-200">
      {/* Top Bar: Icon, Name, Badges */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand flex-shrink-0 group-hover:scale-105 transition-transform">
              <Bot className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-sm font-bold text-content truncate leading-snug">
                  {agent.name}
                </h3>
                {isDefault && (
                  <Badge variant="accent" size="sm" title="Agente padrão da organização">
                    Padrão
                  </Badge>
                )}
              </div>
              <p className="text-[11px] font-mono text-content-muted mt-0.5 truncate">
                {agent.provider} / {agent.model}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge
              variant={hasKey ? 'success' : 'danger'}
              size="sm"
              title={
                hasKey
                  ? 'Chave de API configurada e pronta para responder'
                  : 'Sem chave própria configurada. O agente não responderá mensagens até configurá-la.'
              }
            >
              <KeyRound className="w-3 h-3" />
              {hasKey ? 'Chave OK' : 'Sem chave'}
            </Badge>
          </div>
        </div>

        {/* Instâncias WhatsApp Vinculadas */}
        <div className="mb-3.5 pt-2.5 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-[11px] text-content-secondary mb-1">
            <Smartphone className="w-3.5 h-3.5 text-content-muted" />
            <span className="font-medium">Instâncias WhatsApp:</span>
          </div>
          {assignedInstances.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {assignedInstances.map((inst) => (
                <span
                  key={inst.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-surface-elevated border border-border text-content"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      inst.status === 'connected'
                        ? 'bg-[#2ee86b] animate-pulse'
                        : 'bg-amber-400'
                    }`}
                  />
                  {inst.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-content-muted italic">
              Nenhuma instância conectada a este agente
            </span>
          )}
        </div>

        {/* Prompt Preview */}
        {agent.system_prompt ? (
          <div className="p-2.5 rounded-lg bg-surface-elevated/40 border border-border/40 mb-4">
            <p className="text-[11px] text-content-muted line-clamp-2 leading-relaxed italic">
              "{agent.system_prompt}"
            </p>
          </div>
        ) : (
          <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15 mb-4 text-[11px] text-amber-300/80 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Sem instruções de prompt definidas.</span>
          </div>
        )}

        {/* Telemetry row */}
        <div className="grid grid-cols-3 gap-2 py-2.5 px-3 rounded-lg bg-surface-elevated/60 border border-border/40 text-center mb-4">
          <div>
            <span className="block text-[10px] uppercase font-bold text-content-muted tracking-wider">
              Conversas
            </span>
            <strong className="text-xs font-semibold text-content mt-0.5 block">
              Ativo
            </strong>
          </div>
          <div className="border-x border-border/40 px-1">
            <span className="block text-[10px] uppercase font-bold text-content-muted tracking-wider">
              Qualificação
            </span>
            <strong className="text-xs font-semibold text-[#2ee86b] mt-0.5 block">
              IA Ativa
            </strong>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold text-content-muted tracking-wider">
              Latência
            </span>
            <strong className="text-xs font-semibold text-content mt-0.5 block">
              ~850ms
            </strong>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-3 border-t border-border/60">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(agent)}
          className="flex-1 text-xs"
        >
          <Edit3 className="w-3.5 h-3.5" /> Configurar
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSimulate(agent)}
          className="text-xs"
          title="Simular resposta deste agente"
        >
          <Play className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={isDefault}
          onClick={() => onArchive(agent)}
          title={
            isDefault
              ? 'O agente padrão não pode ser arquivado'
              : 'Arquivar este agente'
          }
        >
          <Archive className="w-3.5 h-3.5" />
        </Button>
      </div>
    </Card>
  );
}
