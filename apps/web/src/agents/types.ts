export interface Agent {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  system_prompt: string;
  tool_policy: Record<string, unknown>;
  model_config: Record<string, unknown>;
  is_default: boolean;
  hasOpenaiKey: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Instance {
  id: string;
  name: string;
  provider?: string;
  status: string;
  phone?: string | null;
  agent_id: string | null;
  created_at?: string;
}

export interface AgentLimits {
  max_agents: number;
  max_instances: number | null;
}

export interface AgentFormData {
  id?: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  system_prompt: string;
  temperature: number;
  ragEnabled: boolean;
  calendarEnabled: boolean;
  handoffEnabled: boolean;
  assignedInstanceId: string | null;
}

export const POPULAR_MODELS = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', desc: 'Padrão recomendado: ultra-rápido, econômico e altamente preciso para SDRs' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', desc: 'Raciocínio avançado para objeções comerciais e vendas de ticket alto' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai', desc: 'Modelo ágil para fluxos e triagens rápidas' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', desc: 'Janela de contexto ampla e alta fidelidade a regras' },
];

export const PROMPT_VARIABLES = [
  { token: '{{lead.name}}', label: 'Nome do Lead' },
  { token: '{{lead.phone}}', label: 'Telefone' },
  { token: '{{empresa}}', label: 'Nome da Empresa' },
  { token: '{{historico}}', label: 'Histórico' },
  { token: '{{data_atual}}', label: 'Data Atual' },
];
