import { type FormEvent, useEffect, useState } from 'react';
import { useSession } from '../session';
import { Button, Badge, Card, Input } from '../components/ui';
import { Bot, Sparkles, Plus, AlertCircle, Edit3, Archive, Check, KeyRound } from 'lucide-react';

type Agent = {
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
};

type Instance = {
  id: string;
  name: string;
  agent_id: string | null;
};

export function AgentsPage() {
  const { session } = useSession();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [max, setMax] = useState(2);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Agent | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  const headers = session ? { Authorization: `Bearer ${session.access_token}` } : undefined;

  const load = async () => {
    if (!headers) return;
    const [a, i] = await Promise.all([
      fetch('/api/me/agents', { headers }),
      fetch('/api/me/instances', { headers }),
    ]);
    if (a.ok) {
      const d = await a.json();
      setAgents(d.agents);
      setMax(d.limits.max_agents);
    }
    if (i.ok) setInstances(await i.json());
  };

  useEffect(() => {
    void load();
  }, [session?.access_token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!headers) return;
    setError('');
    setSaving(true);
    const a = editing;
    const response = await fetch(a ? `/api/me/agents/${a.id}` : '/api/me/agents', {
      method: a ? 'PATCH' : 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: a?.name ?? name,
        description: a?.description ?? '',
        provider: a?.provider ?? 'openai',
        model: a?.model ?? 'gpt-4.1-mini',
        systemPrompt: a?.system_prompt ?? '',
        toolPolicy: a?.tool_policy ?? {},
        modelConfig: a?.model_config ?? {},
      }),
    });
    setSaving(false);
    if (!response.ok) {
      setError((await response.json()).error || 'Falha ao salvar agente.');
      return;
    }
    setName('');
    setEditing(null);
    await load();
  };

  const saveOpenaiKey = async () => {
    if (!headers || !editing || !openaiKey.trim()) return;
    setError('');
    setKeySaved(false);
    setSavingKey(true);
    const r = await fetch(`/api/me/agents/${editing.id}/openai-key`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: openaiKey.trim() }),
    });
    setSavingKey(false);
    if (!r.ok) {
      setError((await r.json()).error || 'Falha ao salvar a chave da OpenAI.');
      return;
    }
    setOpenaiKey('');
    setKeySaved(true);
    await load();
    setEditing(a => (a ? { ...a, hasOpenaiKey: true } : a));
  };

  const assign = async (instanceId: string, agentId: string) => {
    if (!headers) return;
    setError('');
    const r = await fetch(`/api/me/instances/${instanceId}/assign-agent`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    if (!r.ok) {
      setError((await r.json()).error || 'Falha ao atribuir agente.');
      return;
    }
    await load();
  };

  const archive = async (a: Agent) => {
    if (!headers || !confirm(`Arquivar o agente “${a.name}”?`)) return;
    const r = await fetch(`/api/me/agents/${a.id}`, { method: 'DELETE', headers });
    if (!r.ok) {
      setError((await r.json()).error || 'Falha ao arquivar agente.');
      return;
    }
    await load();
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 bg-canvas text-content">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand mb-1">
              <Bot className="w-3.5 h-3.5" /> AGENTES DE IA & PROVEDORES
            </div>
            <h1 className="text-2xl font-bold text-content tracking-tight">
              Agentes de Atendimento
            </h1>
            <p className="text-sm text-content-secondary max-w-2xl mt-1">
              {agents.length} de {max} agentes ativos. Cada instância do WhatsApp pode utilizar um agente dedicado com personalidade e diretrizes exclusivas.
            </p>
          </div>
        </div>

      {error && (
        <div className="p-3.5 mb-6 rounded-lg bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-2" role="alert">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Agents Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {agents.map((a) => (
          <Card key={a.id} className="p-4 bg-surface border-border flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-brand" />
                  <strong className="text-sm font-semibold text-content">{a.name}</strong>
                </div>
                <div className="flex items-center gap-1.5">
                  {a.is_default && (
                    <Badge variant="accent" size="sm">
                      Padrão
                    </Badge>
                  )}
                  <Badge variant={a.hasOpenaiKey ? 'success' : 'danger'} size="sm" title={a.hasOpenaiKey ? 'Este agente tem sua própria chave da OpenAI' : 'Sem chave própria: não vai conseguir responder mensagens até configurar uma'}>
                    <KeyRound className="w-3 h-3" /> {a.hasOpenaiKey ? 'Chave OK' : 'Sem chave'}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-content-muted m-0 font-mono">
                {a.provider} / {a.model}
              </p>
              {a.system_prompt && (
                <p className="text-xs text-content-muted mt-2 line-clamp-2 italic">
                  "{a.system_prompt}"
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-border/60">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setEditing({ ...a }); setOpenaiKey(''); setKeySaved(false); }}
                className="flex-1"
              >
                <Edit3 className="w-3.5 h-3.5" /> Editar
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={a.is_default}
                onClick={() => void archive(a)}
                title={a.is_default ? 'Não é possível arquivar o agente padrão' : 'Arquivar agente'}
              >
                <Archive className="w-3.5 h-3.5" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Create or Edit Form */}
      <Card className="p-6 bg-surface border-border max-w-xl mb-8">
        <h2 className="text-base font-semibold text-content m-0 mb-4">
          {editing ? `Editar Agente: ${editing.name}` : 'Criar Novo Agente'}
        </h2>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label="Nome do Agente"
            required
            maxLength={80}
            value={editing?.name ?? name}
            onChange={(e) =>
              editing ? setEditing({ ...editing, name: e.target.value }) : setName(e.target.value)
            }
            placeholder="Ex: SDR Vendas Vida Card"
          />

          {editing && (
            <>
              <Input
                label="Modelo"
                required
                value={editing.model}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                placeholder="Ex: gpt-4.1-mini"
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-content">Instruções (System Prompt)</label>
                <textarea
                  className="w-full bg-surface text-content border border-border rounded-lg text-xs p-3 outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand min-h-[100px]"
                  value={editing.system_prompt}
                  onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })}
                  placeholder="Instruções de personalidade e comportamento..."
                />
              </div>

              <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-surface-muted/40 border border-border">
                <label className="text-xs font-semibold text-content flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" /> Chave da OpenAI deste agente
                </label>
                <p className="text-[11px] text-content-muted m-0">
                  Cada agente usa sua própria chave — nunca uma chave compartilhada com os demais, e nenhum outro agente consegue lê-la depois de salva.
                  {editing.hasOpenaiKey ? ' Uma chave já está configurada; salvar um novo valor a substitui.' : ' Este agente ainda não tem chave configurada e não vai conseguir responder mensagens até que uma seja salva.'}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    className="flex-1 bg-surface text-content border border-border rounded-lg text-xs py-1.5 px-2.5 outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                    value={openaiKey}
                    onChange={(e) => { setOpenaiKey(e.target.value); setKeySaved(false); }}
                    placeholder="sk-..."
                  />
                  <Button type="button" variant="outline" size="sm" loading={savingKey} disabled={!openaiKey.trim()} onClick={() => void saveOpenaiKey()}>
                    Salvar chave
                  </Button>
                </div>
                {keySaved && (
                  <p className="text-[11px] text-success m-0 flex items-center gap-1"><Check className="w-3 h-3" /> Chave salva.</p>
                )}
              </div>
            </>
          )}

          <div className="flex items-center gap-2 mt-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={saving}
              disabled={!editing && agents.length >= max}
            >
              {editing ? 'Salvar alterações' : 'Criar agente'}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      </Card>

      {/* Instance Assignment */}
      <Card className="p-6 bg-surface border-border max-w-xl">
        <h2 className="text-base font-semibold text-content m-0 mb-1">Agente por instância</h2>
        <p className="text-xs text-content-muted mb-4">Selecione qual agente processará as mensagens de cada instância de WhatsApp conectada.</p>
        <div className="flex flex-col gap-3">
          {instances.map((i) => (
            <div key={i.id} className="flex flex-col gap-1.5 p-3 rounded-lg bg-surface-muted/40 border border-border">
              <span className="text-xs font-semibold text-content">{i.name}</span>
              <select
                className="w-full text-xs py-1.5 px-2.5 bg-surface border border-border rounded-lg text-content focus:outline-none focus:ring-1 focus:ring-brand"
                value={i.agent_id ?? ''}
                onChange={(e) => void assign(i.id, e.target.value)}
              >
                <option value="" disabled>
                  Selecione um agente
                </option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.is_default ? '(Padrão)' : ''} {a.hasOpenaiKey ? '' : '⚠ sem chave'}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </Card>
    </div>
  </div>
  );
}
