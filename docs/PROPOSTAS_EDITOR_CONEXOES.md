# Evolução do editor e conexões — 10/09/2026

## Objetivo e ordem

Permitir configurar atendimento sem editar código, JSON, IDs de contatos ou tokens. Implementação local autorizada; sem commit, push, pull ou deploy nesta entrega.

Ordem: (1) diretório de destinos por instância, compartilhado por filtro e saída; (2) novos blocos e transporte para grupos; (3) conexões externas OAuth e seleção de agenda; (4) central de prompts e dependências; (5) verificações e documentação de homologação.

## 1. Filtro de entrada

Novo bloco `guard.connection_filter`, posicionado imediatamente após o gatilho. Configuração por seletor de instância e dropdown pesquisável de contatos/grupos com seleção múltipla. A lista pertence ao bloco e é a única fonte para manutenção; não duplicar em guardas e configurações globais. Lista vazia bloqueia todos quando ativo. Correspondência exata de JID normalizado e instância, nunca nome de exibição ou sufixos parciais. Grupos usam o JID do grupo, não o telefone do participante.

Bloqueados encerram silenciosamente antes de IA e envio. O modo teste antigo continua compatível, mas a interface orienta migrá-lo para o filtro para evitar duas listas conflitantes. Publicação valida posicionamento e configuração. Nome do grupo não é identificador de autorização.

## 2. Envio a destinos selecionados

Novo bloco `output.send_destinations` com instância, dropdown multi-seleção e mensagem. Contatos e grupos são consultados na Evolution da conexão da organização. Buscar por nome/número, marcar, remover chips e atualizar lista, sem entrada manual de JIDs. Separar esse envio explícito da resposta habitual ao remetente.

Primeira implementação: consulta sob demanda diretamente ao provedor, com atualização manual. Vantagem: nenhuma cópia de agenda desatualizada ou nova persistência. Trade-off: depende da disponibilidade/latência da Evolution. Falhas e lista vazia são estados distintos; nunca oferecer contatos de outra instância. Para volumes maiores, evolução prevista para sincronização periódica em Supabase, com organização+conexão+JID únicos e indicador de última sincronização.

Uma tentativa por destino, com resultado individual e porta de erro em falha parcial. Não repetir automaticamente todos os destinatários após falha parcial. Validar novamente conexão e existência dos destinos no servidor antes de enviar. Meta não será anunciada como compatível com grupos. O envio continua sujeito às restrições de teste do fluxo.

## 3. Conexões externas

Página própria com catálogo extensível de conectores e contas conectadas. Google Calendar é o primeiro: Conectar → consentimento Google → conta disponível → selecionar conta e agenda por dropdown nos blocos.

Authorization Code com state de uso único, expiração, vinculação ao usuário/organização e PKCE. Tokens criptografados no servidor, isolados por organização; o navegador e o grafo recebem somente referências. Renovação automática e desconexão/revogação. Cadastro técnico inicial de client ID, segredo e URL de retorno é responsabilidade da instalação do produto, nunca do cliente que conecta a agenda. Não é possível eliminar esse cadastro exigido pelo Google.

Contas, segredos e estados OAuth em Supabase com RLS; segredos/estados acessíveis somente ao serviço. Não salvar tokens em arquivos de fluxo. Registro de provedores distingue metadados e capacidades para futuros conectores. Compatibilidade com agenda antiga do servidor enquanto novos blocos usam referência explícita à conta.

Homologação real requer configurar aplicativo OAuth, callback e autorizar uma conta Google. Testes simulados não equivalem a consentimento nem criação de evento real.

## 4. Prompts, conhecimento e variáveis

Abas no topo: Editor visual e Prompts e variáveis. Ambas editam o mesmo rascunho/Zustand, preservando desfazer/refazer e publicação imutável. Cartões por bloco com busca, instrução de sistema, prompt editável e bases anteriores no grafo. Edição de uma base altera seu bloco de origem, não cria associação fictícia por agente.

Visão de dependências em tabela: informação → produzida por → usada por → situação. Destacar variáveis externas, referências sem origem conhecida, produtores em caminhos alternativos e sobrescritas. Análise estática percorre arestas e interpolações; não promete conhecer valores de runtime nem decidir condições. Link leva ao bloco no canvas. Seletor Insere informação permite adicionar variáveis ao texto sem escrever chaves.

Formulários de listas e objetos passam a controles repetíveis, seletores e campos nomeados; instruções e conhecimento continuam texto natural. Configurações legadas desconhecidas exigem indicação clara, não perda silenciosa de valores.

## Critérios de aceite

- Contato/grupo fora da lista não chama IA nem envia mensagem.
- Escolher destinos somente pela lista da instância; trocá-la limpa seleção incompatível.
- Falha parcial identifica cada destino entregue/falho sem afirmar sucesso global.
- OAuth rejeita state repetido/expirado e acesso entre organizações; tokens não aparecem no grafo ou UI.
- Seleção de conta/agenda funciona nos executores, inclusive execução por webhook e worker.
- Prompt editado na aba consolidada aparece no bloco e pode ser desfeito.
- Tipos do banco, typecheck, testes relevantes e inspeção no navegador registrados ao concluir.

## Referências técnicas

- [OAuth Google para servidores](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Evolution API — código e contratos](https://github.com/EvolutionAPI/evolution-api)

## Verificação desta entrega

Em implementação. Resultados e limitações serão preenchidos após as verificações.
