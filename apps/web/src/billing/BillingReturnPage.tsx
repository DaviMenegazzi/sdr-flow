import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { PLANS } from '@sdr/shared';
import { PageContainer } from '../components/ui';
import { useSession } from '../session';
import { useBillingApi, type CheckoutStatus } from './api';

// Consulta com backoff: rápido no início (cartão confirma em segundos), mais espaçado depois
// (Pix/boleto podem levar minutos). Cerca de 3 minutos no total.
const DELAYS_MS = [1500, 2000, 3000, 4000, 5000, 8000, 10000, 15000, 15000, 20000, 30000, 30000, 30000];

/**
 * Retorno do checkout hospedado. Mostra "Aguardando confirmação" até o webhook do gateway
 * ser processado — voltar para esta página não libera o plano.
 */
export function BillingReturnPage() {
  const api = useBillingApi();
  const { refresh } = useSession();
  const [params] = useSearchParams();
  const checkoutId = params.get('checkout') ?? '';
  const [status, setStatus] = useState<CheckoutStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const refreshed = useRef(false);

  useEffect(() => {
    if (!api.ready || !checkoutId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (attempt: number) => {
      try {
        const next = await api.checkout(checkoutId);
        if (cancelled) return;
        setStatus(next);
        if (next.activated) {
          if (!refreshed.current) { refreshed.current = true; refresh(); }
          return;
        }
        if (['expired', 'canceled', 'failed'].includes(next.status)) return;
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Não foi possível consultar o pagamento.');
        return;
      }
      if (attempt >= DELAYS_MS.length) { setGaveUp(true); return; }
      timer = setTimeout(() => void poll(attempt + 1), DELAYS_MS[attempt]);
    };
    void poll(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [api, checkoutId]);

  const planName = status ? PLANS[status.tier]?.name : null;
  let icon = <Loader2 size={28} className="animate-spin text-brand-fg" aria-hidden="true" />;
  let title = 'Aguardando confirmação do pagamento';
  let body = 'Assim que o gateway confirmar o pagamento, o plano é ativado na sua organização. Você pode continuar usando a plataforma normalmente.';
  if (!checkoutId || error) {
    icon = <XCircle size={28} className="text-danger" aria-hidden="true" />;
    title = 'Não encontramos este pagamento';
    body = error ?? 'O link de retorno está incompleto.';
  } else if (status?.activated) {
    icon = <CheckCircle2 size={28} className="text-success" aria-hidden="true" />;
    title = `Plano ${planName} ativado`;
    body = 'Pagamento confirmado. Os novos recursos e limites já estão disponíveis para toda a organização.';
  } else if (status && ['expired', 'canceled', 'failed'].includes(status.status)) {
    icon = <XCircle size={28} className="text-danger" aria-hidden="true" />;
    title = 'Pagamento não concluído';
    body = 'Nada foi cobrado e o seu plano continua o mesmo. Você pode tentar novamente quando quiser.';
  } else if (gaveUp) {
    icon = <Clock size={28} className="text-warning" aria-hidden="true" />;
    title = 'Ainda não recebemos a confirmação';
    body = 'Pagamentos por Pix ou boleto podem levar alguns minutos (boleto, até alguns dias úteis). O plano será ativado automaticamente; você pode fechar esta página.';
  }

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center" role="status" aria-live="polite">
        {icon}
        <h1 className="m-0 text-xl font-bold text-content">{title}</h1>
        <p className="m-0 text-sm leading-relaxed text-content-secondary">{body}</p>
        <div className="mt-2 flex gap-2">
          <Link to="/billing" className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-content no-underline hover:bg-surface-elevated">Plano e cobrança</Link>
          <Link to="/dashboard" className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-black no-underline hover:bg-brand-hover">Ir para o painel</Link>
        </div>
      </div>
    </PageContainer>
  );
}
