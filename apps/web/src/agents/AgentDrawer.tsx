import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  Sliders,
  Sparkles,
  KeyRound,
  FileCode,
  Check,
  Eye,
  EyeOff,
  BookOpen,
  Calendar,
  UserCheck,
  Smartphone,
  Info,
} from 'lucide-react';
import { Drawer, Button, Input, Badge } from '../components/ui';
import {
  type Agent,
  type Instance,
  type AgentFormData,
  POPULAR_MODELS,
  PROMPT_VARIABLES,
} from './types';

interface AgentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  agent: Agent | null; // null means creating a new agent
  instances: Instance[];
  onSave: (data: AgentFormData) => Promise<void>;
  onSaveKey: (agentId: string, apiKey: string) => Promise<boolean>;
  onAssignInstance: (instanceId: string, agentId: string) => Promise<void>;
}

export function AgentDrawer({
  isOpen,
  onClose,
  agent,
  instances,
  onSave,
  onSaveKey,
  onAssignInstance,
}: AgentDrawerProps) {
  const [activeTab, setActiveTab] = useState<'model' | 'prompt' | 'tools' | 'key'>('model');

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [ragEnabled, setRagEnabled] = useState(true);
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [handoffEnabled, setHandoffEnabled] = useState(true);
  const [assignedInstanceId, setAssignedInstanceId] = useState<string | null>(null);

  // Key state
  const [openaiKey, setOpenaiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keySavedMessage, setKeySavedMessage] = useState(false);

  // Saving state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setDescription(agent.description || '');
      setProvider(agent.provider || 'openai');
      setModel(agent.model || 'gpt-4o-mini');
      setSystemPrompt(agent.system_prompt || '');
      const cfg = agent.model_config as Record<string, any> | undefined;
      setTemperature(typeof cfg?.temperature === 'number' ? cfg.temperature : 0.7);

      const tools = agent.tool_policy as Record<string, any> | undefined;
      setRagEnabled(tools?.rag !== false);
      setCalendarEnabled(Boolean(tools?.calendar));
      setHandoffEnabled(tools?.handoff !== false);

      const currentAssigned = instances.find((i) => i.agent_id === agent.id);
      setAssignedInstanceId(currentAssigned?.id || null);
    } else {
      setName('');
      setDescription('');
      setProvider('openai');
      setModel('gpt-4o-mini');
      setSystemPrompt(
        'Você é um assistente SDR de vendas especializado e cordial. Seu objetivo é compreender as necessidades do cliente, tirar dúvidas e qualificar o contato para agendamento de uma demonstração.'
      );
      setTemperature(0.7);
      setRagEnabled(true);
      setCalendarEnabled(false);
      setHandoffEnabled(true);
      setAssignedInstanceId(null);
    }
    setOpenaiKey('');
    setKeySavedMessage(false);
    setError('');
    setActiveTab('model');
  }, [agent, isOpen, instances]);

  const insertVariable = (token: string) => {
    const textarea = promptTextareaRef.current;
    if (!textarea) {
      setSystemPrompt((prev) => `${prev} ${token}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = systemPrompt.substring(0, start) + token + systemPrompt.substring(end);
    setSystemPrompt(next);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    }, 50);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('O nome do agente é obrigatório.');
      setActiveTab('model');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({
        id: agent?.id,
        name: name.trim(),
        description: description.trim(),
        provider,
        model,
        system_prompt: systemPrompt,
        temperature,
        ragEnabled,
        calendarEnabled,
        handoffEnabled,
        assignedInstanceId,
      });

      // Se selecionou uma instância específica e o agente já existe
      if (agent?.id && assignedInstanceId) {
        await onAssignInstance(assignedInstanceId, agent.id);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar agente.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!agent?.id || !openaiKey.trim()) return;
    setSavingKey(true);
    setError('');
    try {
      const ok = await onSaveKey(agent.id, openaiKey.trim());
      if (ok) {
        setOpenaiKey('');
        setKeySavedMessage(true);
        setTimeout(() => setKeySavedMessage(false), 4000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar chave.');
    } finally {
      setSavingKey(false);
    }
  };

  const tabs = [
    { id: 'model', label: 'Modelo & Instância', icon: Bot },
    { id: 'prompt', label: 'System Prompt', icon: FileCode },
    { id: 'tools', label: 'Ferramentas & RAG', icon: Sparkles },
    ...(agent?.id ? [{ id: 'key', label: 'Chave de API', icon: KeyRound }] : []),
  ] as const;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      width="xl"
      title={agent ? `Configurar: ${agent.name}` : 'Criar Novo Agente de Atendimento'}
      description="Personalize o tom de voz, o modelo de linguagem, instruções e permissões operacionais do agente."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            loading={saving}
          >
            {agent ? 'Salvar Alterações' : 'Criar Agente'}
          </Button>
        </>
      }
    >
      {/* Sub Tabs */}
      <div className="flex border-b border-border -mx-6 px-6 -mt-2 mb-6 gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 py-2.5 px-3 text-xs font-medium border-b-2 transition-all duration-150 whitespace-nowrap -mb-[1px] cursor-pointer ${
                isActive
                  ? 'border-brand text-brand font-semibold'
                  : 'border-transparent text-content-secondary hover:text-content hover:border-border'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-2">
          <Info className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: MODEL & INSTANCE */}
      {activeTab === 'model' && (
        <div className="space-y-5">
          <Input
            label="Nome do Agente"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: SDR Vendas VidaCard"
          />

          <Input
            label="Descrição Interna (Opcional)"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Responsável por acolhimento e qualificação de novos leads"
          />

          {/* Seletor de Modelos Populares */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-content block">
              Modelo de Linguagem (LLM)
            </label>
            <div className="grid grid-cols-1 gap-2">
              {POPULAR_MODELS.map((item) => {
                const isSelected = model === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setModel(item.id);
                      setProvider(item.provider);
                    }}
                    className={`flex items-start justify-between p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-brand/10 border-brand text-content'
                        : 'bg-surface-elevated/40 border-border hover:border-border-strong text-content-secondary hover:text-content'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-xs font-semibold text-content">
                          {item.name}
                        </strong>
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-surface-elevated text-content-muted">
                          {item.provider}
                        </span>
                      </div>
                      <p className="text-[11px] text-content-muted mt-0.5">
                        {item.desc}
                      </p>
                    </div>
                    {isSelected && (
                      <span className="w-4 h-4 rounded-full bg-brand text-canvas flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Temperature Slider */}
          <div className="p-4 rounded-xl bg-surface-elevated/40 border border-border space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-content flex items-center gap-1.5">
                <Sliders size={13} />
                Temperatura: <span className="font-mono text-brand">{temperature.toFixed(2)}</span>
              </label>
              <span className="text-[10px] text-content-muted">
                {temperature < 0.4
                  ? 'Mais Preciso & Direto'
                  : temperature < 0.8
                  ? 'Equilibrado para Vendas'
                  : 'Mais Criativo'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-brand cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-content-muted font-mono">
              <span>0.0 (Fiel às regras)</span>
              <span>1.0 (Livre e expressivo)</span>
            </div>
          </div>

          {/* Vinculação de Instância WhatsApp */}
          <div className="p-4 rounded-xl bg-surface-elevated/40 border border-border space-y-2">
            <label className="text-xs font-semibold text-content flex items-center gap-1.5">
              <Smartphone size={13} className="text-[#2ee86b]" />
              Vincular a uma Instância WhatsApp
            </label>
            <p className="text-[11px] text-content-muted leading-relaxed">
              As mensagens recebidas por esta instância serão respondidas pelas diretrizes deste agente.
            </p>
            <select
              className="w-full text-xs py-2 px-3 bg-surface border border-border rounded-lg text-content focus:outline-none focus:ring-1 focus:ring-brand"
              value={assignedInstanceId ?? ''}
              onChange={(e) => setAssignedInstanceId(e.target.value || null)}
            >
              <option value="">Nenhuma instância vinculada no momento</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name} ({inst.phone || 'Sem número'}) — Status: {inst.status}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* TAB 2: SYSTEM PROMPT & VARIABLES */}
      {activeTab === 'prompt' && (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-content block mb-1">
              Variáveis Dinâmicas Disponíveis
            </label>
            <p className="text-[11px] text-content-muted mb-2">
              Clique em uma variável abaixo para inseri-la no texto do prompt no ponto do cursor:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_VARIABLES.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  onClick={() => insertVariable(v.token)}
                  className="px-2 py-1 rounded-md bg-brand/10 hover:bg-brand/15 border border-brand/30 text-brand text-[11px] font-mono transition-colors cursor-pointer"
                  title={`Inserir ${v.label}`}
                >
                  + {v.token}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-content">
                Instruções do Sistema (System Prompt)
              </label>
              <span className="text-[10px] font-mono text-content-muted">
                {systemPrompt.length} caracteres
              </span>
            </div>
            <textarea
              ref={promptTextareaRef}
              rows={12}
              className="w-full bg-canvas text-content font-mono border border-border rounded-xl text-xs p-3.5 outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand leading-relaxed resize-y"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Defina a personalidade, as regras de resposta, limites éticos e perguntas de qualificação..."
            />
          </div>

          <div className="p-3 rounded-xl bg-surface-elevated/40 border border-border/60 text-[11px] text-content-secondary leading-relaxed">
            💡 <strong>Dica de Engenharia de Prompt:</strong> Oriente seu agente a não enviar blocos de texto gigantes no WhatsApp. Defina respostas curtas, em tom humano e sempre finalizadas com uma pergunta direcionada para manter o engajamento.
          </div>
        </div>
      )}

      {/* TAB 3: TOOLS & RAG */}
      {activeTab === 'tools' && (
        <div className="space-y-3">
          <p className="text-xs text-content-muted mb-3">
            Habilite as capacidades operacionais e as integrações que este agente tem permissão para acionar de forma autônoma:
          </p>

          {/* RAG */}
          <div className="flex items-start justify-between p-4 rounded-xl bg-surface-elevated/40 border border-border">
            <div className="flex gap-3 min-w-0 pr-4">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-[#2ee86b] flex-shrink-0 mt-0.5">
                <BookOpen size={16} />
              </div>
              <div>
                <strong className="text-xs font-semibold text-content block">
                  Base de Conhecimento RAG
                </strong>
                <p className="text-[11px] text-content-muted mt-0.5 leading-relaxed">
                  Permite consultar automaticamente documentos e tabelas de preços cadastrados na aba Conhecimento para responder dúvidas com precisão.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={ragEnabled}
              onChange={(e) => setRagEnabled(e.target.checked)}
              className="w-4 h-4 accent-brand cursor-pointer mt-1"
            />
          </div>

          {/* Google Calendar */}
          <div className="flex items-start justify-between p-4 rounded-xl bg-surface-elevated/40 border border-border">
            <div className="flex gap-3 min-w-0 pr-4">
              <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 flex-shrink-0 mt-0.5">
                <Calendar size={16} />
              </div>
              <div>
                <strong className="text-xs font-semibold text-content block">
                  Agendamento no Google Calendar
                </strong>
                <p className="text-[11px] text-content-muted mt-0.5 leading-relaxed">
                  Permite checar horários livres e marcar reuniões/consultas diretamente na agenda do vendedor ao qualificar o lead.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={calendarEnabled}
              onChange={(e) => setCalendarEnabled(e.target.checked)}
              className="w-4 h-4 accent-brand cursor-pointer mt-1"
            />
          </div>

          {/* Handoff */}
          <div className="flex items-start justify-between p-4 rounded-xl bg-surface-elevated/40 border border-border">
            <div className="flex gap-3 min-w-0 pr-4">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 flex-shrink-0 mt-0.5">
                <UserCheck size={16} />
              </div>
              <div>
                <strong className="text-xs font-semibold text-content block">
                  Transbordo para Humano (Handoff)
                </strong>
                <p className="text-[11px] text-content-muted mt-0.5 leading-relaxed">
                  Transfere o atendimento para um atendente humano na Caixa de Entrada caso o lead solicite explicitamente ou atinja os critérios finais.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={handoffEnabled}
              onChange={(e) => setHandoffEnabled(e.target.checked)}
              className="w-4 h-4 accent-brand cursor-pointer mt-1"
            />
          </div>
        </div>
      )}

      {/* TAB 4: API KEY */}
      {activeTab === 'key' && agent && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-surface-elevated/40 border border-border space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-content flex items-center gap-1.5">
                <KeyRound size={14} className="text-brand" />
                Chave Privada da OpenAI deste Agente
              </label>
              <Badge variant={agent.hasOpenaiKey ? 'success' : 'danger'} size="sm">
                {agent.hasOpenaiKey ? 'Chave Ativa' : 'Sem Chave'}
              </Badge>
            </div>

            <p className="text-[11px] text-content-muted leading-relaxed">
              Cada agente utiliza sua própria credencial com isolamento criptográfico por organização.
              {agent.hasOpenaiKey
                ? ' Uma chave já está configurada. Digite uma nova se desejar substituí-la.'
                : ' Este agente ainda não possui chave própria e não responderá mensagens até que uma seja configurada.'}
            </p>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-surface text-content border border-border rounded-lg text-xs py-2 pl-3 pr-9 outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-content-muted hover:text-content p-1"
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={savingKey}
                disabled={!openaiKey.trim()}
                onClick={handleSaveApiKey}
              >
                Salvar Chave
              </Button>
            </div>

            {keySavedMessage && (
              <p className="text-[11px] text-success flex items-center gap-1 mt-1 font-medium">
                <Check size={12} /> Chave criptografada salva com sucesso!
              </p>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
