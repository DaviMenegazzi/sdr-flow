import { type FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../session';

type Account={user_id:string;email:string;display_name:string|null;status:'active'|'suspended';max_agents:number;max_instances:number|null;active_agents:number;instances:number};
export function AdminPage(){
  const {session,profile}=useSession(); const [accounts,setAccounts]=useState<Account[]>([]),[email,setEmail]=useState(''),[message,setMessage]=useState('');
  const headers=session?{Authorization:`Bearer ${session.access_token}`}:undefined;
  const load=async()=>{if(!headers)return;const r=await fetch('/api/admin/users',{headers});if(r.ok)setAccounts(await r.json());};
  useEffect(()=>{void load()},[session?.access_token]);
  if(profile?.role!=='admin')return <Navigate to="/404" replace/>;
  const invite=async(e:FormEvent)=>{e.preventDefault();if(!headers)return;const r=await fetch('/api/admin/users/invite',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({email})});setMessage(r.ok?'Convite enviado.':(await r.json()).error);if(r.ok)setEmail('');};
  const update=async(account:Account,kind:'status'|'limits',body:unknown)=>{if(!headers)return;const r=await fetch(`/api/admin/users/${account.user_id}/${kind}`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)setMessage((await r.json()).error);else await load();};
  return <div className="page-content"><span className="eyebrow">ADMINISTRAÇÃO</span><h1>Contas</h1><form onSubmit={invite} style={{display:'flex',gap:8,maxWidth:520}}><input type="email" required placeholder="cliente@empresa.com" value={email} onChange={e=>setEmail(e.target.value)}/><button>Convidar</button></form>{message&&<p role="status">{message}</p>}<div className="info-card" style={{marginTop:20}}>{accounts.map(a=><div key={a.user_id} style={{padding:'14px 0',borderBottom:'1px solid var(--color-border-secondary)'}}><strong>{a.display_name||a.email}</strong><p>{a.email} · {a.instances} instância(s) · {a.active_agents}/{a.max_agents} agente(s)</p><button onClick={()=>void update(a,'status',{status:a.status==='active'?'suspended':'active'})}>{a.status==='active'?'Suspender':'Reativar'}</button>{' '}<button onClick={()=>{const value=Number(prompt('Novo limite de agentes',String(a.max_agents)));if(Number.isInteger(value))void update(a,'limits',{maxAgents:value,maxInstances:a.max_instances});}}>Alterar limite</button></div>)}</div></div>;
}
