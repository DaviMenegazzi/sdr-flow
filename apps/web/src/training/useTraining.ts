import { useCallback, useEffect, useState } from 'react';
import { trainingFactSchema, trainingOnboardingProgress, trainingProfileSchema, type TrainingFact, type TrainingProfile } from '@sdr/shared';
import { useSession } from '../session';

export type FactRow = TrainingFact & { id: string; status: 'draft' | 'approved' | 'archived'; revision: number };
export type AgentRow = { id: string; name: string; active_flow_version_id?: string | null; hasOpenaiKey?: boolean };
export type Readiness = { ready: boolean; checks: Record<string, boolean> };
export type TestResult = { answer: string; sources: string[] };

export const emptyProfile: TrainingProfile = {
  company: { name: '', segment: '', audience: '', offer: '', region: '', hours: '' },
  sales: { goal: '', tone: '', qualification: '', handoff: '' },
};

export const factCategories: Array<{ value: TrainingFact['category']; label: string }> = [
  { value: 'pricing', label: 'Preços e condições' }, { value: 'catalog', label: 'Produtos e serviços' },
  { value: 'faq', label: 'Perguntas frequentes' }, { value: 'objections', label: 'Objeções' },
  { value: 'documents', label: 'Políticas' },
];

const skipKey = (org: string) => `sdr-flow:onboarding-skipped:${org}`;
export function onboardingSkipped(org: string | null | undefined) {
  if (!org) return false;
  try { return localStorage.getItem(skipKey(org)) === '1'; } catch { return false; }
}
export function skipOnboarding(org: string | null | undefined) {
  if (!org) return;
  try { localStorage.setItem(skipKey(org), '1'); } catch { /* the redirect simply happens again */ }
}

/** Training profile, facts and agent test shared by the onboarding and the knowledge base. */
export function useTraining() {
  const { activeOrg, session, activeRole } = useSession();
  const canEdit = activeRole === 'owner' || activeRole === 'admin';
  const token = session?.access_token;
  const [profile, setProfile] = useState<TrainingProfile>(emptyProfile);
  const [hasProfile, setHasProfile] = useState(false);
  const [profileApproved, setProfileApproved] = useState(false);
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token || ''}`, 'Content-Type': 'application/json', ...init?.headers },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `Falha na solicitação (${response.status}).`);
    return data;
  }, [token]);
  const base = `/api/organizations/${activeOrg}/training`;

  const refresh = useCallback(async () => {
    if (!activeOrg || !token) return;
    const [stored, rows, agentList] = await Promise.all([
      request(`${base}/profile`), request(`${base}/facts`), request('/api/me/agents'),
    ]);
    if (stored) {
      setProfile({ company: { ...emptyProfile.company, ...stored.company }, sales: { ...emptyProfile.sales, ...stored.sales } });
      setHasProfile(true);
      setProfileApproved(stored.status === 'approved');
    } else {
      setProfile(emptyProfile); setHasProfile(false); setProfileApproved(false);
    }
    setFacts(rows || []);
    setAgents(agentList?.agents || []);
  }, [activeOrg, token, base, request]);

  useEffect(() => {
    setLoading(true); setError('');
    refresh().catch(cause => setError(cause instanceof Error ? cause.message : 'Falha ao carregar treinamento.')).finally(() => setLoading(false));
  }, [refresh]);

  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError('');
    try { return await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.'); return undefined; }
    finally { setBusy(false); }
  };

  /** Saving always resets the profile to draft on the API, and the runtime only reads approved
   *  profiles. `approve` re-approves in the same action so a live SDR never loses its context. */
  const saveProfile = (next: TrainingProfile, options: { approve: boolean }) => run(async () => {
    const parsed = trainingProfileSchema.parse(next);
    await request(`${base}/profile`, { method: 'PUT', body: JSON.stringify(parsed) });
    setProfile(next); setHasProfile(true); setProfileApproved(false);
    if (options.approve) {
      await request(`${base}/profile/approve`, { method: 'POST' });
      setProfileApproved(true);
    }
    return true;
  });

  const saveFact = (fact: TrainingFact, options: { id?: string | null; approve?: boolean }) => run(async () => {
    const parsed = trainingFactSchema.parse(fact);
    const saved = await request(`${base}/facts${options.id ? `/${options.id}` : ''}`, {
      method: options.id ? 'PATCH' : 'POST', body: JSON.stringify(parsed),
    });
    const id = options.id || saved?.id;
    if (options.approve && id) await request(`${base}/facts/${id}/approve`, { method: 'POST' });
    await refresh();
    return true;
  });

  const changeFact = (id: string, action: 'approve' | 'archive') => run(async () => {
    await request(`${base}/facts/${id}/${action}`, { method: 'POST' });
    await refresh();
  });

  const suggestQuestions = (agentId: string) => run(async () => {
    const result = await request(`${base}/suggestions`, { method: 'POST', body: JSON.stringify({ agentId }) });
    return (result?.questions || []) as string[];
  });

  const readiness = useCallback((agentId: string) => request(`/api/me/agents/${agentId}/training-readiness`) as Promise<Readiness>, [request]);

  const testAgent = (agentId: string, message: string) => run(async (): Promise<TestResult> => {
    const result = await request(`/api/me/agents/${agentId}/test`, { method: 'POST', body: JSON.stringify({ message }) });
    if (result.status === 'failed') throw new Error(result.error || 'O fluxo falhou.');
    return {
      answer: result.sentMessages?.filter((message: { type: string }) => message.type === 'text').map((message: { content: string }) => message.content).join('\n') || result.decision?.reply || 'O fluxo não produziu resposta de texto.',
      sources: result.knowledgeUsed || [],
    };
  });

  const approvedFacts = facts.filter(row => row.status === 'approved').length;
  const progress = trainingOnboardingProgress({ profile: hasProfile ? profile : null, profileApproved, approvedFacts });

  return {
    canEdit, profile, setProfile, hasProfile, profileApproved, facts, agents, approvedFacts, progress,
    loading, busy, error, setError, refresh, saveProfile, saveFact, changeFact, suggestQuestions, readiness, testAgent,
  };
}

export type TrainingState = ReturnType<typeof useTraining>;

/** `stale` is true while a refetch triggered by `refreshKey` is in flight; the first-access
 *  redirect waits for it so leaving the onboarding never bounces back on the old status. */
export type OnboardingStatus = { loading: boolean; stale: boolean; complete: boolean; canEdit: boolean };

/** Lightweight check used by the first-access redirect and the "finish training" banner. */
export function useOnboardingStatus(refreshKey?: unknown): OnboardingStatus {
  const { activeOrg, session, activeRole } = useSession();
  const token = session?.access_token;
  const canEdit = activeRole === 'owner' || activeRole === 'admin';
  const [state, setState] = useState<{ org: string | null; key: unknown; complete: boolean } | null>(null);
  useEffect(() => {
    if (!activeOrg || !token) return;
    let cancelled = false;
    const get = (path: string) => fetch(`/api/organizations/${activeOrg}/training/${path}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))));
    Promise.all([get('profile'), get('facts')]).then(([stored, rows]: [{ status?: string; company?: TrainingProfile['company']; sales?: TrainingProfile['sales'] } | null, FactRow[] | null]) => {
      if (cancelled) return;
      const parsed = stored ? trainingProfileSchema.safeParse({ company: stored.company, sales: stored.sales }) : null;
      const { complete } = trainingOnboardingProgress({
        profile: parsed?.success ? parsed.data : null,
        profileApproved: stored?.status === 'approved',
        approvedFacts: (rows || []).filter(row => row.status === 'approved').length,
      });
      setState({ org: activeOrg, key: refreshKey, complete });
    }).catch(() => {
      // Never block the app on this check: an unknown status behaves as "complete".
      if (!cancelled) setState({ org: activeOrg, key: refreshKey, complete: true });
    });
    return () => { cancelled = true; };
  }, [activeOrg, token, refreshKey]);
  const current = state && state.org === activeOrg ? state : null;
  return { loading: !current, stale: !current || current.key !== refreshKey, complete: current?.complete ?? true, canEdit };
}
