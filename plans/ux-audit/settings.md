# Configurações + Administração — auditoria UX

Arquivos: `apps/web/src/session.tsx` (Configurações), `apps/web/src/admin/AdminPage.tsx` · Capturas: `img/settings-team.png`, `img/settings-invites.png`, `img/settings-apikeys.png`, `img/admin.png`

## Arquitetura da informação

Hoje há **3 lugares para adicionar pessoas**: Administração › "Convidar Novo Usuário", Configurações › Time › "Adicionar login" e Configurações › Convites › "Gerar Convite". E a troca de organização fica escondida no card do topo de Configurações.

| Antes | Depois | Por quê |
| --- | --- | --- |
| 3 fluxos de "adicionar pessoa" | **Um** botão "Convidar pessoa" em Time (por e-mail, com papel). "Criar login direto" vira uma opção avançada desse fluxo. A Administração cuida só de **contas/clientes** (limites, suspensão) | Familiaridade: a mesma coisa num só lugar |
| O seletor de organização fica dentro de Configurações, e "Sair" aparece ali **e** na sidebar | Organização no topo da sidebar (onde já aparece "Vida Card · PRO"), clicável para trocar. "Sair" só no menu do usuário | Orientação: a organização atual é um contexto global, como a instância |
| As abas "Convites" e "Nova Organização" | "Convites pendentes" vira uma seção de Time. "Nova organização" vai para o seletor de organização | Menos abas, cada uma com um propósito |

## Time & Membros (`settings-team.png`)

| Antes | Depois | Por quê |
| --- | --- | --- |
| Cabeçalho "**ID do Usuário**" com os **nomes** em fonte monoespaçada | "Pessoa": nome + e-mail, fonte normal | O rótulo não corresponde ao conteúdo |
| Datas `5/7/2026`, `7/22/2026` | `07/05/2026` ou "há 4 meses" | T1 |
| Mudar o papel no select aplica **na hora**, sem confirmação nem desfazer | Aplicar e mostrar um aviso "Camila agora é Atendente · **Desfazer**" | Ação que muda permissões precisa ser reversível e visível |
| O papel "owner" em inglês num selo âmbar. As opções misturam "Administrador (admin)" | Papéis só em português (Dono, Administrador, Atendente, Leitor), num selo neutro, com uma dica sobre o que cada um pode fazer | Consistência e cor semântica |
| "Remover" em vermelho em cada linha + `confirm()` nativo | "⋯ → Remover da organização" + Modal com o nome | T3/T4 |
| "Agentes disponíveis" dentro de Configurações › Time | Remover daqui (já existe a aba Agentes) | Duplicado |

## Chaves de API (`settings-apikeys.png`)

| Antes | Depois | Por quê |
| --- | --- | --- |
| **Checkboxes quebrados**: cada checkbox aparece **acima** e centralizado sobre o texto (o CSS antigo `label{flex-direction:column}`) | Checkbox à esquerda do texto, alinhado | Bug visual (T8) |
| "Chaves Servidor-a-Servidor (**S2S**)… cabeçalho `X-API-Key: sdr_live_...`" | "Chaves para integrar outros sistemas (CRM, n8n)". O cabeçalho vai para o exemplo de código em "Como usar" | Jargão (T5) |
| Escopos rotulados "Consultar fluxos (**flows:read**)" | O rótulo em português + o escopo técnico em cinza e menor | Mantém a informação sem poluir |
| "Gerar Chave S2S" | "Criar chave". Depois de criar: "Copie agora, ela não será mostrada de novo" + botão copiar | Retorno de conclusão com a instrução crítica |

## Administração (`admin.png`)

| Antes | Depois | Por quê |
| --- | --- | --- |
| **"Suspender" em vermelho cheio em cada linha, sem confirmação**, inclusive na **própria conta do administrador** (Davi Silva) | Desabilitar na própria conta ("Você"). "⋯ → Suspender" com Modal que explica o efeito ("o cliente perde acesso e os agentes param de responder") | Ação destrutiva e sem proteção. Alto risco de erro de clique |
| "2 instância(s)" | "2 instâncias", com o limite "2 / 3" como na coluna Agentes | Plural correto e consistência entre colunas |
| O card de convite fica acima da lista, com outra largura | Botão "Convidar cliente" no cabeçalho da tabela | Layout padrão |
| Sem busca nem filtro | Busca por e-mail e filtro "Suspensos" quando houver mais de ~10 contas | Escala |
