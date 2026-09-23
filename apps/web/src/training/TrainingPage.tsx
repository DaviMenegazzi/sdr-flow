import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Check, ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { trainingFactSchema, trainingProfileSchema, type TrainingFact, type TrainingProfile } from '@sdr/shared';
import { useSession } from '../session';
import { Button, Card, Input } from '../components/ui';

type FactRow = TrainingFact & { id: string; status: 'draft' | 'approved' | 'archived'; revision: number };
type AgentRow = { id: string; name: string; active_flow_version_id?: string | null; hasOpenaiKey?: boolean };
const emptyProfile: TrainingProfile = {
  company: { name: '', segment: '', audience: '', offer: '', region: '', hours: '' },
  sales: { goal: '', tone: '', qualification: '', handoff: '' },
};
const categories: Array<{ value: TrainingFact['category']; label: string }> = [
  { value: 'pricing', label: 'Preços e condições' }, { value: 'catalog', label: 'Produtos e serviços' },
  { value: 'faq', label: 'Perguntas frequentes' }, { value: 'objections', label: 'Objeções' },
  { value: 'documents', label: 'Políticas' },
];

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
  const [readiness, setReadiness] = useState<{ ready: boolean; checks: Record<string, boolean> } | null>(null);
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

  if (loading) return <div className="p-8 text-content-secondary">Carregando treinamento…</div>;
  return <div className="h-full overflow-y-auto bg-canvas p-6 md:p-8 text-content">
    <div className="mx-auto max-w-4xl space-y-6">
      <div><div className="flex items-center gap-2 text-brand text-xs font-bold uppercase"><Sparkles size={15} /> Configuração guiada</div>
        <h1 className="text-2xl font-bold mt-1">Treinar meu SDR</h1>
        <p className="text-sm text-content-secondary mt-1">Ensine fatos sobre a empresa, revise o que o agente pode dizer e teste antes de atender clientes.</p>
      </div>
      <div className="grid grid-cols-4 gap-2" aria-label="Etapas do treinamento">{['Empresa', 'Vendas', 'Fatos', 'Teste'].map((label, index) =>
        <button key={label} type="button" onClick={() => setStep(index)} className={`rounded-lg border px-2 py-3 text-xs font-semibold ${step === index ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-content-secondary'}`}>{index + 1}. {label}</button>)}</div>
      {error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</div>}
      {step === 0 && <Card className="p-6 space-y-4"><h2 className="font-semibold">Sobre a empresa</h2>
        {([['name','Nome da empresa'],['segment','Segmento'],['audience','Público atendido'],['offer','O que oferece'],['region','Regiões atendidas'],['hours','Horários']] as const).map(([key,label]) =>
          <label key={key} className="block text-sm font-medium">{label}<Input className="mt-1" value={profile.company[key]} onChange={event => updateCompany(key, event.target.value)} disabled={!canEdit} /></label>)}
        <Button onClick={() => setStep(1)} disabled={!profile.company.name.trim()}>Continuar <ChevronRight size={15} /></Button></Card>}
      {step === 1 && <Card className="p-6 space-y-4"><h2 className="font-semibold">Como o SDR deve vender</h2>
        {([['goal','Objetivo da conversa'],['tone','Tom de voz'],['qualification','Perguntas de qualificação'],['handoff','Quando encaminhar a uma pessoa']] as const).map(([key,label]) =>
          <label key={key} className="block text-sm font-medium">{label}<textarea className="mt-1 w-full rounded-lg border border-border bg-surface p-3 text-content" rows={3} value={profile.sales[key]} onChange={event => updateSales(key, event.target.value)} disabled={!canEdit} /></label>)}
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setStep(0)}><ChevronLeft size={15} /> Voltar</Button><Button onClick={saveProfile} disabled={busy || !canEdit}>Salvar rascunho</Button>{savedProfile && !profileApproved && <Button onClick={approveProfile} disabled={busy || !canEdit}><Check size={15} /> Aprovar perfil para o agente</Button>}{profileApproved && <><span className="self-center text-xs text-brand">Perfil aprovado e disponível ao agente</span><Button variant="secondary" onClick={() => setStep(2)}>Continuar <ChevronRight size={15} /></Button></>}</div></Card>}
      {step === 2 && <div className="space-y-4"><Card className="p-6 space-y-4"><h2 className="font-semibold">Fatos que o SDR pode afirmar</h2>
        <p className="text-sm text-content-secondary">Cada resposta começa como rascunho. Ela só entra no atendimento após sua aprovação.</p>
        <div className="rounded-lg border border-border bg-canvas p-3 space-y-2"><label className="block text-sm font-medium">Agente para sugerir perguntas<select className="mt-1 w-full rounded-lg border border-border bg-surface p-2" value={selectedAgent} onChange={event => setSelectedAgent(event.target.value)}><option value="">Selecione</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}{!agent.hasOpenaiKey ? ' · sem chave' : ''}</option>)}</select></label><Button size="sm" variant="secondary" onClick={suggestQuestions} disabled={busy || !savedProfile || !selectedAgent || !canEdit}><Sparkles size={14} /> Sugerir perguntas com IA</Button>{suggestions.length > 0 && <div className="flex flex-wrap gap-2">{suggestions.map(question => <button key={question} type="button" className="rounded-lg border border-border px-3 py-2 text-left text-xs hover:border-brand" onClick={() => setFact(previous => ({ ...previous, category: 'faq', question }))}>{question}</button>)}</div>}<p className="text-xs text-content-secondary">As sugestões não incluem respostas. Confirme as informações antes de aprovar.</p></div>
        <label className="block text-sm font-medium">Categoria<select className="mt-1 w-full rounded-lg border border-border bg-surface p-2" value={fact.category} onChange={event => setFact(previous => ({ ...previous, category: event.target.value as TrainingFact['category'] }))} disabled={!canEdit}>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="block text-sm font-medium">Pergunta do cliente<Input className="mt-1" value={fact.question} onChange={event => setFact(previous => ({ ...previous, question: event.target.value }))} disabled={!canEdit} /></label>
        <label className="block text-sm font-medium">Resposta oficial<textarea className="mt-1 w-full rounded-lg border border-border bg-surface p-3 text-content" rows={4} value={fact.answer} onChange={event => setFact(previous => ({ ...previous, answer: event.target.value }))} disabled={!canEdit} /></label>
        <Button onClick={saveFact} disabled={busy || !canEdit || !savedProfile || !fact.question.trim() || !fact.answer.trim()}><Plus size={15} /> {editingFact ? 'Salvar correção' : 'Adicionar rascunho'}</Button>
        {!savedProfile && <p className="text-xs text-content-secondary">Salve o perfil da empresa antes de adicionar fatos.</p>}</Card>
        <div className="space-y-3">{facts.map(row => <Card key={row.id} className="p-4"><div className="flex justify-between gap-3"><strong className="text-sm">{row.question}</strong><span className="text-xs text-content-secondary">{row.status === 'approved' ? 'Aprovado' : 'Rascunho'} · v{row.revision}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-content-secondary">{row.answer}</p><div className="mt-3 flex flex-wrap gap-2">{canEdit && <><Button size="sm" variant="secondary" onClick={() => { setEditingFact(row.id); setFact({ category: row.category, question: row.question, answer: row.answer, sourceType: row.sourceType }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Corrigir</Button>{row.status !== 'approved' && <Button size="sm" onClick={() => changeFact(row.id, 'approve')} disabled={busy}><Check size={14} /> Aprovar</Button>}<Button size="sm" variant="secondary" onClick={() => changeFact(row.id, 'archive')} disabled={busy}>Arquivar</Button></>}</div></Card>)}
          {facts.length === 0 && <p className="text-sm text-content-secondary">Nenhum fato cadastrado. Comece com uma pergunta frequente ou um preço confirmado.</p>}</div>
        <Button onClick={() => setStep(3)}>Testar agente <ChevronRight size={15} /></Button></div>}
      {step === 3 && <Card className="p-6 space-y-4"><h2 className="font-semibold">Teste antes de atender</h2><p className="text-sm text-content-secondary">O teste executa a versão publicada do fluxo com a chave do agente, sem enviar WhatsApp. Mostra os trechos encontrados.</p>
        <label className="block text-sm font-medium">Agente<select className="mt-1 w-full rounded-lg border border-border bg-surface p-2" value={selectedAgent} onChange={event => setSelectedAgent(event.target.value)}><option value="">Selecione</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}{!agent.active_flow_version_id ? ' · sem fluxo publicado' : !agent.hasOpenaiKey ? ' · sem chave' : ''}</option>)}</select></label>
        {readiness && <div className="rounded-lg border border-border bg-canvas p-3"><h3 className="text-sm font-semibold">Configuração: {readiness.ready ? 'pronta para teste' : 'há pendências'}</h3><ul className="mt-2 grid gap-1 text-xs">{([['profileApproved','Perfil aprovado'],['factsApproved','Ao menos um fato aprovado'],['openaiKey','Chave OpenAI configurada'],['publishedFlow','Fluxo publicado'],['knowledgeNode','Conhecimento antes das decisões'],['ragEnabled','Consulta à base habilitada']] as const).map(([key,label]) => <li key={key} className={readiness.checks[key] ? 'text-brand' : 'text-content-secondary'}>{readiness.checks[key] ? '✓' : '○'} {label}</li>)}</ul></div>}
        <label className="block text-sm font-medium">Pergunta de teste<Input className="mt-1" value={testQuestion} onChange={event => setTestQuestion(event.target.value)} placeholder="Qual é o preço do produto?" /></label>
        <Button onClick={test} disabled={busy || !selectedAgent || !testQuestion.trim()}>Perguntar ao SDR</Button>
        {testResult && <div className="rounded-lg border border-border bg-surface p-4"><h3 className="text-sm font-semibold">Resposta</h3><p className="mt-2 whitespace-pre-wrap text-sm">{testResult.answer}</p><h3 className="mt-4 text-sm font-semibold">Fontes consultadas</h3>{testResult.sources.length ? testResult.sources.map((source, index) => <p key={index} className="mt-2 rounded bg-canvas p-2 text-xs whitespace-pre-wrap">{source}</p>) : <p className="mt-1 text-xs text-content-secondary">Nenhum trecho encontrado.</p>}</div>}
        <Link to="/knowledge" className="inline-flex items-center gap-1 text-xs text-brand"><BookOpen size={14} /> Abrir base de conhecimento avançada</Link></Card>}
    </div>
  </div>;
}
