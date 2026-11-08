# Backup, cálculo e exportações

O backup JSON guarda o caderno completo. Markdown e CSV são relatórios de leitura: não substituem esse backup nem são formatos de importação nesta versão. [SPEC.md](../SPEC.md) detalha a API e os comandos do domínio.

Consulte os arquivos públicos do mesmo exemplo fictício: [caderno-exemplo.json](../examples/caderno-exemplo.json), [notas.csv](../examples/notas.csv) e [comparacao.md](../examples/comparacao.md).

## Documento JSON, versão 1

O envelope possui exatamente `schemaVersion` e `decisions`:

```json
{
  "schemaVersion": 1,
  "decisions": [
    {
      "id": "comparacao-1",
      "title": "Espaço fictício de trabalho",
      "question": "Qual opção atende melhor aos critérios informados?",
      "alternatives": [
        { "id": "alternativa-a", "name": "Opção A", "notes": "" },
        { "id": "alternativa-b", "name": "Opção B", "notes": "" }
      ],
      "criteria": [
        { "id": "criterio-1", "name": "Concentração", "weight": 40, "description": "" },
        { "id": "criterio-2", "name": "Acesso", "weight": 60, "description": "" }
      ],
      "ratings": [
        { "alternativeId": "alternativa-a", "criterionId": "criterio-1", "value": 5, "note": "" },
        { "alternativeId": "alternativa-a", "criterionId": "criterio-2", "value": 3, "note": "" },
        { "alternativeId": "alternativa-b", "criterionId": "criterio-1", "value": 4, "note": "" },
        { "alternativeId": "alternativa-b", "criterionId": "criterio-2", "value": 4, "note": "" }
      ],
      "choice": { "alternativeId": null, "reason": "" },
      "snapshots": []
    }
  ]
}
```

Os nomes e valores acima são inteiramente fictícios. A Opção A tem `380` pontos de `500` (**76,0%**); a Opção B, `400` de `500` (**80,0%**). A escolha permanece vazia até ser registrada pela pessoa.

### Estrutura e identidades

| Registro | Campos exatos |
| --- | --- |
| Documento | `schemaVersion`, `decisions` |
| Comparação | `id`, `title`, `question`, `alternatives`, `criteria`, `ratings`, `choice`, `snapshots` |
| Alternativa | `id`, `name`, `notes` |
| Critério | `id`, `name`, `weight`, `description` |
| Nota | `alternativeId`, `criterionId`, `value`, `note` |
| Escolha | `alternativeId`, `reason` |
| Registro histórico | `id`, `label`, `createdAt`, `matrix` |

As chaves são obrigatórias; campos extras são recusados. IDs seguem `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` e são únicos no respectivo conjunto: comparações, alternativas, critérios ou registros históricos. Um mesmo ID pode existir em conjuntos diferentes. As referências devem apontar para IDs presentes na própria matriz.

`ratings` contém exatamente uma entrada por par alternativa × critério, inclusive quando a nota é ausente. `value: null` significa não respondido; inteiros de `0` a `5` são notas reais. Pares duplicados, faltantes ou estranhos são recusados. A validação canoniza a ordem das notas segundo a ordem das alternativas e depois dos critérios.

Os arrays de comparações, alternativas, critérios e registros históricos preservam sua ordem. `choice.alternativeId` é `null` ou o ID de uma alternativa existente. A justificativa pode ser preenchida mesmo sem uma alternativa escolhida.

### Textos, números e limites

| Campo ou conjunto | Regra |
| --- | --- |
| Comparações | Até 20 |
| Alternativas por matriz | Até 8 |
| Critérios por matriz | Até 12 |
| Registros históricos por comparação | Até 12 |
| `title`, `name`, `label` | De 1 a 120 caracteres Unicode, uma linha |
| `question` | Até 2.000 caracteres |
| `alternative.notes`, `criterion.description` | Até 1.000 caracteres |
| `rating.note` | Até 500 caracteres |
| `choice.reason` | Até 4.000 caracteres |
| `weight` | Inteiro exato de 0 a 100 |
| `value` | `null` ou inteiro exato de 0 a 5 |
| Documento canônico | Até 2.097.152 bytes UTF-8 |

Textos são aparados nos extremos. Textos longos aceitam LF e TAB; CRLF e CR são normalizados para LF. Não são aceitos caracteres de controle fora do contrato nem unidades surrogate isoladas. HTML é texto, não uma linguagem de conteúdo aceita pela interface.

Booleanos não substituem números. Valores não finitos, tipos incorretos e referências inválidas são recusados. Arrays podem estar vazios. Sem alternativas ou critérios ativos, a matriz continua válida, mas não tem ranking.

## Registros históricos

`snapshot.matrix` é uma cópia dos campos `title`, `question`, `alternatives`, `criteria`, `ratings` e `choice`. Não inclui o `id` da comparação nem outros registros históricos. Essa matriz é validada pelas mesmas regras da matriz em edição.

`createdAt` usa UTC com milissegundos, em uma data real, por exemplo `2026-11-08T12:00:00.000Z`. IDs e horários são entradas explícitas para o domínio; a interface fornece esses valores ao criar um registro. O horário não autentica a origem ou a autoria do documento.

A interface apresenta esse horário no fuso local do navegador; o backup preserva a representação UTC.

Edições posteriores não modificam o conteúdo dos registros existentes. Ao remover uma alternativa escolhida da matriz atual, a aplicação limpa `choice.alternativeId` e preserva `choice.reason` para revisão. Matrizes históricas continuam com seus próprios IDs, notas e escolhas anteriores.

Os registros são cópias locais, sem assinatura digital ou proteção contra quem editar o backup. Ao exportar o relatório de um registro, a aplicação usa sua matriz histórica, e não a matriz corrente.

## Serialização e importação

`serializeDocument(document)` valida e cria JSON com indentação de dois espaços e LF final. O limite de 2 MiB inclui essa representação canônica completa, com registros históricos. Um comando que exceda o limite é recusado integralmente.

`parseDocument(text)` verifica o limite UTF-8 do texto antes de chamar `JSON.parse` e depois valida todo o documento. A interface também limita o arquivo antes de decodificar seus bytes como UTF-8 estrito. Uma importação precisa satisfazer tanto o limite textual quanto o canônico; espaços extras no arquivo também consomem bytes.

A semântica de chaves repetidas no texto é a de `JSON.parse`; o parser não promete detectá-las previamente. A validação trabalha com o objeto resultante. Mensagens de falha não reproduzem o conteúdo importado.

A importação apresenta uma prévia de contagens antes de substituir o caderno em memória. Cancelar ou receber um erro preserva o documento anterior. Dados válidos não são mesclados parcialmente com um caderno já aberto.

## Cálculo explicado

Considere a soma dos pesos positivos `W`. Para uma alternativa:

- `P` é a soma de `nota × peso` nas respostas ativas existentes.
- `A` é a soma dos pesos ativos que já têm resposta.
- O total possível é `5W`.
- A quantidade de lacunas conta critérios ativos sem nota, independentemente de seu peso relativo.

O resultado usa inteiros em milésimos da escala completa:

```text
cobertura   = roundHalfUp(1000 × A / W)
limite baixo = roundHalfUp(1000 × P / (5W))
limite alto  = roundHalfUp(1000 × (P + 5 × (W - A)) / (5W))
```

`roundHalfUp` arredonda a metade para cima; os termos são não negativos. A interface divide esses inteiros por dez para exibir percentuais com uma casa decimal. O intervalo representa os totais aritméticos possíveis das notas ausentes, não probabilidade ou estimativa de resultado.

Se `W = 0`, os campos de cobertura e pontuação são nulos, sem divisão por zero. Peso zero preserva notas e observações, mas não participa de `W`, de `P` ou das lacunas ativas. Uma contribuição de peso zero com nota existente tem zero pontos; com nota ausente, mantém `points: null`.

Somente quando todas as alternativas responderam a todos os critérios ativos, e existem alternativas e critérios ativos, `canRank` é verdadeiro. O ranking usa `P` em ordem decrescente; empates têm a mesma posição, no padrão `1, 1, 3`. Se a matriz estiver incompleta, nenhum participante recebe posição ou pontuação final, mesmo que uma alternativa isolada esteja completa. Não há normalização por alternativa nem substituição de ausência por zero.

## Relatório Markdown

`exportDecisionMarkdown(decision)` produz um relatório de uma comparação: pergunta, critérios, pesos, notas, observações, contribuições, lacunas ou empates, escolha e justificativa. Registros históricos são resumidos no relatório da comparação; a interface também permite relatar a matriz histórica selecionada.

Valores fornecidos pela pessoa são escapados para evitar que nomes, observações ou controles se tornem HTML ou formatação estrutural. O relatório não é um backup de restauração nem contém uma assinatura do resultado.

## Relatório CSV

`exportDecisionCsv(decision)` usa o cabeçalho:

```csv
comparacao,alternativa,criterio,peso,nota,observacao
```

Há uma linha por par alternativa × critério. Textos usam aspas duplas, com aspas internas duplicadas, e linhas terminadas por CRLF. Uma nota ausente usa campo vazio; nota zero usa `0`. Peso zero permanece `0`.

Textos cujo primeiro caractere significativo depois de espaços ou tabulações é `=`, `+`, `-` ou `@`, ou que começam por TAB ou CR, recebem um apóstrofo inicial para reduzir interpretação como fórmula em planilhas. Essa transformação pode ficar visível ao importar em outra ferramenta. Pesos e notas são campos numéricos, não textos de fórmula. O tratamento de cada planilha e método de importação pode variar.

CSV não preserva o caderno completo, escolhas, justificativas ou registros históricos e não é aceito para restauração nesta versão.

## Revisões do armazenamento local

IndexedDB guarda um envelope `{revision, document}` separado do backup. Sem entrada, a carga retorna revisão `0` e documento `null`. Uma gravação exige a revisão esperada e, em uma única transação de escrita, compara essa revisão e publica o documento com contador incrementado.

Apagar também compara e incrementa a revisão, guardando `document: null`. O contador permanece para impedir que uma aba antiga confunda uma exclusão com um armazenamento nunca usado. O backup JSON não fornece nem restaura o contador.

Conflitos, falhas operacionais e estado persistido inválido não autorizam gravação parcial ou substituição automática. O aplicativo mantém o caderno em memória e interrompe novas gravações automáticas até a pessoa resolver o fluxo. A referência técnica do adaptador e seus códigos de erro está em [SPEC.md](../SPEC.md).
