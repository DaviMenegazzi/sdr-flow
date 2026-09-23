import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Archive, Bot, Copy, MoreHorizontal, Settings2 } from 'lucide-react';
import { DropdownMenu, IconButton, type MenuItem } from '../components/ui';
import { formatPhone } from '../lib/format';
import { POPULAR_MODELS, temperatureLabel, type Agent, type Instance } from './types';

interface AgentCardProps {
  agent: Agent;
  assignedInstances: Instance[];
  canDuplicate: boolean;
  onDuplicate: (agent: Agent) => void;
  onArchive: (agent: Agent) => void;
}

/** The whole card opens the agent; occasional actions live in ⋯; only the exception (no key) gets a badge. */
export function AgentCard({ agent, assignedInstances, canDuplicate, onDuplicate, onArchive }: AgentCardProps) {
  const navigate = useNavigate();
  const href = `/agents/${agent.id}`;
  const modelName = POPULAR_MODELS.find(m => m.id === agent.model)?.name ?? agent.model;
  const temperature = (agent.model_config as { temperature?: unknown } | undefined)?.temperature;

  const menu: MenuItem[] = [
    { label: 'Abrir configurações', icon: <Settings2 size={14} />, onSelect: () => navigate(href) },
    {
      label: 'Duplicar',
      icon: <Copy size={14} />,
      disabled: !canDuplicate,
      hint: canDuplicate ? undefined : 'Limite de agentes do plano atingido',
      onSelect: () => onDuplicate(agent),
    },
    { type: 'separator' },
    {
      label: 'Arquivar…',
      icon: <Archive size={14} />,
      danger: true,
      disabled: agent.is_default,
      hint: agent.is_default ? 'O agente padrão não pode ser arquivado' : undefined,
      onSelect: () => onArchive(agent),
    },
  ];

  return (
    <article className="group relative flex flex-col rounded-xl border border-border bg-surface p-4 transition-[border-color,box-shadow] duration-200 ease-out hover:border-border-strong hover:shadow-elevated focus-within:border-border-strong">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-brand/20 bg-brand/10 text-brand-fg">
          <Bot size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {/* Stretched link: the whole card is the target, the ⋯ stays clickable above it. */}
            <Link
              to={href}
              className="truncate text-sm font-semibold text-content no-underline outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-brand/40"
            >
              {agent.name}
            </Link>
            {agent.is_default && (
              <span className="flex-shrink-0 rounded-full border border-border px-1.5 text-2xs font-medium text-content-secondary">
                Padrão
              </span>
            )}
          </div>
          <p className="m-0 mt-0.5 truncate text-2xs text-content-muted">
            {modelName}
            {typeof temperature === 'number' && ` · ${temperatureLabel(temperature)}`}
          </p>
        </div>
        <div className="relative z-10">
          <DropdownMenu
            aria-label={`Ações de ${agent.name}`}
            items={menu}
            trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} size="sm" tooltip={false} />}
          />
        </div>
      </div>

      {agent.description && <p className="m-0 mt-3 line-clamp-2 text-xs text-content-secondary">{agent.description}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {assignedInstances.length > 0 ? (
          assignedInstances.map(inst => (
            <span
              key={inst.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-2 py-0.5 text-2xs text-content"
              title={inst.phone ? formatPhone(inst.phone) : undefined}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${inst.status === 'connected' ? 'bg-brand' : 'bg-warning'}`} />
              {inst.name}
            </span>
          ))
        ) : (
          <span className="text-2xs text-content-muted">Nenhum número atendido</span>
        )}
      </div>

      {!agent.hasOpenaiKey && (
        <div className="relative z-10 mt-3 flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/10 px-2.5 py-1.5 text-2xs text-content">
          <AlertTriangle size={13} className="flex-shrink-0 text-warning" />
          <span className="min-w-0 flex-1">Sem chave da OpenAI — o agente não responde</span>
          <Link to={`${href}?section=key`} className="flex-shrink-0 font-semibold text-content underline-offset-2 hover:underline">
            Adicionar
          </Link>
        </div>
      )}
    </article>
  );
}
