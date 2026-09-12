import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { serviceDatabase } from '@sdr/db';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }

  const db = serviceDatabase(url, key);

  const { data: conns, error: connErr } = await db
    .from('connections')
    .select('id, name, provider, status, phone, owner_user_id, organization_id, created_at')
    .order('created_at', { ascending: true });

  if (connErr || !conns) {
    console.error('Error fetching connections:', connErr);
    return;
  }

  console.log(`=== SDR Flow Connections Inspection ===`);
  console.log(`Total connections in DB: ${conns.length}`);

  const counts: Record<string, number> = {};
  for (const c of conns) {
    counts[c.name] = (counts[c.name] || 0) + 1;
  }
  console.log('Connections by name:', counts);

  const whatsappConns = conns.filter(c => c.name === 'whatsapp');
  console.log(`Found ${whatsappConns.length} 'whatsapp' connections.`);

  if (whatsappConns.length <= 1) {
    console.log('No duplicate whatsapp connections found. Nothing to do.');
    return;
  }

  const canonical = whatsappConns[0];
  const duplicates = whatsappConns.slice(1);
  console.log(`Canonical connection ID: ${canonical.id}`);
  console.log(`Canonical phone: ${canonical.phone || 'null'} (setting to 555599940634)`);
  console.log(`Duplicate connections to process: ${duplicates.length}`);

  const shouldExecute = process.argv.includes('--execute');
  if (!shouldExecute) {
    console.log('\n[DRY-RUN] Pass --execute to run the deduplication.');
    return;
  }

  console.log('\n>>> EXECUTING CLEANUP <<<');

  // 1. Update canonical phone
  await db.from('connections').update({ phone: '555599940634' }).eq('id', canonical.id);
  console.log('1. Canonical phone updated.');

  let totalMigratedMsgs = 0;
  let totalMigratedConvs = 0;

  for (let idx = 0; idx < duplicates.length; idx++) {
    const dup = duplicates[idx];
    const progress = `[${idx + 1}/${duplicates.length}] dup=${dup.id}`;

    // A. Handle leads referencing this duplicate connection
    const { data: dupLeads } = await db
      .from('leads')
      .select('id, organization_id, phone')
      .eq('connection_id', dup.id);

    if (dupLeads && dupLeads.length > 0) {
      for (const lead of dupLeads) {
        if (lead.phone) {
          const { data: existingLead } = await db
            .from('leads')
            .select('id')
            .eq('organization_id', lead.organization_id)
            .eq('connection_id', canonical.id)
            .eq('phone', lead.phone)
            .maybeSingle();

          if (existingLead && existingLead.id !== lead.id) {
            await db.from('conversations').update({ lead_id: existingLead.id }).eq('lead_id', lead.id);
            await db.from('deals').update({ lead_id: existingLead.id }).eq('lead_id', lead.id);
            await db.from('leads').delete().eq('id', lead.id);
            continue;
          }
        }
        await db
          .from('leads')
          .update({
            connection_id: canonical.id,
            owner_user_id: canonical.owner_user_id,
          })
          .eq('id', lead.id);
      }
    }

    // B. Handle deals referencing this duplicate connection
    await db
      .from('deals')
      .update({
        connection_id: canonical.id,
        owner_user_id: canonical.owner_user_id,
      })
      .eq('connection_id', dup.id);

    // C. Handle knowledge documents
    await db
      .from('knowledge_documents')
      .update({
        connection_id: canonical.id,
        owner_user_id: canonical.owner_user_id,
      })
      .eq('connection_id', dup.id);

    // D. Migrate conversations and messages
    const { data: dupConvs } = await db
      .from('conversations')
      .select('*')
      .eq('connection_id', dup.id);

    if (dupConvs && dupConvs.length > 0) {
      for (const conv of dupConvs) {
        // Find existing canonical conversation for this lead
        const { data: existingConv } = await db
          .from('conversations')
          .select('id')
          .eq('organization_id', conv.organization_id)
          .eq('connection_id', canonical.id)
          .eq('lead_id', conv.lead_id)
          .maybeSingle();

        let targetConvId: string;
        if (existingConv) {
          targetConvId = existingConv.id;
        } else {
          // Create new conversation under canonical connection
          const { data: createdConv, error: createConvErr } = await db
            .from('conversations')
            .insert({
              organization_id: conv.organization_id,
              connection_id: canonical.id,
              lead_id: conv.lead_id,
              flow_version_id: conv.flow_version_id,
              stage: conv.stage,
              bot_paused: conv.bot_paused,
              handled_by: conv.handled_by,
              assigned_user_id: conv.assigned_user_id,
              last_message_at: conv.last_message_at,
              created_at: conv.created_at,
              updated_at: conv.updated_at,
            })
            .select('id')
            .single();

          if (createConvErr || !createdConv) {
            console.error(`Failed to create canonical conversation for lead ${conv.lead_id}:`, createConvErr);
            continue;
          }
          targetConvId = createdConv.id;
        }

        // Re-target flow_executions if any
        await db
          .from('flow_executions')
          .update({ conversation_id: targetConvId })
          .eq('conversation_id', conv.id);

        // Fetch and re-target messages
        const { data: msgs } = await db
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id);

        if (msgs && msgs.length > 0) {
          for (const m of msgs) {
            const { error: insErr } = await db.from('messages').insert({
              organization_id: m.organization_id,
              connection_id: canonical.id,
              conversation_id: targetConvId,
              provider_message_id: m.provider_message_id,
              direction: m.direction,
              sender: m.sender,
              content: m.content,
              message_type: m.message_type,
              created_at: m.created_at,
            });
            if (!insErr) {
              totalMigratedMsgs++;
            }
          }
        }

        // Delete old messages
        await db.from('messages').delete().eq('conversation_id', conv.id);
        // Delete old conversation
        await db.from('conversations').delete().eq('id', conv.id);
        totalMigratedConvs++;
      }
    }

    // E. Delete the duplicate connection
    const { error: delErr } = await db.from('connections').delete().eq('id', dup.id);
    if (delErr) {
      console.error(`${progress} delete error:`, delErr);
    } else if ((idx + 1) % 25 === 0 || idx + 1 === duplicates.length) {
      console.log(`Processed ${idx + 1}/${duplicates.length} duplicate connections...`);
    }
  }

  console.log(`\nMigration summary:`);
  console.log(`- Conversations migrated/merged: ${totalMigratedConvs}`);
  console.log(`- Messages migrated: ${totalMigratedMsgs}`);

  // Final verification
  const { data: finalConns } = await db
    .from('connections')
    .select('id, name, provider, status, phone')
    .order('created_at', { ascending: true });

  console.log('\n=== FINAL REMAINING CONNECTIONS ===');
  console.log(`Total count: ${finalConns?.length ?? 0}`);
  for (const fc of finalConns ?? []) {
    console.log(` - ${fc.name} (${fc.phone || 'no-phone'}) status=${fc.status} [${fc.id}]`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
