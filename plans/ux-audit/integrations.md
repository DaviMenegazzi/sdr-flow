# Integrações Externas — auditoria UX

Arquivo: `apps/web/src/integrations/IntegrationsPage.tsx` · Captura: `img/integrations.png`

| Antes | Depois | Por quê |
| --- | --- | --- |
| Pagamentos: Asaas, Mercado Pago e Stripe com o selo **"Pronto para Conectar" em verde** | Selo neutro "Não configurado" + botão "Conectar". Verde só quando conectado | Verde significa "ok". Aqui significa o contrário |
| Texto para o usuário final com termos de infraestrutura: nós `calendar.availability` / `calendar.create_event`, "fallback ao `GOOGLE_CALENDAR_CREDENTIALS_JSON` configurado no ambiente da **VPS**", "segurança nível empresarial (**RLS**)", "Multi-inquilino" | "O agente consulta horários livres e marca consultas na sua agenda." Os detalhes técnicos ficam num bloco recolhido, só para administradores | Jargão (T5). Além disso, expor nomes de variáveis de ambiente e da infraestrutura não ajuda o cliente |
| "Desconectar" em vermelho cheio ao lado de "Ver Agendas" | "Ver agendas" (principal) + "⋯ → Desconectar" com confirmação | T3 |
| Não mostra **qual agenda** os agentes usam, nem se alguma consulta foi marcada recentemente | "Agenda usada: Consultas Ijuí · 12 agendamentos esta semana" | Status útil |
| "Gates de Pagamento" + selo "Vendedor Sênior Ativo" | "Pagamentos" + selo do plano ("Plano Pro") | "Gate" é jargão interno e o nome do plano é inconsistente com o selo "PRO" da sidebar |
| Página estreita e centralizada | Layout padrão (T7) | Consistência |
