import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase, useSession } from './session';

export function AuthGate({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { session, loading, profile } = useSession();
  const location = useLocation();
  if (loading) return <div className="auth-page">Carregando…</div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!profile || profile.status !== 'active' || (admin && profile.role !== 'admin')) return <Navigate to="/404" replace />;
  return <>{children}</>;
}

function AuthCard({ title, children }: { title: string; children: ReactNode }) { return <main className="auth-page"><section className="auth-card"><h1>{title}</h1>{children}</section></main>; }

export function LoginPage() {
  const { session } = useSession(); const navigate = useNavigate(); const location = useLocation();
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  if (session) return <Navigate to="/dashboard" replace />;
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!supabase){setError('Serviço de autenticação não configurado no cliente.');return;}setBusy(true);setError('');const result=await supabase.auth.signInWithPassword({email,password});setBusy(false);if(result?.error){setError(result.error.message==='Invalid login credentials'?'E-mail ou senha inválidos.':result.error.message);return;}const from=(location.state as {from?:string}|null)?.from;const dest=from&&from.startsWith('/')&&!from.startsWith('//')&&from!=='/'&&from!=='/login'&&from!=='/404'?from:'/dashboard';navigate(dest,{replace:true});};
  return <AuthCard title="Entrar no SDR Flow"><form onSubmit={submit}><label>E-mail<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<button disabled={busy}>{busy?'Entrando…':'Entrar'}</button></form><p><Link to="/forgot-password">Esqueci minha senha</Link> · <Link to="/register">Criar conta</Link></p></AuthCard>;
}

export function RegisterPage(){const [name,setName]=useState('');const[email,setEmail]=useState('');const[password,setPassword]=useState('');const[confirm,setConfirm]=useState('');const[message,setMessage]=useState('');const submit=async(e:FormEvent)=>{e.preventDefault();if(password!==confirm){setMessage('As senhas não coincidem.');return;}const {error}=await supabase!.auth.signUp({email,password,options:{data:{display_name:name},emailRedirectTo:`${location.origin}/auth/callback`}});setMessage(error?'Não foi possível concluir o cadastro.':'Cadastro recebido. Verifique seu e-mail para confirmar a conta.');};return <AuthCard title="Criar conta"><form onSubmit={submit}><label>Nome<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label>E-mail<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Senha<input type="password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Confirmar senha<input type="password" minLength={8} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button>Cadastrar</button></form>{message&&<p role="status">{message}</p>}<Link to="/login">Voltar ao login</Link></AuthCard>}

export function ForgotPasswordPage(){const[email,setEmail]=useState('');const[done,setDone]=useState(false);const submit=async(e:FormEvent)=>{e.preventDefault();await supabase?.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/reset-password`});setDone(true);};return <AuthCard title="Recuperar senha">{done?<p>Se a conta existir, enviaremos as instruções por e-mail.</p>:<form onSubmit={submit}><label>E-mail<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><button>Enviar instruções</button></form>}<Link to="/login">Voltar</Link></AuthCard>}
export function ResetPasswordPage(){const[password,setPassword]=useState('');const[message,setMessage]=useState('');const submit=async(e:FormEvent)=>{e.preventDefault();const{error}=await supabase!.auth.updateUser({password});setMessage(error?'Não foi possível atualizar a senha.':'Senha atualizada. Você já pode entrar.');};return <AuthCard title="Definir nova senha"><form onSubmit={submit}><label>Nova senha<input type="password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)}/></label><button>Atualizar senha</button></form>{message&&<p role="status">{message}</p>}</AuthCard>}
export function AuthCallback(){const navigate=useNavigate();useEffect(()=>{const timer=setTimeout(()=>navigate('/dashboard',{replace:true}),500);return()=>clearTimeout(timer)},[navigate]);return <AuthCard title="Confirmando conta"><p>Aguarde…</p></AuthCard>}
export function NotFoundPage(){return <AuthCard title="Página não encontrada"><p>A conta ou o recurso solicitado não está disponível.</p><p><Link to="/dashboard">Ir para o painel</Link> · <Link to="/login">Voltar ao login</Link></p></AuthCard>}
