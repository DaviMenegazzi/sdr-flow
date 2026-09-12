import { serviceDatabase } from '../packages/db/src/index.js';

const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,userId=process.argv[2];
if(!url||!key||!userId)throw new Error('Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm tsx scripts/bootstrap-admin.ts <user-uuid>');
if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(userId))throw new Error('UUID de usuário inválido.');
const db=serviceDatabase(url,key);
const {data,error}=await db.from('profiles').update({role:'admin',updated_at:new Date().toISOString()}).eq('user_id',userId).select('user_id').maybeSingle();
if(error||!data)throw error||new Error('Perfil não encontrado; registre ou convide o usuário primeiro.');
console.log(`Administrador configurado para o usuário ${data.user_id}.`);
