import { AppError, LIMITS, analyzeDecision, validateDocument } from './domain.mjs';

const encoder = new TextEncoder();

export function serializeDocument(document) {
  const valid = validateDocument(document);
  const text = JSON.stringify(valid, null, 2) + '\n';
  if (encoder.encode(text).byteLength > LIMITS.maxDocumentBytes) {
    throw new AppError('size_limit', 'O caderno excede o limite de tamanho do backup.');
  }
  return text;
}

export function parseDocument(text) {
  if (typeof text !== 'string') {
    throw new AppError('invalid_json', 'O backup deve ser um documento JSON de texto.');
  }
  if (encoder.encode(text).byteLength > LIMITS.maxDocumentBytes) {
    throw new AppError('size_limit', 'O backup excede o limite de tamanho permitido.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('invalid_json', 'Não foi possível interpretar o backup JSON.');
  }
  return validateDocument(parsed);
}

function validDecision(decision) {
  return validateDocument({ schemaVersion: 1, decisions: [decision] }).decisions[0];
}

function visible(value) {
  return [...String(value)].map((character) => {
    if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(character)) {
      const code = character.codePointAt(0);
      return code <= 0xffff ? '\\u' + code.toString(16).padStart(4, '0')
        : '\\U' + code.toString(16).padStart(8, '0');
    }
    return character;
  }).join('');
}

function md(value) {
  return visible(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replace(/[\\`*_{}\[\]()#+.!|~\-]/g, '\\$&');
}

function table(headers, rows) {
  return ['| ' + headers.map(md).join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map((row) => '| ' + row.map(md).join(' | ') + ' |')].join('\n');
}

function percentage(permille) {
  return permille === null ? 'não calculável' :
    Math.floor(permille / 10) + ',' + (permille % 10) + '%';
}

/** A readable report, not a backup or recommendation about the alternatives. */
export function exportDecisionMarkdown(decision) {
  const valid = validDecision(decision);
  const analysis = analyzeDecision(valid);
  const alternatives = new Map(valid.alternatives.map((item) => [item.id, item]));
  const criteria = new Map(valid.criteria.map((item) => [item.id, item]));
  const lines = ['# ' + md(valid.title),
    '**Pergunta:** ' + (valid.question ? md(valid.question) : 'não informada'),
    'Comparação das informações fornecidas. A pontuação não é uma escolha automática.',
    '## Critérios e pesos',
    table(['Critério', 'Peso', 'Estado', 'Descrição'], valid.criteria.map((criterion) => [
      criterion.name, criterion.weight, criterion.weight === 0 ? 'inativo' : 'ativo',
      criterion.description || 'não informada',
    ])),
    'Os pesos são relativos e não precisam somar 100. Peso zero exclui o critério do cálculo, preservando as notas.',
    '## Alternativas',
    table(['Alternativa', 'Observação'], valid.alternatives.map((alternative) => [
      alternative.name, alternative.notes || 'não informada',
    ])),
    '## Notas e observações',
    table(['Alternativa', 'Critério', 'Nota (0 a 5)', 'Observação'], valid.ratings.map((rating) => [
      alternatives.get(rating.alternativeId).name, criteria.get(rating.criterionId).name,
      rating.value === null ? 'não respondida' : rating.value,
      rating.note || 'não informada',
    ])),
    '## Cálculo explicado',
    '**Peso ativo total:** ' + analysis.activeWeight +
      '. **Critérios ativos:** ' + analysis.activeCriteria +
      '. **Notas ativas ausentes:** ' + analysis.missingRatings + '.',
    analysis.canRank ? 'Ranking disponível: todas as alternativas têm notas em todos os critérios ativos.' :
      'Sem ranking: complete todas as notas dos critérios ativos e mantenha ao menos uma alternativa e um critério com peso positivo.',
    'Para cada alternativa, pontos = soma de nota × peso nos critérios ativos. Total possível = 5 × peso ativo total. '
      + 'Notas ausentes não viram zero e não mudam o denominador entre alternativas. Percentuais são arredondados para uma casa decimal.',
    table(['Alternativa', 'Pontos conhecidos', 'Total possível', 'Peso respondido', 'Cobertura ponderada',
      'Intervalo possível', 'Pontuação', 'Posição'], analysis.alternatives.map((item) => [
      item.name, item.points, item.maxPoints, item.answeredWeight,
      percentage(item.coveragePermille),
      item.minPermille === null ? 'não calculável' : percentage(item.minPermille) + ' a ' + percentage(item.maxPermille),
      item.scorePermille === null ? 'indisponível' : percentage(item.scorePermille),
      item.rank === null ? 'indisponível' : String(item.rank) + (item.tied ? ' (empate)' : ''),
    ])),
    'O intervalo apresenta o menor e o maior resultado possível para as notas ainda ausentes; não é uma previsão probabilística.',
  ];
  for (const item of analysis.alternatives) {
    lines.push('### Contribuições: ' + md(item.name),
      table(['Critério', 'Peso', 'Nota', 'Pontos', 'Estado'], item.contributions.map((contribution) => [
        criteria.get(contribution.criterionId).name, contribution.weight,
        contribution.value === null ? 'não respondida' : contribution.value,
        contribution.points === null ? 'não conhecidos' : contribution.points,
        contribution.active ? 'ativo' : 'inativo',
      ])));
  }
  const choice = valid.choice.alternativeId === null ? null : alternatives.get(valid.choice.alternativeId);
  lines.push('## Escolha registrada',
    '**Alternativa:** ' + (choice ? md(choice.name) : 'nenhuma escolhida'),
    '**Justificativa:** ' + (valid.choice.reason ? md(valid.choice.reason) : 'não informada'),
    'A escolha e a justificativa são informadas pela pessoa responsável, separadamente do ranking.',
    '## Registros históricos',
    valid.snapshots.length ? table(['Registro', 'Data UTC', 'Alternativas', 'Critérios', 'Escolha'],
      valid.snapshots.map((snapshot) => {
        const historicalChoice = snapshot.matrix.alternatives.find((item) => item.id === snapshot.matrix.choice.alternativeId);
        return [snapshot.label, snapshot.createdAt, snapshot.matrix.alternatives.length,
          snapshot.matrix.criteria.length, historicalChoice?.name || 'nenhuma escolhida'];
      })) : 'Nenhum registro histórico.',
    'Registros preservam uma cópia local dos dados usados. O backup pode ser editado por seu proprietário; não há assinatura ou certificação de autoria.');
  return lines.join('\n\n') + '\n';
}

function csvText(value) {
  let text = String(value).replace(/\r\n?|\n/g, '\r\n');
  if (/^[ \t]*[=+\-@]/u.test(text) || /^[\t\r]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

/** CSV is a worksheet export; JSON is the lossless restoration format. */
export function exportDecisionCsv(decision) {
  const valid = validDecision(decision);
  const alternatives = new Map(valid.alternatives.map((item) => [item.id, item]));
  const criteria = new Map(valid.criteria.map((item) => [item.id, item]));
  const rows = ['comparacao,alternativa,criterio,peso,nota,observacao'];
  for (const rating of valid.ratings) {
    const criterion = criteria.get(rating.criterionId);
    rows.push([csvText(valid.title), csvText(alternatives.get(rating.alternativeId).name),
      csvText(criterion.name), String(criterion.weight), rating.value === null ? '' : String(rating.value),
      csvText(rating.note)].join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

/** Entirely fictional alternatives, notes and fixed historical timestamp. */
export function createExampleDocument() {
  const matrix = {
    title: 'Um espaço para trabalhar',
    question: 'Qual espaço fictício combina melhor com uma rotina de trabalho concentrado?',
    alternatives: [
      { id: 'estudio-norte', name: 'Estúdio Norte', notes: 'Espaço fictício com ambiente silencioso.' },
      { id: 'sala-jardim', name: 'Sala Jardim', notes: 'Espaço fictício com acesso simples e horários flexíveis.' },
      { id: 'espaco-central', name: 'Espaço Central', notes: 'Espaço fictício com estrutura compartilhada.' },
    ],
    criteria: [
      { id: 'concentracao', name: 'Concentração', weight: 40, description: 'Quanto o ambiente ajuda a manter o foco.' },
      { id: 'acesso', name: 'Acesso', weight: 25, description: 'Facilidade de chegar no horário pretendido.' },
      { id: 'estrutura', name: 'Estrutura', weight: 20, description: 'Adequação dos recursos à rotina descrita.' },
      { id: 'flexibilidade', name: 'Flexibilidade', weight: 15, description: 'Liberdade para ajustar os dias e horários.' },
    ],
    ratings: [],
    choice: { alternativeId: 'sala-jardim', reason: 'Nesta comparação fictícia, o acesso e a flexibilidade equilibraram a necessidade de concentração.' },
  };
  const values = [[5, 3, 4, 3], [4, 5, 3, 4], [3, 4, 5, 5]];
  matrix.ratings = matrix.alternatives.flatMap((alternative, i) => matrix.criteria.map((criterion, j) => ({
    alternativeId: alternative.id, criterionId: criterion.id, value: values[i][j],
    note: i === 1 && j === 1 ? 'Nota fictícia para demonstrar a observação de uma célula.' : '',
  })));
  return validateDocument({ schemaVersion: 1, decisions: [{
    id: 'espaco-de-trabalho', ...matrix,
    snapshots: [{ id: 'primeira-analise', label: 'Primeira análise fictícia',
      createdAt: '2026-11-08T12:00:00.000Z', matrix: JSON.parse(JSON.stringify(matrix)) }],
  }] });
}
