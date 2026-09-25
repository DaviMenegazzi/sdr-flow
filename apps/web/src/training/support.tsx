import { MessageCircle } from 'lucide-react';

/** Prodigi support on WhatsApp (DDD 55). */
const SUPPORT_PHONE = '5555999940634';

export function supportLink(context?: string) {
  const text = context
    ? `Olá! Estou configurando minha conta na Prodigi (etapa: ${context}) e preciso de ajuda.`
    : 'Olá! Estou configurando minha conta na Prodigi e preciso de ajuda.';
  return `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(text)}`;
}

export function SupportButton({ context }: { context?: string }) {
  return <a href={supportLink(context)} target="_blank" rel="noopener noreferrer"
    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-content-secondary transition-colors hover:border-success-border hover:text-content">
    <MessageCircle className="h-3.5 w-3.5 text-brand" /> <span className="hidden sm:inline">Falar com o suporte</span><span className="sm:hidden">Suporte</span>
  </a>;
}

export function SupportHint({ context, children = 'Travou em algo? A equipe Prodigi configura com você.' }: { context?: string; children?: string }) {
  return <p className="text-center text-xs text-content-muted">
    {children}{' '}
    <a href={supportLink(context)} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">Chamar no WhatsApp</a>
  </p>;
}
