import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BookOpen,
  Calendar,
  Check,
  ChevronRight,
  Cpu,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Lightbulb,
  MoreHorizontal,
  Smartphone,
  UserCheck,
  Wrench,
  Info,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  IconButton,
  Input,
  PageContainer,
  Select,
  SegmentedControl,
  Skeleton,
  Switch,
  confirmDialog,
  toast,
} from '../components/ui';
import { formatPhone } from '../lib/format';
import { formFromAgent, useAgentsApi } from './api';
import { PromptEditor } from './PromptEditor';
import {
  POPULAR_MODELS,
  TEMPERATURE_PRESETS,
  presetForTemperature,
  type Agent,
  type AgentFormData,
  type AgentLimits,
  type Instance,
  type TemperaturePreset,
} from './types';

type Section = 'general' | 'instructions' | 'model' | 'tools' | 'instances' | 'key';

const SECTIONS: Array<{ id: Section; label: string; icon: React.ReactNode; existingOnly?: boolean }> = [
  { id: 'general', label: 'Geral', icon: <Info size={15} /> },
  { id: 'instructions', label: 'Instruções', icon: <FileText size={15} /> },
  { id: 'model', label: 'Modelo', icon: <Cpu size={15} /> },
  { id: 'tools', label: 'Ferramentas', icon: <Wrench size={15} /> },
  { id: 'instances', label: 'Números', icon: <Smartphone size={15} />, existingOnly: true },
  { id: 'key', label: 'Chave da OpenAI', icon: <KeyRound size={15} />, existingOnly: true },
];

const DEFAULT_PROMPT =
  'Você é um SDR cordial e objetivo. Entenda a necessidade do lead, tire dúvidas com base no que sabe e qualifique o contato para agendar uma conversa com o time comercial.\n\nRegras:\n- Responda em mensagens curtas, como no WhatsApp.\n- Termine com uma pergunta para manter a conversa.';

const EMPTY_FORM: AgentFormData = {
  name: '',
  description: '',
  provider: 'openai',
  model: 'gpt-4o-mini',
  system_prompt: DEFAULT_PROMPT,
  temperature: 0.4,
  ragEnabled: true,
  calendarEnabled: false,
  handoffEnabled: true,
  assignedInstanceId: null,
};

function sameForm(a: AgentFormData, b: AgentFormData) {
  return JSON.stringify({ ...a, assignedInstanceId: null }) === JSON.stringify({ ...b, assignedInstanceId: null });
}

/** One agent, one page: side navigation, the prompt gets the biggest area, Salvar sits in the header. */
export function AgentEditorPage() {
  const { agentId = 'new' } = useParams();
  const isNew = agentId === 'new';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const api = useAgentsApi();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [limits, setLimits] = useState<AgentLimits | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState<AgentFormData>(EMPTY_FORM);
  const [saved, setSaved] = useState<AgentFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const requested = params.get('section') as Section | null;
  const available = SECTIONS.filter(s => !(isNew && s.existingOnly));
  const section: Section = available.some(s => s.id === requested) ? (requested as Section) : 'general';
  const goTo = (next: Section) => setParams(p => {
    const copy = new URLSearchParams(p);
    copy.set('section', next);
    return copy;
  }, { replace: true });

  const load = async (resetForm = true) => {
    if (!api.ready) return;
    try {
      const data = await api.list();
      setAgents(data.agents);
      setInstances(data.instances);
      setLimits(data.limits);
      if (!isNew) {
        const found = data.agents.find(a => a.id === agentId) ?? null;
        setAgent(found);
        setNotFound(!found);
        if (found) {
          const next = formFromAgent(found);
          if (resetForm) setForm(next);
          setSaved(next);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar o agente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isNew) {
      setAgent(null);
      setForm(EMPTY_FORM);
      setSaved(EMPTY_FORM);
    }
    void load();
  }, [api, agentId]);

  const dirty = isNew ? Boolean(form.name.trim()) || !sameForm(form, EMPTY_FORM) : !sameForm(form, saved);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const set = <K extends keyof AgentFormData>(key: K, value: AgentFormData[K]) => setForm(f => ({ ...f, [key]: value }));

  const leave = async (to: string) => {
    if (dirty) {
      const ok = await confirmDialog({
        title: 'Sair sem salvar?',
        description: 'As alterações feitas neste agente serão perdidas.',
        confirmLabel: 'Descartar alterações',
        danger: true,
      });
      if (!ok) return;
    }
    navigate(to);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setNameError('Dê um nome ao agente.');
      goTo('general');
      return;
    }
    setNameError('');
    setSaving(true);
    try {
      const id = await api.save({ ...form, name: form.name.trim(), description: form.description.trim() });
      setSaved(form);
      toast.success(isNew ? 'Agente criado' : 'Alterações salvas');
      if (isNew && id) navigate(`/agents/${id}?section=key`, { replace: true });
      else await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar o agente.');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!agent) return;
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
      navigate('/agents');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao arquivar o agente.');
    }
  };

  if (notFound) {
    return (
      <PageContainer>
        <div className="py-16 text-center">
          <p className="m-0 text-sm font-semibold text-content">Agente não encontrado</p>
          <p className="m-0 mt-1 text-xs text-content-secondary">Ele pode ter sido arquivado.</p>
          <Link to="/agents" className="mt-4 inline-block text-xs font-semibold text-brand-fg">
            Voltar para Agentes
          </Link>
        </div>
      </PageContainer>
    );
  }

  const assignedHere = instances.filter(i => i.agent_id === agent?.id);
  const status = agent ? [agent.is_default ? 'Padrão' : null, assignedHere.length ? `${assignedHere.length} número${assignedHere.length > 1 ? 's' : ''}` : 'Sem número'].filter(Boolean).join(' · ') : null;

  return (
    <PageContainer wide>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => void leave('/agents')}
            className="mb-1 flex min-h-0 items-center gap-1 border-0 bg-transparent p-0 text-xs text-content-secondary hover:text-content"
          >
            <ArrowLeft size={14} /> Agentes
          </button>
          {loading ? (
            <Skeleton className="h-7 w-64" />
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="m-0 truncate text-2xl font-bold tracking-tight text-content">
                {form.name.trim() || (isNew ? 'Novo agente' : agent?.name)}
              </h1>
              {status && <span className="text-xs text-content-muted">{status}</span>}
              {dirty && <span className="text-xs text-content-muted">· Alterações não salvas</span>}
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {agent && (
            <DropdownMenu
              aria-label="Mais ações do agente"
              items={[
                {
                  label: 'Arquivar…',
                  icon: <Archive size={14} />,
                  danger: true,
                  disabled: agent.is_default,
                  hint: agent.is_default ? 'O agente padrão não pode ser arquivado' : undefined,
                  onSelect: () => void archive(),
                },
              ]}
              trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} variant="outline" />}
            />
          )}
          <Button variant="primary" size="lg" onClick={() => void save()} loading={saving} disabled={loading || (!dirty && !isNew)}>
            {isNew ? 'Criar agente' : 'Salvar'}
          </Button>
        </div>
      </header>

      {!loading && agent && !agent.hasOpenaiKey && section !== 'key' && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-content">
          <AlertTriangle size={15} className="flex-shrink-0 text-warning" />
          <span className="flex-1">Este agente não tem chave da OpenAI e não responde mensagens.</span>
          <button type="button" onClick={() => goTo('key')} className="min-h-0 border-0 bg-transparent p-0 text-xs font-semibold text-content hover:underline">
            Adicionar chave
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Seções do agente" className="flex gap-1 overflow-x-auto md:sticky md:top-0 md:flex-col md:self-start">
          {available.map(item => {
            const active = item.id === section;
            const flag = item.id === 'key' && agent && !agent.hasOpenaiKey;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => goTo(item.id)}
                className={`flex h-8 min-h-0 flex-shrink-0 items-center justify-start gap-2 whitespace-nowrap rounded-lg border-0 px-2.5 text-left text-xs ${
                  active ? 'bg-surface-elevated font-semibold text-content' : 'bg-transparent text-content-secondary hover:bg-surface-elevated hover:text-content'
                }`}
              >
                <span className="text-content-muted">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {flag && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="Pendente" />}
              </button>
            );
          })}
        </nav>

        <section className="min-w-0 max-w-3xl">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              {section === 'general' && (
                <Panel title="Geral" description="Como o agente aparece para o seu time. O lead não vê estes campos.">
                  <Input
                    label="Nome"
                    required
                    maxLength={80}
                    value={form.name}
                    error={nameError || undefined}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Ex.: Sofia — SDR Vida Card"
                    autoFocus={isNew}
                  />
                  <Input
                    label="Descrição (opcional)"
                    maxLength={200}
                    value={form.description}
                    onChange={e => set('description', e.target.value)}
                    placeholder="Ex.: Qualifica leads de planos e agenda consultas"
                  />
                  {isNew && (
                    <p className="m-0 text-2xs text-content-muted">
                      Depois de criar, você adiciona a chave da OpenAI e escolhe quais números o agente atende.
                    </p>
                  )}
                </Panel>
              )}

              {section === 'instructions' && (
                <Panel title="Instruções" description="O que o agente é, o que deve descobrir e como deve responder. Escreva como falaria com um vendedor novo.">
                  <PromptEditor
                    value={form.system_prompt}
                    onChange={value => set('system_prompt', value)}
                    placeholder="Ex.: Você é Sofia, SDR da Vida Card…"
                  />
                  <details className="group rounded-lg border border-border bg-surface px-3 py-2 text-xs text-content-secondary">
                    <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-content">
                      <Lightbulb size={14} className="text-content-muted" />
                      Dicas para WhatsApp
                      <ChevronRight size={14} className="ml-auto text-content-muted transition-transform group-open:rotate-90" />
                    </summary>
                    <ul className="m-0 mt-2 space-y-1 pl-6 leading-relaxed">
                      <li>Peça respostas curtas: uma ideia por mensagem.</li>
                      <li>Termine com uma pergunta direcionada para manter o lead engajado.</li>
                      <li>Liste o que o agente nunca deve prometer (preços fora da tabela, prazos).</li>
                    </ul>
                  </details>
                </Panel>
              )}

              {section === 'model' && (
                <ModelSection form={form} set={set} />
              )}

              {section === 'tools' && (
                <Panel title="Ferramentas" description="O que o agente pode fazer por conta própria durante a conversa.">
                  <ToolCard
                    icon={<BookOpen size={16} />}
                    title="Consultar a base de conhecimento"
                    description="Responde dúvidas com os documentos e preços cadastrados em Base de Conhecimento."
                    checked={form.ragEnabled}
                    onChange={value => set('ragEnabled', value)}
                    footer={<Link to="/knowledge" className="text-2xs font-medium text-content-secondary hover:text-content">Ver base de conhecimento →</Link>}
                  />
                  <ToolCard
                    icon={<Calendar size={16} />}
                    title="Agendar no Google Agenda"
                    description="Consulta horários livres e marca reuniões na agenda do vendedor."
                    checked={form.calendarEnabled}
                    onChange={value => set('calendarEnabled', value)}
                    footer={<Link to="/integrations" className="text-2xs font-medium text-content-secondary hover:text-content">Gerenciar agendas em Integrações →</Link>}
                  />
                  <ToolCard
                    icon={<UserCheck size={16} />}
                    title="Passar para um atendente"
                    description="Transfere a conversa para o Atendimento quando o lead pede ou quando a qualificação termina."
                    checked={form.handoffEnabled}
                    onChange={value => set('handoffEnabled', value)}
                  />
                </Panel>
              )}

              {section === 'instances' && agent && (
                <InstancesSection
                  agent={agent}
                  agents={agents}
                  instances={instances}
                  onAssign={async instance => {
                    try {
                      await api.assignInstance(instance.id, agent.id);
                      toast.success(`${instance.name} agora é atendido por ${agent.name}`);
                      await load(false);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Não foi possível vincular o número.');
                    }
                  }}
                />
              )}

              {section === 'key' && agent && (
                <KeySection
                  agent={agent}
                  onSave={async key => {
                    await api.saveKey(agent.id, key);
                    toast.success('Chave salva', { description: 'Ela fica criptografada e não é exibida de novo.' });
                    await load(false);
                  }}
                />
              )}
            </>
          )}
          {limits && isNew && agents.length >= (limits.max_agents || 2) && (
            <p className="mt-4 text-xs text-warning">Limite de agentes do plano atingido — não será possível criar este agente.</p>
          )}
        </section>
      </div>
    </PageContainer>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="m-0 text-base font-semibold text-content">{title}</h2>
        {description && <p className="m-0 mt-1 text-xs text-content-secondary">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function ModelSection({ form, set }: { form: AgentFormData; set: <K extends keyof AgentFormData>(key: K, value: AgentFormData[K]) => void }) {
  const preset = presetForTemperature(form.temperature);
  const [advanced, setAdvanced] = useState(preset === 'custom');
  const current = TEMPERATURE_PRESETS.find(p => p.value === preset);
  const known = POPULAR_MODELS.some(m => m.id === form.model);
  const options = useMemo(
    () => [
      ...POPULAR_MODELS.map((m, index) => ({
        value: m.id,
        label: index === 0 ? `${m.name} · Recomendado` : m.name,
        text: m.name,
        description: m.desc,
      })),
      ...(known ? [] : [{ value: form.model, label: form.model, text: form.model, description: 'Modelo configurado fora da lista' }]),
    ],
    [form.model, known]
  );

  return (
    <Panel title="Modelo" description="Qual modelo da OpenAI responde e com quanta liberdade.">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-content-secondary">Modelo</span>
        <Select
          aria-label="Modelo"
          value={form.model}
          onChange={value => {
            set('model', value);
            set('provider', POPULAR_MODELS.find(m => m.id === value)?.provider ?? form.provider);
          }}
          options={options}
          fullWidth
          menuWidth={360}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-content-secondary">Estilo das respostas</span>
        <SegmentedControl<Exclude<TemperaturePreset, 'custom'>>
          aria-label="Estilo das respostas"
          value={(preset === 'custom' ? 'balanced' : preset) as Exclude<TemperaturePreset, 'custom'>}
          onChange={value => set('temperature', TEMPERATURE_PRESETS.find(p => p.value === value)?.temperature ?? 0.4)}
          options={TEMPERATURE_PRESETS.map(p => ({ value: p.value, label: p.label }))}
          className={preset === 'custom' ? 'opacity-60' : ''}
        />
        <p className="m-0 text-2xs text-content-muted">
          {current ? current.description : `Valor personalizado (${form.temperature.toFixed(2).replace('.', ',')}).`}
        </p>
      </div>

      <div>
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(v => !v)}
          className="flex min-h-0 items-center gap-1 border-0 bg-transparent p-0 text-xs font-medium text-content-secondary hover:text-content"
        >
          <ChevronRight size={14} className={`transition-transform ${advanced ? 'rotate-90' : ''}`} /> Avançado
        </button>
        {advanced && (
          <div className="mt-3 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-content-secondary">Temperatura</span>
              <span className="tabular-nums font-medium text-content">{form.temperature.toFixed(2).replace('.', ',')}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={form.temperature}
              onChange={e => set('temperature', parseFloat(e.target.value))}
              aria-label="Temperatura"
              className="range-input mt-2 w-full"
            />
            <div className="mt-1 flex justify-between text-2xs text-content-muted">
              <span>Fiel às instruções</span>
              <span>Mais variado</span>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ToolCard({
  icon,
  title,
  description,
  checked,
  onChange,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  footer?: React.ReactNode;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors duration-150 ease-out ${
        checked ? 'border-border-strong bg-surface' : 'border-border bg-surface hover:border-border-strong'
      }`}
    >
      <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${checked ? 'bg-brand/10 text-brand-fg' : 'bg-surface-elevated text-content-muted'}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-medium text-content">{title}</p>
        <p className="m-0 mt-0.5 text-xs text-content-secondary">{description}</p>
        {footer && (
          <div className="mt-2" onClick={e => e.stopPropagation()}>
            {footer}
          </div>
        )}
      </div>
      <span onClick={e => e.stopPropagation()} className="mt-1">
        <Switch checked={checked} onChange={onChange} aria-label={title} />
      </span>
    </div>
  );
}

function InstancesSection({
  agent,
  agents,
  instances,
  onAssign,
}: {
  agent: Agent;
  agents: Agent[];
  instances: Instance[];
  onAssign: (instance: Instance) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Panel title="Números" description="As mensagens que chegam nestes números são respondidas por este agente. Cada número tem um agente.">
      {instances.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-content-secondary">
          Nenhum número conectado.{' '}
          <Link to="/connections" className="font-semibold text-content">
            Conectar WhatsApp →
          </Link>
        </div>
      ) : (
        <ul className="m-0 list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface p-0">
          {instances.map(instance => {
            const mine = instance.agent_id === agent.id;
            const owner = agents.find(a => a.id === instance.agent_id);
            return (
              <li key={instance.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${instance.status === 'connected' ? 'bg-brand' : 'bg-warning'}`} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-sm font-medium text-content">{instance.name}</p>
                  <p className="m-0 truncate text-2xs text-content-muted">
                    {instance.phone ? formatPhone(instance.phone) : 'Sem número'}
                    {!mine && owner ? ` · atendido por ${owner.name}` : !mine ? ' · sem agente' : ''}
                  </p>
                </div>
                {mine ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-brand-fg">
                    <Check size={14} /> Atende
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === instance.id}
                    onClick={async () => {
                      setBusy(instance.id);
                      await onAssign(instance);
                      setBusy(null);
                    }}
                  >
                    {owner ? 'Transferir para este agente' : 'Atender com este agente'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function KeySection({ agent, onSave }: { agent: Agent; onSave: (key: string) => Promise<void> }) {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  return (
    <Panel
      title="Chave da OpenAI"
      description="Cada agente usa a própria chave, guardada criptografada e isolada por organização. O custo das respostas vai para essa conta."
    >
      <div className="flex items-center gap-2 text-xs">
        {agent.hasOpenaiKey ? (
          <>
            <Check size={14} className="text-brand-fg" />
            <span className="text-content">Chave configurada. Digite uma nova só se quiser substituí-la.</span>
          </>
        ) : (
          <>
            <AlertTriangle size={14} className="text-warning" />
            <span className="text-content">Sem chave — o agente não responde até você adicionar uma.</span>
          </>
        )}
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={async event => {
          event.preventDefault();
          if (!key.trim()) return;
          setSaving(true);
          setError('');
          try {
            await onSave(key.trim());
            setKey('');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao salvar a chave.');
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="flex-1">
          <Input
            aria-label="Chave da OpenAI"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder={agent.hasOpenaiKey ? 'sk-… (nova chave)' : 'sk-…'}
            error={error || undefined}
            className="font-mono"
            rightIcon={
              <button
                type="button"
                aria-label={show ? 'Ocultar chave' : 'Mostrar chave'}
                onClick={() => setShow(s => !s)}
                className="flex min-h-0 items-center border-0 bg-transparent p-0 text-content-muted hover:text-content"
              >
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            }
          />
        </div>
        <Button type="submit" variant={agent.hasOpenaiKey ? 'outline' : 'primary'} loading={saving} disabled={!key.trim()}>
          {agent.hasOpenaiKey ? 'Substituir chave' : 'Salvar chave'}
        </Button>
      </form>
    </Panel>
  );
}
