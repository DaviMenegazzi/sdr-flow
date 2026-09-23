import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Minus } from 'lucide-react';
import {
  BILLING_GRACE_DAYS,
  BILLING_OFFERS,
  PLANS,
  PLAN_LIMITS,
  formatPrice,
  orgTiers,
  type BillingInterval,
  type OrgTier,
} from '@sdr/shared';
import { ProdigiWordmark } from '../components/layout/ProdigiWordmark';
import { useSession } from '../session';
import { rememberOffer } from './pendingOffer';

/** Layout público (LP e preços): sempre no tema escuro Prodigi, independente do app. */
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="dark lp min-h-[100dvh] bg-canvas text-content-primary">
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}

function MarketingNav() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const links = [
    { href: '/#recursos', label: 'Recursos' },
    { href: '/#como-funciona', label: 'Como funciona' },
    { href: '/pricing', label: 'Planos' },
    { href: '/#perguntas', label: 'Perguntas' },
  ];
  return (
    <header className="lp-nav sticky top-0 z-40 border-b border-border/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
        <Link to="/" aria-label="Prodigi — início" className="flex items-center">
          <ProdigiWordmark />
        </Link>
        <nav aria-label="Principal" className="hidden items-center gap-7 md:flex">
          {links.map(link => (
            <a key={link.href} href={link.href} className="text-sm text-content-secondary no-underline transition-colors hover:text-content-primary">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {session ? (
            <Link to="/dashboard" className="lp-btn lp-btn-primary">Abrir painel</Link>
          ) : (
            <>
              <Link to="/login" className="lp-btn lp-btn-ghost">Entrar</Link>
              <Link to="/pricing" className="lp-btn lp-btn-primary">Começar agora</Link>
            </>
          )}
        </div>
        <button
          type="button"
          className="lp-btn lp-btn-ghost md:hidden"
          aria-expanded={open}
          aria-controls="lp-mobile-nav"
          onClick={() => setOpen(value => !value)}
        >
          Menu <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      </div>
      {open && (
        <nav id="lp-mobile-nav" aria-label="Principal" className="border-t border-border/60 px-4 pb-4 md:hidden">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 pt-2">
            {links.map(link => (
              <li key={link.href}>
                <a href={link.href} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-2 text-sm text-content-secondary no-underline hover:bg-surface-elevated">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            {session ? (
              <Link to="/dashboard" className="lp-btn lp-btn-primary flex-1">Abrir painel</Link>
            ) : (
              <>
                <Link to="/login" className="lp-btn lp-btn-ghost flex-1">Entrar</Link>
                <Link to="/pricing" className="lp-btn lp-btn-primary flex-1">Começar agora</Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex flex-col gap-2">
          <ProdigiWordmark />
          <p className="m-0 text-xs text-content-muted">SDR com IA para WhatsApp. © {new Date().getFullYear()} Prodigi.</p>
        </div>
        <nav aria-label="Rodapé" className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <Link to="/pricing" className="text-content-secondary no-underline hover:text-content-primary">Planos</Link>
          <a href="/#perguntas" className="text-content-secondary no-underline hover:text-content-primary">Perguntas frequentes</a>
          <Link to="/login" className="text-content-secondary no-underline hover:text-content-primary">Entrar</Link>
          <Link to="/register" className="text-content-secondary no-underline hover:text-content-primary">Criar conta</Link>
        </nav>
      </div>
    </footer>
  );
}

export function SectionHeading({ kicker, title, description, center = true }: { kicker: string; title: ReactNode; description?: ReactNode; center?: boolean }) {
  return (
    <div className={`mb-10 flex flex-col gap-3 ${center ? 'items-center text-center' : ''}`}>
      <span className="lp-kicker">{kicker}</span>
      <h2 className="lp-h2 m-0 max-w-3xl">{title}</h2>
      {description && <p className="m-0 max-w-2xl text-base leading-relaxed text-content-secondary">{description}</p>}
    </div>
  );
}

function limitLabel(value: number | null, singular: string, plural: string) {
  if (value === null) return `${plural.charAt(0).toUpperCase()}${plural.slice(1)} ilimitados`;
  return `Até ${value} ${value === 1 ? singular : plural}`;
}

/** Leva a escolha do plano ao cadastro/login ou à página de cobrança (mesma oferta). */
export function useChoosePlan() {
  const { session } = useSession();
  const navigate = useNavigate();
  return (offerCode: string) => {
    if (session) {
      navigate(`/billing?offer=${encodeURIComponent(offerCode)}`);
      return;
    }
    rememberOffer(offerCode);
    navigate(`/register?offer=${encodeURIComponent(offerCode)}`);
  };
}

export function PricingSection({ id = 'planos' }: { id?: string }) {
  const [interval, setBillingInterval] = useState<BillingInterval>('monthly');
  const choose = useChoosePlan();
  return (
    <section id={id} className="lp-section scroll-mt-20" aria-labelledby={`${id}-title`}>
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <SectionHeading
          kicker="Planos"
          title={<span id={`${id}-title`}>Escolha o nível da sua operação</span>}
          description="O plano vale para a organização inteira. Ele é ativado assim que o pagamento é confirmado pelo gateway — nunca antes."
        />
        <div className="mb-8 flex justify-center">
          <div role="radiogroup" aria-label="Periodicidade" className="lp-toggle">
            {(['monthly', 'yearly'] as const).map(value => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={interval === value}
                onClick={() => setBillingInterval(value)}
                className={interval === value ? 'is-active' : ''}
              >
                {value === 'monthly' ? 'Mensal' : 'Anual'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {orgTiers.map(tier => {
            const plan = PLANS[tier];
            const offer = BILLING_OFFERS.find(item => item.tier === tier && item.interval === interval && item.active);
            const limits = PLAN_LIMITS[tier];
            return (
              <article key={tier} className={`lp-plan ${plan.highlight ? 'is-highlight' : ''}`} aria-labelledby={`plan-${tier}`}>
                {plan.highlight && <span className="lp-plan-badge">Mais escolhido</span>}
                <h3 id={`plan-${tier}`} className="m-0 text-lg font-semibold text-content-primary">{plan.name}</h3>
                <p className="m-0 mt-1 min-h-[40px] text-sm text-content-secondary">{plan.tagline}</p>
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className={`lp-price ${offer?.amountCents == null ? 'is-pending' : ''}`}>{formatPrice(offer?.amountCents ?? null)}</span>
                  {offer?.amountCents != null && <span className="text-sm text-content-muted">/{interval === 'monthly' ? 'mês' : 'ano'}</span>}
                </div>
                <button type="button" onClick={() => offer && choose(offer.code)} className={`lp-btn mt-5 w-full ${plan.highlight ? 'lp-btn-primary' : 'lp-btn-outline'}`}>
                  Escolher {plan.name}
                </button>
                <ul className="m-0 mt-6 flex list-none flex-col gap-2.5 p-0">
                  {[...plan.features, limitLabel(limits.maxAgents, 'agente de IA', 'agentes de IA'), limitLabel(limits.maxInstances, 'número de WhatsApp', 'números de WhatsApp')].map(feature => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-content-secondary">
                      <Check size={16} className="mt-0.5 flex-shrink-0 text-brand-fg" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const COMPARISON: Array<{ label: string; tiers: Record<OrgTier, boolean | string> }> = [
  { label: 'Atendimento (Inbox) e assunção humana', tiers: { 'pre-venda': true, vendedor: true, 'vendedor-senior': true } },
  { label: 'Indicadores do funil', tiers: { 'pre-venda': true, vendedor: true, 'vendedor-senior': true } },
  { label: 'Agentes de IA', tiers: { 'pre-venda': String(PLAN_LIMITS['pre-venda'].maxAgents), vendedor: String(PLAN_LIMITS.vendedor.maxAgents), 'vendedor-senior': 'Ilimitado' } },
  { label: 'Números de WhatsApp', tiers: { 'pre-venda': String(PLAN_LIMITS['pre-venda'].maxInstances), vendedor: String(PLAN_LIMITS.vendedor.maxInstances), 'vendedor-senior': 'Ilimitado' } },
  { label: 'Integrações externas (Google Agenda)', tiers: { 'pre-venda': false, vendedor: true, 'vendedor-senior': true } },
  { label: 'Gates de pagamento para os seus leads', tiers: { 'pre-venda': false, vendedor: false, 'vendedor-senior': true } },
];

export function PlanComparison() {
  return (
    <section className="lp-section" aria-labelledby="comparativo-title">
      <div className="mx-auto max-w-4xl px-4 md:px-6">
        <SectionHeading kicker="Comparativo" title={<span id="comparativo-title">O que cada plano libera</span>} />
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface">
                <th scope="col" className="px-4 py-3 text-left font-medium text-content-muted">Recurso</th>
                {orgTiers.map(tier => (
                  <th key={tier} scope="col" className="px-4 py-3 text-center font-semibold text-content-primary">{PLANS[tier].name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(row => (
                <tr key={row.label} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-left font-normal text-content-secondary">{row.label}</th>
                  {orgTiers.map(tier => {
                    const value = row.tiers[tier];
                    return (
                      <td key={tier} className="px-4 py-3 text-center">
                        {value === true ? <Check size={16} className="inline text-brand-fg" aria-label="Incluído" />
                          : value === false ? <Minus size={16} className="inline text-content-muted" aria-label="Não incluído" />
                          : <span className="font-medium text-content-primary">{value}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  {
    q: 'Quando o plano é liberado?',
    a: 'Assim que o gateway de pagamento confirma o pagamento. Voltar da página de pagamento não libera o plano sozinho: a confirmação chega pelo gateway e a plataforma atualiza a sua organização automaticamente.',
  },
  {
    q: 'O plano é por usuário?',
    a: 'Não. A assinatura é da organização. Todos os membros usam os recursos do plano conforme o papel de cada um (proprietário, administrador, agente ou leitor).',
  },
  {
    q: 'Quem pode contratar ou mudar o plano?',
    a: 'O proprietário da organização. Administradores podem acompanhar a cobrança; os demais membros veem apenas o plano atual.',
  },
  {
    q: 'Posso mudar de plano depois?',
    a: 'Sim. Upgrades entram em vigor depois do pagamento. Reduções de plano são agendadas para o próximo ciclo, e nada do que você criou é apagado: apenas novas criações acima do limite ficam bloqueadas.',
  },
  {
    q: 'E se um pagamento de renovação falhar?',
    a: `Você mantém o acesso por ${BILLING_GRACE_DAYS} dias de carência. Se o pagamento não for regularizado, os recursos pagos são suspensos e os seus dados continuam guardados para quando você voltar.`,
  },
  {
    q: 'Como funciona o cancelamento?',
    a: 'O acesso continua até o fim do período já pago. Depois disso a organização volta ao nível inicial.',
  },
];

export function FaqSection() {
  return (
    <section id="perguntas" className="lp-section scroll-mt-20" aria-labelledby="faq-title">
      <div className="mx-auto max-w-3xl px-4 md:px-6">
        <SectionHeading kicker="Perguntas frequentes" title={<span id="faq-title">Tudo claro antes de assinar</span>} />
        <div className="flex flex-col gap-3">
          {FAQ.map(item => (
            <details key={item.q} className="lp-faq group">
              <summary>
                <span>{item.q}</span>
                <ChevronDown size={16} className="flex-shrink-0 text-content-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="m-0 px-5 pb-5 text-sm leading-relaxed text-content-secondary">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
