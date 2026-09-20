import { z } from 'zod';

export const memberRoleSchema = z.enum(['owner', 'admin', 'agent', 'viewer']);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const accountRoleSchema = z.enum(['admin', 'client']);
export type AccountRole = z.infer<typeof accountRoleSchema>;

export const orgTiers = ['pre-venda', 'vendedor', 'vendedor-senior'] as const;
export type OrgTier = (typeof orgTiers)[number];
export const orgTierSchema = z.enum(orgTiers);

export const capabilities = [
  'inbox:read',
  'inbox:reply',
  'inbox:takeover',
  'dashboard:read',
  'agents:manage',
  'instances:manage',
  'flows:read',
  'flows:edit',
  'flows:publish',
  'integrations:manage',
  'payment_gates:manage',
  'team:manage',
  'apikeys:manage',
] as const;

export type Capability = (typeof capabilities)[number];
export const capabilitySchema = z.enum(capabilities);

/**
 * Matriz estática tipada de capabilities por Tier e Role.
 *
 * - pre-venda: acesso a Inbox, Dashboard (Indicadores) e Agentes de IA das instâncias configuradas. Sem acesso a integrações externas ou gates de pagamento.
 * - vendedor: acesso a Inbox, Dashboard, Agentes de IA e controle de Integrações externas (ex: Google Calendar).
 * - vendedor-senior: acesso completo, incluindo Gates de Pagamento (Asaas, Stripe, Mercado Pago) dentro das integrações.
 *
 * Todos os tiers têm acesso à aba de agentes das instâncias configuradas naquele login.
 */
export const CAPABILITIES: Record<OrgTier, Record<MemberRole, readonly Capability[]>> = {
  'pre-venda': {
    owner: [
      'inbox:read',
      'inbox:reply',
      'inbox:takeover',
      'dashboard:read',
      'agents:manage',
      'instances:manage',
      'flows:read',
      'flows:edit',
      'flows:publish',
      'team:manage',
      'apikeys:manage',
    ],
    admin: [
      'inbox:read',
      'inbox:reply',
      'inbox:takeover',
      'dashboard:read',
      'agents:manage',
      'instances:manage',
      'flows:read',
      'flows:edit',
      'flows:publish',
      'team:manage',
    ],
    agent: ['inbox:read', 'inbox:reply', 'inbox:takeover', 'dashboard:read', 'agents:manage'],
    viewer: ['inbox:read', 'dashboard:read'],
  },
  vendedor: {
    owner: [
      'inbox:read',
      'inbox:reply',
      'inbox:takeover',
      'dashboard:read',
      'agents:manage',
      'instances:manage',
      'flows:read',
      'flows:edit',
      'flows:publish',
      'integrations:manage',
      'team:manage',
      'apikeys:manage',
    ],
    admin: [
      'inbox:read',
      'inbox:reply',
      'inbox:takeover',
      'dashboard:read',
      'agents:manage',
      'instances:manage',
      'flows:read',
      'flows:edit',
      'flows:publish',
      'integrations:manage',
      'team:manage',
    ],
    agent: ['inbox:read', 'inbox:reply', 'inbox:takeover', 'dashboard:read', 'agents:manage'],
    viewer: ['inbox:read', 'dashboard:read'],
  },
  'vendedor-senior': {
    owner: [
      'inbox:read',
      'inbox:reply',
      'inbox:takeover',
      'dashboard:read',
      'agents:manage',
      'instances:manage',
      'flows:read',
      'flows:edit',
      'flows:publish',
      'integrations:manage',
      'payment_gates:manage',
      'team:manage',
      'apikeys:manage',
    ],
    admin: [
      'inbox:read',
      'inbox:reply',
      'inbox:takeover',
      'dashboard:read',
      'agents:manage',
      'instances:manage',
      'flows:read',
      'flows:edit',
      'flows:publish',
      'integrations:manage',
      'payment_gates:manage',
      'team:manage',
    ],
    agent: ['inbox:read', 'inbox:reply', 'inbox:takeover', 'dashboard:read', 'agents:manage'],
    viewer: ['inbox:read', 'dashboard:read'],
  },
};

export function getCapabilities(tier: OrgTier, role: MemberRole): readonly Capability[] {
  return CAPABILITIES[tier]?.[role] ?? [];
}

const CLIENT_FORBIDDEN_CAPABILITIES = new Set<Capability>([
  'instances:manage',
  'flows:read',
  'flows:edit',
  'flows:publish',
  'team:manage',
  'apikeys:manage',
]);

/**
 * Platform clients never inherit administrative product surfaces merely because
 * their organization membership was accidentally elevated to owner/admin.
 * The account role is trusted server data from public.profiles, not user metadata.
 */
export function getAccountCapabilities(
  accountRole: AccountRole,
  tier: OrgTier,
  memberRole: MemberRole,
): readonly Capability[] {
  const memberCapabilities = getCapabilities(tier, memberRole);
  if (accountRole === 'admin') return memberCapabilities;
  return memberCapabilities.filter((capability) => !CLIENT_FORBIDDEN_CAPABILITIES.has(capability));
}

export function hasCapability(tier: OrgTier, role: MemberRole, capability: Capability): boolean {
  return getCapabilities(tier, role).includes(capability);
}
