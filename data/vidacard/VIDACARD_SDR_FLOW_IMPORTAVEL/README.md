# VIDA CARD — SDR FLOW

Arquivo principal para importação:
VIDACARD_SDR_FLOW_IMPORT.json

Validação local realizada:
- schemaVersion = 1
- 31 nós
- 43 conexões
- exatamente 1 gatilho
- IDs únicos
- nenhuma conexão entrando no gatilho
- todas as portas obrigatórias conectadas
- uma única conexão por sourcePort
- nenhum nó órfão
- todos os ramos alcançam output.end
- sem targetPort
- sem propriedades extras na raiz
- loopLimit = 5

Antes de produção:
1. Importe o JSON.
2. Cadastre VIDACARD_RAG_BASE.md na coleção documents.
3. Crie um documento por unidade usando VIDACARD_UNIT_TEMPLATE.md.
4. Atualize preços, modalidades, agendas e campanhas com validade.
5. Se quiser ativar o Modo Teste, edite o nó guard_test e informe allowedPhones.
