import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { supabase, useSession } from './session';
import { Button, Input } from './components/ui';

export function AuthGate({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { session, loading, profile } = useSession();
  const location = useLocation();

  if (!supabase) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-canvas text-content-muted text-sm">
        Carregando…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!profile || profile.status !== 'active') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && profile.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl p-8 shadow-xl flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="flex items-center gap-2 mb-1">
            <div className="flex items-baseline font-black text-2xl tracking-tight select-none">
              <span className="text-content-primary font-black">pro</span>
              <span className="text-content-muted font-mono font-normal">(</span>
              <span className="text-[#2ee86b] font-black drop-shadow-[0_0_12px_rgba(46,232,107,0.4)]">digi</span>
              <span className="text-content-muted font-mono font-normal">)</span>
            </div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#2ee86b]/10 text-[#2ee86b] border border-[#2ee86b]/30">
              SDR Flow
            </span>
          </div>
          <h1 className="text-lg font-semibold text-content-secondary tracking-tight m-0">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

export function LoginPage() {
  const { session, devLogin } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/dashboard" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      devLogin?.(email || 'admin@sdrflow.local');
      const from = (location.state as { from?: string } | null)?.from;
      const dest = from && from.startsWith('/') && !from.startsWith('//') && from !== '/' && from !== '/login' && from !== '/404' ? from : '/dashboard';
      navigate(dest, { replace: true });
      return;
    }
    setBusy(true);
    setError('');
    const result = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result?.error) {
      setError(result.error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : result.error.message);
      return;
    }
    const from = (location.state as { from?: string } | null)?.from;
    const dest = from && from.startsWith('/') && !from.startsWith('//') && from !== '/' && from !== '/login' && from !== '/404' ? from : '/dashboard';
    navigate(dest, { replace: true });
  };

  return (
    <AuthCard title="Entrar no SDR Flow">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {!supabase && (
          <div className="p-3 bg-brand/10 border border-brand/20 text-brand text-xs rounded-lg flex items-center gap-2">
            <Info className="w-4 h-4 text-brand shrink-0" />
            <span>Modo Local (Sem Supabase conectado). Digite qualquer e-mail e senha ou clique em <strong>Entrar</strong> para navegar no painel.</span>
          </div>
        )}
        <Input
          label="E-mail"
          type="email"
          autoComplete="email"
          required={Boolean(supabase)}
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="seu@email.com"
        />
        <Input
          label="Senha"
          type="password"
          autoComplete="current-password"
          required={Boolean(supabase)}
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
        />
        {error && (
          <div className="p-3 bg-danger/10 border border-danger/20 text-danger text-xs rounded-lg" role="alert">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" loading={busy} className="w-full mt-1">
          {busy ? 'Entrando…' : !supabase ? 'Entrar (Modo Local)' : 'Entrar'}
        </Button>
      </form>
      <div className="flex items-center justify-center gap-3 text-xs text-content-muted pt-2 border-t border-border/60">
        <Link to="/forgot-password" className="text-brand hover:underline">
          Esqueci minha senha
        </Link>
        <span>•</span>
        <Link to="/register" className="text-brand hover:underline">
          Criar conta
        </Link>
      </div>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { devLogin } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setMessage('As senhas não coincidem.');
      return;
    }
    if (!supabase) {
      devLogin?.(email || 'admin@sdrflow.local');
      navigate('/dashboard', { replace: true });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name }, emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    setMessage(error ? 'Não foi possível concluir o cadastro.' : 'Cadastro recebido. Verifique seu e-mail para confirmar a conta.');
  };

  return (
    <AuthCard title="Criar conta">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Nome"
          required
          maxLength={120}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Seu nome completo"
        />
        <Input
          label="E-mail"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="seu@email.com"
        />
        <Input
          label="Senha"
          type="password"
          minLength={8}
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="No mínimo 8 caracteres"
        />
        <Input
          label="Confirmar senha"
          type="password"
          minLength={8}
          required
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Repita a senha"
        />
        {message && (
          <div className="p-3 bg-brand/10 border border-brand/20 text-brand text-xs rounded-lg" role="status">
            {message}
          </div>
        )}
        <Button type="submit" variant="primary" loading={busy} className="w-full mt-1">
          Cadastrar
        </Button>
      </form>
      <div className="text-center text-xs text-content-muted pt-2 border-t border-border/60">
        <Link to="/login" className="text-brand hover:underline">
          Voltar ao login
        </Link>
      </div>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await supabase?.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
    setBusy(false);
    setDone(true);
  };

  return (
    <AuthCard title="Recuperar senha">
      {done ? (
        <div className="flex flex-col gap-4 text-center">
          <p className="text-xs text-content-muted m-0">Se a conta existir, enviaremos as instruções por e-mail.</p>
          <Link to="/login" className="text-xs text-brand hover:underline">
            Voltar ao login
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label="E-mail"
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="seu@email.com"
          />
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            Enviar instruções
          </Button>
          <div className="text-center text-xs text-content-muted pt-2 border-t border-border/60">
            <Link to="/login" className="text-brand hover:underline">
              Voltar ao login
            </Link>
          </div>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password });
    setBusy(false);
    setMessage(error ? 'Não foi possível atualizar a senha.' : 'Senha atualizada. Você já pode entrar.');
  };

  return (
    <AuthCard title="Definir nova senha">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Nova senha"
          type="password"
          minLength={8}
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="No mínimo 8 caracteres"
        />
        {message && (
          <div className="p-3 bg-brand/10 border border-brand/20 text-brand text-xs rounded-lg" role="status">
            {message}
          </div>
        )}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Atualizar senha
        </Button>
      </form>
    </AuthCard>
  );
}

export function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    const timer = setTimeout(() => navigate('/dashboard', { replace: true }), 500);
    return () => clearTimeout(timer);
  }, [navigate]);
  return (
    <AuthCard title="Confirmando conta">
      <p className="text-xs text-content-muted text-center m-0">Aguarde um momento…</p>
    </AuthCard>
  );
}

export function NotFoundPage() {
  return (
    <AuthCard title="Página não encontrada">
      <div className="flex flex-col items-center text-center gap-4">
        <p className="text-xs text-content-muted m-0">A conta ou o recurso solicitado não está disponível.</p>
        <div className="flex items-center gap-3 text-xs">
          <Link to="/dashboard" className="text-brand hover:underline font-medium">
            Ir para o painel
          </Link>
          <span className="text-content-muted">•</span>
          <Link to="/login" className="text-brand hover:underline font-medium">
            Voltar ao login
          </Link>
        </div>
      </div>
    </AuthCard>
  );
}
