# Supabase Auth, contas e agentes

## Configuração

O frontend recebe somente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. API e worker recebem `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `CONNECTION_SECRETS_KEY`. `ALLOWED_ORIGINS` é uma lista separada por vírgulas. `STANDALONE_MODE` deve permanecer `false`; a API recusa sua inicialização em produção quando ele está ativo.

No painel do Supabase, configure o Site URL, permita apenas os redirects `/auth/callback` e `/reset-password` dos domínios implantados, habilite confirmação de e-mail e SMTP de produção. Aplique as migrations em ordem. O trigger de `auth.users` provisiona perfil `client`, organização, membership, limites e agente padrão na mesma transação.

## Primeiro administrador

Depois de criar e confirmar o usuário, execute no SQL Editor usando seu UUID exato:

```sql
update public.profiles set role = 'admin', updated_at = now()
where user_id = '<uuid-confirmado>' and role = 'client';
```

Confirme que exatamente uma linha foi alterada. Para reverter, troque `admin` por `client`. Nunca derive o papel de `user_metadata`.

## Migração do standalone

1. Interrompa escritas legadas e produza um backup cifrado de `data/store.json` fora do host da aplicação.
2. Prepare um mapa revisado de cada `instanceName` para `owner_user_id` e `organization_id`; ambiguidades bloqueiam o cutover.
3. Migre fluxos/versões, conexões e bindings usando UUIDs internos. Grave credenciais exclusivamente por `set_connection_credentials`, nunca em tabelas públicas.
4. Compare contagens e execute os testes cross-tenant antes de trocar webhooks para `/api/webhooks/evolution/:connectionId`.
5. Mantenha o JSON apenas como backup cifrado durante a janela aprovada. Não o apague automaticamente.
6. Rotacione OpenAI, Evolution, webhook secrets, Google client secret e todos os refresh tokens que estiveram no JSON ou em logs.

## Rollout e rollback

Implante primeiro a migration aditiva, depois API, web e worker. Cadastre os redirects, valide login/registro/reset, crie o primeiro admin e só então altere os webhooks. Em falha de Auth, coloque o painel em manutenção; não reative rotas públicas. O rollback da aplicação pode manter o schema aditivo, mas não deve restaurar o webhook por `instanceName` nem o standalone em produção.

## Limites conhecidos de homologação

PGlite verifica schema, RLS e integridade localmente, mas não substitui um ensaio hospedado do Supabase Auth/JWKS, SMTP, duas conexões PostgreSQL concorrentes, Redis e provedores reais. Execute esses cenários em staging antes do cutover.
