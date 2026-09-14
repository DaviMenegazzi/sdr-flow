import { serviceDatabase, ConnectionRepository, type EvolutionCredentials } from '../packages/db/src/index.js';
import { EvolutionClient } from '../apps/api/src/whatsapp/evolution-client.js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicApiUrl = process.env.PUBLIC_API_URL?.replace(/\/$/, '');

if (!supabaseUrl || !serviceRoleKey || !publicApiUrl) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e PUBLIC_API_URL são obrigatórios.');
}

const db = serviceDatabase(supabaseUrl, serviceRoleKey);
const repository = new ConnectionRepository(db);
const { data: connections, error } = await db
  .from('connections')
  .select('id, provider_instance_id')
  .eq('provider', 'evolution');
if (error) throw error;

let synced = 0;
let skipped = 0;
let failed = 0;
for (const connection of connections ?? []) {
  const instanceName = connection.provider_instance_id?.trim();
  if (!instanceName) { skipped++; continue; }

  const credentials = await repository.getConnectionCredentials<EvolutionCredentials>(connection.id, db);
  const serverUrl = credentials?.serverUrl || process.env.EVOLUTION_SERVER_URL;
  const apiKey = credentials?.apiKey || process.env.EVOLUTION_API_KEY;
  if (!serverUrl || !apiKey) { skipped++; continue; }

  const webhookUrl = `${publicApiUrl}/api/webhooks/evolution/${connection.id}`;
  try {
    await new EvolutionClient(serverUrl, apiKey)
      .setWebhook(instanceName, webhookUrl, credentials?.webhookToken);
    synced++;
    console.log(`webhook sincronizado: ${instanceName}`);
  } catch (error) {
    failed++;
    console.warn(`webhook não sincronizado: ${instanceName} (${error instanceof Error ? error.message : 'erro desconhecido'})`);
  }
}

console.log(`Concluído: ${synced} sincronizado(s), ${skipped} ignorado(s), ${failed} falha(s).`);
