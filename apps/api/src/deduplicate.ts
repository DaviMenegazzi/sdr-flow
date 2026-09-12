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
    console.log('No duplicates to clean up!');
    return;
  }

  const canonical = whatsappConns[0];
  const duplicateIds = whatsappConns.slice(1).map(c => c.id);
  console.log(`Canonical connection ID: ${canonical.id}`);
  console.log(`Canonical phone: ${canonical.phone || 'null'} (will update to 555599940634)`);
  console.log(`Duplicate connections to remove: ${duplicateIds.length}`);

  // Inspect related data across all duplicate IDs
  const { count: convCount } = await db
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .in('connection_id', duplicateIds);
  console.log(`Conversations linked to duplicates: ${convCount ?? 0}`);

  const { count: msgCount } = await db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .in('connection_id', duplicateIds);
  console.log(`Messages linked to duplicates: ${msgCount ?? 0}`);

  const { count: leadCount } = await db
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .in('connection_id', duplicateIds);
  console.log(`Leads linked to duplicates: ${leadCount ?? 0}`);

  const { count: dealCount } = await db
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .in('connection_id', duplicateIds);
  console.log(`Deals linked to duplicates: ${dealCount ?? 0}`);

  const { count: kdCount } = await db
    .from('knowledge_documents')
    .select('*', { count: 'exact', head: true })
    .in('connection_id', duplicateIds);
  console.log(`Knowledge docs linked to duplicates: ${kdCount ?? 0}`);

  const shouldExecute = process.argv.includes('--execute');
  if (!shouldExecute) {
    console.log('\nDRY-RUN completed. To execute cleanup, run with --execute');
    return;
  }

  console.log('\n>>> EXECUTING CLEANUP <<<');

  // 1. Ensure canonical phone is set
  await db.from('connections').update({ phone: '555599940634' }).eq('id', canonical.id);
  console.log('1. Updated canonical connection phone to 555599940634');

  // 2. We need to migrate references. In Postgres, leads have unique (organization_id, connection_id, phone).
  // If leads on duplicate connections have same phone as leads on canonical connection, we must merge them or reassign.
  // Let's fetch all leads pointing to duplicate connections.
  const { data: dupLeads } = await db
    .from('leads')
    .select('id, organization_id, owner_user_id, connection_id, phone, name')
    .in('connection_id', duplicateIds);

  if (dupLeads && dupLeads.length > 0) {
    console.log(`Processing ${dupLeads.length} leads pointing to duplicate connections...`);
    for (const lead of dupLeads) {
      // Check if a lead with same org, canonical.id, and phone already exists
      if (lead.phone) {
        const { data: existingLead } = await db
          .from('leads')
          .select('id')
          .eq('organization_id', lead.organization_id)
          .eq('connection_id', canonical.id)
          .eq('phone', lead.phone)
          .maybeSingle();

        if (existingLead && existingLead.id !== lead.id) {
          // Reassign conversations and deals pointing to `lead.id` to `existingLead.id`
          await db.from('conversations').update({ lead_id: existingLead.id }).eq('lead_id', lead.id);
          await db.from('deals').update({ lead_id: existingLead.id }).eq('lead_id', lead.id);
          // Now safe to delete this duplicate lead
          await db.from('leads').delete().eq('id', lead.id);
          continue;
        }
      }
      // Otherwise just update connection_id and owner_user_id to canonical
      await db
        .from('leads')
        .update({
          connection_id: canonical.id,
          owner_user_id: canonical.owner_user_id,
        })
        .eq('id', lead.id);
    }
    console.log('2. Leads processed and merged into canonical connection.');
  }

  // 3. Update deals
  const { error: dealsErr } = await db
    .from('deals')
    .update({
      connection_id: canonical.id,
      owner_user_id: canonical.owner_user_id,
    })
    .in('connection_id', duplicateIds);
  if (dealsErr) console.error('Error updating deals:', dealsErr);
  else console.log('3. Deals updated to canonical connection.');

  // 4. Update knowledge_documents
  const { error: kdErr } = await db
    .from('knowledge_documents')
    .update({
      connection_id: canonical.id,
      owner_user_id: canonical.owner_user_id,
    })
    .in('connection_id', duplicateIds);
  if (kdErr) console.error('Error updating knowledge docs:', kdErr);
  else console.log('4. Knowledge docs updated to canonical connection.');

  // 5. Update messages
  // Note: messages composite foreign key references conversations(organization_id, connection_id, id).
  // In Postgres, if conversations and messages both have connection_id, we need conversations updated too.
  // Let's update conversations and messages in chunks or batches if needed.
  console.log('5. Updating conversations and messages...');
  const { data: dupConvs } = await db
    .from('conversations')
    .select('id, organization_id')
    .in('connection_id', duplicateIds);

  if (dupConvs && dupConvs.length > 0) {
    console.log(`Updating ${dupConvs.length} conversations...`);
    // First update messages for these conversations
    for (let i = 0; i < dupConvs.length; i += 50) {
      const batch = dupConvs.slice(i, i + 50).map(c => c.id);
      await db.from('messages').update({ connection_id: canonical.id }).in('conversation_id', batch);
      await db.from('conversations').update({ connection_id: canonical.id }).in('id', batch);
    }
  }

  // Update any leftover messages
  await db.from('messages').update({ connection_id: canonical.id }).in('connection_id', duplicateIds);
  console.log('5. Completed updating conversations and messages.');

  // 6. Delete duplicate connections in chunks of 50
  console.log(`6. Deleting ${duplicateIds.length} duplicate connections...`);
  for (let i = 0; i < duplicateIds.length; i += 50) {
    const batch = duplicateIds.slice(i, i + 50);
    const { error: delErr } = await db.from('connections').delete().in('id', batch);
    if (delErr) {
      console.error(`Error deleting batch ${i}-${i + 50}:`, delErr);
    }
  }

  // 7. Verify final count
  const { data: finalConns } = await db
    .from('connections')
    .select('id, name, provider, status, phone')
    .order('created_at', { ascending: true });

  console.log('\n=== FINAL CONNECTIONS ===');
  console.log(`Total remaining: ${finalConns?.length ?? 0}`);
  for (const fc of finalConns ?? []) {
    console.log(` - ${fc.name} (${fc.phone || 'no-phone'}) [${fc.id}]`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
