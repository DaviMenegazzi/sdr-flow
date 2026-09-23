import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import type { MemberRole, OrgTier, Capability } from '@sdr/shared';


const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;

interface Org {
  id: string;
  name: string;
  role?: MemberRole;
  tier?: OrgTier;
}

interface Member {
  organization_id: string;
  user_id: string;
  display_name?: string | null;
  role: MemberRole;
  created_at: string;
}

interface AgentSummary {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  provider: string;
  model: string;
  is_default?: boolean;
}

interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  expires_at: string;
  created_at: string;
}

interface ApiKeyItem {
  id: string;
  name: string;
  key_prefix: string;
  role: MemberRole;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

interface SessionContextType {
  session: Session | null;
  organizations: Org[];
  activeOrg: string;
  activeRole: MemberRole | null;
  activeTier: OrgTier | null;
  capabilities: Capability[];
  can(capability: Capability): boolean;
  setActiveOrg(id: string): void;
  reload(): Promise<void>;
  /** Recarrega /api/me (tier e capabilities efetivos), ex.: após confirmação de pagamento. */
  refresh(): void;
  loading: boolean;
  profile: {
    role: 'admin' | 'client';
    platformRole?: 'admin' | 'client';
    status: string;
    organizationId: string;
    memberRole?: MemberRole;
    orgTier?: OrgTier;
    capabilities?: Capability[];
  } | null;
  signOut(): Promise<void>;
}

const Context = createContext<SessionContextType>({
  session: null,
  organizations: [],
  activeOrg: '',
  activeRole: null,
  activeTier: null,
  capabilities: [],
  can: () => false,
  setActiveOrg: () => {},
  reload: async () => {},
  refresh: () => {},
  loading: true,
  profile: null,
  signOut: async () => {},
});

export const useSession = () => useContext(Context);

export function Can({
  do: capability,
  children,
  fallback = null,
}: {
  do: Capability;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useSession();
  return can(capability) ? <>{children}</> : <>{fallback}</>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState('');
  const [activeRole, setActiveRole] = useState<MemberRole | null>(null);
  const [activeTier, setActiveTier] = useState<OrgTier | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(() => Boolean(supabase));
  const [profile, setProfile] = useState<SessionContextType['profile']>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  // A refresh keeps the current UI mounted (no loading gate) while /api/me is re-read.
  const silentRefresh = useRef(false);

  const reload = async () => {
    if (!supabase || !session) return;
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, tier')
      .order('name');
    if (orgError) throw orgError;

    const rows = (orgData ?? []) as Org[];
    setOrganizations(rows);

    const currentOrgId = rows.some((org) => org.id === activeOrg) ? activeOrg : rows[0]?.id ?? '';
    setActiveOrg(currentOrgId);

    const currentOrg = rows.find((org) => org.id === currentOrgId);
    if (currentOrg?.tier) setActiveTier(currentOrg.tier);

    if (currentOrgId && session?.user?.id) {
      const { data: memberData } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', currentOrgId)
        .eq('user_id', session.user.id)
        .maybeSingle();

      setActiveRole((memberData?.role as MemberRole) ?? null);
    } else {
      setActiveRole(null);
    }
  };

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    // With a session, stay in the loading state until /api/me answers (effect below); ending it
    // here let AuthGate render once with a session but no profile and bounce deep links
    // (e.g. the checkout return URL) through /login to /dashboard.
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    if (!session) {
      setProfile(null);
      setActiveTier(null);
      setCapabilities([]);
      return;
    }
    if (!silentRefresh.current) setLoading(true);
    silentRefresh.current = false;
    const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}` };
    if (activeOrg) headers['X-Organization-Id'] = activeOrg;
    void fetch('/api/me', { headers })
      .then(async (response) => {
        if (!response.ok) {
          setProfile(null);
          return;
        }
        const me = await response.json();
        setProfile({
          role: me.role,
          platformRole: me.platformRole,
          status: me.status,
          organizationId: me.organizationId,
          memberRole: me.memberRole,
          orgTier: me.orgTier,
          capabilities: me.capabilities,
        });
        if (me.orgTier) setActiveTier(me.orgTier);
        if (Array.isArray(me.capabilities)) setCapabilities(me.capabilities);
        if (me.memberRole) setActiveRole(me.memberRole);
      })
      .finally(() => setLoading(false));
  }, [session?.access_token, activeOrg, profileVersion]);

  const signOut = async () => {
    setOrganizations([]);
    setActiveOrg('');
    setActiveRole(null);
    setActiveTier(null);
    setCapabilities([]);
    setProfile(null);
    setSession(null);
    try { localStorage.removeItem('sdr-flow:active-instance'); } catch {}
    await supabase?.auth.signOut();
  };

  useEffect(() => {
    if (!supabase) return;
    setOrganizations([]);
    setActiveOrg('');
    setActiveRole(null);
    setActiveTier(null);
    setCapabilities([]);
    if (session) void reload().catch(() => setOrganizations([]));
  }, [session?.user.id]);

  useEffect(() => {
    if (activeOrg && session?.user?.id && supabase) {
      void supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', activeOrg)
        .eq('user_id', session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          setActiveRole((data?.role as MemberRole) ?? null);
        });
      const currentOrg = organizations.find((o) => o.id === activeOrg);
      if (currentOrg?.tier) setActiveTier(currentOrg.tier);
    }
  }, [activeOrg]);

  const can = (cap: Capability): boolean => {
    if (profile?.role === 'admin' || profile?.platformRole === 'admin') return true;
    return capabilities.includes(cap);
  };

  return (
    <Context.Provider
      value={{
        session,
        organizations,
        activeOrg,
        activeRole,
        activeTier,
        capabilities,
        can,
        setActiveOrg,
        reload,
        refresh: () => { silentRefresh.current = true; setProfileVersion(version => version + 1); },
        loading,
        profile,
        signOut,
      }}
    >
      {children}
    </Context.Provider>
  );
}


