# SDR Flow

Fundação do motor de fluxos SDR: o construtor visual do AutoGen Studio adaptado para conversas de WhatsApp, com domínio e backend TypeScript novos.

Editor, runtime e integrações possuem implementação local. OpenAI está disponível no servidor e no playground; Evolution e Meta estão preparados com envio desativado por padrão. Consulte [configuração de OpenAI e WhatsApp](docs/PROVIDERS.md). Veja o [estado da implementação](docs/IMPLEMENTATION.md) e o [plano original completo](docs/PLAN.md).

## Abrir localmente

Requisitos: Node **22.13+** e pnpm **11.24.0**. Verificado nesta máquina com Node 24.13.0.

```powershell
cd 'C:\Users\Davi Menegazzi\Desktop\Projetos Dev\sdr-flow'
pnpm install --frozen-lockfile
pnpm dev
```

- Editor: [http://127.0.0.1:5173/flows/new](http://127.0.0.1:5173/flows/new)
- API: [http://127.0.0.1:3001/api/health](http://127.0.0.1:3001/api/health)
- Sem Redis configurado, o worker informa que está desativado; web e API continuam funcionando.
- `pnpm dev:web` e `pnpm dev:api` permitem iniciar separadamente.

No editor: arraste um nó da biblioteca, conecte suas saídas, selecione o nó para configurar e clique em **Validar**. **Usar modelo SDR** abre o grafo estrutural com 17 nós e 19 conexões. **Salvar**, sem sessão, grava explicitamente um rascunho no navegador; **Recuperar rascunho local** o recupera. Exportar e importar preservam o grafo em JSON. Nenhuma dessas ações locais publica uma versão.

## Conectar o Supabase

1. Use um projeto de desenvolvimento e aplique todos os arquivos de `supabase/migrations/` em ordem pelo SQL Editor do Supabase. A migração é para um schema novo; não a aplique sobre o SDR Engine existente.
2. Se `.env` ainda não existir, copie `.env.example` para `.env` na raiz e preencha `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Os dois campos VITE usam a mesma URL e chave pública do servidor.
3. Reinicie `pnpm dev`. Em **Configurações**, entre com um usuário já existente no Supabase Auth, crie a organização e volte ao construtor.
4. **Salvar** grava `flows.draft`; **Publicar** valida o grafo no servidor, cria `flow_versions`, atualiza o ponteiro de publicação e registra `audit_events` em uma transação. Os fluxos salvos aparecem no seletor da organização.

A chave de serviço fica somente na API. Requisições de leitura e rascunho usam o JWT do usuário com RLS; apenas a RPC de publicação usa a chave de serviço, após validação de JWT, organização, papel e grafo. A função SQL verifica novamente a associação do ator à organização. Clientes autenticados não têm permissão para chamar essa RPC diretamente, inserir versões ou alterar o ponteiro publicado. Credenciais de provedores não pertencem às tabelas públicas.

Login, organizações, membros e conexões têm telas próprias. A chave OpenAI é configurada no `.env` do servidor. As integrações externas aguardam homologação.

## Verificação

```powershell
pnpm check
pnpm db:types:check
pnpm test:db
```

`check` executa TypeScript, Vitest e build. Os testes SQL usam **PostgreSQL embutido via PGlite**, em bases descartáveis: migrações reais, roles, RLS, FKs, publicação e imutabilidade. O bootstrap simula somente `auth.users`, `auth.uid()` e os papéis do Supabase. Isso não substitui a homologação com Supabase Auth/PostgREST hospedados nem os testes de concorrência em múltiplas conexões.

`pnpm db:types` gera `packages/db/src/database.types.ts` consultando as tabelas e enums do catálogo Postgres após as migrações. Os contratos RPC estão declarados no gerador; atualize-os junto das assinaturas SQL. PGlite não é dependência de nenhum app e nunca é persistência de negócio.

## Docker Compose

```powershell
docker compose config --quiet
docker compose up --build -d
```

Acesso em [http://127.0.0.1:8080](http://127.0.0.1:8080). A stack padrão contém Traefik, web, API, worker e Redis. Somente o Traefik publica porta, vinculada ao localhost. Redis usa AOF e `noeviction`. O worker consome jobs de manutenção e turnos, mas o gateway de entrada ainda executa inline e precisa ser integrado à fila.

Evolution é o sexto serviço, ativado pelo perfil `whatsapp`, após configurar `EVOLUTION_API_KEY` e `EVOLUTION_DATABASE_URL` para o banco próprio do provedor:

```powershell
docker compose --profile whatsapp up --build -d
```

Use `docker compose --env-file <arquivo-fora-do-repositorio> ...` para os segredos em uma VPS. A chave pública do frontend entra no build. O volume `evolution_instances` preserva as sessões do provedor. Sua política de backup e o TLS/Let's Encrypt pertencem à fase de produção.

**Docker não estava instalado/disponível nesta sessão. As imagens, healthchecks e a inicialização da stack não foram executados.** Não há conexão WhatsApp ativa nem serviço externo provisionado por esta entrega.

## Estrutura

```text
apps/web       Vite, React 18, React Flow, Zustand, tema AutoGen
apps/api       Express 5, autenticação Supabase, rotas de fluxo
apps/worker    BullMQ, estrutura de manutenção e healthcheck
packages/shared   contratos, enums e telefone
packages/flow     catálogo, validador, modelos e máquina de estados
packages/db       cliente Supabase, repositório e tipos gerados
supabase/migrations   SQL versionado
tests             suítes portadas, grafo, store, API e Postgres
```

Origem dos componentes e próximos serviços: [mapa de migração](docs/MIGRATION.md). Atribuições: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
