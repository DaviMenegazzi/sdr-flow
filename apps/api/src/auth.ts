import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { userDatabase, type UserDatabase } from '@sdr/db';
import {
  type MemberRole,
  type OrgTier,
  type Capability,
  getCapabilities,
  tierHasCapability,
} from '@sdr/shared';

// Every request re-verified the JWT with Supabase Auth, then read profiles, organization_members
// and organizations.tier sequentially -- up to 4 round trips per request, exhausting the
// PgBouncer pool under load. Cache each of those (independently, since they depend on different
// keys) for a short TTL: stale-for-20s is an acceptable trade for not hammering Postgres on
// every request, and a role/tier change now takes up to 20s to take effect instead of 0.
const AUTH_CACHE_TTL_MS = 20_000;
const AUTH_CACHE_MAX_ENTRIES = 5000;

function createTtlCache<T>() {
  const store = new Map<string, { value: T; expiresAt: number }>();
  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt < Date.now()) {
        store.delete(key);
        return undefined;
      }
      store.delete(key);
      store.set(key, hit); // touch: keeps recently-used entries out of the eviction path below
      return hit.value;
    },
    set(key: string, value: T) {
      if (store.size >= AUTH_CACHE_MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
    },
  };
}

interface CachedUser {
  userId: string;
  email?: string;
}

interface CachedProfile {
  appRole: 'admin' | 'client';
  profileStatus: 'active' | 'invited' | 'suspended' | 'disabled';
  defaultOrganizationId: string | null;
}

interface CachedOrgAccess {
  role: MemberRole;
  orgTier: OrgTier;
}

export interface AuthCache {
  resolveUser(db: UserDatabase, token: string): Promise<CachedUser | null>;
  resolveProfile(db: UserDatabase, userId: string): Promise<CachedProfile | null>;
  resolveOrgAccess(db: UserDatabase, userId: string, organizationId: string): Promise<CachedOrgAccess | null>;
}

/**
 * One cache instance per running app (created once in createApp, not at module scope) so tests
 * that spin up a fresh app per case never see another case's cached role/tier.
 */
export function createAuthCache(): AuthCache {
  const userCache = createTtlCache<CachedUser>();
  const profileCache = createTtlCache<CachedProfile>();
  const orgAccessCache = createTtlCache<CachedOrgAccess>();

  return {
    async resolveUser(db, token) {
      const cached = userCache.get(token);
      if (cached) return cached;
      const {
        data: { user },
        error,
      } = await db.auth.getUser(token);
      if (error || !user?.id) return null;
      const resolved = { userId: user.id, email: user.email };
      userCache.set(token, resolved);
      return resolved;
    },

    async resolveProfile(db, userId) {
      const cached = profileCache.get(userId);
      if (cached) return cached;
      const { data: profile, error } = await db
        .from('profiles')
        .select('role,status,default_organization_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (error || !profile) return null;
      const resolved = {
        appRole: profile.role as CachedProfile['appRole'],
        profileStatus: profile.status as CachedProfile['profileStatus'],
        defaultOrganizationId: profile.default_organization_id,
      };
      profileCache.set(userId, resolved);
      return resolved;
    },

    async resolveOrgAccess(db, userId, organizationId) {
      const key = `${userId}:${organizationId}`;
      const cached = orgAccessCache.get(key);
      if (cached) return cached;
      const { data: memberData, error: memberError } = await db
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .maybeSingle();
      if (memberError || !memberData) return null;
      let orgTier: OrgTier = 'pre-venda';
      try {
        const { data: orgData } = await db.from('organizations').select('tier').eq('id', organizationId).maybeSingle();
        if ((orgData as any)?.tier) orgTier = (orgData as any).tier;
      } catch {
        // fallback to pre-venda
      }
      const resolved = { role: memberData.role as MemberRole, orgTier };
      orgAccessCache.set(key, resolved);
      return resolved;
    },
  };
}

export type AppRole = 'admin' | 'client';
export type PlatformRole = AppRole;

export interface AuthContext {
  userId: string;
  email?: string;
  appRole: AppRole;
  platformRole: PlatformRole;
  profileStatus: 'active';
  organizationId: string;
  memberRole: MemberRole;
  orgTier: OrgTier;
  capabilities: Set<Capability>;
  token: string;
  db: UserDatabase;
}

declare global {
  namespace Express {
    interface Locals {
      auth?: AuthContext;
    }
  }
}

const bearer = /^Bearer (\S+)$/i;

export function authMiddleware(config: { supabaseUrl?: string; anonKey?: string }, cache: AuthCache = createAuthCache()) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!config.supabaseUrl || !config.anonKey) {
      res.status(503).json({ error: 'Autenticação indisponível.' });
      return;
    }
    const token = bearer.exec(req.get('authorization') ?? '')?.[1];
    if (!token) {
      res.status(401).json({ error: 'Autenticação obrigatória.' });
      return;
    }
    const db = userDatabase(config.supabaseUrl, config.anonKey, token);
    const user = await cache.resolveUser(db, token);
    if (!user) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      return;
    }
    const profile = await cache.resolveProfile(db, user.userId);
    if (!profile || profile.profileStatus !== 'active' || !profile.defaultOrganizationId) {
      res.status(404).json({ error: 'Conta não encontrada.' });
      return;
    }

    // Resolução dinâmica da organização ativa (Blind Spot 2: Prisão do default_organization_id)
    const requestedOrg = (
      req.get('x-organization-id') ||
      (typeof req.query.organizationId === 'string' ? req.query.organizationId : '') ||
      ''
    ).trim();
    const targetOrgId = requestedOrg || profile.defaultOrganizationId;

    const orgAccess = await cache.resolveOrgAccess(db, user.userId, targetOrgId);
    if (!orgAccess) {
      if (requestedOrg) {
        res.status(403).json({ error: 'Acesso negado à organização solicitada.' });
        return;
      }
      res.status(403).json({ error: 'Você não é membro desta organização.' });
      return;
    }

    const { role: memberRole, orgTier } = orgAccess;
    const caps = new Set<Capability>(getCapabilities(orgTier, memberRole));

    res.locals.auth = {
      userId: user.userId,
      email: user.email,
      appRole: profile.appRole,
      platformRole: profile.appRole,
      profileStatus: 'active',
      organizationId: targetOrgId,
      memberRole,
      orgTier,
      capabilities: caps,
      token,
      db,
    };
    next();
  };
}

export function requireCapability(cap: Capability) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const auth = res.locals.auth;
    if (!auth) {
      res.status(401).json({ error: 'Autenticação obrigatória.' });
      return;
    }
    if (auth.capabilities.has(cap)) {
      next();
      return;
    }
    // No role in this tier has the capability: it's a plan limitation (upgrade fixes it), not a
    // permission the user's role could ever be granted -- 402 says so instead of a bare 403.
    if (!tierHasCapability(auth.orgTier, cap)) {
      res.status(402).json({
        error: 'Recurso não incluído no seu plano atual.',
        requiredCapability: cap,
        currentTier: auth.orgTier,
      });
      return;
    }
    res.status(403).json({
      error: 'Acesso não permitido pelo seu perfil na organização.',
      requiredCapability: cap,
    });
  };
}

export function requireOrgRole(...roles: MemberRole[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!res.locals.auth) {
      res.status(401).json({ error: 'Autenticação obrigatória.' });
      return;
    }
    if (!res.locals.auth.memberRole || !roles.includes(res.locals.auth.memberRole)) {
      res.status(403).json({ error: 'Permissão insuficiente na organização.' });
      return;
    }
    next();
  };
}

export function requirePlatformRole(...roles: AppRole[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!res.locals.auth) {
      res.status(401).json({ error: 'Autenticação obrigatória.' });
      return;
    }
    if (!roles.includes(res.locals.auth.platformRole)) {
      res.status(404).json({ error: 'Recurso não encontrado.' });
      return;
    }
    next();
  };
}

// Mantido como alias para compatibilidade com rotas de administração global da plataforma
export const requireRole = requirePlatformRole;

export const uuidParam = z.string().uuid();
