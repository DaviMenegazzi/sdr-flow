import { useEffect, useState } from 'react';
import { AlertCircle, BookOpen, Building2, Check, CheckCircle2, Circle, Edit3, FlaskConical, Plus, Sparkles, Target, X } from 'lucide-react';
import { trainingAnswer, trainingQuestions, withTrainingAnswer, type TrainingFact, type TrainingQuestion } from '@sdr/shared';
import { Badge, Button, Card, Input, Select } from '../components/ui';
import { factCategories, type Readiness, type TestResult, type TrainingState } from './useTraining';

export const textareaClass = 'w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm leading-6 text-content-primary outline-none transition placeholder:text-content-muted focus:border-brand focus:ring-2 focus:ring-success-border disabled:cursor-not-allowed disabled:opacity-50';

export function TrainingError({ message }: { message: string }) {
  if (!message) return null;
  return <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger-border bg-danger-bg p-3 text-xs text-danger">
    <AlertCircle className="h-4 w-4 shrink-0" /><span>{message}</span>
  </div>;
}

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Building2; title: string; description: string }) {
  return <div className="mb-4 flex items-start gap-3">
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"><Icon className="h-5 w-5" /></div>
    <div>
      <h2 className="text-base font-semibold text-content">{title}</h2>
      <p className="mt-0.5 text-sm text-content-secondary">{description}</p>
    </div>
  </div>;
}

function ProfileItem({ training, item }: { training: TrainingState; item: TrainingQuestion }) {
  const value = trainingAnswer(training.profile, item);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const save = async () => {
    const ok = await training.saveProfile(withTrainingAnswer(training.profile, item, draft), { approve: training.profileApproved });
    if (ok) setEditing(false);
  };
  return <Card className="flex flex-col p-5 shadow-sm transition-colors hover:border-border-hover">
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">{item.label}</span>
      {training.canEdit && !editing && <button type="button" onClick={() => setEditing(true)} aria-label={`Editar ${item.label}`}
        className="rounded p-1.5 text-content-muted transition-colors hover:bg-surface-elevated hover:text-content"><Edit3 className="h-3.5 w-3.5" /></button>}
    </div>
    {editing ? <div className="space-y-3">
      {item.multiline
        ? <textarea className={textareaClass} rows={3} value={draft} onChange={event => setDraft(event.target.value)} placeholder={item.placeholder} aria-label={item.label} autoFocus />
        : <Input value={draft} onChange={event => setDraft(event.target.value)} placeholder={item.placeholder} aria-label={item.label} autoFocus />}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => { setDraft(value); setEditing(false); }}><X className="h-3.5 w-3.5" /> Cancelar</Button>
        <Button size="sm" variant="primary" onClick={save} loading={training.busy} disabled={training.busy || (item.key === 'name' && !draft.trim())}><Check className="h-3.5 w-3.5" /> Salvar</Button>
      </div>
    </div> : <p className={`whitespace-pre-wrap text-sm leading-relaxed ${value.trim() ? 'text-content' : 'italic text-content-muted'}`}>{value.trim() || 'Não informado'}</p>}
  </Card>;
}

/** Answers from the onboarding, read-only by default; each card edits only its own field. */
export function ProfileSummary({ training }: { training: TrainingState }) {
  const groups = [
    { section: 'company' as const, icon: Building2, title: 'Empresa', description: 'O contexto do negócio que o SDR usa em todas as conversas.' },
    { section: 'sales' as const, icon: Target, title: 'Vendas', description: 'Como o SDR conduz, qualifica e encaminha o atendimento.' },
  ];
  return <div className="space-y-8">
    {!training.profileApproved && training.hasProfile && <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg p-3 text-xs text-content-secondary">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span>O perfil ainda não foi confirmado. O SDR só usa estas informações depois que você concluir o treinamento.</span>
    </div>}
    {groups.map(group => <section key={group.section}>
      <SectionHeader icon={group.icon} title={group.title} description={group.description} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {trainingQuestions.filter(item => item.section === group.section).map(item => <ProfileItem key={item.key} training={training} item={item} />)}
      </div>
    </section>)}
  </div>;
}

const emptyFact: TrainingFact = { category: 'faq', question: '', answer: '', sourceType: 'manual' };

export function FactForm({ training, onSaved, approve = false, submitLabel }: { training: TrainingState; onSaved?: () => void; approve?: boolean; submitLabel?: string }) {
  const [fact, setFact] = useState<TrainingFact>(emptyFact);
  const [agentId, setAgentId] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const save = async () => {
    const ok = await training.saveFact(fact, { approve });
    if (ok) { setFact(emptyFact); onSaved?.(); }
  };
  const suggest = async () => {
    const questions = await training.suggestQuestions(agentId);
    if (questions) setSuggestions(questions);
  };
  return <div className="space-y-4">
    {training.agents.length > 0 && <div className="rounded-lg border border-border bg-surface-elevated/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-content"><Sparkles className="h-4 w-4 text-brand" /> Precisa de ideias?</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1"><Select fullWidth aria-label="Agente para sugerir perguntas" value={agentId} onChange={setAgentId} placeholder="Selecione um agente" className="min-h-[38px] w-full"
          options={training.agents.map(agent => ({ value: agent.id, label: agent.name, description: agent.hasOpenaiKey ? 'Pronto para sugerir perguntas' : 'Sem chave de IA cadastrada' }))} /></div>
        <Button variant="secondary" onClick={suggest} disabled={training.busy || !agentId || !training.hasProfile || !training.canEdit}><Sparkles className="h-4 w-4" /> Sugerir perguntas</Button>
      </div>
      {suggestions.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{suggestions.map(question =>
        <button key={question} type="button" onClick={() => setFact(previous => ({ ...previous, category: 'faq', question }))}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs text-content-secondary transition hover:border-success-border hover:text-content">{question}</button>)}</div>}
    </div>}
    <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
      <div><label htmlFor="fact-category" className="mb-1.5 block text-xs font-semibold text-content">Categoria</label>
        <Select id="fact-category" fullWidth aria-label="Categoria do fato" value={fact.category} onChange={value => setFact(previous => ({ ...previous, category: value as TrainingFact['category'] }))} className="min-h-[38px] w-full" options={factCategories} disabled={!training.canEdit} /></div>
      <div><label htmlFor="fact-question" className="mb-1.5 block text-xs font-semibold text-content">Pergunta do cliente</label>
        <Input id="fact-question" value={fact.question} onChange={event => setFact(previous => ({ ...previous, question: event.target.value }))} disabled={!training.canEdit} placeholder="Ex.: Quais são as formas de pagamento?" /></div>
    </div>
    <div><label htmlFor="fact-answer" className="mb-1.5 block text-xs font-semibold text-content">Resposta oficial</label>
      <textarea id="fact-answer" className={textareaClass} rows={4} value={fact.answer} onChange={event => setFact(previous => ({ ...previous, answer: event.target.value }))} disabled={!training.canEdit} placeholder="Escreva a resposta que o SDR está autorizado a dar." /></div>
    <div className="flex justify-end">
      <Button variant="primary" onClick={save} loading={training.busy} disabled={training.busy || !training.canEdit || !training.hasProfile || !fact.question.trim() || !fact.answer.trim()}>
        <Plus className="h-4 w-4" /> {submitLabel || 'Adicionar fato'}
      </Button>
    </div>
  </div>;
}

function FactCard({ training, row }: { training: TrainingState; row: TrainingState['facts'][number] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TrainingFact>({ category: row.category, question: row.question, answer: row.answer, sourceType: row.sourceType });
  const statusLabel = row.status === 'approved' ? 'Aprovado' : row.status === 'archived' ? 'Arquivado' : 'Rascunho';
  const save = async () => { if (await training.saveFact(draft, { id: row.id })) setEditing(false); };
  return <Card className="flex flex-col justify-between p-5 shadow-sm transition-colors hover:border-border-hover">
    <div>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="rounded bg-surface-elevated px-2 py-0.5 text-[11px] font-semibold uppercase text-content-muted">{factCategories.find(item => item.value === row.category)?.label ?? row.category}</span>
        <Badge variant={row.status === 'approved' ? 'success' : row.status === 'archived' ? 'default' : 'warning'} size="sm">
          {row.status === 'approved' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <Circle className="mr-1 h-2.5 w-2.5" />}{statusLabel} · v{row.revision}
        </Badge>
      </div>
      {editing ? <div className="space-y-3">
        <Input value={draft.question} onChange={event => setDraft(previous => ({ ...previous, question: event.target.value }))} aria-label="Pergunta do cliente" />
        <textarea className={textareaClass} rows={4} value={draft.answer} onChange={event => setDraft(previous => ({ ...previous, answer: event.target.value }))} aria-label="Resposta oficial" />
      </div> : <>
        <h3 className="mb-2 text-sm font-semibold text-content">{row.question}</h3>
        <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-content-secondary">{row.answer}</p>
      </>}
    </div>
    {training.canEdit && <div className="mt-4 flex flex-wrap items-center justify-end gap-1.5 border-t border-border/60 pt-3">
      {editing ? <>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={training.busy || !draft.question.trim() || !draft.answer.trim()}>Salvar correção</Button>
      </> : <>
        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => setEditing(true)}><Edit3 className="mr-1 h-3.5 w-3.5" /> Corrigir</Button>
        {row.status === 'draft' && <Button size="sm" variant="primary" className="h-7 px-2.5 text-xs" onClick={() => training.changeFact(row.id, 'approve')} disabled={training.busy}><Check className="h-3.5 w-3.5" /> Aprovar</Button>}
        {row.status !== 'archived' && <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => training.changeFact(row.id, 'archive')} disabled={training.busy}>Arquivar</Button>}
      </>}
    </div>}
  </Card>;
}

export function FactsPanel({ training }: { training: TrainingState }) {
  return <div className="space-y-6">
    {training.canEdit && <Card className="p-5">
      <SectionHeader icon={BookOpen} title="Novo fato" description="Respostas oficiais que o SDR pode afirmar. Cada fato precisa ser aprovado antes de entrar no atendimento." />
      <FactForm training={training} />
    </Card>}
    {training.facts.length === 0
      ? <Card className="border-dashed p-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-elevated text-content-muted"><BookOpen className="h-6 w-6" /></div>
        <h3 className="mb-1.5 text-base font-semibold text-content">Nenhum fato cadastrado</h3>
        <p className="mx-auto max-w-md text-sm text-content-secondary">Comece por uma pergunta frequente, uma condição comercial ou uma política que o SDR precisa conhecer.</p>
      </Card>
      : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{training.facts.map(row => <FactCard key={`${row.id}-${row.revision}`} training={training} row={row} />)}</div>}
  </div>;
}

const readinessLabels = [
  ['profileApproved', 'Perfil aprovado'], ['factsApproved', 'Ao menos um fato aprovado'], ['openaiKey', 'Chave OpenAI configurada'],
  ['publishedFlow', 'Fluxo publicado'], ['knowledgeNode', 'Conhecimento antes das decisões'], ['ragEnabled', 'Consulta à base habilitada'],
] as const;

export function TestPanel({ training }: { training: TrainingState }) {
  const [agentId, setAgentId] = useState('');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const { readiness: loadReadiness, profileApproved, approvedFacts } = training;
  useEffect(() => {
    setReadiness(null);
    if (!agentId) return;
    loadReadiness(agentId).then(setReadiness).catch(() => setReadiness(null));
  }, [agentId, loadReadiness, profileApproved, approvedFacts]);
  const test = async () => { const answer = await training.testAgent(agentId, question); if (answer) setResult(answer); };
  return <div className="space-y-4">
    <div><label htmlFor="test-agent" className="mb-1.5 block text-xs font-semibold text-content">Agente</label>
      <Select id="test-agent" fullWidth aria-label="Agente para teste" value={agentId} onChange={setAgentId} placeholder="Selecione um agente" className="min-h-[38px] w-full"
        options={training.agents.map(agent => ({ value: agent.id, label: agent.name, description: !agent.active_flow_version_id ? 'Sem fluxo publicado' : !agent.hasOpenaiKey ? 'Sem chave de IA cadastrada' : 'Pronto para teste' }))} /></div>
    {training.agents.length === 0 && <p className="text-xs text-content-muted">Nenhum agente cadastrado ainda. Crie um em Agentes de IA para testar as respostas.</p>}
    {readiness && <div className={`rounded-lg border p-4 ${readiness.ready ? 'border-success-border bg-success-bg' : 'border-warning-border bg-warning-bg'}`}>
      <h3 className="text-sm font-semibold text-content">{readiness.ready ? 'Tudo pronto para testar' : 'Revise estes itens antes do teste'}</h3>
      <ul className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">{readinessLabels.map(([key, label]) =>
        <li key={key} className={`flex items-center gap-1.5 ${readiness.checks[key] ? 'text-success' : 'text-content-muted'}`}><Check className="h-3 w-3" aria-hidden="true" />{label}</li>)}</ul>
    </div>}
    <div><label htmlFor="test-question" className="mb-1.5 block text-xs font-semibold text-content">Mensagem de teste</label>
      <Input id="test-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ex.: Vocês atendem aos sábados?" />
      <p className="mt-1.5 text-xs text-content-muted">O teste usa a versão publicada do fluxo e não envia mensagens pelo WhatsApp.</p></div>
    <div className="flex justify-end"><Button variant="primary" onClick={test} loading={training.busy} disabled={training.busy || !agentId || !question.trim()}><FlaskConical className="h-4 w-4" /> Testar resposta</Button></div>
    {result && <div className="rounded-xl border border-success-border bg-brand-subtle p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand"><CheckCircle2 className="h-4 w-4" /> Resposta do agente</div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-content">{result.answer}</p>
      {result.sources.length > 0 && <div className="mt-4 border-t border-success-border pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">Fontes consultadas</p>
        <ul className="mt-2 space-y-1">{result.sources.map((source, index) => <li key={`${source}-${index}`} className="flex items-start gap-2 text-xs text-content-secondary"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />{source}</li>)}</ul>
      </div>}
    </div>}
  </div>;
}
