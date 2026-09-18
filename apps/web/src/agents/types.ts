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
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', desc: 'Rápido, econômico e excelente para SDRs' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', desc: 'Alta inteligência para vendas complexas' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', desc: 'Excelente tom humano e interpretação' },
  { id: 'claude-3-haiku', name: 'Claude 3 Haiku', provider: 'anthropic', desc: 'Ultrarrápido para triagem' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', provider: 'groq', desc: 'Latência sub-segundo via Groq' },
];

export const PROMPT_VARIABLES = [
  { token: '{{lead.name}}', label: 'Nome do Lead' },
  { token: '{{lead.phone}}', label: 'Telefone' },
  { token: '{{empresa}}', label: 'Nome da Empresa' },
  { token: '{{historico}}', label: 'Histórico' },
  { token: '{{data_atual}}', label: 'Data Atual' },
];
