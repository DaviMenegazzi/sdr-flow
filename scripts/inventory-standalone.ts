import { readFile } from 'node:fs/promises';

const source=process.argv[2]||'data/store.json',mapPath=process.argv[3];
const store=JSON.parse(await readFile(source,'utf8')) as Record<string,unknown>;
const bindings=(store.activeBindings&&typeof store.activeBindings==='object'?Object.keys(store.activeBindings):[]);
if(!mapPath)throw new Error(`Informe um mapa JSON explícito: pnpm tsx scripts/inventory-standalone.ts ${source} <mapa.json>. Instâncias encontradas: ${bindings.length}. Nenhum segredo foi exibido ou alterado.`);
const mapping=JSON.parse(await readFile(mapPath,'utf8')) as Record<string,{owner_user_id:string}>;
const missing=bindings.filter(instance=>!mapping[instance]?.owner_user_id);
if(missing.length)throw new Error(`Mapa incompleto: ${missing.length} instância(s) sem owner_user_id.`);
console.log(JSON.stringify({validated:true,instances:bindings.length,flows:Array.isArray(store.flows)?store.flows.length:0,knowledge:Array.isArray(store.knowledge)?store.knowledge.length:0,secretsPrinted:false,sourcePreserved:true}));
