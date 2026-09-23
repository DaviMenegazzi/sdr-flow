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
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', desc: 'Rápido e econômico. Atende bem a maioria dos SDRs.' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', desc: 'Raciocínio mais forte para objeções e vendas de ticket alto.' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai', desc: 'Ágil para triagens e respostas curtas.' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', desc: 'Contexto amplo e alta fidelidade às regras.' },
];

export const PROMPT_VARIABLES = [
  { token: '{{lead.name}}', label: 'Nome do Lead' },
  { token: '{{lead.phone}}', label: 'Telefone' },
  { token: '{{empresa}}', label: 'Nome da Empresa' },
  { token: '{{historico}}', label: 'Histórico' },
  { token: '{{data_atual}}', label: 'Data Atual' },
];

export const TEMPERATURE_PRESETS = [
  { value: 'precise', label: 'Preciso', temperature: 0.2, description: 'Segue as instruções à risca. Bom para triagem e regras rígidas.' },
  { value: 'balanced', label: 'Equilibrado', temperature: 0.4, description: 'Natural sem improvisar. Recomendado para SDR.' },
  { value: 'creative', label: 'Criativo', temperature: 0.7, description: 'Varia mais as respostas. Bom para conversas abertas.' },
] as const;

export type TemperaturePreset = (typeof TEMPERATURE_PRESETS)[number]['value'] | 'custom';

export function presetForTemperature(value: number): TemperaturePreset {
  return TEMPERATURE_PRESETS.find(p => Math.abs(p.temperature - value) < 0.001)?.value ?? 'custom';
}

export function temperatureLabel(value: number): string {
  return TEMPERATURE_PRESETS.find(p => Math.abs(p.temperature - value) < 0.001)?.label ?? `Temperatura ${value.toFixed(2).replace('.', ',')}`;
}
