# Auditoria UX — Dashboard (Indicadores)

- **Arquivo**: `apps/web/src/metrics/DashboardPage.tsx` · API `GET /metrics/dashboard` (`apps/api/src/app.ts:2018`)
- **Skills**: `dataviz` (escolha dos gráficos, cor validada por script, marcas, interação, acessibilidade) e `apple-design` (hierarquia, simplicidade, orientação, retorno ao usuário, agrupamento e rótulos)
- **Método**: leitura do código + a página renderizada no Chromium com **dados realistas simulados** (30 dias, 1.684 conversas, 2 versões de fluxo), nos modos escuro e claro, com hover no gráfico. Capturas: `before-dark.png`, `before-light.png`, `before-tooltip.png`.

---

## Resumo

O dashboard tem as peças certas (KPIs, funil, tendência e comparativo por versão), mas **não responde às duas primeiras perguntas de quem abre a página**: *"qual período é este?"* e *"isso está melhor ou pior?"*. A API já aceita `startDate`/`endDate` (padrão: **últimos 30 dias**), mas a interface não mostra o período nem deixa mudar, e o subtítulo diz "em tempo real". Os 6 KPIs têm o mesmo peso, nenhum mostra variação, e o "funil" mistura etapas com resultados.

---

## 1. Orientação e contexto (apple-design: onde estou, o que estou vendo)

| Antes | Depois | Por quê |
| --- | --- | --- |
| Nenhum período visível. A API usa os últimos 30 dias por padrão (`app.ts:2027`), e o subtítulo diz "consolidados em **tempo real**" | Uma **linha de filtros acima de tudo**, com o período primeiro: presets *Hoje · 7 dias · 30 dias · 90 dias* e intervalo personalizado. O período escolhido aparece no subtítulo ("1–30 set · comparado aos 30 dias anteriores") | A `dataviz` manda os filtros numa linha só, acima dos gráficos, com o período primeiro. Sem período, nenhum número tem significado |
| O filtro de instância fica escondido no header global ("Canal ativo") e muda os números em silêncio | Mostrar a instância como um filtro visível na mesma linha: "Instância: Todas ▾" | Um filtro que afeta a página precisa aparecer na página. Proximidade indica relação |
| "Consolidar Hoje" é um botão de destaque, e a mensagem de sucesso fala em "consolidadas em **metrics_daily**" | Mover para um menu "⋯" (ação de administrador) ou rodar automaticamente. Se ficar, usar a mensagem "Números de hoje atualizados às 14:32" | É uma ação operacional e interna. O nome de tabela é jargão. O retorno deve dizer o que mudou para o usuário |
| Dois botões de exportar competindo com o título | Um só botão "Exportar ▾" com as opções *Leads* e *Conversas*, **respeitando o período e a instância filtrados** | Simplicidade: o caminho comum primeiro, as opções um nível abaixo. Hoje o CSV ignora os filtros |
| Título pequeno "INDICADORES DE DESEMPENHO" + H1 "Indicadores" | Remover o título pequeno, ou trocar pelo contexto útil ("Últimos 30 dias · Todas as instâncias") | Hoje ele só repete o H1 |

## 2. Hierarquia dos KPIs (dataviz: KPIs e número de destaque · apple-design: o mais importante deve ser o mais óbvio)

| Antes | Depois | Por quê |
| --- | --- | --- |
| 6 cartões iguais, sem ordem de importância | **Número de destaque**: *Taxa de qualificação* (≥ 48px), seguido de uma fileira de 4 cartões: Conversas · Qualificados · 1ª resposta · Custo por lead qualificado. O custo total de IA vai para o detalhe do cartão de custo | A `dataviz` pede exatamente **um** número de destaque por tela. Para um SDR, o número principal é a taxa de qualificação |
| Nenhum cartão mostra variação | Cada cartão ganha variação **com sinal, em relação a um período nomeado** ("▲ 3,1 p.p. vs. 30 dias anteriores"). A cor indica se a direção é boa (tempo e custo **caindo** = bom) | Sem comparação, o número não diz se a situação está melhor ou pior. Precisa de uma segunda chamada à API com o período anterior, ou de um campo `previous` no endpoint |
| Opcional | Minigráfico de 30 pontos no cartão, em cinza, com o período atual na cor de destaque | Os dados já existem em `dailyTrends` |
| Números coloridos: **471** em verde "success", **27.97%** em verde da marca, ícone de relógio em âmbar "warning" | Números sempre na cor de texto principal. A cor fica só na variação e num ícone discreto | "Texto não usa a cor do dado". As cores de status (sucesso/alerta) são reservadas para significado real, e o relógio âmbar sugere um alerta que não existe |
| `1684`, `27.97%`, `74s`, `3 mi tokens` | `1.684`, `28,0%`, `1 min 14 s`, `3,0 mi tokens` (tudo com `Intl` pt-BR) | O separador de milhar e a vírgula decimal estão no formato americano, e 2 casas na taxa é precisão falsa |
| "Custo / Lead Qual." | "Custo por lead qualificado" | Rótulos diretos e específicos, sem abreviação |
| Detalhe "Percentual sobre o total" / "Eficiência de custo da IA" | Detalhe que acrescente informação: "471 de 1.684 conversas" / "US$ 12,42 no período" | O texto de apoio hoje só repete o título |

## 3. Funil (dataviz: tipo de gráfico, marcas e rótulos)

| Antes | Depois | Por quê |
| --- | --- | --- |
| Barras **verticais** com rótulos girados −25° e **cortados** ("…leta de Informações", "…minhado p/ Humano") | Barras **horizontais**, com os rótulos lidos na horizontal à esquerda e o valor na ponta | A `dataviz` indica barras horizontais para categorias com nomes longos. Rótulo cortado é um erro listado explicitamente |
| As 8 etapas no mesmo eixo, incluindo **Encaminhado p/ Humano** e **Encerrado**, que são *resultados* e não etapas. A barra "Encerrado" (640) sobe no fim e parece que o funil volta a crescer | Funil com as 6 etapas em progressão (Nova → Convertido). *Humano* e *Encerrado* viram 2 cartões de resultado ao lado ("163 encaminhados · 640 encerrados") | Misturar etapa e desfecho engana a leitura |
| Mostra só a contagem por etapa | Rótulo "1.210 · 72%" na ponta, com a **conversão entre etapas** ("→ 70%") entre as barras | O funil existe para mostrar **onde os leads se perdem**, e a taxa entre etapas é essa informação. O campo `percentage` já vem da API e não é usado |
| Um verde neon saturado em todas as barras, com mais de 40px de espessura | **Escala ordinal** de um só tom de verde (mais escuro = etapa mais avançada), barras ≤ 24px, pontas arredondadas de 4px | Etapas ordenadas pedem escala ordinal. Blocos grossos e saturados "gritam" |
| Grade tracejada (`strokeDasharray="3 3"`) | Linha fina contínua, em cinza discreto | Grade tracejada está na lista de erros da `dataviz` |
| Título "Funil de Conversão SDR" + "Por Estágio Canônico" | "Funil de conversão" + período ("30 dias") | "Canônico" é jargão interno |

**Cores validadas** (`validate_palette.js --ordinal`, passa em tudo):
- Claro, sobre `#ffffff`: `#6cc795 → #3fb074 → #1f9460 → #127547 → #0b5a36`
- Escuro, sobre `#141414`: `#0f5c37 → #1a7a4a → #27a866 → #4fc583 → #8fe0b0`

## 4. Evolução diária (dataviz: forma, cor, legenda e dica ao passar o mouse)

| Antes | Depois | Por quê |
| --- | --- | --- |
| **2 séries sem legenda** | Legenda sempre visível ("━ Conversas  ━ Qualificados") + rótulo direto no último ponto de cada linha | Com 2 ou mais séries a legenda é obrigatória. Hoje a identidade depende só da cor |
| Duas áreas com gradiente de 40% de opacidade, uma sobre a outra | **Linhas** de 2px (área só na série de destaque, com ~10% de opacidade). Opcional: *Conversas* em cinza e *Qualificados* em destaque | Qualificados é um subconjunto de Conversas. A história é a qualificação, então vale destacá-la |
| Cores fixas `#2ee86b` / `#38bdf8` → **FALHAM no validador** (faixa de luminosidade nos 2 modos; no claro, contraste de 1,63:1 e 2,14:1, abaixo do mínimo de 3:1) | Tokens de gráfico por tema, **validados**: claro `#2a78d6` (Conversas) + `#10915a` (Qualificados); escuro `#3987e5` + `#22a861`. **Passam em todos os testes** nos dois modos | A cor calculável foi calculada. Recharts desenha SVG por atributos, então as cores vêm de `getComputedStyle` quando o tema muda |
| Eixo X com datas ISO `2026-09-01` | `01/09`, com menos marcações (semanais) | Leitura rápida no formato local |
| A dica mostra "Conversas : 43" em verde, sem destaque para o valor | O valor em destaque, o nome secundário, uma marquinha da cor da série, e a data escrita ("qui, 11 set") | Na dica, o valor vem primeiro e o texto usa as cores de texto, não a da série |
| `handoff`, `tokens` e `cost` já vêm por dia e não são usados | Opcional: uma aba "Custo" com o custo diário. **Nunca com dois eixos Y** | Duas medidas em escalas diferentes pedem dois gráficos |
| Título "Evolução Diária de Atendimentos" + "Consolidado por Data" | "Conversas por dia" | O texto secundário não informa nada |

## 5. Comparativo por versão de fluxo

| Antes | Depois | Por quê |
| --- | --- | --- |
| Números alinhados à esquerda, `1,983,600` (formato en-US) | Colunas numéricas **alinhadas à direita** com `tabular-nums`, `1.983.600` | Números em coluna precisam alinhar para comparar |
| "Qualificados" em verde | Texto principal. Se quiser destacar, **negrito na melhor taxa** | A cor de status não deve ser usada como destaque |
| Não mostra qual versão está **em produção** nem a diferença entre versões | Selo "Em produção" na versão ativa + coluna "Δ taxa vs. anterior" (v11 **+7,8 p.p.**) | O objetivo declarado da tabela é comparar o impacto dos prompts, e a diferença é a resposta |
| `avgResponseTimeSec` vem da API e não aparece | Coluna "1ª resposta" | Dado já disponível |
| Cabeçalho "Custo ($)" | "Custo (US$)" | Consistente com os cartões |

## 6. Retorno ao usuário (apple-design: status, conclusão, alerta, erro)

| Antes | Depois | Por quê |
| --- | --- | --- |
| Ao recarregar (trocar de instância), a página mantém os dados antigos **sem nenhum sinal** de que está atualizando | Manter o gráfico anterior com opacidade reduzida + um pequeno "Atualizando…" | A `dataviz` pede para manter o quadro anterior durante o carregamento. Hoje a pessoa pode ler números da instância errada |
| Uma falha de exportação usa o **mesmo** banner da falha de carregamento | Um aviso curto e local ("Não foi possível exportar leads. Tentar de novo") perto do botão | O erro deve ficar perto da causa e oferecer uma saída |
| Nenhum horário de atualização | "Atualizado às 14:32" ao lado do período | Informa o status sem o usuário ter que perguntar |

## 7. Acessibilidade (dataviz)

- Não há tabela alternativa aos gráficos → adicionar "Ver como tabela" em cada card. O funil e a série diária precisam ser acessíveis sem depender de hover.
- A dica só abre com o mouse → foco pelo teclado precisa mostrar o mesmo.
- A identidade das séries depende só da cor → a legenda e os rótulos diretos resolvem.

---

## Proposta de implantação

| Fase | Itens | Esforço |
| --- | --- | --- |
| **A · Rápidas** (só front) | Números em pt-BR, cores de texto nos KPIs, funil horizontal com rótulos inteiros e etapas × resultados separados, legenda e datas no gráfico diário, cores validadas por tema, grade contínua, tabela alinhada, rótulos mais claros, "Exportar ▾", "Consolidar" no menu "⋯" | Pequeno |
| **B · Período** (front + API existente) | Linha de filtros com presets de período e instância visível, subtítulo com o período, exportação respeitando os filtros, indicador de "Atualizando…" e hora da atualização | Médio (a API já aceita `startDate`/`endDate`; o CSV precisa receber os filtros) |
| **C · Comparação** (API) | Variação vs. período anterior nos KPIs, número de destaque, minigráficos, Δ entre versões e selo "Em produção" | Médio (chamada extra ao período anterior, ou um campo `previous` no endpoint) |
| **D · Acessibilidade** | Tabela alternativa por gráfico, dica pelo teclado | Pequeno |
