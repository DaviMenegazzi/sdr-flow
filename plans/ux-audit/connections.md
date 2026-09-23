# Conexões WhatsApp — auditoria UX

Arquivo: `apps/web/src/connections/ConnectionsPage.tsx` · Capturas: `img/connections.png`, `img/connections-wizard.png`

| Antes | Depois | Por quê |
| --- | --- | --- |
| Conexão "Meta Oficial" com status **Erro** sem nenhuma explicação nem ação | O motivo em uma linha ("Token expirado", "Webhook sem resposta") + a ação que resolve ("Reautenticar") na própria linha | Retorno de erro precisa dizer o que aconteceu e como sair |
| "Campanha Odonto" **Desconectado**, com "QR Code" como um botão entre outros | Quando desconectado, a ação principal da linha é **"Reconectar (QR)"**, em destaque | O próximo passo óbvio deve ser o mais visível |
| Botão vermelho cheio de excluir em **todas** as linhas | Menu "⋯" → Excluir, com diálogo que nomeia a conexão e avisa "o atendimento para imediatamente" | T3/T4 |
| "Copiar URL" do webhook como coluna principal | Mover para "⋯ → Detalhes técnicos" (útil só na configuração da Meta) | Informação de configuração, não de uso diário |
| "Sincronizar" | "Verificar status" (ou nada: atualizar sozinho a cada X s) | O rótulo não diz o que faz |
| Número `+5555999990000` e "Não identificado" em fonte monoespaçada | `+55 55 99999-0000`, fonte normal. "—" quando não houver número | T2 |
| Não mostra qual **agente** nem qual **fluxo** atende cada número. Isso fica numa seção separada lá embaixo ("Fluxos Ativos") | Colunas "Agente" e "Fluxo publicado" na própria tabela, com link | Proximidade: o que se relaciona fica junto. Hoje é preciso cruzar 3 telas (Conexões, Agentes e Builder) |
| Assistente de nova conexão: "…canal de transporte oficial ou **Baileys**", "Evolution API" | "QR Code (rápido, para testes e operação)" vs. "API oficial da Meta (templates aprovados)" | Jargão (T5). O usuário escolhe pelo resultado, não pela tecnologia |
| O assistente abre no meio da página, empurrando a tabela | Abrir o assistente num `Modal` (ou numa página própria) | Tarefa focada: reduzir o que distrai (`apple-design`, "Dim to focus") |
