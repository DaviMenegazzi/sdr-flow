import React, { useEffect, useState, useMemo } from 'react';
import {
  Bot,
  Plus,
  Search,
  AlertCircle,
  Smartphone,
  Sparkles,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { useSession } from '../session';
import { Button, Card, Badge, CardGridSkeleton } from '../components/ui';
import { AgentCard } from './AgentCard';
import { AgentDrawer } from './AgentDrawer';
import { AgentPlaygroundModal } from './AgentPlaygroundModal';
import type { Agent, Instance, AgentLimits, AgentFormData } from './types';

export function AgentsPage() {
  const { session, activeOrg } = useSession();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [limits, setLimits] = useState<AgentLimits>({ max_agents: 2, max_instances: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Drawer & Modal states
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [simulatingAgent, setSimulatingAgent] = useState<Agent | null>(null);

  const headers: Record<string, string> | undefined = session
    ? {
        Authorization: `Bearer ${session.access_token}`,
        ...(activeOrg ? { 'X-Organization-Id': activeOrg } : {}),
      }
    : undefined;

  const loadData = async () => {
    if (!headers) return;
    setError(null);
    try {
      const [agentsRes, instancesRes] = await Promise.all([
        fetch('/api/me/agents', { headers }),
        fetch('/api/me/instances', { headers }),
      ]);

      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents(data.agents || []);
        if (data.limits) setLimits(data.limits);
      } else {
        throw new Error('Falha ao carregar lista de agentes.');
      }

      if (instancesRes.ok) {
        const data = await instancesRes.json();
        setInstances(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [session?.access_token, activeOrg]);

  const showNotification = (msg: string) => {
    setSuccessNotice(msg);
    setTimeout(() => setSuccessNotice(null), 4000);
  };

  const handleSaveAgent = async (formData: AgentFormData) => {
    if (!headers) return;
    const isEdit = Boolean(formData.id);
    const url = isEdit ? `/api/me/agents/${formData.id}` : '/api/me/agents';
    const method = isEdit ? 'PATCH' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.name,
        description: formData.description,
        provider: formData.provider,
        model: formData.model,
        systemPrompt: formData.system_prompt,
        toolPolicy: {
          rag: formData.ragEnabled,
          calendar: formData.calendarEnabled,
          handoff: formData.handoffEnabled,
        },
        modelConfig: {
          temperature: formData.temperature,
        },
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Não foi possível salvar o agente.');
    }

    showNotification(isEdit ? 'Agente atualizado com sucesso!' : 'Novo agente criado com sucesso!');
    await loadData();
  };

  const handleSaveKey = async (agentId: string, apiKey: string): Promise<boolean> => {
    if (!headers) return false;
    const res = await fetch(`/api/me/agents/${agentId}/openai-key`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Falha ao registrar chave da OpenAI.');
    }
    showNotification('Chave de API salva com sucesso!');
    await loadData();
    return true;
  };

  const handleAssignInstance = async (instanceId: string, agentId: string) => {
    if (!headers) return;
    const res = await fetch(`/api/me/instances/${instanceId}/assign-agent`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Falha ao vincular agente à instância.');
    }
    await loadData();
  };

  const handleArchiveAgent = async (agent: Agent) => {
    if (!headers) return;
    if (!window.confirm(`Deseja arquivar o agente "${agent.name}"?`)) return;

    try {
      const res = await fetch(`/api/me/agents/${agent.id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Falha ao arquivar agente.');
      }
      showNotification(`Agente "${agent.name}" arquivado.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao arquivar agente.');
    }
  };

  // Filtered list
  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      const matchesSearch =
        agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (agent.system_prompt && agent.system_prompt.toLowerCase().includes(searchQuery.toLowerCase()));

      let matchesStatus = true;
      if (selectedStatus === 'with-key') {
        matchesStatus = agent.hasOpenaiKey;
      } else if (selectedStatus === 'without-key') {
        matchesStatus = !agent.hasOpenaiKey;
      } else if (selectedStatus === 'assigned') {
        matchesStatus = instances.some((i) => i.agent_id === agent.id);
      }

      return matchesSearch && matchesStatus;
    });
  }, [agents, instances, searchQuery, selectedStatus]);

  const quotaUsed = agents.length;
  const quotaMax = limits.max_agents || 2;
  const canCreate = quotaUsed < quotaMax;

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 bg-canvas text-content">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header Superior */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand mb-1">
              <Bot className="w-3.5 h-3.5" /> AGENTES DE ATENDIMENTO & MODELOS
            </div>
            <h1 className="text-2xl font-bold text-content tracking-tight">
              Agentes de IA
            </h1>
            <p className="text-sm text-content-secondary max-w-2xl mt-1">
              Configure personalidades, diretrizes de qualificação e modelos para atender leads em cada canal de WhatsApp.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              disabled={!canCreate}
              onClick={() => {
                setEditingAgent(null);
                setDrawerOpen(true);
              }}
              title={
                canCreate
                  ? 'Criar um novo agente de atendimento'
                  : 'Limite do plano atingido. Faça upgrade para adicionar mais agentes.'
              }
            >
              <Plus className="w-4 h-4" />
              <span>Novo Agente</span>
            </Button>
          </div>
        </div>

        {/* Notificação de Sucesso */}
        {successNotice && (
          <div className="p-3.5 rounded-xl bg-[#2ee86b]/10 border border-[#2ee86b]/30 text-[#2ee86b] text-xs flex items-center gap-2 animate-in fade-in duration-150">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* Alerta de Erro */}
        {error && (
          <div className="p-3.5 rounded-xl bg-danger/10 border border-danger/25 text-danger text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Barra de Filtros & Quota */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-surface border border-border">
          {/* Busca & Filtros */}
          <div className="flex items-center gap-2 flex-1 max-w-lg">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nome, modelo ou instrução..."
                className="w-full bg-surface-elevated text-content text-xs pl-9 pr-3 py-1.5 rounded-lg border border-border outline-none focus:ring-1 focus:ring-brand focus:border-brand"
              />
            </div>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-auto shrink-0 text-xs bg-surface-elevated text-content border border-border rounded-lg py-1.5 px-2.5 outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="all">Todos os status</option>
              <option value="with-key">Chave OK (Ativos)</option>
              <option value="without-key">Sem Chave (Pendente)</option>
              <option value="assigned">Vinculados ao WhatsApp</option>
            </select>
          </div>

          {/* Quota Counter */}
          <div className="flex items-center gap-2 text-xs text-content-secondary px-1">
            <span>Slots de Agente:</span>
            <div className="flex items-center gap-1.5 font-semibold text-content">
              <span className="font-mono text-brand">{quotaUsed}</span>
              <span className="text-content-muted">/</span>
              <span className="font-mono">{quotaMax}</span>
            </div>
            <div className="w-20 h-1.5 bg-surface-elevated rounded-full overflow-hidden ml-1 border border-border">
              <div
                className="h-full bg-brand transition-all duration-300"
                style={{ width: `${Math.min(100, (quotaUsed / quotaMax) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Loading Skeletons */}
        {loading ? (
          <CardGridSkeleton />
        ) : filteredAgents.length > 0 ? (
          /* Grid de Agentes Modernizado */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAgents.map((agent) => {
              const assigned = instances.filter((i) => i.agent_id === agent.id);
              return (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  assignedInstances={assigned}
                  onEdit={(a) => {
                    setEditingAgent(a);
                    setDrawerOpen(true);
                  }}
                  onArchive={handleArchiveAgent}
                  onSimulate={(a) => setSimulatingAgent(a)}
                />
              );
            })}
          </div>
        ) : (
          /* Empty State */
          <Card className="p-12 text-center bg-surface border-border flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand mb-3">
              <Bot className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-content mb-1">
              Nenhum agente encontrado
            </h3>
            <p className="text-xs text-content-secondary max-w-sm mb-4">
              {searchQuery || selectedStatus !== 'all'
                ? 'Nenhum agente corresponde aos filtros de busca aplicados.'
                : 'Crie seu primeiro agente de IA para conectar à sua instância de WhatsApp e automatizar o atendimento.'}
            </p>
            {canCreate && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditingAgent(null);
                  setDrawerOpen(true);
                }}
              >
                <Plus className="w-4 h-4" /> Criar Primeiro Agente
              </Button>
            )}
          </Card>
        )}
      </div>

      {/* Slide-over Drawer para Configuração de Agentes */}
      <AgentDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        agent={editingAgent}
        instances={instances}
        onSave={handleSaveAgent}
        onSaveKey={handleSaveKey}
        onAssignInstance={handleAssignInstance}
      />

      {/* Modal de Simulação & Playground */}
      <AgentPlaygroundModal
        isOpen={Boolean(simulatingAgent)}
        onClose={() => setSimulatingAgent(null)}
        agent={simulatingAgent}
      />
    </div>
  );
}
