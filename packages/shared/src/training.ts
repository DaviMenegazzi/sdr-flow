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
