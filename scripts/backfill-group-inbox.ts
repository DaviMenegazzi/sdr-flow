import { serviceDatabase, ConversationRepository } from '../packages/db/src/index.js';
import { resolveGroupSubject } from '../packages/runtime/src/index.js';

// Plan items 2 (manual "group renamed" resync) and 8 (backfill): one on-demand command that (1)
// recovers what the pre-fix code path never captured — is_group and historical
// messages.sender_name/sender_jid, both via the purely-SQL backfill_group_inbox RPC — then (2)
// re-resolves every group's title against Evolution's own catalog, the same resolver the live
// webhook path uses, so a WhatsApp rename catches up without waiting for a fresh message.

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
}

const db = serviceDatabase(supabaseUrl, serviceRoleKey);
const convRepo = new ConversationRepository(db);

console.log('Etapa 1/2: marcando grupos e recuperando sender_name/sender_jid históricos...');
const { data: backfillResult, error: backfillError } = await db.rpc('backfill_group_inbox', {});
if (backfillError) throw backfillError;
const summary = Array.isArray(backfillResult) ? backfillResult[0] : backfillResult;
console.log(`  leads marcados como grupo: ${summary?.leads_marked_group ?? 0}`);
console.log(`  mensagens com sender_name/sender_jid recuperados: ${summary?.messages_sender_backfilled ?? 0}`);

console.log('Etapa 2/2: resincronizando nomes de grupo com a Evolution...');
const { data: groupLeads, error: leadsError } = await db
  .from('leads')
  .select('id, organization_id, connection_id, phone, group_subject')
  .eq('is_group', true)
  .not('connection_id', 'is', null);
if (leadsError) throw leadsError;

let resynced = 0;
let unchanged = 0;
let failed = 0;
for (const lead of groupLeads ?? []) {
  if (!lead.connection_id) { unchanged++; continue; }
  const groupJid = `${lead.phone}@g.us`;
  try {
    const subject = await resolveGroupSubject(db, lead.organization_id, lead.connection_id, groupJid);
    if (!subject || subject === lead.group_subject) { unchanged++; continue; }
    await convRepo.syncGroupIdentity(lead.organization_id, lead.id, subject, { synced: true });
    resynced++;
    console.log(`  atualizado: ${lead.phone} -> "${subject}"`);
  } catch (err) {
    failed++;
    console.warn(`  falha ao resincronizar ${lead.phone}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`Concluído: ${resynced} nome(s) de grupo atualizado(s), ${unchanged} sem alteração, ${failed} falha(s).`);
