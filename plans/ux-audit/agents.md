# Agentes de IA — auditoria UX

Arquivos: `apps/web/src/agents/*` · Capturas: `img/agents.png`, `img/agents-drawer.png`

## Card do agente

| Antes | Depois | Por quê |
| --- | --- | --- |
| **Métricas inventadas**: "Conversas: Ativo", "Qualificação: IA Ativa", "Latência: ~850ms" estão **fixas no código** (`AgentCard.tsx`, bloco de estatísticas) e aparecem iguais em todos os agentes | Mostrar dados reais do período (conversas, taxa de qualificação, 1ª resposta média) vindos das métricas por agente. **Enquanto não houver, remover o bloco** | Responsabilidade: um número inventado destrói a confiança nos números reais. O `AGENTS.md` do repositório também proíbe simular |
| Selo "**Sem chave**" em vermelho sem ação | "Sem chave da OpenAI · **Adicionar chave**" (abre a gaveta na aba Chave). O agente sem chave fica com um estado visual de "inativo" | Um erro precisa de uma saída |
| Botões: Configurar · ▶ (sem rótulo) · 🗃 vermelho cheio | "Configurar" (principal) · "Testar" (com texto, abre o Playground) · "⋯ → Arquivar" | Ícone sem rótulo não é descobrível. Destrutivo não fica em destaque (T3) |
| `openai / gpt-4o-mini` em fonte monoespaçada | "GPT-4o Mini", o nome que aparece na gaveta | Consistente com a própria gaveta |
| O prompt aparece como citação ("Você é Sofia…") | Manter, mas limitar a 2 linhas com um "ver mais" | Ok |
| Filtro "Todos os status" com 2 agentes | Mostrar filtros só a partir de ~6 itens | Simplicidade |
| "Slots de Agente: 2 / 5" + barra | "2 de 5 agentes do plano" | Rótulo direto |

## Gaveta de configuração (`agents-drawer.png`)

| Antes | Depois | Por quê |
| --- | --- | --- |
| 4 abas. **A última ("Chave de API") fica cortada** ("Chave de…") na largura da gaveta | Abas com rolagem horizontal e indicador, ou rótulos mais curtos ("Modelo · Prompt · Ferramentas · Chave") | A navegação não pode esconder uma aba, ainda mais a que resolve "Sem chave" |
| Temperatura como slider com `0.40` e extremos "Fiel às regras / Livre e expressivo" | Três opções: **Preciso · Equilibrado · Criativo** (0,2 / 0,4 / 0,7), com o slider fino em "Avançado" | Mais simples para o usuário comum, sem perder o controle |
| "Descrição Interna (Opcional)" | "Descrição (só para a equipe)" | Rótulo claro |
| Salvar / Cancelar no rodapé | Ok. Acrescentar o aviso "alterações não salvas" ao fechar com mudanças | Evita perder a edição |
