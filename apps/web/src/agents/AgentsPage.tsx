import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Bot, Plus, Search } from 'lucide-react';
import {
  Button,
  CardGridSkeleton,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  confirmDialog,
  toast,
} from '../components/ui';
import { AgentCard } from './AgentCard';
import { formFromAgent, useAgentsApi } from './api';
import type { Agent, AgentLimits, Instance } from './types';

type Filter = 'all' | 'without-key' | 'unassigned';

/** Search and filters only earn their place once the list is long enough to need them. */
const FILTERS_FROM = 6;

export function AgentsPage() {
  const api = useAgentsApi();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [limits, setLimits] = useState<AgentLimits>({ max_agents: 2, max_instances: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = async () => {
    if (!api.ready) return;
    setError(null);
    try {
      const data = await api.list();
      setAgents(data.agents);
      setInstances(data.instances);
      if (data.limits) setLimits(data.limits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar os agentes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [api]);

  const quotaMax = limits.max_agents;
  const canCreate = quotaMax === null || agents.length < quotaMax;

  const archive = async (agent: Agent) => {
    const ok = await confirmDialog({
      title: `Arquivar "${agent.name}"?`,
      description: 'Os números atendidos por este agente deixam de receber respostas dele.',
      confirmLabel: 'Arquivar agente',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.archive(agent.id);
      toast.success(`"${agent.name}" arquivado`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao arquivar o agente.');
    }
  };

  const duplicate = async (agent: Agent) => {
    try {
      const form = { ...formFromAgent(agent), id: undefined, name: `${agent.name} (cópia)`.slice(0, 80) };
      const id = await api.save(form);
      toast.success('Agente duplicado', { description: 'A chave da OpenAI não é copiada.' });
      if (id) navigate(`/agents/${id}`);
      else await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível duplicar o agente.');
    }
  };

  const showFilters = agents.length >= FILTERS_FROM;
  const visible = useMemo(() => {
    if (!showFilters) return agents;
    const q = query.trim().toLowerCase();
    return agents.filter(agent => {
      if (q && !`${agent.name} ${agent.description ?? ''} ${agent.model}`.toLowerCase().includes(q)) return false;
      if (filter === 'without-key') return !agent.hasOpenaiKey;
      if (filter === 'unassigned') return !instances.some(i => i.agent_id === agent.id);
      return true;
    });
  }, [agents, instances, query, filter, showFilters]);

  const newButton = (
    <Button
      variant="primary"
      disabled={!canCreate}
      title={canCreate ? undefined : 'Limite de agentes do plano atingido'}
      onClick={() => navigate('/agents/new')}
    >
      <Plus size={16} /> Novo agente
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Agentes de IA"
        description={
          loading ? 'Carregando…' : (
            <>
              {quotaMax === null ? `${agents.length} agentes · plano sem limite` : `${agents.length} de ${quotaMax} agentes do plano`}
              {!canCreate && <> — limite atingido. <Link to="/billing" className="text-brand-fg">Ver planos</Link></>}
            </>
          )
        }
        actions={newButton}
        toolbar={
          showFilters ? (
            <>
              <div className="w-full sm:w-64">
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar agente"
                  aria-label="Buscar agente"
                  leftIcon={<Search size={14} />}
                />
              </div>
              <SegmentedControl<Filter>
                value={filter}
                onChange={setFilter}
                aria-label="Filtrar agentes"
                options={[
                  { value: 'all', label: 'Todos' },
                  { value: 'without-key', label: 'Sem chave', count: agents.filter(a => !a.hasOpenaiKey).length },
                  { value: 'unassigned', label: 'Sem número' },
                ]}
              />
            </>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/25 bg-danger/10 p-3 text-xs text-danger">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Tentar de novo
          </Button>
        </div>
      )}

      {loading ? (
        <CardGridSkeleton />
      ) : visible.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {visible.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              assignedInstances={instances.filter(i => i.agent_id === agent.id)}
              canDuplicate={canCreate}
              onDuplicate={duplicate}
              onArchive={archive}
            />
          ))}
        </div>
      ) : agents.length > 0 ? (
        <EmptyState icon={<Search size={20} />} title="Nenhum agente encontrado" description="Ajuste a busca ou o filtro." />
      ) : (
        <EmptyState
          icon={<Bot size={20} />}
          title="Crie seu primeiro agente"
          description="O agente responde os leads que chegam nos seus números de WhatsApp, com as instruções e o modelo que você definir."
          action={canCreate ? newButton : undefined}
        />
      )}
    </PageContainer>
  );
}
