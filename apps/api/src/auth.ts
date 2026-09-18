import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { userDatabase, type UserDatabase } from '@sdr/db';
import {
  type MemberRole,
  type OrgTier,
  type Capability,
  getCapabilities,
} from '@sdr/shared';

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

export function authMiddleware(config: { supabaseUrl?: string; anonKey?: string }) {
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
    const {
      data: { user },
      error,
    } = await db.auth.getUser(token);
    if (error || !user?.id) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      return;
    }
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('role,status,default_organization_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError || !profile || profile.status !== 'active' || !profile.default_organization_id) {
      res.status(404).json({ error: 'Conta não encontrada.' });
      return;
    }

    // Resolução dinâmica da organização ativa (Blind Spot 2: Prisão do default_organization_id)
    const requestedOrg = (
      req.get('x-organization-id') ||
      (typeof req.query.organizationId === 'string' ? req.query.organizationId : '') ||
      ''
    ).trim();
    const targetOrgId = requestedOrg || profile.default_organization_id;

    // Consulta membership da organização ativa
    const { data: memberData, error: memberError } = await db
      .from('organization_members')
      .select('role')
      .eq('organization_id', targetOrgId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError || !memberData) {
      if (requestedOrg) {
        res.status(403).json({ error: 'Acesso negado à organização solicitada.' });
        return;
      }
      res.status(403).json({ error: 'Você não é membro desta organização.' });
      return;
    }

    const memberRole = memberData.role as MemberRole;

    // Consulta tier da organização ativa
    let orgTier: OrgTier = 'pre-venda';
    try {
      const { data: orgData } = await db
        .from('organizations')
        .select('tier')
        .eq('id', targetOrgId)
        .maybeSingle();
      if ((orgData as any)?.tier) {
        orgTier = (orgData as any).tier;
      }
    } catch {
      // fallback to pre-venda
    }
    const caps = new Set<Capability>(getCapabilities(orgTier, memberRole));

    res.locals.auth = {
      userId: user.id,
      email: user.email,
      appRole: profile.role as AppRole,
      platformRole: profile.role as AppRole,
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
    if (!res.locals.auth) {
      res.status(401).json({ error: 'Autenticação obrigatória.' });
      return;
    }
    if (!res.locals.auth.capabilities.has(cap)) {
      res.status(403).json({
        error: 'Acesso não permitido pelo seu plano ou perfil.',
        requiredCapability: cap,
      });
      return;
    }
    next();
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
