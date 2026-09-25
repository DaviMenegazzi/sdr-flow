import { z } from 'zod';

export const trainingCompanySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  segment: z.string().trim().max(120).default(''),
  audience: z.string().trim().max(500).default(''),
  offer: z.string().trim().max(1000).default(''),
  region: z.string().trim().max(500).default(''),
  hours: z.string().trim().max(500).default(''),
});

export const trainingSalesSchema = z.strictObject({
  goal: z.string().trim().max(1000).default(''),
  tone: z.string().trim().max(500).default(''),
  qualification: z.string().trim().max(1500).default(''),
  handoff: z.string().trim().max(1000).default(''),
});

export const trainingProfileSchema = z.strictObject({
  company: trainingCompanySchema,
  sales: trainingSalesSchema,
});

export const trainingFactSchema = z.strictObject({
  category: z.enum(['pricing', 'catalog', 'faq', 'objections', 'documents']),
  question: z.string().trim().min(1).max(200),
  answer: z.string().trim().min(1).max(10000),
  sourceType: z.enum(['interview', 'manual']).default('manual'),
});

export type TrainingProfile = z.infer<typeof trainingProfileSchema>;
export type TrainingFact = z.infer<typeof trainingFactSchema>;

export function formatTrainingProfile(profile: TrainingProfile): string {
  const fields: Array<[string, string]> = [
    ['Empresa', profile.company.name], ['Segmento', profile.company.segment],
    ['Público', profile.company.audience], ['Oferta', profile.company.offer],
    ['Região', profile.company.region], ['Horários', profile.company.hours],
    ['Objetivo comercial', profile.sales.goal], ['Tom de voz', profile.sales.tone],
    ['Perguntas de qualificação', profile.sales.qualification],
    ['Encaminhamento humano', profile.sales.handoff],
  ];
  return fields.filter(([, value]) => value.trim()).map(([label, value]) => `${label}: ${value.trim()}`).join('\n');
}

type TrainingQuestionCopy = { label: string; question: string; placeholder: string; multiline: boolean };
export type TrainingQuestion =
  | (TrainingQuestionCopy & { section: 'company'; key: keyof TrainingProfile['company'] })
  | (TrainingQuestionCopy & { section: 'sales'; key: keyof TrainingProfile['sales'] });

export function trainingAnswer(profile: TrainingProfile, item: TrainingQuestion): string {
  return item.section === 'company' ? profile.company[item.key] : profile.sales[item.key];
}

export function withTrainingAnswer(profile: TrainingProfile, item: TrainingQuestion, value: string): TrainingProfile {
  return item.section === 'company'
    ? { ...profile, company: { ...profile.company, [item.key]: value } }
    : { ...profile, sales: { ...profile.sales, [item.key]: value } };
}

export const trainingQuestions: TrainingQuestion[] = [
  { section: 'company', key: 'name', label: 'Nome da empresa', question: 'Qual é o nome da sua empresa?', placeholder: 'Ex.: Clínica São Lucas', multiline: false },
  { section: 'company', key: 'segment', label: 'Segmento', question: 'Em qual segmento vocês atuam?', placeholder: 'Ex.: clínica odontológica, cartão de benefícios, estética…', multiline: false },
  { section: 'company', key: 'audience', label: 'Público atendido', question: 'Quem são os clientes que vocês atendem?', placeholder: 'Ex.: famílias da região, adultos de 30 a 60 anos, empresas…', multiline: true },
  { section: 'company', key: 'offer', label: 'O que oferece', question: 'O que a sua empresa oferece?', placeholder: 'Descreva produtos, serviços e diferenciais principais.', multiline: true },
  { section: 'company', key: 'region', label: 'Regiões atendidas', question: 'Quais regiões vocês atendem?', placeholder: 'Ex.: Ijuí e região, todo o RS, online para todo o Brasil…', multiline: false },
  { section: 'company', key: 'hours', label: 'Horários', question: 'Quais são os horários de atendimento?', placeholder: 'Ex.: segunda a sexta, 8h às 18h; sábados, 8h às 12h.', multiline: false },
  { section: 'sales', key: 'goal', label: 'Objetivo da conversa', question: 'Qual é o objetivo da conversa do SDR?', placeholder: 'Ex.: entender a necessidade e agendar uma avaliação.', multiline: true },
  { section: 'sales', key: 'tone', label: 'Tom de voz', question: 'Qual tom de voz o SDR deve usar?', placeholder: 'Ex.: próximo, profissional e direto.', multiline: false },
  { section: 'sales', key: 'qualification', label: 'Perguntas de qualificação', question: 'O que o SDR precisa descobrir para qualificar o cliente?', placeholder: 'Ex.: cidade, quantas pessoas na família, se já usa algum plano…', multiline: true },
  { section: 'sales', key: 'handoff', label: 'Quando encaminhar a uma pessoa', question: 'Quando o SDR deve passar a conversa para uma pessoa?', placeholder: 'Ex.: quando o cliente pedir para falar com alguém ou quiser fechar.', multiline: true },
];

export type TrainingStage = 'company' | 'sales' | 'facts' | 'test' | 'done';

/** Where a returning user should resume the onboarding. The test step is optional because it
 *  depends on a published flow and an OpenAI key, which the user may not have yet. */
export function trainingOnboardingProgress(input: {
  profile: TrainingProfile | null;
  profileApproved: boolean;
  approvedFacts: number;
}): { complete: boolean; stage: TrainingStage; questionIndex: number } {
  const profile = input.profile;
  const firstEmpty = trainingQuestions.findIndex(item => !profile || !trainingAnswer(profile, item).trim());
  if (!input.profileApproved) {
    const questionIndex = firstEmpty === -1 ? trainingQuestions.length : firstEmpty;
    const stage = questionIndex < trainingQuestions.length && trainingQuestions[questionIndex]?.section === 'company' ? 'company' : 'sales';
    return { complete: false, stage, questionIndex };
  }
  if (input.approvedFacts === 0) return { complete: false, stage: 'facts', questionIndex: trainingQuestions.length };
  return { complete: true, stage: 'done', questionIndex: trainingQuestions.length };
}
