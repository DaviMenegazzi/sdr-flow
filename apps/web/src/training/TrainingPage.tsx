import { useEffect, useState } from 'react';
import { BookOpen, Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, FlaskConical, Plus, Sparkles, Target } from 'lucide-react';
import { trainingFactSchema, trainingProfileSchema, type TrainingFact, type TrainingProfile } from '@sdr/shared';
import { useSession } from '../session';
import { Button, Card, Input, Select, Skeleton } from '../components/ui';

type FactRow = TrainingFact & { id: string; status: 'draft' | 'approved' | 'archived'; revision: number };
type AgentRow = { id: string; name: string; active_flow_version_id?: string | null; hasOpenaiKey?: boolean };
type Readiness = { ready: boolean; checks: Record<string, boolean> };

const emptyProfile: TrainingProfile = {
  company: { name: '', segment: '', audience: '', offer: '', region: '', hours: '' },
  sales: { goal: '', tone: '', qualification: '', handoff: '' },
};
const categories: Array<{ value: TrainingFact['category']; label: string }> = [
  { value: 'pricing', label: 'Preços e condições' }, { value: 'catalog', label: 'Produtos e serviços' },
  { value: 'faq', label: 'Perguntas frequentes' }, { value: 'objections', label: 'Objeções' },
  { value: 'documents', label: 'Políticas' },
];
const steps = [
  { label: 'Empresa', description: 'Contexto do negócio', icon: Building2 },
  { label: 'Vendas', description: 'Como o SDR atende', icon: Target },
  { label: 'Fatos', description: 'Respostas confiáveis', icon: BookOpen },
  { label: 'Teste', description: 'Simule uma conversa', icon: FlaskConical },
];
const textareaClass = 'mt-1.5 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-xs leading-5 text-content-primary outline-none transition placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50';

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return <div className="min-w-0">
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-content-primary">{label}</label>
    {children}
    {hint && <p className="mt-1.5 text-[11px] leading-4 text-content-muted">{hint}</p>}
  </div>;
}

function TrainingLoading() {
  return <div role="status" aria-live="polite" aria-label="Carregando treinamento" className="h-full overflow-y-auto bg-canvas p-5 md:p-8">
    <span className="sr-only">Carregando treinamento…</span>
    <div aria-hidden="true" className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-3"><Skeleton className="h-3 w-36" /><Skeleton className="h-7 w-64" /><Skeleton className="h-4 w-full max-w-xl" /></div>
      <Skeleton className="h-24 w-full" rounded="lg" />
      <Skeleton className="h-80 w-full" rounded="lg" />
    </div>
  </div>;
}

export function TrainingPage() {
  const { activeOrg, session, activeRole } = useSession();
  const canEdit = activeRole === 'owner' || activeRole === 'admin';
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<TrainingProfile>(emptyProfile);
  const [savedProfile, setSavedProfile] = useState(false);
  const [profileApproved, setProfileApproved] = useState(false);
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [fact, setFact] = useState<TrainingFact>({ category: 'faq', question: '', answer: '', sourceType: 'manual' });
  const [editingFact, setEditingFact] = useState<string | null>(null);
  const [testQuestion, setTestQuestion] = useState('');
  const [testResult, setTestResult] = useState<{ answer: string; sources: string[] } | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json', ...init?.headers },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `Falha na solicitação (${response.status}).`);
    return data;
  };
  const base = `/api/organizations/${activeOrg}/training`;
  const refresh = async () => {
    if (!activeOrg || !session?.access_token) return;
    const [stored, rows, agentList] = await Promise.all([
      request(`${base}/profile`), request(`${base}/facts`), request('/api/me/agents'),
    ]);
    if (stored) { setProfile({ company: { ...emptyProfile.company, ...stored.company }, sales: { ...emptyProfile.sales, ...stored.sales } }); setSavedProfile(true); setProfileApproved(stored.status === 'approved'); }
    else { setProfile(emptyProfile); setSavedProfile(false); setProfileApproved(false); }
    setFacts(rows || []);
    setAgents(agentList.agents || []);
  };
  useEffect(() => {
    setLoading(true);
    refresh().catch(cause => setError(cause instanceof Error ? cause.message : 'Falha ao carregar treinamento.')).finally(() => setLoading(false));
  }, [activeOrg, session?.access_token]);
  useEffect(() => {
    setReadiness(null);
    if (!selectedAgent || !session?.access_token) return;
    request(`/api/me/agents/${selectedAgent}/training-readiness`).then(setReadiness).catch(() => setReadiness(null));
  }, [selectedAgent, session?.access_token, step, profileApproved, facts]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.'); }
    finally { setBusy(false); }
  };
  const saveProfile = () => run(async () => {
    const parsed = trainingProfileSchema.parse(profile);
    await request(`${base}/profile`, { method: 'PUT', body: JSON.stringify(parsed) });
    setSavedProfile(true);
    setProfileApproved(false);
  });
  const approveProfile = () => run(async () => {
    await request(`${base}/profile/approve`, { method: 'POST' });
    setProfileApproved(true);
  });
  const saveFact = () => run(async () => {
    const parsed = trainingFactSchema.parse(fact);
    await request(`${base}/facts${editingFact ? `/${editingFact}` : ''}`, {
      method: editingFact ? 'PATCH' : 'POST', body: JSON.stringify(parsed),
    });
    setFact({ category: 'faq', question: '', answer: '', sourceType: 'manual' });
    setEditingFact(null);
    await refresh();
  });
  const suggestQuestions = () => run(async () => {
    if (!selectedAgent) throw new Error('Selecione um agente para gerar sugestões.');
    const result = await request(`${base}/suggestions`, { method: 'POST', body: JSON.stringify({ agentId: selectedAgent }) });
    setSuggestions(result.questions || []);
  });
  const changeFact = (id: string, action: 'approve' | 'archive') => run(async () => {
    await request(`${base}/facts/${id}/${action}`, { method: 'POST' });
    await refresh();
  });
  const test = () => run(async () => {
    if (!selectedAgent) throw new Error('Selecione um agente.');
    const result = await request(`/api/me/agents/${selectedAgent}/test`, { method: 'POST', body: JSON.stringify({ message: testQuestion }) });
    if (result.status === 'failed') throw new Error(result.error || 'O fluxo falhou.');
    setTestResult({
      answer: result.sentMessages?.filter((message: { type: string }) => message.type === 'text').map((message: { content: string }) => message.content).join('\n') || result.decision?.reply || 'O fluxo não produziu resposta de texto.',
      sources: result.knowledgeUsed || [],
    });
  });
  const updateCompany = (key: keyof TrainingProfile['company'], value: string) => setProfile(previous => ({ ...previous, company: { ...previous.company, [key]: value } }));
  const updateSales = (key: keyof TrainingProfile['sales'], value: string) => setProfile(previous => ({ ...previous, sales: { ...previous.sales, [key]: value } }));
  const complete = [Boolean(savedProfile && profile.company.name.trim()), profileApproved, facts.some(row => row.status === 'approved'), Boolean(testResult)];

  if (loading) return <TrainingLoading />;

  return <div className="h-full overflow-y-auto bg-canvas px-4 py-5 text-content-primary sm:px-6 md:px-8 md:py-7">
    <div className="mx-auto max-w-5xl space-y-5 md:space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-brand"><Sparkles size={14} aria-hidden="true" /> Treinamento guiado</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-content-primary">Treinar meu SDR</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-content-secondary">Dê contexto ao agente, aprove o que ele pode afirmar e teste uma conversa antes de atender clientes.</p>
        </div>
        <div className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-content-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_8px_rgba(46,232,107,.45)]" />
          <span>Etapa <strong className="text-content-primary">{step + 1} de {steps.length}</strong></span>
        </div>
      </header>

      <nav aria-label="Etapas do treinamento" className="rounded-xl border border-border bg-surface p-2 sm:p-3">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map(({ label, description, icon: Icon }, index) => {
            const active = step === index;
            const done = complete[index] && !active;
            return <li key={label} className="min-w-0">
              <button type="button" onClick={() => setStep(index)} aria-current={active ? 'step' : undefined}
                className={`group flex min-h-[58px] w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition sm:px-3 ${active ? 'border-brand/40 bg-brand/10 text-content-primary shadow-[inset_0_0_0_1px_rgba(46,232,107,.08)]' : 'border-transparent text-content-secondary hover:border-border hover:bg-surface-elevated hover:text-content-primary'}`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${active ? 'border-brand/30 bg-brand/10 text-brand' : done ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-surface-elevated text-content-muted'}`}>
                  {done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-xs font-semibold ${active ? 'text-content-primary' : ''}`}>{label}</span>
                  <span className="mt-0.5 hidden truncate text-[10px] text-content-muted sm:block">{description}</span>
                </span>
                <span className="ml-auto hidden text-[10px] font-bold text-content-muted sm:block">0{index + 1}</span>
              </button>
            </li>;
          })}
        </ol>
      </nav>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs leading-5 text-danger"><span className="mt-0.5 font-bold">!</span><p>{error}</p></div>}

      {step === 0 && <Card className="overflow-visible">
        <div className="border-b border-border/60 px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brand/20 bg-brand/10 text-brand"><Building2 size={17} /></span><div><h2 className="text-sm font-semibold text-content-primary">Sobre a empresa</h2><p className="mt-1 text-xs leading-5 text-content-secondary">Esse contexto ajuda o SDR a responder com informações relevantes para o seu negócio.</p></div></div>
        </div>
        <div className="grid gap-x-5 gap-y-4 p-5 sm:grid-cols-2 sm:p-6">
          {([['name','Nome da empresa'],['segment','Segmento'],['audience','Público atendido'],['offer','O que oferece'],['region','Regiões atendidas'],['hours','Horários']] as const).map(([key,label]) =>
            <Field key={key} label={label} htmlFor={`company-${key}`}><Input id={`company-${key}`} value={profile.company[key]} onChange={event => updateCompany(key, event.target.value)} disabled={!canEdit} placeholder={label === 'Nome da empresa' ? 'Ex.: Clínica São Lucas' : undefined} /></Field>)}
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-border/60 bg-surface-subtle/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-[11px] text-content-muted">Você poderá revisar essas informações antes de liberar o agente.</p>
          <Button variant="primary" onClick={() => setStep(1)} disabled={!profile.company.name.trim()}>Continuar <ChevronRight size={15} /></Button>
        </div>
      </Card>}

      {step === 1 && <Card className="overflow-visible">
        <div className="border-b border-border/60 px-5 py-4 sm:px-6"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brand/20 bg-brand/10 text-brand"><Target size={17} /></span><div><h2 className="text-sm font-semibold text-content-primary">Como o SDR deve vender</h2><p className="mt-1 text-xs leading-5 text-content-secondary">Defina o objetivo da conversa, o tom e os critérios para qualificar ou encaminhar o atendimento.</p></div></div></div>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">{([['goal','Objetivo da conversa','Ex.: entender a necessidade e apresentar a solução mais adequada.'],['tone','Tom de voz','Ex.: próximo, profissional e direto.'],['qualification','Perguntas de qualificação','Quais informações o SDR deve descobrir?'],['handoff','Quando encaminhar a uma pessoa','Descreva as situações que precisam de atendimento humano.']] as const).map(([key,label,hint]) =>
            <div key={key}><label htmlFor={`sales-${key}`} className="block text-xs font-semibold text-content-primary">{label}</label><textarea id={`sales-${key}`} className={textareaClass} rows={3} placeholder={hint} value={profile.sales[key]} onChange={event => updateSales(key, event.target.value)} disabled={!canEdit} /></div>)}</div>
        </div>
        <div className="flex flex-col gap-3 border-t border-border/60 bg-surface-subtle/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Button variant="ghost" onClick={() => setStep(0)}><ChevronLeft size={15} /> Voltar</Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={saveProfile} disabled={busy || !canEdit}>Salvar rascunho</Button>
            {savedProfile && !profileApproved && <Button variant="primary" onClick={approveProfile} disabled={busy || !canEdit}><Check size={14} /> Aprovar perfil</Button>}
            {profileApproved && <><span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-success"><CheckCircle2 size={14} /> Perfil aprovado</span><Button variant="primary" onClick={() => setStep(2)}>Continuar <ChevronRight size={15} /></Button></>}
          </div>
        </div>
      </Card>}

      {step === 2 && <div className="space-y-4">
        <Card className="overflow-visible">
          <div className="border-b border-border/60 px-5 py-4 sm:px-6"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brand/20 bg-brand/10 text-brand"><BookOpen size={17} /></span><div><h2 className="text-sm font-semibold text-content-primary">Fatos que o SDR pode afirmar</h2><p className="mt-1 text-xs leading-5 text-content-secondary">Cadastre respostas oficiais. Cada fato precisa ser aprovado antes de entrar no atendimento.</p></div></div></div>
          <div className="space-y-4 p-5 sm:p-6">
            <div className="rounded-lg border border-border bg-surface-subtle/60 p-4">
              <div className="mb-3"><h3 className="text-xs font-semibold text-content-primary">Precisa de ideias?</h3><p className="mt-1 text-[11px] leading-4 text-content-muted">A IA sugere perguntas frequentes com base no perfil. As respostas continuam sob sua revisão.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1"><Select ariaLabel="Agente para sugerir perguntas" value={selectedAgent} onChange={setSelectedAgent} placeholder="Selecione um agente" className="w-full min-h-[38px]" options={agents.map(agent => ({ value: agent.id, label: agent.name, description: agent.hasOpenaiKey ? 'Pronto para sugerir perguntas' : 'Sem chave de IA cadastrada' }))} /></div>
                <Button size="sm" variant="secondary" onClick={suggestQuestions} disabled={busy || !savedProfile || !selectedAgent || !canEdit}><Sparkles size={14} /> Gerar sugestões</Button>
              </div>
              {!savedProfile && <p className="mt-2 text-[11px] text-content-muted">Salve o perfil da empresa antes de gerar sugestões.</p>}
              {suggestions.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{suggestions.map(question => <button key={question} type="button" className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-[11px] leading-4 text-content-secondary transition hover:border-brand/50 hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" onClick={() => setFact(previous => ({ ...previous, category: 'faq', question }))}>{question}</button>)}</div>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="fact-category" className="mb-1.5 block text-xs font-semibold text-content-primary">Categoria</label><Select id="fact-category" ariaLabel="Categoria do fato" value={fact.category} onChange={value => setFact(previous => ({ ...previous, category: value as TrainingFact['category'] }))} className="w-full min-h-[38px]" options={categories} disabled={!canEdit} /></div>
              <Field label="Pergunta do cliente" htmlFor="fact-question"><Input id="fact-question" value={fact.question} onChange={event => setFact(previous => ({ ...previous, question: event.target.value }))} disabled={!canEdit} placeholder="Ex.: Quais são as formas de pagamento?" /></Field>
            </div>
            <div><label htmlFor="fact-answer" className="block text-xs font-semibold text-content-primary">Resposta oficial</label><textarea id="fact-answer" className={textareaClass} rows={4} value={fact.answer} onChange={event => setFact(previous => ({ ...previous, answer: event.target.value }))} disabled={!canEdit} placeholder="Escreva a resposta que o SDR está autorizado a dar." /></div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-[11px] text-content-muted">Revise preços e regras antes de aprovar qualquer resposta.</p><Button variant="primary" onClick={saveFact} disabled={busy || !canEdit || !savedProfile || !fact.question.trim() || !fact.answer.trim()} loading={busy}><Plus size={15} /> {editingFact ? 'Salvar correção' : 'Adicionar fato'}</Button></div>
          </div>
        </Card>

        <section aria-labelledby="fact-list-title" className="space-y-3">
          <div className="flex items-center justify-between gap-3"><div><h3 id="fact-list-title" className="text-xs font-semibold text-content-primary">Base de respostas</h3><p className="mt-1 text-[11px] text-content-muted">{facts.length} {facts.length === 1 ? 'fato cadastrado' : 'fatos cadastrados'}</p></div><span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold text-content-muted">{facts.filter(row => row.status === 'approved').length} aprovados</span></div>
          {facts.map(row => <Card key={row.id} className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-surface-elevated px-2 py-1 text-[10px] font-medium text-content-muted">{categories.find(item => item.value === row.category)?.label ?? row.category}</span><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${row.status === 'approved' ? 'bg-success/10 text-success' : row.status === 'archived' ? 'bg-surface-elevated text-content-muted' : 'bg-warning/10 text-warning'}`}>{row.status === 'approved' ? <CheckCircle2 size={12} /> : <Circle size={10} />}{row.status === 'approved' ? 'Aprovado' : row.status === 'archived' ? 'Arquivado' : 'Rascunho'} · v{row.revision}</span></div><h4 className="mt-2 text-sm font-semibold text-content-primary">{row.question}</h4><p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-content-secondary">{row.answer}</p></div><div className="flex shrink-0 flex-wrap gap-2">{canEdit && <><Button size="sm" variant="secondary" onClick={() => { setEditingFact(row.id); setFact({ category: row.category, question: row.question, answer: row.answer, sourceType: row.sourceType }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Corrigir</Button>{row.status !== 'approved' && row.status !== 'archived' && <Button size="sm" variant="primary" onClick={() => changeFact(row.id, 'approve')} disabled={busy}><Check size={14} /> Aprovar</Button>}{row.status !== 'archived' && <Button size="sm" variant="ghost" onClick={() => changeFact(row.id, 'archive')} disabled={busy}>Arquivar</Button>}</>}</div></div></Card>)}
          {facts.length === 0 && <div className="rounded-xl border border-dashed border-border bg-surface/50 px-5 py-8 text-center"><span className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface text-content-muted"><BookOpen size={18} /></span><p className="mt-3 text-xs font-semibold text-content-primary">Sua base ainda está vazia</p><p className="mx-auto mt-1 max-w-sm text-[11px] leading-5 text-content-muted">Comece por uma pergunta frequente, uma condição comercial ou uma política que o SDR precisa conhecer.</p></div>}
        </section>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><Button variant="ghost" onClick={() => setStep(1)}><ChevronLeft size={15} /> Voltar</Button><Button variant="primary" onClick={() => setStep(3)}>Testar agente <ChevronRight size={15} /></Button></div>
      </div>}

      {step === 3 && <Card className="overflow-visible">
        <div className="border-b border-border/60 px-5 py-4 sm:px-6"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brand/20 bg-brand/10 text-brand"><FlaskConical size={17} /></span><div><h2 className="text-sm font-semibold text-content-primary">Teste antes de atender</h2><p className="mt-1 text-xs leading-5 text-content-secondary">Simule uma conversa com a versão publicada. O teste não envia mensagens pelo WhatsApp.</p></div></div></div>
        <div className="space-y-4 p-5 sm:p-6">
          <div><label htmlFor="test-agent" className="mb-1.5 block text-xs font-semibold text-content-primary">Agente</label><Select id="test-agent" ariaLabel="Agente para teste" value={selectedAgent} onChange={setSelectedAgent} placeholder="Selecione um agente" className="w-full min-h-[38px]" options={agents.map(agent => ({ value: agent.id, label: agent.name, description: !agent.active_flow_version_id ? 'Sem fluxo publicado' : !agent.hasOpenaiKey ? 'Sem chave de IA cadastrada' : 'Pronto para teste' }))} /></div>
          {readiness && <div className={`rounded-lg border p-4 ${readiness.ready ? 'border-success/25 bg-success/5' : 'border-warning/25 bg-warning/5'}`}><div className="flex items-start gap-2.5"><span className={`mt-0.5 ${readiness.ready ? 'text-success' : 'text-warning'}`}>{readiness.ready ? <CheckCircle2 size={16} /> : <Circle size={16} />}</span><div className="min-w-0 flex-1"><h3 className="text-xs font-semibold text-content-primary">{readiness.ready ? 'Tudo pronto para testar' : 'Revise estes itens antes do teste'}</h3><ul className="mt-2 grid gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-2">{([['profileApproved','Perfil aprovado'],['factsApproved','Ao menos um fato aprovado'],['openaiKey','Chave OpenAI configurada'],['publishedFlow','Fluxo publicado'],['knowledgeNode','Conhecimento antes das decisões'],['ragEnabled','Consulta à base habilitada']] as const).map(([key,label]) => <li key={key} className={`flex items-center gap-1.5 ${readiness.checks[key] ? 'text-success' : 'text-content-muted'}`}><Check size={12} aria-hidden="true" />{label}</li>)}</ul></div></div></div>}
          <Field label="Mensagem de teste" htmlFor="test-question" hint="Use uma pergunta realista. O resultado mostra a resposta e as fontes consultadas."><Input id="test-question" value={testQuestion} onChange={event => setTestQuestion(event.target.value)} placeholder="Ex.: Vocês atendem aos sábados?" /></Field>
          <div className="flex flex-col-reverse gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between"><Button variant="ghost" onClick={() => setStep(2)}><ChevronLeft size={15} /> Voltar aos fatos</Button><Button variant="primary" onClick={test} disabled={busy || !selectedAgent || !testQuestion.trim()} loading={busy}><FlaskConical size={14} /> Testar resposta</Button></div>
          {testResult && <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 sm:p-5"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-brand"><CheckCircle2 size={14} /> Resposta do agente</div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-content-primary">{testResult.answer}</p>{testResult.sources.length > 0 && <div className="mt-4 border-t border-brand/10 pt-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">Fontes consultadas</p><ul className="mt-2 space-y-1">{testResult.sources.map((source, index) => <li key={`${source}-${index}`} className="flex items-start gap-2 text-[11px] leading-5 text-content-secondary"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />{source}</li>)}</ul></div>}</div>}
        </div>
      </Card>}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[10px] text-content-muted"><span>O agente só usa fatos aprovados pela sua equipe.</span><span>{complete.filter(Boolean).length} de 4 etapas concluídas</span></footer>
    </div>
  </div>;
}
