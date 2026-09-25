import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Barcode, Check, CreditCard, Lock, MailCheck, QrCode } from 'lucide-react';
import { BILLING_OFFERS, PLAN_LIMITS, PLANS, formatPrice } from '@sdr/shared';
import { Button, Input } from '../components/ui';
import { ProdigiWordmark } from '../components/layout/ProdigiWordmark';
import { supabase, useSession } from '../session';
import { postLoginDestination, rememberOffer } from './pendingOffer';
import { SupportHint } from '../training/support';

function limitLabel(value: number | null, singular: string, plural: string) {
  return value === null ? `${plural.charAt(0).toUpperCase()}${plural.slice(1)} ilimitados` : `Até ${value} ${value === 1 ? singular : plural}`;
}

const paymentMethods = [
  { icon: QrCode, label: 'Pix', text: 'Aprovação na hora' },
  { icon: CreditCard, label: 'Cartão de crédito', text: 'Renovação automática' },
  { icon: Barcode, label: 'Boleto', text: 'Até 3 dias úteis' },
];

/**
 * Checkout público: resumo do plano escolhido + dados da conta. A conta é criada aqui e o
 * pagamento acontece logo depois de confirmar o e-mail (a oferta fica guardada no navegador
 * e o preço é sempre validado pela API a partir do catálogo).
 */
export function CheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const offerCode = params.get('offer') ?? '';
  const offer = BILLING_OFFERS.find(item => item.code === offerCode && item.active);
  useEffect(() => { rememberOffer(offer?.code); }, [offer?.code]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!offer) return <Navigate to="/pricing" replace />;
  if (session) return <Navigate to={`/billing?offer=${encodeURIComponent(offer.code)}`} replace />;

  const plan = PLANS[offer.tier];
  const limits = PLAN_LIMITS[offer.tier];
  const intervalLabel = offer.interval === 'monthly' ? 'mês' : 'ano';
  const otherInterval = BILLING_OFFERS.find(item => item.tier === offer.tier && item.interval !== offer.interval && item.active);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError('');
    const { data, error: signUpError } = await supabase.auth.signUp({
      email, password,
      options: { data: { display_name: name.trim() }, emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (signUpError) { setError(signUpError.message.includes('registered') ? 'Este e-mail já tem conta. Entre para continuar o pagamento.' : 'Não foi possível criar a sua conta. Confira os dados e tente de novo.'); return; }
    if (data.session) { navigate(postLoginDestination(), { replace: true }); return; }
    setSentTo(email);
  };

  return <div className="min-h-[100dvh] w-full bg-canvas text-content">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
      <Link to="/" aria-label="Prodigi, página inicial"><ProdigiWordmark /></Link>
      <span className="flex items-center gap-1.5 text-xs text-content-muted"><Lock className="h-3.5 w-3.5" /> Compra segura</span>
    </header>

    <main className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-4 sm:px-8 lg:grid-cols-[1fr_400px] lg:gap-16 lg:pt-10">
      <section>
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">Checkout</h1>
        <ol className="mt-6 flex flex-wrap items-center gap-2 text-xs" aria-label="Etapas da compra">
          {['Seus dados', 'Pagamento', 'Configurar o SDR'].map((label, index) => {
            const state = index === 0 ? (sentTo ? 'done' : 'current') : index === 1 && sentTo ? 'current' : 'next';
            return <li key={label} className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${state === 'current' ? 'bg-brand text-black' : state === 'done' ? 'bg-brand-subtle text-brand' : 'bg-surface-elevated text-content-muted'}`}>{state === 'done' ? <Check className="h-3 w-3" /> : index + 1}</span>
              <span className={state === 'next' ? 'text-content-muted' : 'font-medium text-content'}>{label}</span>
              {index < 2 && <span className="h-px w-6 bg-border" aria-hidden="true" />}
            </li>;
          })}
        </ol>

        {!sentTo ? <form onSubmit={submit} className="mt-10 max-w-lg space-y-5">
          <div>
            <h2 className="text-lg font-semibold">1. Seus dados</h2>
            <p className="mt-1 text-sm text-content-secondary">Com eles criamos a sua conta na Prodigi.</p>
          </div>
          <Input label="Nome completo" required maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Como devemos chamar você" />
          <Input label="E-mail" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="voce@empresa.com.br" />
          <Input label="Crie uma senha" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="No mínimo 8 caracteres" />
          {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{error}</p>}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">Continuar para o pagamento</Button>
          <p className="text-center text-xs text-content-muted">Já tem conta? <Link to="/login" className="font-semibold text-brand hover:underline">Entrar e pagar</Link></p>

          <div className="border-t border-border pt-6">
            <h2 className="text-lg font-semibold text-content-muted">2. Pagamento</h2>
            <p className="mt-1 text-sm text-content-muted">Na próxima etapa, escolha como pagar:</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">{paymentMethods.map(method =>
              <li key={method.label} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs text-content-muted"><method.icon className="h-4 w-4" /><span><b className="block font-semibold text-content-secondary">{method.label}</b>{method.text}</span></li>)}
            </ul>
          </div>
        </form> : <div className="mt-10 max-w-lg space-y-5">
          <MailCheck className="h-10 w-10 text-brand" />
          <h2 className="text-2xl font-bold">Confirme o seu e-mail para pagar</h2>
          <p className="text-sm leading-relaxed text-content-secondary">Enviamos um link para <b className="text-content">{sentTo}</b>. Ao abrir, você cai direto no pagamento do plano {plan.name}, com o valor e o plano que você escolheu aqui.</p>
          <p className="text-xs text-content-muted">Não chegou? Confira o spam ou a aba Promoções.</p>
        </div>}
        <div className="mt-10 max-w-lg"><SupportHint context={`Checkout ${plan.name}`}>Dúvidas sobre o plano ou o pagamento? Fale com a equipe Prodigi.</SupportHint></div>
      </section>

      <aside className="h-fit rounded-2xl border border-border bg-surface p-6 lg:sticky lg:top-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-content-muted">Seu plano</p>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <h2 className="text-2xl font-bold">{plan.name}</h2>
          {plan.highlight && <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-2xs font-semibold text-brand">Mais escolhido</span>}
        </div>
        <p className="mt-1 text-sm text-content-secondary">{plan.tagline}</p>
        <p className="mt-5 text-3xl font-bold tabular-nums">{formatPrice(offer.amountCents)}{offer.amountCents !== null && <span className="text-sm font-normal text-content-muted"> /{intervalLabel}</span>}</p>
        <p className="mt-1 text-xs text-content-muted">Cobrança {offer.interval === 'monthly' ? 'mensal' : 'anual'}{otherInterval && <> · <Link replace to={`/checkout?offer=${otherInterval.code}`} className="text-brand hover:underline">trocar para {otherInterval.interval === 'monthly' ? 'mensal' : 'anual'}</Link></>}</p>
        <ul className="mt-6 space-y-2.5 border-t border-border pt-5 text-sm">
          {[...plan.features, limitLabel(limits.maxInstances, 'número de WhatsApp', 'números de WhatsApp'), limitLabel(limits.maxAgents, 'agente de IA', 'agentes de IA')].map(feature =>
            <li key={feature} className="flex gap-2 text-content-secondary"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />{feature}</li>)}
        </ul>
        <p className="mt-6 border-t border-border pt-5 text-xs text-content-muted">Depois do pagamento, você conecta o WhatsApp e treina o SDR em cerca de 10 minutos. <Link to="/pricing" className="text-brand hover:underline">Trocar de plano</Link></p>
      </aside>
    </main>
  </div>;
}
