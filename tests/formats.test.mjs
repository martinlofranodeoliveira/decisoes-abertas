import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, LIMITS, analyzeDecision, applyCommand, createDocument, validateDocument } from '../assets/domain.mjs';
import { createExampleDocument, exportDecisionCsv, exportDecisionMarkdown, parseDocument, serializeDocument } from '../assets/formats.mjs';

function example() { return createExampleDocument(); }

// An independent CSV reader for the emitted RFC4180 profile, including multiline fields.
function readCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\r' && text[i + 1] === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; i += 1;
    } else field += char;
  }
  assert.equal(quoted, false);
  assert.equal(field, ''); assert.deepEqual(row, []);
  return rows;
}

test('the synthetic example has independent exact scores and a coherent historical copy', () => {
  const doc = example();
  const decision = doc.decisions[0];
  const analyzed = analyzeDecision(decision);
  assert.deepEqual(decision.alternatives.map((item) => item.name), ['Estúdio Norte', 'Sala Jardim', 'Espaço Central']);
  assert.deepEqual(decision.criteria.map((item) => item.weight), [40, 25, 20, 15]);
  assert.deepEqual(analyzed.alternatives.map((item) => item.points), [400, 405, 395]);
  assert.deepEqual(analyzed.alternatives.map((item) => item.scorePermille), [800, 810, 790]);
  assert.deepEqual(analyzed.alternatives.map((item) => item.rank), [2, 1, 3]);
  assert.equal(analyzed.canRank, true);
  const { id, snapshots, ...matrix } = decision;
  assert.deepEqual(snapshots[0].matrix, matrix);
  assert.equal(snapshots[0].createdAt, '2026-11-08T12:00:00.000Z');
  decision.alternatives[0].name = 'Changed example';
  assert.equal(snapshots[0].matrix.alternatives[0].name, 'Estúdio Norte');
  assert.equal(example().decisions[0].alternatives[0].name, 'Estúdio Norte');
});

test('JSON backup round trips the full notebook including snapshots without mutation', () => {
  const doc = example();
  const before = structuredClone(doc);
  const text = serializeDocument(doc);
  assert.ok(text.endsWith('\n'));
  assert.equal(text, JSON.stringify(doc, null, 2) + '\n');
  assert.deepEqual(parseDocument(text), doc);
  assert.equal(serializeDocument(parseDocument(text)), text);
  assert.deepEqual(doc, before);
});

test('empty documents round trip without manufacturing comparisons', () => {
  const doc = createDocument();
  assert.deepEqual(parseDocument(serializeDocument(doc)), { schemaVersion: 1, decisions: [] });
});

test('JSON parser normalizes rating order and text under the public domain contract', () => {
  const doc = example();
  doc.decisions[0].ratings.reverse();
  doc.decisions[0].question = '  Linha A\r\nLinha B  ';
  const parsed = parseDocument(JSON.stringify(doc));
  assert.equal(parsed.decisions[0].question, 'Linha A\nLinha B');
  assert.deepEqual(parsed.decisions[0].ratings.map((rating) => [rating.alternativeId, rating.criterionId]),
    example().decisions[0].ratings.map((rating) => [rating.alternativeId, rating.criterionId]));
});

test('malformed and non-text JSON failures never repeat input values or native parser messages', () => {
  for (const input of ['{ "private-personal-marker":', '', 'undefined', null, 3, {}, []]) {
    assert.throws(() => parseDocument(input), (error) => error instanceof AppError
      && error.code === 'invalid_json' && !String(error).includes('private-personal-marker')
      && !Object.hasOwn(error, 'cause'));
  }
});

test('input is byte-limited before JSON.parse, including UTF8 multibyte text', () => {
  const oversized = 'á'.repeat(Math.floor(LIMITS.maxDocumentBytes / 2) + 1);
  assert.ok(oversized.length < LIMITS.maxDocumentBytes);
  assert.throws(() => parseDocument(oversized), { code: 'size_limit' });
  assert.throws(() => parseDocument(' '.repeat(LIMITS.maxDocumentBytes + 1)), { code: 'size_limit' });
});

test('valid JSON is still completely validated before it can replace a notebook', () => {
  for (const mutate of [
    (doc) => { doc.schemaVersion = 2; },
    (doc) => { doc.unknown = 'private-personal-marker'; },
    (doc) => { doc.decisions[0].ratings[0].value = 6; },
    (doc) => { doc.decisions[0].ratings.pop(); },
    (doc) => { doc.decisions[0].snapshots[0].matrix.choice.alternativeId = 'missing'; },
  ]) {
    const doc = example(); mutate(doc);
    assert.throws(() => parseDocument(JSON.stringify(doc)), (error) => error instanceof AppError
      && !String(error).includes('private-personal-marker'));
  }
  const polluted = '{"schemaVersion":1,"decisions":[],"__proto__":{"polluted":true}}';
  assert.throws(() => parseDocument(polluted));
  assert.equal({}.polluted, undefined);
});

test('zero scores and missing scores remain distinct through every export', () => {
  const doc = example();
  doc.decisions[0].ratings[0].value = 0;
  doc.decisions[0].ratings[1].value = null;
  const roundTrip = parseDocument(serializeDocument(doc));
  assert.equal(roundTrip.decisions[0].ratings[0].value, 0);
  assert.equal(roundTrip.decisions[0].ratings[1].value, null);
  const rows = readCsv(exportDecisionCsv(doc.decisions[0]));
  assert.equal(rows[1][4], '0'); assert.equal(rows[2][4], '');
  const markdown = exportDecisionMarkdown(doc.decisions[0]);
  assert.match(markdown, /não respondida/);
  assert.match(markdown, /Sem ranking/);
  assert.match(markdown, /\| Estúdio Norte \| Concentração \| 0 \|/);
});

test('CSV row order, cardinality and exact numbers agree with the matrix', () => {
  const decision = example().decisions[0];
  const text = exportDecisionCsv(decision);
  const rows = readCsv(text);
  assert.deepEqual(rows[0], ['comparacao', 'alternativa', 'criterio', 'peso', 'nota', 'observacao']);
  assert.equal(rows.length, 13);
  assert.deepEqual(rows.slice(1, 5).map((row) => row[1]), Array(4).fill('Estúdio Norte'));
  assert.deepEqual(rows.slice(1, 5).map((row) => row[2]), ['Concentração', 'Acesso', 'Estrutura', 'Flexibilidade']);
  assert.deepEqual(rows.slice(1, 5).map((row) => row[3]), ['40', '25', '20', '15']);
  assert.deepEqual(rows.slice(1, 5).map((row) => row[4]), ['5', '3', '4', '3']);
});

test('CSV quoting preserves commas, quotes and multiline observations', () => {
  const decision = example().decisions[0];
  decision.title = 'Título, com "aspas"';
  decision.ratings[0].note = 'Linha "um", nota\nLinha dois';
  const text = exportDecisionCsv(decision);
  const rows = readCsv(text);
  assert.equal(rows[1][0], 'Título, com "aspas"');
  assert.equal(rows[1][5], 'Linha "um", nota\r\nLinha dois');
  assert.ok(text.endsWith('\r\n'));
  assert.ok(text.includes('""aspas""'));
});

test('CSV guards formula-leading strings while preserving numeric scores', () => {
  for (const prefix of ['=', '+', '-', '@']) {
    const decision = example().decisions[0];
    decision.title = prefix + 'titulo';
    decision.alternatives[0].name = prefix + 'alternativa';
    decision.criteria[0].name = prefix + 'criterio';
    decision.ratings[0].note = prefix + 'observacao';
    const row = readCsv(exportDecisionCsv(decision))[1];
    for (const column of [0, 1, 2, 5]) assert.ok(row[column].startsWith("'" + prefix));
    assert.equal(row[3], '40'); assert.equal(row[4], '5');
  }
});

test('CSV contains current ratings only; historical data remains in JSON backup', () => {
  const doc = example();
  doc.decisions[0].snapshots[0].matrix.ratings[0].note = 'historical-only-marker';
  assert.ok(serializeDocument(doc).includes('historical-only-marker'));
  assert.ok(!exportDecisionCsv(doc.decisions[0]).includes('historical-only-marker'));
});

test('Markdown exposes the actual calculation, ties and independent human choice', () => {
  const doc = example();
  doc.decisions[0].ratings[0].value = 4;
  doc.decisions[0].ratings[2].value = 5;
  doc.decisions[0].ratings[3].value = 4;
  // Estúdio Norte:160+75+100+60=395, tying Espaço Central.
  const markdown = exportDecisionMarkdown(doc.decisions[0]);
  assert.match(markdown, /\*\*Peso ativo total:\*\* 100/);
  assert.ok(markdown.includes('2 \\(empate\\)'));
  assert.match(markdown, /81,0%/);
  assert.match(markdown, /\*\*Alternativa:\*\* Sala Jardim/);
  assert.match(markdown, /Primeira análise fictícia/);
  assert.match(markdown, /Contribuições: Estúdio Norte/);
  assert.match(markdown, /5 × peso ativo total/);
});

test('Markdown reports no rank and bounded ranges while any active value is missing', () => {
  const decision = example().decisions[0];
  decision.ratings[0].value = null;
  const markdown = exportDecisionMarkdown(decision);
  assert.match(markdown, /Sem ranking/);
  assert.match(markdown, /40,0% a 80,0%/);
  assert.ok(!markdown.includes('(empate)'));
  assert.match(markdown, /indisponível/);
});

test('inactive criteria are explicit, and all-zero weights do not generate percentages', () => {
  const decision = example().decisions[0];
  decision.criteria.forEach((criterion) => { criterion.weight = 0; });
  const markdown = exportDecisionMarkdown(decision);
  assert.match(markdown, /inativo/);
  assert.match(markdown, /não calculável/);
  assert.match(markdown, /Sem ranking/);
  assert.ok(!markdown.includes('NaN') && !markdown.includes('Infinity'));
});

test('Markdown escapes HTML, table delimiters, links, fences and invisible controls', () => {
  const decision = example().decisions[0];
  decision.title = '<script>alert(1)</script>|[x](javascript:evil)`';
  decision.question = '````\n<img src=x onerror=alert(1)>\n# Título';
  decision.ratings[0].note = 'Texto\tcom\nquebra e \u202econtrole';
  const before = structuredClone(decision);
  const markdown = exportDecisionMarkdown(decision);
  assert.ok(!markdown.includes('<script>') && !markdown.includes('<img'));
  assert.ok(!markdown.includes('[x](javascript:evil)'));
  assert.ok(!markdown.includes('\u202e'));
  assert.ok(markdown.includes('&lt;script&gt;'));
  assert.ok(markdown.includes('\\|'));
  assert.ok(markdown.includes('\\`\\`\\`\\`'));
  assert.ok(markdown.includes('\\\\u202e'));
  assert.deepEqual(decision, before);
});

test('snapshot reports use only their historical matrix, even after current edits', () => {
  let doc = example();
  doc = applyCommand(doc, { type: 'alternative.update', decisionId: doc.decisions[0].id,
    alternativeId: 'sala-jardim', name: 'Nome atual novo', notes: 'Mudança atual' });
  const snapshot = doc.decisions[0].snapshots[0];
  const markdown = exportDecisionMarkdown({ id: 'snapshot-report', ...snapshot.matrix, snapshots: [] });
  assert.ok(markdown.includes('Sala Jardim'));
  assert.ok(!markdown.includes('Nome atual novo'));
  assert.ok(!markdown.includes('Mudança atual'));
});

test('all reports validate their complete input and never mutate it', () => {
  const doc = example();
  const before = structuredClone(doc);
  for (const render of [exportDecisionCsv, exportDecisionMarkdown]) {
    assert.equal(render(doc.decisions[0]), render(doc.decisions[0]));
    const invalid = structuredClone(doc.decisions[0]);
    invalid.snapshots[0].matrix.ratings[0].value = 99;
    assert.throws(() => render(invalid), AppError);
  }
  assert.deepEqual(doc, before);
  assert.deepEqual(validateDocument(doc), doc);
});
