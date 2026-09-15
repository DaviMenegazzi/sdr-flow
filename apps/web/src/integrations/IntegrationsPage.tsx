import { CalendarDays, ServerCog, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Calendar credentials are server-managed for now. The former screen performed
 * OAuth against the legacy JSON store, while production flow execution never read
 * those credentials. Keep the route as an honest migration notice instead of a
 * UI that appears to connect an account but has no effect on the runtime.
 */
export function IntegrationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 sm:p-10">
      <header>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
          <ShieldCheck size={15} />
          Integrações seguras
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-content-primary">Integrações externas</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-content-secondary">
          As conexões por instância do armazenamento antigo foram removidas. Esta tela não salva mais tokens ou credenciais fora do Supabase.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6" aria-labelledby="calendar-heading">
        <div className="flex gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <CalendarDays size={22} />
          </div>
          <div>
            <h2 id="calendar-heading" className="text-base font-semibold text-content-primary">Google Calendar</h2>
            <p className="mt-1 text-sm leading-6 text-content-secondary">
              O runtime usa somente as credenciais configuradas no servidor. Nenhuma autorização OAuth feita no navegador será mostrada como conectada até existir armazenamento seguro, criptografado e com escopo de organização.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-border bg-surface-elevated/50 p-4 text-sm text-content-secondary">
          <div className="flex items-center gap-2 font-semibold text-content-primary">
            <ServerCog size={16} className="text-brand" />
            Configuração atual
          </div>
          <p className="mt-2 leading-6">
            Para executar nós <code className="rounded bg-surface px-1.5 py-0.5 text-xs">calendar.*</code>, configure{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 text-xs">GOOGLE_CALENDAR_CREDENTIALS_JSON</code> no ambiente do servidor. Sem essa configuração, o fluxo segue pela porta de erro e não simula uma ação de agenda bem-sucedida.
          </p>
        </div>
      </section>

      <div>
        <Link
          to="/flows"
          className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-content-primary transition-colors hover:bg-surface-elevated"
        >
          Voltar aos fluxos
        </Link>
      </div>
    </main>
  );
}
