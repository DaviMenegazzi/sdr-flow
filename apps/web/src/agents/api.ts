import { useMemo } from 'react';
import { useSession } from '../session';
import type { Agent, AgentFormData, AgentLimits, Instance } from './types';

async function failure(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error || fallback);
}

export function agentPayload(form: AgentFormData) {
  return {
    name: form.name,
    description: form.description,
    provider: form.provider,
    model: form.model,
    systemPrompt: form.system_prompt,
    toolPolicy: { rag: form.ragEnabled, calendar: form.calendarEnabled, handoff: form.handoffEnabled },
    modelConfig: { temperature: form.temperature },
  };
}

export function formFromAgent(agent: Agent): AgentFormData {
  const cfg = agent.model_config as { temperature?: unknown } | undefined;
  const tools = agent.tool_policy as { rag?: unknown; calendar?: unknown; handoff?: unknown } | undefined;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || '',
    provider: agent.provider || 'openai',
    model: agent.model || 'gpt-4o-mini',
    system_prompt: agent.system_prompt || '',
    temperature: typeof cfg?.temperature === 'number' ? cfg.temperature : 0.4,
    ragEnabled: tools?.rag !== false,
    calendarEnabled: Boolean(tools?.calendar),
    handoffEnabled: tools?.handoff !== false,
    assignedInstanceId: null,
  };
}

/** The agents endpoints, with the session headers applied. */
export function useAgentsApi() {
  const { session, activeOrg } = useSession();
  const token = session?.access_token;

  return useMemo(() => {
    const headers: Record<string, string> | undefined = token
      ? { Authorization: `Bearer ${token}`, ...(activeOrg ? { 'X-Organization-Id': activeOrg } : {}) }
      : undefined;
    const json = headers ? { ...headers, 'Content-Type': 'application/json' } : undefined;

    return {
      ready: Boolean(headers),
      async list(): Promise<{ agents: Agent[]; limits: AgentLimits | null; instances: Instance[] }> {
        const [agentsRes, instancesRes] = await Promise.all([
          fetch('/api/me/agents', { headers }),
          fetch('/api/me/instances', { headers }),
        ]);
        if (!agentsRes.ok) await failure(agentsRes, 'Falha ao carregar a lista de agentes.');
        const data = await agentsRes.json();
        const instances = instancesRes.ok ? await instancesRes.json() : [];
        return { agents: data.agents || [], limits: data.limits ?? null, instances: Array.isArray(instances) ? instances : [] };
      },
      async save(form: AgentFormData): Promise<string | null> {
        const res = await fetch(form.id ? `/api/me/agents/${form.id}` : '/api/me/agents', {
          method: form.id ? 'PATCH' : 'POST',
          headers: json,
          body: JSON.stringify(agentPayload(form)),
        });
        if (!res.ok) await failure(res, 'Não foi possível salvar o agente.');
        const data = await res.json().catch(() => null);
        if (typeof data === 'string') return data;
        return (data as { id?: string } | null)?.id ?? form.id ?? null;
      },
      async saveKey(agentId: string, apiKey: string) {
        const res = await fetch(`/api/me/agents/${agentId}/openai-key`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ apiKey }),
        });
        if (!res.ok) await failure(res, 'Falha ao registrar a chave da OpenAI.');
      },
      async assignInstance(instanceId: string, agentId: string) {
        const res = await fetch(`/api/me/instances/${instanceId}/assign-agent`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ agentId }),
        });
        if (!res.ok) await failure(res, 'Falha ao vincular o agente à instância.');
      },
      async archive(agentId: string) {
        const res = await fetch(`/api/me/agents/${agentId}`, { method: 'DELETE', headers });
        if (!res.ok) await failure(res, 'Falha ao arquivar o agente.');
      },
    };
  }, [token, activeOrg]);
}
