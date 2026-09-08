# SDR Flow

Leia `docs/PLAN.md`, `docs/IMPLEMENTATION.md` e `docs/MIGRATION.md` antes de ampliar o escopo.

- Este repositório é independente de `../auto-gen` e `../sdr-engine`.
- Supabase Postgres é a única persistência de negócio. PGlite só existe em testes e geração de tipos.
- Toda tabela de negócio exige organization_id, RLS e FKs compostas em referências entre entidades da organização.
- Não porte o auth SHA-256, as duas tabelas WhatsApp, a escrita dupla ou o buffer em memória.
- O mesmo catálogo Zod deve alimentar o formulário e a validação da API.
- Versões publicadas são imutáveis; retomadas devem usar flow_executions.flow_version_id.
- Não implemente nós desconhecidos como no-op. Não simule publicação, conexão ou envio bem-sucedido.
- Preserve a atribuição MIT do AutoGen em `LICENSE` e `THIRD_PARTY_NOTICES.md`.
- Verificação: `pnpm db:types:check` e `pnpm check`. Para UI, verifique o fluxo no navegador.
- Os arquivos dos projetos de origem não devem ser alterados durante a migração.
