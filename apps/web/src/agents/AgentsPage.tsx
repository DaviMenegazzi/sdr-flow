import { type FormEvent, useEffect, useState } from 'react';
import { useSession } from '../session';

type Agent = { id:string; name:string; description:string|null; provider:string; model:string; system_prompt:string; is_default:boolean };
type Instance = { id:string; name:string; agent_id:string|null };

export function AgentsPage() {
  const { session } = useSession();
  const [agents,setAgents]=useState<Agent[]>([]), [instances,setInstances]=useState<Instance[]>([]);
  const [max,setMax]=useState(2), [name,setName]=useState(''), [editing,setEditing]=useState<Agent|null>(null), [error,setError]=useState('');
  const headers = session ? { Authorization:`Bearer ${session.access_token}` } : undefined;
  const load=async()=>{ if(!headers)return; const [a,i]=await Promise.all([fetch('/api/me/agents',{headers}),fetch('/api/me/instances',{headers})]); if(a.ok){const d=await a.json();setAgents(d.agents);setMax(d.limits.max_agents);} if(i.ok)setInstances(await i.json()); };
  useEffect(()=>{void load()},[session?.access_token]);
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!headers)return;setError('');const a=editing;const response=await fetch(a?`/api/me/agents/${a.id}`:'/api/me/agents',{method:a?'PATCH':'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:a?.name??name,description:a?.description??'',provider:a?.provider??'openai',model:a?.model??'gpt-4.1-mini',systemPrompt:a?.system_prompt??'',toolPolicy:{},modelConfig:{}})});if(!response.ok){setError((await response.json()).error||'Falha ao salvar agente.');return;}setName('');setEditing(null);await load();};
  const assign=async(instanceId:string,agentId:string)=>{if(!headers)return;setError('');const r=await fetch(`/api/me/instances/${instanceId}/assign-agent`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({agentId})});if(!r.ok){setError((await r.json()).error||'Falha ao atribuir agente.');return;}await load();};
  const archive=async(a:Agent)=>{if(!headers||!confirm(`Arquivar o agente “${a.name}”?`))return;const r=await fetch(`/api/me/agents/${a.id}`,{method:'DELETE',headers});if(!r.ok){setError((await r.json()).error||'Falha ao arquivar agente.');return;}await load();};
  return <div className="page-content"><span className="eyebrow">AGENTES</span><h1>Agentes de IA</h1><p className="muted">{agents.length} de {max} agentes ativos. Cada instância usa exatamente um agente.</p>{error&&<p role="alert">{error}</p>}
    <div className="info-card">{agents.map(a=><div key={a.id} style={{padding:'12px 0',borderBottom:'1px solid var(--color-border-secondary)'}}><strong>{a.name}</strong>{a.is_default?' · padrão':''}<p>{a.provider} / {a.model}</p><button onClick={()=>setEditing({...a})}>Editar</button>{' '}<button disabled={a.is_default} onClick={()=>void archive(a)}>Arquivar</button></div>)}</div>
    <form onSubmit={submit} style={{maxWidth:560,display:'grid',gap:10,marginTop:20}}><label>Nome<input required maxLength={80} value={editing?.name??name} onChange={e=>editing?setEditing({...editing,name:e.target.value}):setName(e.target.value)}/></label>{editing&&<><label>Modelo<input required value={editing.model} onChange={e=>setEditing({...editing,model:e.target.value})}/></label><label>Instruções<textarea value={editing.system_prompt} onChange={e=>setEditing({...editing,system_prompt:e.target.value})}/></label></>}<div><button disabled={!editing&&agents.length>=max}>{editing?'Salvar alterações':'Criar agente'}</button>{editing&&<button type="button" onClick={()=>setEditing(null)}>Cancelar</button>}</div></form>
    <h2 style={{marginTop:32}}>Agente por instância</h2><div className="info-card">{instances.map(i=><label key={i.id} style={{display:'grid',gap:6,marginBottom:12}}>{i.name}<select value={i.agent_id??''} onChange={e=>void assign(i.id,e.target.value)}><option value="" disabled>Selecione</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>)}</div>
  </div>;
}
