/** Pure, bounded decision matrices. No storage, clock, random IDs or network. */

export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export const LIMITS = Object.freeze({
  maxDecisions: 20,
  maxAlternatives: 8,
  maxCriteria: 12,
  maxSnapshots: 12,
  maxDocumentBytes: 2_097_152,
});

const MATRIX_KEYS = ['title', 'question', 'alternatives', 'criteria', 'ratings', 'choice'];
const DECISION_KEYS = ['id', ...MATRIX_KEYS, 'snapshots'];
const COMMAND_KEYS = Object.freeze({
  'decision.add': ['id', 'title'],
  'decision.update': ['decisionId', 'title', 'question'],
  'decision.remove': ['decisionId'],
  'alternative.add': ['decisionId', 'id', 'name', 'notes'],
  'alternative.update': ['decisionId', 'alternativeId', 'name', 'notes'],
  'alternative.remove': ['decisionId', 'alternativeId'],
  'criterion.add': ['decisionId', 'id', 'name', 'weight', 'description'],
  'criterion.update': ['decisionId', 'criterionId', 'name', 'weight', 'description'],
  'criterion.remove': ['decisionId', 'criterionId'],
  'rating.set': ['decisionId', 'alternativeId', 'criterionId', 'value', 'note'],
  'choice.set': ['decisionId', 'alternativeId', 'reason'],
  'snapshot.add': ['decisionId', 'id', 'label', 'createdAt'],
  'snapshot.remove': ['decisionId', 'snapshotId'],
});

function fail(code, message) {
  throw new AppError(code, message);
}

function dataRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('invalid_structure', 'O caderno deve conter somente objetos JSON válidos.');
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('invalid_structure', 'O caderno deve conter somente propriedades de dados JSON.');
    }
  }
  return value;
}

function record(value, keys) {
  dataRecord(value);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    fail('invalid_fields', 'A estrutura contém campos ausentes ou não reconhecidos.');
  }
  return value;
}

function list(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail('limit', 'Uma lista excede o limite permitido ou possui formato inválido.');
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail('invalid_structure', 'As listas devem possuir a estrutura padrão de arrays JSON.');
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    fail('invalid_structure', 'As listas devem conter somente entradas JSON contínuas.');
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('invalid_structure', 'As listas devem conter somente entradas JSON contínuas.');
    }
  }
  return value;
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    fail('invalid_id', 'Um identificador possui formato inválido.');
  }
  return value;
}

function text(value, maximum, required = false, multiline = true) {
  if (typeof value !== 'string') {
    fail('invalid_text', 'Um campo de texto possui formato inválido.');
  }
  const normalizedLines = value.replace(/\r\n?/g, '\n');
  for (const char of normalizedLines) {
    const code = char.codePointAt(0);
    const allowedWhitespace = multiline && (char === '\n' || char === '\t');
    if ((code >= 0xd800 && code <= 0xdfff)
        || (!allowedWhitespace && /\p{Cc}/u.test(char))
        || (!multiline && /[\p{Zl}\p{Zp}]/u.test(char))) {
      fail('invalid_text', 'Um campo de texto contém caracteres de controle não permitidos.');
    }
  }
  const normalized = normalizedLines.trim();
  const length = [...normalized].length;
  if (length > maximum || (required && length === 0)) {
    fail('invalid_text', 'Um campo de texto está vazio ou excede o tamanho permitido.');
  }
  return normalized;
}

function integer(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('invalid_number', 'Um peso ou uma nota está fora do intervalo permitido.');
  }
  return value === 0 ? 0 : value;
}

function distinct(items) {
  const found = new Set();
  for (const item of items) {
    if (found.has(item.id)) fail('duplicate', 'Há identificadores repetidos na mesma lista.');
    found.add(item.id);
  }
  return items;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail('invalid_date', 'A data do registro deve ser um instante UTC válido com milissegundos.');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    fail('invalid_date', 'A data do registro deve ser um instante UTC válido com milissegundos.');
  }
  return value;
}

function pairKey(alternativeId, criterionId) {
  return alternativeId + '\0' + criterionId;
}

function matrixValues(value) {
  const alternatives = distinct(list(value.alternatives, LIMITS.maxAlternatives).map(item => {
    record(item, ['id', 'name', 'notes']);
    return {id: identifier(item.id), name: text(item.name, 120, true, false), notes: text(item.notes, 1000)};
  }));
  const criteria = distinct(list(value.criteria, LIMITS.maxCriteria).map(item => {
    record(item, ['id', 'name', 'weight', 'description']);
    return {id: identifier(item.id), name: text(item.name, 120, true, false),
      weight: integer(item.weight, 0, 100), description: text(item.description, 1000)};
  }));
  const alternativeIds = new Set(alternatives.map(item => item.id));
  const criterionIds = new Set(criteria.map(item => item.id));
  const ratings = new Map();
  const inputRatings = list(value.ratings, LIMITS.maxAlternatives * LIMITS.maxCriteria);
  if (inputRatings.length !== alternatives.length * criteria.length) {
    fail('invalid_ratings', 'A matriz deve conter exatamente uma nota por alternativa e critério.');
  }
  for (const item of inputRatings) {
    record(item, ['alternativeId', 'criterionId', 'value', 'note']);
    const alternativeId = identifier(item.alternativeId);
    const criterionId = identifier(item.criterionId);
    if (!alternativeIds.has(alternativeId) || !criterionIds.has(criterionId)) {
      fail('reference', 'Uma nota faz referência a uma alternativa ou critério inexistente.');
    }
    const key = pairKey(alternativeId, criterionId);
    if (ratings.has(key)) fail('duplicate', 'Há notas repetidas para o mesmo par de alternativa e critério.');
    ratings.set(key, {alternativeId, criterionId,
      value: item.value === null ? null : integer(item.value, 0, 5), note: text(item.note, 500)});
  }
  const orderedRatings = [];
  for (const alternative of alternatives) {
    for (const criterion of criteria) {
      const rating = ratings.get(pairKey(alternative.id, criterion.id));
      if (!rating) fail('invalid_ratings', 'A matriz possui uma nota ausente na sua estrutura.');
      orderedRatings.push(rating);
    }
  }
  record(value.choice, ['alternativeId', 'reason']);
  const chosen = value.choice.alternativeId === null ? null : identifier(value.choice.alternativeId);
  if (chosen !== null && !alternativeIds.has(chosen)) {
    fail('reference', 'A escolha faz referência a uma alternativa inexistente.');
  }
  return {
    title: text(value.title, 120, true, false),
    question: text(value.question, 2000),
    alternatives,
    criteria,
    ratings: orderedRatings,
    choice: {alternativeId: chosen, reason: text(value.choice.reason, 4000)},
  };
}

function matrix(value) {
  record(value, MATRIX_KEYS);
  return matrixValues(value);
}

function decision(value) {
  record(value, DECISION_KEYS);
  const current = matrixValues(value);
  const snapshots = distinct(list(value.snapshots, LIMITS.maxSnapshots).map(item => {
    record(item, ['id', 'label', 'createdAt', 'matrix']);
    return {id: identifier(item.id), label: text(item.label, 120, true, false),
      createdAt: timestamp(item.createdAt), matrix: matrix(item.matrix)};
  }));
  return {id: identifier(value.id), ...current, snapshots};
}

export function validateDocument(value) {
  record(value, ['schemaVersion', 'decisions']);
  if (value.schemaVersion !== 1) fail('schema_version', 'Esta versão de caderno não é compatível.');
  const result = {schemaVersion: 1,
    decisions: distinct(list(value.decisions, LIMITS.maxDecisions).map(decision))};
  const bytes = new TextEncoder().encode(JSON.stringify(result, null, 2) + '\n').byteLength;
  if (bytes > LIMITS.maxDocumentBytes) {
    fail('document_limit', 'O caderno completo excede o limite de 2 MiB. Exporte ou remova registros antes de continuar.');
  }
  return result;
}

export function createDocument() {
  return {schemaVersion: 1, decisions: []};
}

export function createDecision(options) {
  record(options, ['id', 'title']);
  return decision({id: options.id, title: options.title, question: '', alternatives: [],
    criteria: [], ratings: [], choice: {alternativeId: null, reason: ''}, snapshots: []});
}

function find(items, id) {
  identifier(id);
  const found = items.find(item => item.id === id);
  if (!found) fail('not_found', 'O item solicitado não existe mais neste caderno.');
  return found;
}

function synchronizeRatings(current) {
  const previous = new Map(current.ratings.map(item => [pairKey(item.alternativeId, item.criterionId), item]));
  current.ratings = [];
  for (const alternative of current.alternatives) {
    for (const criterion of current.criteria) {
      current.ratings.push(previous.get(pairKey(alternative.id, criterion.id))
        ?? {alternativeId: alternative.id, criterionId: criterion.id, value: null, note: ''});
    }
  }
}

export function applyCommand(document, command) {
  const result = validateDocument(document);
  dataRecord(command);
  if (typeof command.type !== 'string' || !Object.hasOwn(COMMAND_KEYS, command.type)) {
    fail('invalid_command', 'O comando solicitado não é reconhecido.');
  }
  record(command, ['type', ...COMMAND_KEYS[command.type]]);
  if (command.type === 'decision.add') {
    result.decisions.push(createDecision({id: command.id, title: command.title}));
    return validateDocument(result);
  }
  const current = find(result.decisions, command.decisionId);
  switch (command.type) {
    case 'decision.update':
      current.title = command.title;
      current.question = command.question;
      break;
    case 'decision.remove':
      result.decisions = result.decisions.filter(item => item.id !== current.id);
      break;
    case 'alternative.add':
      current.alternatives.push({id: identifier(command.id), name: command.name, notes: command.notes});
      synchronizeRatings(current);
      break;
    case 'alternative.update': {
      const alternative = find(current.alternatives, command.alternativeId);
      alternative.name = command.name;
      alternative.notes = command.notes;
      break;
    }
    case 'alternative.remove':
      find(current.alternatives, command.alternativeId);
      current.alternatives = current.alternatives.filter(item => item.id !== command.alternativeId);
      if (current.choice.alternativeId === command.alternativeId) current.choice.alternativeId = null;
      synchronizeRatings(current);
      break;
    case 'criterion.add':
      current.criteria.push({id: identifier(command.id), name: command.name,
        weight: command.weight, description: command.description});
      synchronizeRatings(current);
      break;
    case 'criterion.update': {
      const criterion = find(current.criteria, command.criterionId);
      criterion.name = command.name;
      criterion.weight = command.weight;
      criterion.description = command.description;
      break;
    }
    case 'criterion.remove':
      find(current.criteria, command.criterionId);
      current.criteria = current.criteria.filter(item => item.id !== command.criterionId);
      synchronizeRatings(current);
      break;
    case 'rating.set': {
      find(current.alternatives, command.alternativeId);
      find(current.criteria, command.criterionId);
      const rating = current.ratings.find(item => item.alternativeId === command.alternativeId
        && item.criterionId === command.criterionId);
      rating.value = command.value;
      rating.note = command.note;
      break;
    }
    case 'choice.set':
      current.choice = {alternativeId: command.alternativeId, reason: command.reason};
      break;
    case 'snapshot.add':
      current.snapshots.push({id: identifier(command.id), label: command.label,
        createdAt: command.createdAt, matrix: matrixValues(current)});
      break;
    case 'snapshot.remove':
      find(current.snapshots, command.snapshotId);
      current.snapshots = current.snapshots.filter(item => item.id !== command.snapshotId);
      break;
    default:
      fail('invalid_command', 'O comando solicitado não é reconhecido.');
  }
  return validateDocument(result);
}

function halfUp(numerator, denominator) {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function analyzeDecision(value) {
  // The same analysis can be applied directly to a historical matrix. It
  // never borrows an alternative, criterion or choice from the current data.
  dataRecord(value);
  const current = Object.hasOwn(value, 'id') || Object.hasOwn(value, 'snapshots')
    ? validateDocument({schemaVersion: 1, decisions: [value]}).decisions[0]
    : validateDocument({schemaVersion: 1, decisions: [{id: 'analysis', ...matrix(value), snapshots: []}]}).decisions[0];
  const activeWeight = current.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const activeCriteria = current.criteria.filter(criterion => criterion.weight > 0).length;
  const lookup = new Map(current.ratings.map(item => [pairKey(item.alternativeId, item.criterionId), item]));
  let missingRatings = 0;
  const alternatives = current.alternatives.map(alternative => {
    let points = 0;
    let answeredWeight = 0;
    let missingCount = 0;
    const contributions = current.criteria.map(criterion => {
      const {value: rating} = lookup.get(pairKey(alternative.id, criterion.id));
      const active = criterion.weight > 0;
      const contribution = rating === null ? null : rating * criterion.weight;
      if (active) {
        if (rating === null) missingCount += 1;
        else {
          points += contribution;
          answeredWeight += criterion.weight;
        }
      }
      return {criterionId: criterion.id, weight: criterion.weight, value: rating, points: contribution, active};
    });
    missingRatings += missingCount;
    return {id: alternative.id, name: alternative.name, points, maxPoints: 5 * activeWeight,
      answeredWeight, missingCount,
      coveragePermille: activeWeight ? halfUp(1000 * answeredWeight, activeWeight) : null,
      minPermille: activeWeight ? halfUp(1000 * points, 5 * activeWeight) : null,
      maxPermille: activeWeight
        ? halfUp(1000 * (points + 5 * (activeWeight - answeredWeight)), 5 * activeWeight) : null,
      scorePermille: null, rank: null, tied: false, contributions};
  });
  const canRank = alternatives.length > 0 && activeCriteria > 0 && missingRatings === 0;
  if (canRank) {
    for (const alternative of alternatives) {
      alternative.scorePermille = alternative.minPermille;
      alternative.rank = 1 + alternatives.filter(other => other.points > alternative.points).length;
      alternative.tied = alternatives.filter(other => other.points === alternative.points).length > 1;
    }
  }
  return {activeWeight, activeCriteria, canRank, missingRatings, alternatives};
}
