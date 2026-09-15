import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { createApp } from './app.js';
import { wsServer } from './ws.js';
import { runtimeConfigFromEnv } from '@sdr/flow/server';
import { serviceDatabase, userDatabase } from '@sdr/db';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const logger = pino({ redact: ['req.headers.authorization', '*.key', '*.token'] });
if (process.env.NODE_ENV === 'production' && (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error('Configuração Supabase obrigatória ausente.');
const app = createApp({ ...runtimeConfigFromEnv(process.env), publicApiUrl: process.env.PUBLIC_API_URL, supabaseUrl: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY, evolutionServerUrl: process.env.EVOLUTION_SERVER_URL, evolutionApiKey: process.env.EVOLUTION_API_KEY, redisUrl: process.env.REDIS_URL, allowedOrigins:(process.env.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean) });
const server = app.listen(Number(process.env.PORT ?? 3001),process.env.HOST ?? '127.0.0.1',() => logger.info({ port: process.env.PORT ?? 3001 },'SDR Flow API ready'));
wsServer.attach(server, {
  async authenticate(token) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
    const db = userDatabase(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, token);
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) return null;
    const { data: profile } = await db.from('profiles').select('status').eq('user_id', user.id).maybeSingle();
    return profile?.status === 'active' ? { userId: user.id } : null;
  },
  async authorize(userId, scope) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const db = serviceDatabase(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    // Inbox channel (Fase 5, 11.2.2): org-wide subscription, no connection/flow/execution to
    // derive the org from — verify active membership directly against organization_members,
    // the same table the REST inbox routes gate on (apps/api/src/app.ts orgRoutes middleware).
    if (scope.organizationId && !scope.connectionId && !scope.flowId && !scope.executionId && !scope.conversationId) {
      const { data: membership } = await db
        .from('organization_members')
        .select('role')
        .eq('organization_id', scope.organizationId)
        .eq('user_id', userId)
        .maybeSingle();
      return membership ? { organizationId: scope.organizationId } : null;
    }
    if (scope.flowId) {
      const { data: flow } = await db.from('flows').select('organization_id').eq('id',scope.flowId).maybeSingle();
      const { data: profile } = flow ? await db.from('profiles').select('user_id').eq('user_id',userId).eq('default_organization_id',flow.organization_id).eq('status','active').maybeSingle() : { data:null };
      if (flow && profile) return { organizationId: flow.organization_id };
    }
    let connectionId = scope.connectionId;
    if (!connectionId && scope.conversationId) {
      const { data: conversation } = await db.from('conversations').select('connection_id').eq('id', scope.conversationId).maybeSingle();
      connectionId = conversation?.connection_id;
    }
    if (!connectionId && scope.executionId) {
      const { data: execution } = await db.from('flow_executions').select('conversation_id').eq('id', scope.executionId).maybeSingle();
      if (execution) {
        const { data: conversation } = await db.from('conversations').select('connection_id').eq('id', execution.conversation_id).maybeSingle();
        connectionId = conversation?.connection_id;
      }
    }
    if (!connectionId) return null;
    const { data } = await db.from('connections').select('organization_id').eq('id', connectionId).eq('owner_user_id', userId).maybeSingle();
    return data ? { organizationId: data.organization_id } : null;
  },
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async () => {
  wsServer.close();
  await app.locals.closeRuntime?.();
  server.close(() => process.exit(0));
});
