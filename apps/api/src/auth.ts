import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { userDatabase, type UserDatabase } from '@sdr/db';

export type AppRole = 'admin' | 'client';
export interface AuthContext {
  userId: string;
  email?: string;
  appRole: AppRole;
  profileStatus: 'active';
  organizationId: string;
  token: string;
  db: UserDatabase;
}

declare global {
  namespace Express { interface Locals { auth?: AuthContext } }
}

const bearer = /^Bearer (\S+)$/i;

export function authMiddleware(config: { supabaseUrl?: string; anonKey?: string }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!config.supabaseUrl || !config.anonKey) {
      res.status(503).json({ error: 'Autenticação indisponível.' });
      return;
    }
    const token = bearer.exec(req.get('authorization') ?? '')?.[1];
    if (!token) { res.status(401).json({ error: 'Autenticação obrigatória.' }); return; }
    const db = userDatabase(config.supabaseUrl, config.anonKey, token);
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user?.id) { res.status(401).json({ error: 'Sessão inválida ou expirada.' }); return; }
    const { data: profile, error: profileError } = await db.from('profiles').select('role,status,default_organization_id').eq('user_id', user.id).maybeSingle();
    if (profileError || !profile || profile.status !== 'active' || !profile.default_organization_id) {
      res.status(404).json({ error: 'Conta não encontrada.' }); return;
    }
    res.locals.auth = { userId: user.id, email: user.email, appRole: profile.role as AppRole, profileStatus: 'active', organizationId: profile.default_organization_id, token, db };
    next();
  };
}

export function requireRole(...roles: AppRole[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!res.locals.auth) { res.status(401).json({ error: 'Autenticação obrigatória.' }); return; }
    if (!roles.includes(res.locals.auth.appRole)) { res.status(404).json({ error: 'Recurso não encontrado.' }); return; }
    next();
  };
}

export const uuidParam = z.string().uuid();
