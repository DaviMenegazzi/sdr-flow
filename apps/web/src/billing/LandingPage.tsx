import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarCheck,
  Hand,
  MessageSquareText,
  Workflow,
  Zap,
} from 'lucide-react';
import { FaqSection, MarketingShell, PricingSection, SectionHeading } from './marketing';

const FEATURES = [
  { icon: Zap, title: 'Resposta em segundos', text: 'Cada lead recebe retorno imediato no WhatsApp, a qualquer hora, sem fila de espera.' },
  { icon: Bot, title: 'Qualificação progressiva', text: 'O agente de IA conduz a conversa, coleta os dados que importam e classifica a temperatura do lead.' },
  { icon: CalendarCheck, title: 'Agenda integrada', text: 'Consulta horários livres e agenda, remarca ou cancela direto no Google Agenda.' },
  { icon: Hand, title: 'Assunção humana', text: 'Um vendedor assume a conversa em um clique e a IA sai de cena na hora certa.' },
  { icon: Workflow, title: 'Fluxos visuais', text: 'Desenhe o caminho da conversa em nós: regras, condições, integrações e mensagens.' },
  { icon: BarChart3, title: 'Indicadores do funil', text: 'Acompanhe atendimentos, conversões e o estágio de cada lead em um só painel.' },
];

const STEPS = [
  { title: 'Conecte seu WhatsApp', text: 'Leia o QR Code e o número passa a ser atendido pela plataforma.' },
  { title: 'Configure o agente', text: 'Defina o tom, a base de conhecimento e o fluxo de qualificação.' },
  { title: 'Acompanhe e assuma', text: 'Veja o funil em tempo real e entre na conversa quando o lead estiver pronto.' },
];

export function LandingPage() {
  useEffect(() => {
    document.title = 'Prodigi · SDR com IA para WhatsApp';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 'O Prodigi responde, qualifica e agenda seus leads no WhatsApp com IA e passa a conversa para o vendedor na hora certa.');
    return () => { document.title = 'SDR Flow · Prodigi'; };
  }, []);

  return (
    <MarketingShell>
      <section className="lp-hero" aria-labelledby="hero-title">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pb-20 pt-14 md:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-20">
          <div className="flex flex-col items-start gap-6">
            <span className="lp-kicker"><i aria-hidden="true" /> SDR com IA para WhatsApp</span>
            <h1 id="hero-title" className="lp-h1 m-0">
              Seu time de pré-venda <span className="lp-accent">trabalhando 24 horas</span> no WhatsApp.
            </h1>
            <p className="m-0 max-w-xl text-lg leading-relaxed text-content-secondary">
              O Prodigi responde, qualifica e agenda seus leads em segundos — e passa a conversa para um vendedor humano na hora certa.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a href="#planos" className="lp-btn lp-btn-primary lp-btn-lg">
                Ver planos <ArrowRight size={16} aria-hidden="true" />
              </a>
              <Link to="/login" className="lp-btn lp-btn-outline lp-btn-lg">Já tenho conta</Link>
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-xs text-content-muted">
              <li className="lp-check">Dados isolados por organização</li>
              <li className="lp-check">Assunção humana em um clique</li>
              <li className="lp-check">Plano ativado só após pagamento confirmado</li>
            </ul>
          </div>
          <HeroPreview />
        </div>
      </section>

      <section id="recursos" className="lp-section scroll-mt-20" aria-labelledby="recursos-title">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <SectionHeading
            kicker="Recursos"
            title={<span id="recursos-title">Tudo o que um SDR faz, sem deixar lead esperando</span>}
            description="Do primeiro “oi” ao horário marcado na agenda do vendedor."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <article key={title} className="lp-card">
                <span className="lp-icon" aria-hidden="true"><Icon size={20} /></span>
                <h3 className="m-0 mt-4 text-base font-semibold text-content-primary">{title}</h3>
                <p className="m-0 mt-2 text-sm leading-relaxed text-content-secondary">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="lp-section scroll-mt-20" aria-labelledby="como-title">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <SectionHeading kicker="Como funciona" title={<span id="como-title">No ar em três passos</span>} />
          <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="lp-card lp-step">
                <span className="lp-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="m-0 mt-4 text-base font-semibold text-content-primary">{step.title}</h3>
                <p className="m-0 mt-2 text-sm leading-relaxed text-content-secondary">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <PricingSection />
      <FaqSection />

      <section className="lp-section" aria-labelledby="cta-title">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="lp-cta">
            <h2 id="cta-title" className="lp-h2 m-0">Pronto para nunca mais perder um lead?</h2>
            <p className="m-0 max-w-xl text-base text-content-secondary">Crie sua conta, escolha o plano e conecte seu WhatsApp.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link to="/register" className="lp-btn lp-btn-primary lp-btn-lg">Criar conta <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link to="/pricing" className="lp-btn lp-btn-outline lp-btn-lg">Comparar planos</Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

/** Ilustração do produto (conversa + funil), feita em HTML/CSS para não pesar na página. */
function HeroPreview() {
  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-preview-head">
        <span className="lp-avatar">MC</span>
        <div className="min-w-0">
          <strong>Marina Costa</strong>
          <small>WhatsApp · agora</small>
        </div>
        <span className="lp-stage">Qualificado</span>
      </div>
      <div className="lp-chat">
        <p className="lp-bubble is-lead">Oi! Vi o anúncio, queria saber como funciona o atendimento.</p>
        <p className="lp-bubble is-bot"><MessageSquareText size={13} /> Olá, Marina! Posso te ajudar agora mesmo. É para você ou para sua empresa?</p>
        <p className="lp-bubble is-lead">Para a minha clínica, somos 3 dentistas.</p>
        <p className="lp-bubble is-bot"><CalendarCheck size={13} /> Perfeito! Tenho horários amanhã às 10h ou 15h para uma conversa com nosso especialista.</p>
        <p className="lp-bubble is-lead">15h fica ótimo.</p>
        <p className="lp-event"><CalendarCheck size={13} /> Reunião agendada · amanhã, 15:00</p>
      </div>
      <div className="lp-preview-metrics">
        <div><small>Temperatura</small><strong>Quente</strong></div>
        <div><small>Estágio</small><strong>Qualificado</strong></div>
        <div><small>Próximo passo</small><strong>Reunião</strong></div>
      </div>
    </div>
  );
}
