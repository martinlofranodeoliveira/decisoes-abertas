# Contrato · Decisões Abertas 1

Aplicação estática MIT com domínio puro em JavaScript. Node22+ para testes/build. Sem dependências de runtime de terceiros. Interface PT-BR, responsiva, teclado e rótulos visíveis. Publicar código, demo GitHub Pages, versão1.0.0 e ZIP/checksum; atualizar só catálogo/evidências do perfil, preservando README. Exemplos integralmente sintéticos.

## Ownership e módulos

- `assets/domain.mjs`, `tests/domain.test.mjs`: agente de domínio.
- `assets/formats.mjs`, `assets/store.mjs`, `tests/formats.test.mjs`, `tests/store.test.mjs`: agente de dados.
- Raiz: UI `assets/app.mjs`, HTML/CSS, testes de interface, scripts/CI/docs e integração.
- Ninguém altera arquivos de outro ownership sem coordenar.

## Domínio público

Exports: `AppError`, `LIMITS`, `createDocument()`, `createDecision({id,title})`, `validateDocument(value)`, `applyCommand(document, command)`, `analyzeDecision(decision)`.

`AppError(code,message)` usa mensagens úteis PT-BR, sem reproduzir valores privados. Operações são puras, não alteram entradas; sucesso retorna documento validado e independente. Domínio não lê relógio, gera IDs, usa armazenamento ou rede. IDs/horários são entradas explícitas. `validateDocument` retorna cópia normalizada, não booleano.

`LIMITS`: `maxDecisions=20,maxAlternatives=8,maxCriteria=12,maxSnapshots=12,maxDocumentBytes=2097152`.

Documento:

```json
{"schemaVersion":1,"decisions":[{
 "id":"d1","title":"Comparação fictícia","question":"Qual alternativa atende melhor aos critérios informados?",
 "alternatives":[{"id":"a1","name":"Alternativa A","notes":""}],
 "criteria":[{"id":"c1","name":"Facilidade","weight":40,"description":""}],
 "ratings":[{"alternativeId":"a1","criterionId":"c1","value":null,"note":""}],
 "choice":{"alternativeId":null,"reason":""},
 "snapshots":[]
}]}
```

Matriz é a projeção dos campos title/question/alternatives/criteria/ratings/choice (sem id nem snapshots). Snapshot: `{id,label,createdAt,matrix}`. createdAt é ISO UTC exato com milissegundos e data real, exemplo `2026-11-08T12:00:00.000Z`. `matrix` tem a mesma estrutura e validação da matriz corrente e não contém snapshots aninhados. Registros são cópias locais, não documentos assinados ou prova contra edição do próprio backup.

Regras:

- Somente objetos JSON com chaves exatas do contrato; arrays limitados antes de percorrer, sem extensões silenciosas. Rejeitar tipos incorretos, NaN/Infinity, bool como número, IDs duplicados, referências inexistentes, campos desconhecidos, lone surrogates e controles de texto não permitidos.
- ID `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`; unicidade no respectivo conjunto (document decisions; alternativas; critérios; snapshots). IDs podem coincidir entre conjuntos sem colisão.
- title/name/label: texto simples aparado, 1..120 caracteres Unicode, uma linha, sem controles. question:0..2000; alternative.notes e criterion.description:0..1000; rating.note:0..500; choice.reason:0..4000. Textos longos aceitam LF/TAB; normalizar CRLF/CR para LF e aparar extremos. Sem HTML interpretado.
- weight: inteiro exato0..100; value:null ou inteiro exato0..5. Valor0 é nota real, diferente de ausente. Peso0 exclui critério do cálculo, mas preserva notas e observações.
- `ratings` contém exatamente uma entrada para cada par alternativa×critério, na ordem alternativa e depois critério. Rejeitar duplicação e pares faltantes/estranhos em importação. Comandos de estrutura preenchem novos pares com null/nota vazia e preservam pares existentes.
- Alternativas e critérios podem estar vazios. Escolha exige alternativa existente ou null. Ao remover alternativa escolhida, limpar alternativeId e manter reason (a justificativa textual permanece para revisão). Snapshots preservam todos os IDs/valores anteriores, independentemente de edições/remoções atuais.
- Array decisions preserva ordem. Arrays alternatives/criteria/snapshots preservam ordem; ratings canoniza em ordem da matriz. Documento canônico JSON.stringify com indent2 e LF deve caber no limite UTF-8; criação/edição/importação excedida falha atomicamente.

## Comandos

`applyCommand(doc,{type,...campos})` valida integralmente antes e depois e rejeita comando/campos desconhecidos. Campos obrigatórios abaixo, sem defaults implícitos de comando:

| type | Campos além de type |
| --- | --- |
| decision.add | id,title |
| decision.update | decisionId,title,question |
| decision.remove | decisionId |
| alternative.add | decisionId,id,name,notes |
| alternative.update | decisionId,alternativeId,name,notes |
| alternative.remove | decisionId,alternativeId |
| criterion.add | decisionId,id,name,weight,description |
| criterion.update | decisionId,criterionId,name,weight,description |
| criterion.remove | decisionId,criterionId |
| rating.set | decisionId,alternativeId,criterionId,value,note |
| choice.set | decisionId,alternativeId,reason |
| snapshot.add | decisionId,id,label,createdAt |
| snapshot.remove | decisionId,snapshotId |

`createDecision({id,title})` começa com question vazia, arrays vazios, choice null/razão vazia e snapshots vazios. `createDocument()` começa sem comparações.

## Análise e cálculo

`analyzeDecision(decision)` é puro e retorna:

```json
{"activeWeight":40,"activeCriteria":1,"canRank":false,"missingRatings":1,
 "alternatives":[{"id":"a1","name":"Alternativa A","points":0,"maxPoints":200,
 "answeredWeight":0,"missingCount":1,"coveragePermille":0,
 "minPermille":0,"maxPermille":1000,"scorePermille":null,"rank":null,"tied":false,
 "contributions":[{"criterionId":"c1","weight":40,"value":null,"points":null,"active":true}]}]}
```

`activeWeight=W` soma pesos positivos, `activeCriteria` conta critérios com peso>0. Por alternativa: points=P soma nota×peso somente notas existentes ativas; maxPoints=5W (total possível, não conhecido); answeredWeight soma pesos ativos com nota; missingCount conta notas ativas ausentes; `missingRatings` soma missingCount. contributions segue critérios (inclusive inativos; points=0 para peso0 com nota existente, null quando ausente). `coveragePermille=roundHalfUp(1000*answeredWeight/W)`, `minPermille=roundHalfUp(1000*P/(5W))`, `maxPermille=roundHalfUp(1000*(P+5*(W-answeredWeight))/(5W))`. Esses limites mostram intervalo de pontuação possível, não estimativa probabilística.

Se W=0: coveragePermille/minPermille/maxPermille/scorePermille=null, canRank=false. Sem alternativas ou sem critérios ativos, canRank=false. Só canRank=true se todas alternativas completaram todos critérios ativos. Nesse caso scorePermille=minPermille=maxPermille, ranks por P decrescente (competição1,1,3), empate mantém mesma posição e tied=true em todas empatadas. Se não canRank, nenhum rank ou scorePermille para qualquer alternativa (mesmo uma completa), preserving ordem original. Nunca renormalizar notas por alternativa ou substituir null por0. Pesos são relativos; não precisam somar100. Todos cálculos cabem em inteiro JS seguro; exibir percentagem com uma casa via permille/10. Pontuação não é escolha automática.

## Formatos públicos

`assets/formats.mjs` exports `serializeDocument(doc)`, `parseDocument(text)`, `exportDecisionMarkdown(decision)`, `exportDecisionCsv(decision)`, `createExampleDocument()`.

- serializeDocument usa validateDocument e JSON.stringify(indent2)+LF, ordem canônica; parseDocument exige string e limite UTF8 antes de JSON.parse, sanitiza erros e valida tudo. Erro não inclui conteúdo importado. Formato duplicado segue semântica JSON.parse; não prometer detecção de chaves duplicadas no texto. UI decodifica bytes UTF8 com fatal=true após limite de tamanho.
- Markdown: mostra pergunta, critérios/pesos, notas/observações, cálculo e lacunas/empates, escolha/justificativa e registros históricos resumidos. Escape HTML, Markdown e controles de valores não confiáveis; sem inserir HTML ou cercas vulneráveis. Distinguir não respondido, peso0 e nota0.
- CSV: uma linha por par alternativa×critério, cabeçalho `comparacao,alternativa,criterio,peso,nota,observacao`; texto citado com aspas RFC4180/CRLF, nota ausente campo vazio. Prefixar apóstrofo em texto cujo primeiro caractere significativo após espaços/tab é `=,+,-,@` ou começa TAB/CR para reduzir interpretação como fórmula em planilhas; documentar transformação e que CSV não é backup de restauração. Valores numéricos de peso/nota não são texto de fórmula. Nenhum caminho de importação CSV nesta versão.
- createExampleDocument retorna documento validado com comparação fictícia de espaço de trabalho:3 alternativas (Estúdio Norte, Sala Jardim, Espaço Central),4 critérios (Concentração40, Acesso25, Estrutura20, Flexibilidade15), notas completas, texto curto e um snapshot sintético coerente. Não sugerir empresas/lugares reais.

## Armazenamento opcional

`assets/store.mjs` exports `StorageError`, `createStore({indexedDB=globalThis.indexedDB,name='decisoes-abertas-v1'}={})`. Retorno `{load(),save(document,expectedRevision),clear(expectedRevision),close()}`; methods async exceto close. Revisão inteiro seguro0..MAX_SAFE_INTEGER. Envelope `{revision,document}`; load sem entrada retorna revision0/documentnull. save valida/copia antes de entrar em transação, compara revisão esperada e grava revision+1 em única transação readwrite. clear também compara e incrementa, gravando tombstone documentnull; não apaga contador (evita ABA). Nunca aceitar contador vindo do JSON de backup.

Erro code `conflict` quando revisão mudou, `unavailable` sem IndexedDB, `storage` em falha operacional/quota/abertura, `corrupt` em estado persistido inválido, `revision_limit` em revisão esgotada. Mensagens constantes PT-BR. Não ecoar dados privados. Limite e validação da revisão esperada antes de escrita. Nenhuma operação escreve parcialmente; load valida estado antes de devolvê-lo; não mutar objeto chamador nem envelope retornado. Use IndexedDB próprio da origem, versão1/store `workspaces`/key `default`.

UI começa sem abrir armazenamento nem salvar dados. Ações explícitas Abrir salvo/Ativar salvamento abrem IndexedDB; se já existe outro documento, oferecer abrir/cancelar, nunca sobrescrever silenciosamente. Abrir documento salvo habilita autosave para sessão. Edições são serializadas/coalescidas em fila, com revisão atualizada só após commit. Falha/conflito conserva caderno em memória e permite backup; não repetir overwrite com revisão nova automaticamente. Desativar e apagar exige confirmação, clear com revisão atual. Backup/importação completos sempre funcionam sem habilitar persistência.

## Interface e verificação

Workspace com lista de comparações, cabeçalho de contexto, matriz editável, resultados explicados e registros. Células de nota com rótulo alternativo+critério e opção não respondida; critérios mostram peso relativo, edição sem mutação de snapshots. Formulários completos no fluxo ou dialog nativo acessível, destrutivas confirmadas. Importação com prévia de contagens antes de substituir estado; cancelamento preserva estado. Exportar backup, CSV e Markdown como downloads locais; relatório de snapshot usa matriz histórica, não dados atuais.

Reutilizar tipografia Lato local e licenças originais dos aplicativos LOFRANO; atribuir código de infraestrutura reutilizado. CUA para checar UI desktop/mobile em até duas rodadas visuais; tarefas funcionais adicionais conforme necessário. Não usar Playwright ou outro controle de browser fora de CUA. Testes Node22/24 para domínio, formatos, IndexedDB (fake-indexeddb6.2.7) e UI (linkedom0.18.15). Dependências somente desenvolvimento. CI constrói e publica Pages; conferir bytes públicos e funções reais no navegador após deploy. Preflight sem origens privadas, tokens ou dados operacionais.
