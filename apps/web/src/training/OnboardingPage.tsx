import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Building2, Check, ChevronLeft, FlaskConical, PartyPopper, Sparkles, Target } from 'lucide-react';
import { trainingAnswer, trainingQuestions, withTrainingAnswer, type TrainingQuestion } from '@sdr/shared';
import { useSession } from '../session';
import { Button, Card, Input, Skeleton } from '../components/ui';
import { ProdigiWordmark } from '../components/layout/ProdigiWordmark';
import { FactForm, TestPanel, TrainingError, textareaClass } from './TrainingPanels';
import { skipOnboarding, useTraining } from './useTraining';

type Screen = { kind: 'welcome' } | { kind: 'question'; index: number } | { kind: 'review' } | { kind: 'facts' } | { kind: 'test' } | { kind: 'done' };

const stages = [
  { id: 'company', label: 'Empresa', icon: Building2 },
  { id: 'sales', label: 'Vendas', icon: Target },
  { id: 'facts', label: 'Fatos', icon: BookOpen },
  { id: 'test', label: 'Teste', icon: FlaskConical },
] as const;

function stageOf(screen: Screen): number {
  if (screen.kind === 'question') return trainingQuestions[screen.index]?.section === 'company' ? 0 : 1;
  if (screen.kind === 'review') return 1;
  if (screen.kind === 'facts') return 2;
  if (screen.kind === 'test') return 3;
  return screen.kind === 'done' ? 4 : -1;
}

// Welcome + 10 questions + review + facts + test.
const totalScreens = trainingQuestions.length + 4;
function positionOf(screen: Screen): number {
  switch (screen.kind) {
    case 'welcome': return 0;
    case 'question': return screen.index + 1;
    case 'review': return trainingQuestions.length + 1;
    case 'facts': return trainingQuestions.length + 2;
    case 'test': return trainingQuestions.length + 3;
    case 'done': return totalScreens;
  }
}

function QuestionScreen({ item, training, onNext, onBack }: { item: TrainingQuestion; training: ReturnType<typeof useTraining>; onNext: () => void; onBack: () => void }) {
  const [value, setValue] = useState(trainingAnswer(training.profile, item));
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  const required = item.key === 'name';
  const submit = async () => {
    if (required && !value.trim()) return;
    // Each answer is saved as a draft so the user can close the tab and resume later.
    const ok = await training.saveProfile(withTrainingAnswer(training.profile, item, value.trim()), { approve: false });
    if (ok) onNext();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
  };
  const sectionQuestions = trainingQuestions.filter(question => question.section === item.section);
  const numberInSection = sectionQuestions.indexOf(item) + 1;
  return <div className="onboarding-step w-full space-y-6">
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-brand">{item.section === 'company' ? 'Sobre a empresa' : 'Como o SDR deve vender'} · {numberInSection} de {sectionQuestions.length}</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-content sm:text-3xl">{item.question}</h1>
      <p className="mt-2 text-sm text-content-secondary">{item.label}{required ? '' : ' · opcional'}</p>
    </div>
    {item.multiline
      ? <textarea ref={field} className={`${textareaClass} min-h-[120px] text-base`} rows={4} value={value} onChange={event => setValue(event.target.value)} onKeyDown={onKeyDown} placeholder={item.placeholder} aria-label={item.label} disabled={!training.canEdit} />
      : <Input ref={field} className="h-12 text-base" value={value} onChange={event => setValue(event.target.value)} onKeyDown={onKeyDown} placeholder={item.placeholder} aria-label={item.label} disabled={!training.canEdit} />}
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="ghost" onClick={onBack}><ChevronLeft className="h-4 w-4" /> Voltar</Button>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-content-muted sm:inline">{item.multiline ? 'Enter envia · Shift+Enter quebra linha' : 'Pressione Enter para enviar'}</span>
        <Button variant="primary" size="lg" onClick={submit} loading={training.busy} disabled={training.busy || !training.canEdit || (required && !value.trim())}>
          {value.trim() || required ? 'Enviar' : 'Pular'} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  </div>;
}

function OnboardingLoading() {
  return <div role="status" aria-live="polite" className="mx-auto w-full max-w-2xl space-y-4 px-4">
    <span className="sr-only">Carregando treinamento…</span>
    <Skeleton className="h-3 w-40" /><Skeleton className="h-9 w-full" /><Skeleton className="h-12 w-full" rounded="lg" />
  </div>;
}

export function OnboardingPage() {
  const { activeOrg } = useSession();
  const navigate = useNavigate();
  const training = useTraining();
  const [screen, setScreen] = useState<Screen | null>(null);

  // Resume where the user stopped, once the stored profile is known.
  useEffect(() => {
    if (training.loading || screen) return;
    const { stage, questionIndex } = training.progress;
    if (stage === 'facts') setScreen({ kind: 'facts' });
    else if (stage === 'done') setScreen({ kind: 'done' });
    else if (!training.hasProfile) setScreen({ kind: 'welcome' });
    else if (questionIndex >= trainingQuestions.length) setScreen({ kind: 'review' });
    else setScreen({ kind: 'question', index: questionIndex });
  }, [training.loading, training.progress, training.hasProfile, screen]);

  const skip = () => { skipOnboarding(activeOrg); navigate('/dashboard', { replace: true }); };
  const finish = () => navigate('/dashboard', { replace: true });
  const confirmProfile = async () => { if (await training.saveProfile(training.profile, { approve: true })) setScreen({ kind: 'facts' }); };

  const current = screen ?? { kind: 'welcome' as const };
  const activeStage = stageOf(current);
  const percent = Math.round((positionOf(current) / totalScreens) * 100);
  const key = current.kind === 'question' ? `question-${current.index}` : current.kind;

  return <div className="flex min-h-[100dvh] w-full flex-col bg-canvas text-content-primary">
    <header className="border-b border-border bg-surface/60 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <ProdigiWordmark />
        {current.kind !== 'done' && <Button variant="ghost" size="sm" onClick={skip}>Pular por enquanto</Button>}
      </div>
      <div className="h-1 w-full bg-surface-elevated" role="progressbar" aria-label="Progresso do treinamento" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-brand transition-all duration-500" style={{ width: `${percent}%` }} />
      </div>
    </header>

    <main className="flex flex-1 flex-col items-center px-4 py-8 sm:px-6 sm:py-14">
      {activeStage >= 0 && activeStage < stages.length && <ol aria-label="Etapas do treinamento" className="mb-10 flex flex-wrap items-center justify-center gap-2">
        {stages.map((stage, index) => {
          const done = index < activeStage;
          const active = index === activeStage;
          return <li key={stage.id} className="flex items-center gap-2">
            <span aria-current={active ? 'step' : undefined} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? 'border-success-border bg-brand-subtle text-brand' : done ? 'border-success-border bg-success-bg text-success' : 'border-border bg-surface text-content-muted'}`}>
              {done ? <Check className="h-3.5 w-3.5" /> : <stage.icon className="h-3.5 w-3.5" />}{stage.label}
            </span>
            {index < stages.length - 1 && <span className="h-px w-4 bg-border" aria-hidden="true" />}
          </li>;
        })}
      </ol>}

      <div className="flex w-full max-w-2xl flex-1 flex-col">
        <TrainingError message={training.error} />
        {!training.canEdit && !training.loading && <p className="mb-4 rounded-lg border border-warning-border bg-warning-bg p-3 text-xs text-content-secondary">Apenas donos e administradores podem treinar o SDR. Peça a um deles para concluir esta etapa.</p>}
        <div key={key} className={`${training.error ? 'mt-4' : ''} w-full`}>
          {!screen ? <OnboardingLoading /> : <>
            {screen.kind === 'welcome' && <div className="onboarding-step space-y-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-subtle text-brand"><Sparkles className="h-7 w-7" /></div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">Vamos treinar o seu SDR</h1>
                <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-content-secondary">Algumas perguntas rápidas sobre a sua empresa e a forma de vender. Responda uma de cada vez: o SDR usa essas respostas em todas as conversas no WhatsApp.</p>
              </div>
              <p className="text-xs text-content-muted">Leva cerca de 5 minutos · o progresso é salvo a cada resposta</p>
              <Button variant="primary" size="lg" onClick={() => setScreen({ kind: 'question', index: 0 })} disabled={!training.canEdit}>Começar <ArrowRight className="h-4 w-4" /></Button>
            </div>}

            {screen.kind === 'question' && trainingQuestions[screen.index] && <QuestionScreen item={trainingQuestions[screen.index]!} training={training}
              onNext={() => setScreen(screen.index + 1 < trainingQuestions.length ? { kind: 'question', index: screen.index + 1 } : { kind: 'review' })}
              onBack={() => setScreen(screen.index === 0 ? { kind: 'welcome' } : { kind: 'question', index: screen.index - 1 })} />}

            {screen.kind === 'review' && <div className="onboarding-step space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand">Confira antes de continuar</p>
                <h1 className="mt-3 text-2xl font-bold tracking-tight text-content sm:text-3xl">É assim que o SDR vai conhecer a sua empresa</h1>
                <p className="mt-2 text-sm text-content-secondary">Depois você pode ajustar qualquer resposta em Base de Conhecimento › Perfil do SDR.</p>
              </div>
              <Card className="divide-y divide-border/60">
                {trainingQuestions.map((item, index) => <button key={item.key} type="button" onClick={() => setScreen({ kind: 'question', index })}
                  className="flex w-full items-start justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-elevated">
                  <span className="w-40 shrink-0 text-xs font-semibold text-content-muted">{item.label}</span>
                  <span className={`min-w-0 flex-1 truncate text-sm ${trainingAnswer(training.profile, item).trim() ? 'text-content' : 'italic text-content-muted'}`}>{trainingAnswer(training.profile, item).trim() || 'Não informado'}</span>
                </button>)}
              </Card>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <Button variant="ghost" onClick={() => setScreen({ kind: 'question', index: trainingQuestions.length - 1 })}><ChevronLeft className="h-4 w-4" /> Voltar</Button>
                <Button variant="primary" size="lg" onClick={confirmProfile} loading={training.busy} disabled={training.busy || !training.canEdit}><Check className="h-4 w-4" /> Confirmar e continuar</Button>
              </div>
            </div>}

            {screen.kind === 'facts' && <div className="onboarding-step space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand">Fatos · o que o SDR pode afirmar</p>
                <h1 className="mt-3 text-2xl font-bold tracking-tight text-content sm:text-3xl">Qual pergunta seus clientes mais fazem?</h1>
                <p className="mt-2 text-sm text-content-secondary">Cadastre a resposta oficial. O SDR só afirma fatos aprovados por você, e você pode adicionar outros depois na Base de Conhecimento.</p>
              </div>
              <Card className="p-5"><FactForm training={training} approve submitLabel="Salvar e aprovar" onSaved={() => setScreen({ kind: 'test' })} /></Card>
            </div>}

            {screen.kind === 'test' && <div className="onboarding-step space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand">Teste</p>
                <h1 className="mt-3 text-2xl font-bold tracking-tight text-content sm:text-3xl">Faça uma pergunta ao seu SDR</h1>
                <p className="mt-2 text-sm text-content-secondary">Veja como ele responde com o que você acabou de ensinar.</p>
              </div>
              <Card className="p-5"><TestPanel training={training} /></Card>
              <div className="flex justify-end"><Button variant="primary" size="lg" onClick={() => setScreen({ kind: 'done' })}>Concluir treinamento <ArrowRight className="h-4 w-4" /></Button></div>
            </div>}

            {screen.kind === 'done' && <div className="onboarding-step space-y-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success-bg text-success"><PartyPopper className="h-7 w-7" /></div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">Seu SDR está treinado</h1>
                <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-content-secondary">Para ajustar respostas, adicionar fatos ou testar de novo, acesse Base de Conhecimento.</p>
              </div>
              <Button variant="primary" size="lg" onClick={finish}>Ir para a plataforma <ArrowRight className="h-4 w-4" /></Button>
            </div>}
          </>}
        </div>
      </div>
    </main>
  </div>;
}
