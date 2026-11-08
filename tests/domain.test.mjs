import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError, LIMITS, createDocument, createDecision, validateDocument,
  applyCommand, analyzeDecision,
} from '../assets/domain.mjs';

const copy = value => structuredClone(value);
const date = '2026-11-08T12:00:00.000Z';

function fixture({weights = [40, 25, 20, 15], values = [[5, 2, 4, 3], [3, 5, 4, 5]]} = {}) {
  const alternatives = values.map((_, index) => ({id: 'a' + index, name: 'Alternativa ' + index, notes: ''}));
  const criteria = weights.map((weight, index) => ({id: 'c' + index, name: 'Critério ' + index, weight, description: ''}));
  return {schemaVersion: 1, decisions: [{
    id: 'd', title: 'Comparação sintética', question: '', alternatives, criteria,
    ratings: values.flatMap((row, a) => weights.map((_, c) => ({
      alternativeId: 'a' + a, criterionId: 'c' + c, value: row[c], note: '',
    }))),
    choice: {alternativeId: null, reason: ''}, snapshots: [],
  }]};
}

function command(document, type, fields = {}) {
  return applyCommand(document, {type, decisionId: 'd', ...fields});
}

function fails(callback, code) {
  assert.throws(callback, error => error instanceof AppError && (!code || error.code === code));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('new documents and decisions are independent and use no clock or random generator', () => {
  const originalNow = Date.now;
  const originalRandom = Math.random;
  Date.now = () => { throw new Error('unexpected clock'); };
  Math.random = () => { throw new Error('unexpected random generator'); };
  try {
    const first = createDocument();
    const second = createDocument();
    assert.deepEqual(first, {schemaVersion: 1, decisions: []});
    first.decisions.push(createDecision({id: 'd', title: '  Comparação  '}));
    assert.equal(second.decisions.length, 0);
    assert.equal(first.decisions[0].title, 'Comparação');
    assert.deepEqual(first.decisions[0].choice, {alternativeId: null, reason: ''});
    assert.deepEqual(analyzeDecision(first.decisions[0]), {
      activeWeight: 0, activeCriteria: 0, canRank: false, missingRatings: 0, alternatives: [],
    });
    assert.deepEqual(validateDocument(second), second);
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
  }
});

test('validation canonizes rating order without changing alternative or criterion order', () => {
  const document = fixture();
  document.decisions[0].ratings.reverse();
  const before = copy(document);
  const result = validateDocument(document);
  assert.deepEqual(document, before);
  assert.deepEqual(result.decisions[0].alternatives.map(item => item.id), ['a0', 'a1']);
  assert.deepEqual(result.decisions[0].ratings.map(item => [item.alternativeId, item.criterionId]),
    [['a0', 'c0'], ['a0', 'c1'], ['a0', 'c2'], ['a0', 'c3'],
      ['a1', 'c0'], ['a1', 'c1'], ['a1', 'c2'], ['a1', 'c3']]);
  result.decisions[0].ratings[0].note = 'Novo';
  assert.equal(document.decisions[0].ratings.at(-1).note, '');
});

test('all object levels reject unknown or missing fields without exposing values', () => {
  const selectors = [doc => doc, doc => doc.decisions[0], doc => doc.decisions[0].alternatives[0],
    doc => doc.decisions[0].criteria[0], doc => doc.decisions[0].ratings[0], doc => doc.decisions[0].choice];
  for (const select of selectors) {
    const document = fixture();
    select(document).unknown = 'PRIVATE_SYNTHETIC_VALUE';
    assert.throws(() => validateDocument(document), error => error instanceof AppError
      && error.code === 'invalid_fields' && !error.message.includes('PRIVATE_SYNTHETIC_VALUE'));
  }
  for (const key of ['title', 'question', 'ratings', 'snapshots', 'choice']) {
    const document = fixture();
    delete document.decisions[0][key];
    fails(() => validateDocument(document), 'invalid_fields');
  }
  const document = JSON.parse(JSON.stringify(fixture()).replace('"schemaVersion":1',
    '"schemaVersion":1,"__proto__":{"polluted":true}'));
  fails(() => validateDocument(document), 'invalid_fields');
  assert.equal({}.polluted, undefined);
});

test('validation rejects accessors and non-JSON objects without evaluating accessors', () => {
  let called = false;
  const document = fixture();
  Object.defineProperty(document.decisions[0], 'title', {
    enumerable: true, get() { called = true; throw new Error('private'); },
  });
  fails(() => validateDocument(document), 'invalid_structure');
  assert.equal(called, false);
  for (const bad of [null, [], 'text', new Date(date), Object.create({schemaVersion: 1})]) {
    fails(() => validateDocument(bad));
  }
  const withSymbol = fixture();
  withSymbol[Symbol('private')] = true;
  fails(() => validateDocument(withSymbol), 'invalid_structure');
  const withHidden = fixture();
  Object.defineProperty(withHidden, 'hidden', {value: 1});
  fails(() => validateDocument(withHidden), 'invalid_structure');
});

test('array validation rejects holes, extras, accessors and custom prototypes', () => {
  const mutations = [
    value => { delete value[0]; },
    value => { value.extra = true; },
    value => { value[Symbol('extra')] = true; },
    value => { Object.setPrototypeOf(value, null); },
    value => { Object.defineProperty(value, '0', {get() { throw new Error('private'); }}); },
  ];
  for (const mutate of mutations) {
    const document = fixture();
    mutate(document.decisions[0].alternatives);
    fails(() => validateDocument(document), 'invalid_structure');
  }
  const huge = fixture();
  huge.decisions = new Array(1_000_000_000);
  fails(() => validateDocument(huge), 'limit');
});

test('schema version is exact and numeric primitive types are not coerced', () => {
  for (const value of [0, 2, '1', true, false, null, NaN, new Number(1)]) {
    const document = fixture();
    document.schemaVersion = value;
    fails(() => validateDocument(document), 'schema_version');
  }
});

test('text normalization preserves Unicode code points and canonicalizes long-text newlines', () => {
  const document = fixture();
  const current = document.decisions[0];
  current.title = '  😀'.repeat(1).trim() + '😀'.repeat(119);
  current.question = '  Primeiro\r\nSegundo\rTerceiro\t quarto  ';
  current.alternatives[0].notes = '\n  Observação\tcom tab\r\n  ';
  current.choice.reason = '  Razão sintética  ';
  const result = validateDocument(document).decisions[0];
  assert.equal([...result.title].length, 120);
  assert.equal(result.question, 'Primeiro\nSegundo\nTerceiro\t quarto');
  assert.equal(result.alternatives[0].notes, 'Observação\tcom tab');
  assert.equal(result.choice.reason, 'Razão sintética');
  current.title += '😀';
  fails(() => validateDocument(document), 'invalid_text');
});

test('text fields reject forbidden controls, lone surrogates and single-line newlines', () => {
  for (const forbidden of ['\u0000', '\u0007', '\u000b', '\u007f', '\u0085', '\ud800', '\udfff']) {
    const document = fixture();
    document.decisions[0].question = forbidden + 'Texto sintético';
    fails(() => validateDocument(document), 'invalid_text');
  }
  for (const forbidden of ['\n', '\t', '\r', '\u2028', '\u2029']) {
    const document = fixture();
    document.decisions[0].title = forbidden + 'Título';
    fails(() => validateDocument(document), 'invalid_text');
  }
  for (const value of ['', '  ', 123, null]) {
    const document = fixture();
    document.decisions[0].alternatives[0].name = value;
    fails(() => validateDocument(document), 'invalid_text');
  }
});

test('each long-text field enforces its own code-point boundary', () => {
  const cases = [
    [decision => decision, 'question', 2000],
    [decision => decision.alternatives[0], 'notes', 1000],
    [decision => decision.criteria[0], 'description', 1000],
    [decision => decision.ratings[0], 'note', 500],
    [decision => decision.choice, 'reason', 4000],
  ];
  for (const [select, key, limit] of cases) {
    const document = fixture();
    select(document.decisions[0])[key] = 'é'.repeat(limit);
    assert.doesNotThrow(() => validateDocument(document));
    select(document.decisions[0])[key] += 'x';
    fails(() => validateDocument(document), 'invalid_text');
  }
});

test('weights and ratings reject nonintegers, coercion and out-of-range inputs', () => {
  for (const value of [true, false, '0', null, NaN, Infinity, -Infinity, 1.5, -1, 101, 2 ** 53]) {
    const document = fixture();
    document.decisions[0].criteria[0].weight = value;
    fails(() => validateDocument(document), 'invalid_number');
  }
  for (const value of [true, false, '0', NaN, Infinity, -1, 6, 0.5]) {
    const document = fixture();
    document.decisions[0].ratings[0].value = value;
    fails(() => validateDocument(document), 'invalid_number');
  }
  const document = fixture();
  document.decisions[0].criteria[0].weight = -0;
  document.decisions[0].ratings[0].value = -0;
  const result = validateDocument(document).decisions[0];
  assert.equal(Object.is(result.criteria[0].weight, -0), false);
  assert.equal(Object.is(result.ratings[0].value, -0), false);
});

test('identifier rules and uniqueness are scoped to their respective lists', () => {
  for (const id of ['', ' space', '_first', 'á', 'a/b', 'a'.repeat(65), 1, null]) {
    fails(() => createDecision({id, title: 'Título'}), 'invalid_id');
  }
  const document = fixture();
  document.decisions[0].alternatives[1].id = 'a0';
  fails(() => validateDocument(document), 'duplicate');
  const duplicateCriterion = fixture();
  duplicateCriterion.decisions[0].criteria[1].id = 'c0';
  fails(() => validateDocument(duplicateCriterion), 'duplicate');
  const duplicateDecision = fixture();
  duplicateDecision.decisions.push(copy(duplicateDecision.decisions[0]));
  fails(() => validateDocument(duplicateDecision), 'duplicate');
  let separate = applyCommand(createDocument(), {type: 'decision.add', id: 'same', title: 'Título'});
  separate = applyCommand(separate, {type: 'alternative.add', decisionId: 'same', id: 'same', name: 'Nome', notes: ''});
  separate = applyCommand(separate, {type: 'criterion.add', decisionId: 'same', id: 'same', name: 'Critério', weight: 1, description: ''});
  assert.equal(separate.decisions[0].ratings.length, 1);
  assert.doesNotThrow(() => createDecision({id: 'a'.repeat(64), title: 'Válido'}));
});

test('imports require a dense rating matrix with valid and unique references', () => {
  const mutations = [
    decision => decision.ratings.pop(),
    decision => decision.ratings.push(copy(decision.ratings[0])),
    decision => { decision.ratings[1] = copy(decision.ratings[0]); },
    decision => { decision.ratings[0].alternativeId = 'missing'; },
    decision => { decision.ratings[0].criterionId = 'missing'; },
  ];
  for (const mutate of mutations) {
    const document = fixture();
    mutate(document.decisions[0]);
    fails(() => validateDocument(document));
  }
  const invalidChoice = fixture();
  invalidChoice.decisions[0].choice.alternativeId = 'missing';
  fails(() => validateDocument(invalidChoice), 'reference');
});

test('structure commands create new empty pairs and preserve existing values and notes', () => {
  let document = fixture({weights: [40], values: [[0]]});
  document.decisions[0].ratings[0].note = 'Preservada';
  document = command(document, 'alternative.add', {id: 'a1', name: 'Nova', notes: 'Notas'});
  document = command(document, 'criterion.add', {id: 'c1', name: 'Novo', weight: 3, description: 'Descrição'});
  assert.deepEqual(document.decisions[0].ratings, [
    {alternativeId: 'a0', criterionId: 'c0', value: 0, note: 'Preservada'},
    {alternativeId: 'a0', criterionId: 'c1', value: null, note: ''},
    {alternativeId: 'a1', criterionId: 'c0', value: null, note: ''},
    {alternativeId: 'a1', criterionId: 'c1', value: null, note: ''},
  ]);
  document = command(document, 'rating.set', {alternativeId: 'a1', criterionId: 'c1', value: 5, note: 'Completa'});
  document = command(document, 'criterion.remove', {criterionId: 'c0'});
  document = command(document, 'alternative.remove', {alternativeId: 'a0'});
  assert.deepEqual(document.decisions[0].ratings, [
    {alternativeId: 'a1', criterionId: 'c1', value: 5, note: 'Completa'},
  ]);
});

test('updates retain IDs, change intended fields and never mutate frozen inputs', () => {
  const original = deepFreeze(fixture());
  let document = command(original, 'decision.update', {title: ' Novo título ', question: ' Nova pergunta '});
  document = command(document, 'alternative.update', {alternativeId: 'a0', name: 'Nome novo', notes: 'Contexto'});
  document = command(document, 'criterion.update', {criterionId: 'c0', name: 'Critério novo', weight: 7, description: 'Explicação'});
  assert.equal(document.decisions[0].title, 'Novo título');
  assert.equal(document.decisions[0].question, 'Nova pergunta');
  assert.deepEqual(document.decisions[0].alternatives[0], {id: 'a0', name: 'Nome novo', notes: 'Contexto'});
  assert.deepEqual(document.decisions[0].criteria[0], {id: 'c0', name: 'Critério novo', weight: 7, description: 'Explicação'});
  assert.equal(original.decisions[0].title, 'Comparação sintética');
  document.decisions[0].alternatives[0].notes = 'Outro texto';
  assert.equal(original.decisions[0].alternatives[0].notes, '');
});

test('choice remains a human record and removal clears its reference but preserves its reason', () => {
  let document = fixture();
  document = command(document, 'choice.set', {alternativeId: 'a0', reason: 'Escolha por contexto próprio'});
  const winner = analyzeDecision(document.decisions[0]).alternatives.find(item => item.rank === 1);
  assert.equal(winner.id, 'a1');
  assert.equal(document.decisions[0].choice.alternativeId, 'a0');
  document = command(document, 'alternative.remove', {alternativeId: 'a0'});
  assert.deepEqual(document.decisions[0].choice, {alternativeId: null, reason: 'Escolha por contexto próprio'});
});

test('snapshots preserve matrix, choice and annotations across all later edits and removals', () => {
  let document = fixture();
  document = command(document, 'choice.set', {alternativeId: 'a0', reason: 'Razão histórica'});
  document = command(document, 'rating.set', {alternativeId: 'a0', criterionId: 'c0', value: 0, note: 'Nota histórica'});
  document = command(document, 'snapshot.add', {id: 's1', label: ' Versão inicial ', createdAt: date});
  const historical = copy(document.decisions[0].snapshots[0]);
  document = command(document, 'rating.set', {alternativeId: 'a0', criterionId: 'c0', value: 5, note: 'Nota atual'});
  document = command(document, 'choice.set', {alternativeId: 'a1', reason: 'Razão atual'});
  document = command(document, 'criterion.remove', {criterionId: 'c0'});
  document = command(document, 'alternative.remove', {alternativeId: 'a0'});
  document = command(document, 'decision.update', {title: 'Título novo', question: 'Pergunta nova'});
  assert.deepEqual(document.decisions[0].snapshots[0], historical);
  assert.equal(historical.label, 'Versão inicial');
  assert.equal(historical.matrix.choice.alternativeId, 'a0');
  assert.equal(historical.matrix.ratings[0].value, 0);
  assert.equal(historical.matrix.ratings[0].note, 'Nota histórica');
  const analysis = analyzeDecision(historical.matrix);
  assert.equal(analysis.alternatives.length, 2);
  document = command(document, 'snapshot.remove', {snapshotId: 's1'});
  assert.deepEqual(document.decisions[0].snapshots, []);
});

test('snapshots require strict, real ISO UTC instants and prohibit nested history', () => {
  const invalid = ['2026-11-08T12:00:00Z', '2026-11-08T12:00:00.000+00:00',
    '2026-02-30T12:00:00.000Z', '2026-02-29T12:00:00.000Z', '2026-13-01T12:00:00.000Z',
    '2026-11-08T25:00:00.000Z', '2026-11-08', null, 0];
  for (const createdAt of invalid) {
    fails(() => command(fixture(), 'snapshot.add', {id: 's', label: 'Versão', createdAt}), 'invalid_date');
  }
  const leap = command(fixture(), 'snapshot.add', {id: 's', label: 'Versão', createdAt: '2024-02-29T23:59:59.999Z'});
  leap.decisions[0].snapshots[0].matrix.snapshots = [];
  fails(() => validateDocument(leap), 'invalid_fields');
});

test('command shapes and referenced items are exact and failures leave source unchanged', () => {
  const original = deepFreeze(fixture());
  const before = JSON.stringify(original);
  const commands = [
    {type: 'unknown'},
    {type: '__proto__'},
    {type: 'decision.remove'},
    {type: 'decision.remove', decisionId: 'd', extra: true},
    {type: 'decision.remove', decisionId: 'missing'},
    {type: 'decision.add', id: 'd', title: 'Duplicada'},
    {type: 'alternative.add', decisionId: 'd', id: 'a0', name: 'Duplicada', notes: ''},
    {type: 'alternative.update', decisionId: 'd', alternativeId: 'missing', name: 'Nome', notes: ''},
    {type: 'criterion.update', decisionId: 'd', criterionId: 'c0', name: 'Nome', weight: false, description: ''},
    {type: 'criterion.remove', decisionId: 'd', criterionId: 'missing'},
    {type: 'rating.set', decisionId: 'd', alternativeId: 'a0', criterionId: 'missing', value: 1, note: ''},
    {type: 'choice.set', decisionId: 'd', alternativeId: 'missing', reason: ''},
    {type: 'snapshot.remove', decisionId: 'd', snapshotId: 'missing'},
  ];
  for (const candidate of commands) {
    fails(() => applyCommand(original, candidate));
    assert.equal(JSON.stringify(original), before);
  }
  const removed = command(original, 'decision.remove');
  assert.deepEqual(removed.decisions, []);
  assert.equal(JSON.stringify(original), before);
});

test('all collection limits permit their boundary and reject one extra atomically', () => {
  let documents = createDocument();
  for (let i = 0; i < LIMITS.maxDecisions; i += 1) {
    documents = applyCommand(documents, {type: 'decision.add', id: 'd' + i, title: 'Título'});
  }
  fails(() => applyCommand(documents, {type: 'decision.add', id: 'extra', title: 'Título'}), 'limit');
  assert.equal(documents.decisions.length, LIMITS.maxDecisions);
  let document = applyCommand(createDocument(), {type: 'decision.add', id: 'd', title: 'Título'});
  for (let i = 0; i < LIMITS.maxAlternatives; i += 1) {
    document = command(document, 'alternative.add', {id: 'a' + i, name: 'Nome', notes: ''});
  }
  for (let i = 0; i < LIMITS.maxCriteria; i += 1) {
    document = command(document, 'criterion.add', {id: 'c' + i, name: 'Nome', weight: 100, description: ''});
  }
  assert.equal(document.decisions[0].ratings.length, 96);
  fails(() => command(document, 'alternative.add', {id: 'extra', name: 'Nome', notes: ''}), 'limit');
  fails(() => command(document, 'criterion.add', {id: 'extra', name: 'Nome', weight: 1, description: ''}), 'limit');
  for (let i = 0; i < LIMITS.maxSnapshots; i += 1) {
    document = command(document, 'snapshot.add', {id: 's' + i, label: 'Versão', createdAt: date});
  }
  fails(() => command(document, 'snapshot.add', {id: 'extra', label: 'Versão', createdAt: date}), 'limit');
  fails(() => command(document, 'snapshot.add', {id: 's0', label: 'Versão', createdAt: date}));
  assert.equal(document.decisions[0].snapshots.length, 12);
});

test('canonical UTF-8 document size counts historical matrices and fails without source mutation', () => {
  const document = fixture({weights: Array(12).fill(100), values: Array.from({length: 8}, () => Array(12).fill(5))});
  for (const rating of document.decisions[0].ratings) rating.note = '😀'.repeat(500);
  let valid = validateDocument(document);
  let rejected = false;
  for (let i = 0; i < LIMITS.maxSnapshots; i += 1) {
    const before = JSON.stringify(valid);
    try {
      valid = command(valid, 'snapshot.add', {id: 's' + i, label: 'Versão', createdAt: date});
    } catch (error) {
      assert.equal(error.code, 'document_limit');
      assert.equal(JSON.stringify(valid), before);
      rejected = true;
      break;
    }
  }
  assert.equal(rejected, true);
  assert.ok(new TextEncoder().encode(JSON.stringify(valid, null, 2) + '\n').byteLength <= LIMITS.maxDocumentBytes);
});

test('incomplete alternatives show possible bounds and block the entire ranking', () => {
  const document = fixture({values: [[5, null, 3, 0], [5, 5, 5, 5]]});
  const result = analyzeDecision(document.decisions[0]);
  assert.equal(result.activeWeight, 100);
  assert.equal(result.activeCriteria, 4);
  assert.equal(result.canRank, false);
  assert.equal(result.missingRatings, 1);
  assert.deepEqual(result.alternatives[0], {
    id: 'a0', name: 'Alternativa 0', points: 260, maxPoints: 500,
    answeredWeight: 75, missingCount: 1, coveragePermille: 750,
    minPermille: 520, maxPermille: 770, scorePermille: null, rank: null, tied: false,
    contributions: [
      {criterionId: 'c0', weight: 40, value: 5, points: 200, active: true},
      {criterionId: 'c1', weight: 25, value: null, points: null, active: true},
      {criterionId: 'c2', weight: 20, value: 3, points: 60, active: true},
      {criterionId: 'c3', weight: 15, value: 0, points: 0, active: true},
    ],
  });
  assert.equal(result.alternatives[1].coveragePermille, 1000);
  assert.equal(result.alternatives[1].rank, null);
  assert.equal(result.alternatives[1].scorePermille, null);
});

test('zero is an answered rating, while null is absent and never renormalized', () => {
  const complete = analyzeDecision(fixture({weights: [1, 99], values: [[0, 5]]}).decisions[0]);
  assert.equal(complete.canRank, true);
  assert.equal(complete.alternatives[0].scorePermille, 990);
  assert.equal(complete.alternatives[0].answeredWeight, 100);
  const incomplete = analyzeDecision(fixture({weights: [1, 99], values: [[5, null]]}).decisions[0]);
  assert.equal(incomplete.canRank, false);
  assert.equal(incomplete.alternatives[0].points, 5);
  assert.equal(incomplete.alternatives[0].minPermille, 10);
  assert.equal(incomplete.alternatives[0].maxPermille, 1000);
  assert.equal(incomplete.alternatives[0].coveragePermille, 10);
});

test('weight zero preserves annotations and excludes even missing values from ranking', () => {
  const document = fixture({weights: [0, 3], values: [[null, 4], [5, 3]]});
  document.decisions[0].ratings[0].note = 'Continua registrada';
  const result = analyzeDecision(document.decisions[0]);
  assert.equal(result.activeWeight, 3);
  assert.equal(result.activeCriteria, 1);
  assert.equal(result.canRank, true);
  assert.equal(result.missingRatings, 0);
  assert.equal(result.alternatives[0].scorePermille, 800);
  assert.deepEqual(result.alternatives[0].contributions[0], {
    criterionId: 'c0', weight: 0, value: null, points: null, active: false,
  });
  assert.deepEqual(result.alternatives[1].contributions[0], {
    criterionId: 'c0', weight: 0, value: 5, points: 0, active: false,
  });
  const reactivated = command(document, 'criterion.update', {criterionId: 'c0', name: 'Reativado', weight: 1, description: ''});
  assert.equal(analyzeDecision(reactivated.decisions[0]).canRank, false);
  assert.equal(reactivated.decisions[0].ratings[0].note, 'Continua registrada');
});

test('zero total weight and empty alternatives never produce a ranking or false 0 percent', () => {
  const result = analyzeDecision(fixture({weights: [0], values: [[null], [0]]}).decisions[0]);
  assert.equal(result.canRank, false);
  assert.equal(result.missingRatings, 0);
  for (const alternative of result.alternatives) {
    for (const key of ['coveragePermille', 'minPermille', 'maxPermille', 'scorePermille', 'rank']) {
      assert.equal(alternative[key], null);
    }
    assert.equal(alternative.maxPoints, 0);
    assert.equal(alternative.points, 0);
  }
  assert.equal(analyzeDecision(fixture({weights: [10], values: []}).decisions[0]).canRank, false);
});

test('relative weights need not sum to 100 and use exact integer totals', () => {
  const result = analyzeDecision(fixture({weights: [7, 4], values: [[5, 1]]}).decisions[0]);
  assert.equal(result.activeWeight, 11);
  assert.equal(result.alternatives[0].points, 39);
  assert.equal(result.alternatives[0].maxPoints, 55);
  assert.equal(result.alternatives[0].scorePermille, 709);
});

test('competition ranks retain original order and mark every tied alternative', () => {
  const original = deepFreeze(fixture({weights: [100], values: [[1], [5], [5], [0]]}));
  const result = analyzeDecision(original.decisions[0]);
  assert.deepEqual(result.alternatives.map(item => item.id), ['a0', 'a1', 'a2', 'a3']);
  assert.deepEqual(result.alternatives.map(item => item.rank), [3, 1, 1, 4]);
  assert.deepEqual(result.alternatives.map(item => item.tied), [false, true, true, false]);
  assert.deepEqual(result.alternatives.map(item => item.points), [100, 500, 500, 0]);
  const allTied = analyzeDecision(fixture({weights: [1], values: [[0], [0], [0]]}).decisions[0]);
  assert.deepEqual(allTied.alternatives.map(item => item.rank), [1, 1, 1]);
  assert.ok(allTied.alternatives.every(item => item.tied));
});

test('rank compares exact points rather than rounded display percentages', () => {
  const weights = [...Array(11).fill(100), 1];
  const first = [...Array(11).fill(0), 1];
  const second = [...Array(11).fill(0), 2];
  const result = analyzeDecision(fixture({weights, values: [first, second]}).decisions[0]);
  assert.deepEqual(result.alternatives.map(item => item.scorePermille), [0, 0]);
  assert.deepEqual(result.alternatives.map(item => item.rank), [2, 1]);
  assert.ok(result.alternatives.every(item => !item.tied));
});

test('half-up rounding handles an exact midpoint for coverage and score bounds', () => {
  const result = analyzeDecision(fixture({weights: [1, 15], values: [[1, null]]}).decisions[0]);
  const alternative = result.alternatives[0];
  assert.equal(alternative.coveragePermille, 63);
  assert.equal(alternative.minPermille, 13);
  assert.equal(alternative.maxPermille, 950);
});

test('400 small matrices agree with independent exhaustive completion and BigInt rounding oracles', () => {
  function round(numerator, denominator) {
    const n = BigInt(numerator);
    const d = BigInt(denominator);
    const quotient = n / d;
    const remainder = n % d;
    return Number(quotient + (remainder * 2n >= d ? 1n : 0n));
  }
  const possible = [0, 1, 2, 3, 4, 5];
  const inputs = [null, 0, 1, 3, 5];
  let checked = 0;
  for (let a = 1; a <= 4; a += 1) {
    for (let b = 1; b <= 4; b += 1) {
      for (const x of inputs) {
        for (const y of inputs) {
          const completePoints = [];
          for (const cx of x === null ? possible : [x]) {
            for (const cy of y === null ? possible : [y]) completePoints.push(cx * a + cy * b);
          }
          const observed = (x === null ? 0 : x * a) + (y === null ? 0 : y * b);
          const answered = (x === null ? 0 : a) + (y === null ? 0 : b);
          const result = analyzeDecision(fixture({weights: [a, b], values: [[x, y]]}).decisions[0]);
          const alternative = result.alternatives[0];
          assert.equal(alternative.points, observed);
          assert.equal(alternative.coveragePermille, round(1000 * answered, a + b));
          assert.equal(alternative.minPermille, round(1000 * Math.min(...completePoints), 5 * (a + b)));
          assert.equal(alternative.maxPermille, round(1000 * Math.max(...completePoints), 5 * (a + b)));
          assert.equal(result.canRank, x !== null && y !== null);
          assert.equal(alternative.rank, result.canRank ? 1 : null);
          assert.equal(alternative.scorePermille, result.canRank ? alternative.minPermille : null);
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 400);
});

test('analysis accepts a historical projection and does not consult current objects', () => {
  const source = fixture();
  const current = source.decisions[0];
  const {id, snapshots, ...historical} = copy(current);
  assert.deepEqual(analyzeDecision(historical), analyzeDecision(current));
  const snapshotDocument = command(source, 'snapshot.add', {id: 's', label: 'Histórico', createdAt: date});
  const snapshot = deepFreeze(snapshotDocument.decisions[0].snapshots[0].matrix);
  current.criteria[0].weight = 0;
  current.alternatives[0].name = 'Nome atual';
  const result = analyzeDecision(snapshot);
  assert.equal(result.activeWeight, 100);
  assert.equal(result.alternatives[0].name, 'Alternativa 0');
});
