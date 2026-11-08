import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {parseHTML} from 'linkedom';
import {IDBFactory} from 'fake-indexeddb';
import {mountApp} from '../assets/app.mjs';
import {LIMITS, applyCommand, analyzeDecision, validateDocument} from '../assets/domain.mjs';
import {createExampleDocument, serializeDocument, parseDocument,
  exportDecisionCsv, exportDecisionMarkdown} from '../assets/formats.mjs';
import {createStore, StorageError} from '../assets/store.mjs';

const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const fixedDate = '2026-11-08T15:30:00.000Z';
const clone = value => structuredClone(value);

// Linkedom 0.18.15 parses select controls but omits the standard value setter.
// Supply only that missing DOM behavior, rather than changing application code
// to fit the test renderer. These tests do not simulate browser layout.
const selectPrototype = Object.getPrototypeOf(parseHTML('<select></select>').document.querySelector('select'));
Object.defineProperty(selectPrototype, 'value', {
  configurable: true,
  get() { return this.querySelector('option[selected]')?.value ?? ''; },
  set(value) {
    let selected = false;
    for (const option of this.querySelectorAll('option')) {
      const matches = !selected && option.value === String(value);
      option.toggleAttribute('selected', matches);
      if (matches) selected = true;
    }
  },
});

function memoryStore(initial = {revision: 0, document: null}) {
  let envelope = clone(initial);
  const calls = {load: [], save: [], clear: [], close: []};
  return {
    calls,
    async load() { calls.load.push(true); return clone(envelope); },
    async save(document, revision) {
      calls.save.push({document: clone(document), revision});
      if (revision !== envelope.revision) throw new StorageError('conflict');
      envelope = {revision: revision + 1, document: validateDocument(document)};
      return clone(envelope);
    },
    async clear(revision) {
      calls.clear.push(revision);
      if (revision !== envelope.revision) throw new StorageError('conflict');
      envelope = {revision: revision + 1, document: null};
      return clone(envelope);
    },
    close() { calls.close.push(true); },
    read: () => clone(envelope),
    external(document) { envelope = {revision: envelope.revision + 1, document: validateDocument(document)}; },
  };
}

function fixture(options = {}) {
  const {window, document} = parseHTML(markup);
  const host = document.querySelector('#app');
  const downloads = [];
  const store = options.store ?? memoryStore(options.envelope);
  let id = 0;
  const app = mountApp(host, {store, id: () => 'ui-' + ++id,
    now: () => fixedDate, download: (filename, text, type) => downloads.push({filename, text, type})});
  const findButton = (label, scope = host) => {
    const result = [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === label);
    assert.ok(result, 'Button not found: ' + label);
    return result;
  };
  const settle = async () => { await nextTurn(); await app.flush(); await nextTurn(); };
  const dispatch = async (element, type, wait = true) => {
    assert.ok(element, 'Missing event target');
    element.dispatchEvent(new window.Event(type, {bubbles: true, cancelable: true}));
    if (wait) await settle();
  };
  const click = async (label, scope = host, wait = true) => {
    const button = findButton(label, scope);
    assert.equal(button.hasAttribute('disabled'), false, 'Button unexpectedly disabled: ' + label);
    await dispatch(button, 'click', wait);
  };
  const fill = (name, value, scope = host) => {
    const field = scope.querySelector(`[name="${name}"]`);
    assert.ok(field, 'Field not found: ' + name);
    field.value = value;
  };
  const submit = async (form = host.querySelector('#editor-form'), wait = true) => dispatch(form, 'submit', wait);
  const file = async (candidate, wait = true) => {
    const input = host.querySelector('#backup-file');
    assert.ok(input);
    Object.defineProperty(input, 'files', {configurable: true, value: [candidate]});
    await dispatch(input, 'change', wait);
  };
  return {window, document, host, app, downloads, store, findButton, settle, dispatch, click, fill, submit, file};
}

function fileOf(text) {
  const bytes = new TextEncoder().encode(text);
  return {name: 'caderno-sintetico.json', size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer};
}

async function waitFor(predicate, message = 'The expected asynchronous state did not arrive') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.ok(predicate(), message);
}

async function example(f) {
  await f.click('Explorar exemplo fictício');
  assert.equal(f.app.getDocument().decisions.length, 1);
  return f.app.getDocument().decisions[0];
}

async function chooseRating(f, alternative = 'estudio-norte', criterion = 'concentracao', value = '0', wait = true) {
  const control = f.host.querySelector(`.matrix-table [data-focus="rating-${alternative}-${criterion}"]`);
  assert.ok(control);
  control.value = value;
  await f.dispatch(control, 'change', wait);
}

async function files(f) { await f.click('Backup e salvamento'); }

test('initial mount is empty, temporary and does not touch optional storage', t => {
  const f = fixture(); t.after(() => f.app.destroy());
  assert.deepEqual(f.app.getDocument(), {schemaVersion: 1, decisions: []});
  assert.deepEqual(f.store.calls.load, []);
  assert.deepEqual(f.store.calls.save, []);
  assert.deepEqual(f.store.calls.clear, []);
  assert.match(f.host.querySelector('#storage-status').textContent, /Sessão temporária/);
  assert.ok(!f.host.querySelector('#feedback').textContent.includes('null'));
  assert.ok(f.findButton('Criar comparação'));
});

test('example opens a real editable matrix with accessible note controls and ranking', async t => {
  const f = fixture(); t.after(() => f.app.destroy());
  const current = await example(f);
  assert.equal(current.alternatives.length, 3);
  assert.equal(current.criteria.length, 4);
  assert.equal(f.host.querySelectorAll('.matrix-table .rating-select').length, 12);
  assert.equal(f.host.querySelectorAll('.mobile-matrix .rating-select').length, 12);
  assert.ok([...f.host.querySelectorAll('.rating-select')].every(control => control.getAttribute('aria-label')));
  assert.equal(analyzeDecision(current).canRank, true);
  assert.match(f.host.querySelector('.matrix-table').textContent, /1º lugar/);
  assert.deepEqual(f.store.calls.load, []);
  assert.deepEqual(f.store.calls.save, []);
  const detached = f.app.getDocument(); detached.decisions[0].title = 'Not a mutation';
  assert.equal(f.app.getDocument().decisions[0].title, 'Um espaço para trabalhar');
});

test('a score of zero stays answered while an empty rating blocks every displayed rank', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  await chooseRating(f, 'estudio-norte', 'concentracao', '0');
  assert.equal(f.app.getDocument().decisions[0].ratings[0].value, 0);
  assert.equal(analyzeDecision(f.app.getDocument().decisions[0]).canRank, true);
  await chooseRating(f, 'estudio-norte', 'concentracao', '');
  assert.equal(f.app.getDocument().decisions[0].ratings[0].value, null);
  assert.equal(analyzeDecision(f.app.getDocument().decisions[0]).canRank, false);
  assert.ok(!f.host.querySelector('.matrix-table').textContent.includes('º lugar'));
  assert.match(f.host.querySelector('.matrix-table').textContent, /Aguardando as outras alternativas/);
  await chooseRating(f, 'estudio-norte', 'concentracao', '5');
  assert.equal(analyzeDecision(f.app.getDocument().decisions[0]).canRank, true);
});

test('criterion weight edits, notes and invalid input preserve a consistent matrix', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  await chooseRating(f, 'estudio-norte', 'concentracao', '');
  await f.click('Concentração', f.host.querySelector('.matrix-table'));
  f.fill('weight', '0'); await f.submit();
  let current = f.app.getDocument().decisions[0];
  assert.equal(current.criteria[0].weight, 0);
  assert.equal(current.ratings[0].value, null);
  assert.equal(analyzeDecision(current).canRank, true);
  assert.match(f.host.querySelector('.matrix-table').textContent, /Peso 0 · inativo/);
  await f.click('Concentração', f.host.querySelector('.matrix-table'));
  f.fill('weight', '101'); await f.submit();
  assert.equal(f.app.getDocument().decisions[0].criteria[0].weight, 0);
  assert.equal(f.host.querySelector('[name="weight"]').value, '101');
  assert.ok(f.host.querySelector('[role="alert"]'));
  f.fill('weight', '25'); await f.submit();
  current = f.app.getDocument().decisions[0];
  assert.equal(current.criteria[0].weight, 25);
  assert.equal(analyzeDecision(current).canRank, false);
  const observation = f.host.querySelector('.matrix-table button[aria-label="Observação de Estúdio Norte em Concentração"]');
  await f.dispatch(observation, 'click');
  f.fill('note', 'Observação sintética'); await f.submit();
  assert.equal(f.app.getDocument().decisions[0].ratings[0].value, null);
  assert.equal(f.app.getDocument().decisions[0].ratings[0].note, 'Observação sintética');
});

test('context and alternative editing stay text and destructive removal requires confirmation', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  await f.click('Editar contexto');
  f.fill('title', '<img src=x onerror=alert(1)>'); f.fill('question', 'Pergunta\ncom contexto'); await f.submit();
  assert.equal(f.app.getDocument().decisions[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(f.host.querySelectorAll('img,script').length, 0);
  assert.match(f.host.querySelector('h1').textContent, /<img/);
  await f.click('+ Alternativa');
  f.fill('name', 'Nova alternativa'); f.fill('notes', 'Contexto da opção'); await f.submit();
  let current = f.app.getDocument().decisions[0];
  assert.equal(current.alternatives.length, 4);
  assert.equal(current.alternatives.at(-1).id, 'ui-1');
  assert.ok(current.ratings.filter(rating => rating.alternativeId === 'ui-1').every(rating => rating.value === null));
  await f.click('Nova alternativa', f.host.querySelector('.matrix-table'));
  f.fill('name', 'Alternativa renomeada'); await f.submit();
  await f.click('Alternativa renomeada', f.host.querySelector('.matrix-table'));
  await f.click('Remover alternativa');
  assert.equal(f.app.getDocument().decisions[0].alternatives.length, 4);
  await f.click('Cancelar', f.host.querySelector('.confirmation'));
  assert.equal(f.app.getDocument().decisions[0].alternatives.length, 4);
  await f.click('Alternativa renomeada', f.host.querySelector('.matrix-table'));
  await f.click('Remover alternativa'); await f.click('Confirmar');
  assert.equal(f.app.getDocument().decisions[0].alternatives.length, 3);
});

test('a new comparison is complete only after its form succeeds and can coexist with the example', async t => {
  const f = fixture(); t.after(() => f.app.destroy());
  await f.click('Criar comparação');
  f.fill('title', ''); f.fill('question', 'Contexto em edição'); await f.submit();
  assert.equal(f.app.getDocument().decisions.length, 0);
  assert.equal(f.host.querySelector('[name="question"]').value, 'Contexto em edição');
  f.fill('title', 'Minha comparação'); await f.submit();
  assert.equal(f.app.getDocument().decisions[0].title, 'Minha comparação');
  assert.equal(f.app.getDocument().decisions[0].question, 'Contexto em edição');
  await f.click('Adicionar alternativa'); f.fill('name', 'Alternativa própria'); f.fill('notes', ''); await f.submit();
  await f.click('Adicionar critério'); f.fill('name', 'Critério próprio'); f.fill('weight', '10'); f.fill('description', 'Quanto maior, melhor'); await f.submit();
  assert.equal(f.app.getDocument().decisions[0].ratings[0].value, null);
  await f.click('+ Nova comparação'); f.fill('title', 'Segunda comparação'); await f.submit();
  assert.equal(f.app.getDocument().decisions.length, 2);
  await f.click('Minha comparação', f.host.querySelector('.decision-list'));
  assert.equal(f.host.querySelector('h1').textContent, 'Minha comparação');
  assert.match(f.host.querySelector('.matrix-table').textContent, /Critério próprio/);
});

test('conclusion and a new snapshot use explicit IDs and time and remain independent of later edits', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  await f.click('Análise');
  f.fill('choice', 'estudio-norte'); f.fill('reason', 'Razão própria e próximos passos');
  await f.submit(f.host.querySelector('.conclusion-form'));
  assert.deepEqual(f.app.getDocument().decisions[0].choice,
    {alternativeId: 'estudio-norte', reason: 'Razão própria e próximos passos'});
  await f.click('Criar registro desta versão'); f.fill('label', 'Minha versão'); await f.submit();
  const snapshot = f.app.getDocument().decisions[0].snapshots.at(-1);
  assert.equal(snapshot.id, 'ui-1'); assert.equal(snapshot.createdAt, fixedDate);
  assert.equal(snapshot.matrix.choice.reason, 'Razão própria e próximos passos');
  await f.click('Matriz'); await chooseRating(f, 'estudio-norte', 'concentracao', '0');
  assert.equal(f.app.getDocument().decisions[0].snapshots.at(-1).matrix.ratings[0].value, 5);
  await f.click('Registros');
  const row = [...f.host.querySelectorAll('.history-row')].find(item => item.textContent.includes('Minha versão'));
  await f.click('Ver registro', row);
  assert.match(f.host.querySelector('.snapshot-view').textContent, /Razão própria e próximos passos/);
  assert.equal(f.host.querySelectorAll('.snapshot-view select').length, 0);
  assert.equal(f.host.querySelector('.snapshot-view .readonly-rating strong').textContent, '5');
});

test('backup, CSV and Markdown downloads are real exports and snapshot export uses historical data', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  await chooseRating(f, 'estudio-norte', 'concentracao', '0');
  const current = f.app.getDocument();
  await files(f); await f.click('Baixar backup JSON'); await f.click('Exportar notas CSV'); await f.click('Exportar Markdown');
  assert.deepEqual(parseDocument(f.downloads[0].text), current);
  assert.equal(f.downloads[0].filename, 'decisoes-abertas.json');
  assert.equal(f.downloads[1].text, exportDecisionCsv(current.decisions[0]));
  assert.equal(f.downloads[2].text, exportDecisionMarkdown(current.decisions[0]));
  await f.click('Registros'); await f.click('Markdown', f.host.querySelector('.history-row'));
  const historic = current.decisions[0].snapshots[0];
  assert.equal(f.downloads[3].text, exportDecisionMarkdown({id: historic.id, ...historic.matrix, snapshots: []}));
  assert.notEqual(f.downloads[3].text, f.downloads[2].text);
});

test('valid import is previewed and can be cancelled before a whole-document replacement', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f); await files(f);
  const before = f.app.getDocument();
  const replacement = applyCommand(createExampleDocument(), {type: 'decision.update', decisionId: 'espaco-de-trabalho', title: 'Backup importado', question: 'Outro contexto'});
  await f.file(fileOf(serializeDocument(replacement)));
  assert.deepEqual(f.app.getDocument(), before);
  assert.match(f.host.querySelector('.import-preview').textContent, /1 comparação/);
  await f.click('Cancelar importação');
  assert.equal(f.host.querySelector('.import-preview'), null);
  assert.deepEqual(f.app.getDocument(), before);
  await f.file(fileOf(serializeDocument(replacement))); await f.click('Substituir pelo backup');
  assert.deepEqual(f.app.getDocument(), replacement);
  assert.equal(f.host.querySelector('.import-preview'), null);
  assert.deepEqual(f.store.calls.save, []);
});

test('invalid UTF-8, JSON and oversized selections clear old previews without losing the current document', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f); await files(f);
  const before = f.app.getDocument();
  for (const invalid of [
    {name: 'invalid.json', size: 2, arrayBuffer: async () => Uint8Array.of(0xc3, 0x28).buffer},
    fileOf('{invalid JSON PRIVATE_SYNTHETIC}'),
    fileOf('{"schemaVersion":2,"decisions":[]}'),
    {name: 'large.json', size: LIMITS.maxDocumentBytes + 1, arrayBuffer: async () => { throw new Error('Must not read oversized input'); }},
  ]) {
    await f.file(fileOf(serializeDocument(createExampleDocument())));
    assert.ok(f.host.querySelector('.import-preview'));
    await f.file(invalid);
    assert.equal(f.host.querySelector('.import-preview'), null);
    assert.equal(f.host.querySelector('#import-confirm'), null);
    assert.deepEqual(f.app.getDocument(), before);
    assert.ok(f.host.querySelector('[role="alert"]'));
    assert.ok(!f.host.querySelector('[role="alert"]').textContent.includes('PRIVATE_SYNTHETIC'));
  }
  await f.click('Baixar backup JSON');
  assert.deepEqual(parseDocument(f.downloads.at(-1).text), before);
});

test('out-of-order file reads cannot replace a newer preview and edits invalidate pending reads', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f); await files(f);
  let release;
  const delayedBytes = new TextEncoder().encode(serializeDocument(createExampleDocument()));
  const delayed = {name: 'older.json', size: delayedBytes.length,
    arrayBuffer: () => new Promise(resolve => { release = () => resolve(delayedBytes.buffer); })};
  const oldRead = f.app.importFile(delayed);
  const newer = applyCommand(createExampleDocument(), {type: 'decision.update', decisionId: 'espaco-de-trabalho', title: 'Mais recente', question: ''});
  await f.app.importFile(fileOf(serializeDocument(newer)));
  release(); await oldRead;
  await f.click('Substituir pelo backup');
  assert.equal(f.app.getDocument().decisions[0].title, 'Mais recente');
  const after = f.app.importFile(delayed);
  await f.click('Matriz'); await chooseRating(f, 'estudio-norte', 'concentracao', '0');
  release(); await after; await files(f);
  assert.equal(f.host.querySelector('.import-preview'), null);
  assert.equal(f.app.getDocument().decisions[0].ratings[0].value, 0);
});

test('example replacement and comparison deletion require explicit confirmation', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  await f.click('Editar contexto'); f.fill('title', 'Conteúdo próprio'); await f.submit();
  await f.click('+ Nova comparação'); await f.click('Cancelar', f.host.querySelector('#editor-form'));
  await f.click('Explorar exemplo fictício');
  assert.equal(f.app.getDocument().decisions[0].title, 'Conteúdo próprio');
  await f.click('Cancelar', f.host.querySelector('.confirmation'));
  assert.equal(f.app.getDocument().decisions[0].title, 'Conteúdo próprio');
  await f.click('Explorar exemplo fictício'); await f.click('Confirmar');
  assert.equal(f.app.getDocument().decisions[0].title, 'Um espaço para trabalhar');
  await f.click('Remover comparação');
  assert.equal(f.app.getDocument().decisions.length, 1);
  await f.click('Cancelar', f.host.querySelector('.confirmation'));
  assert.equal(f.app.getDocument().decisions[0].title, 'Um espaço para trabalhar');
  await f.click('Remover comparação'); await f.click('Confirmar');
  assert.equal(f.app.getDocument().decisions.length, 0);
  assert.ok(f.findButton('Explorar exemplo fictício'));
});

test('optional persistence saves only after activation and clear keeps the session exportable', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  assert.equal(f.store.calls.save.length, 0);
  await files(f); await f.click('Ativar salvamento', f.host.querySelector('.storage-section'));
  assert.equal(f.store.calls.load.length, 1);
  assert.equal(f.store.calls.save.length, 1);
  assert.equal(f.store.calls.save[0].revision, 0);
  assert.equal(f.store.read().revision, 1);
  await f.click('Matriz'); await chooseRating(f, 'estudio-norte', 'concentracao', '0');
  assert.equal(f.store.calls.save.length, 2);
  assert.equal(f.store.calls.save[1].revision, 1);
  assert.equal(f.store.read().document.decisions[0].ratings[0].value, 0);
  const beforeClear = f.app.getDocument();
  await files(f); await f.click('Desativar e apagar salvamento');
  assert.equal(f.store.read().document !== null, true);
  await f.click('Cancelar', f.host.querySelector('.confirmation'));
  assert.equal(f.store.calls.clear.length, 0);
  await f.click('Desativar e apagar salvamento'); await f.click('Confirmar');
  assert.equal(f.store.calls.clear.length, 1);
  assert.equal(f.store.read().document, null);
  assert.equal(f.store.read().revision, 3);
  assert.deepEqual(f.app.getDocument(), beforeClear);
  await f.click('Baixar backup JSON');
  assert.deepEqual(parseDocument(f.downloads.at(-1).text), beforeClear);
});

test('an existing saved notebook is never silently overwritten when enabling persistence', async t => {
  const saved = applyCommand(createExampleDocument(), {type: 'decision.update', decisionId: 'espaco-de-trabalho', title: 'Salvo anteriormente', question: ''});
  const f = fixture({envelope: {revision: 7, document: saved}}); t.after(() => f.app.destroy());
  await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'));
  assert.equal(f.store.calls.save.length, 0);
  assert.equal(f.app.getDocument().decisions[0].title, 'Um espaço para trabalhar');
  assert.ok(f.host.querySelector('.confirmation'));
  await f.click('Cancelar', f.host.querySelector('.confirmation'));
  assert.equal(f.store.calls.save.length, 0);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section')); await f.click('Confirmar');
  assert.deepEqual(f.app.getDocument(), saved);
  assert.equal(f.store.calls.save.length, 0);
  await f.click('Matriz'); await chooseRating(f, 'estudio-norte', 'concentracao', '0');
  assert.equal(f.store.calls.save.length, 1);
  assert.equal(f.store.calls.save[0].revision, 7);
});

test('storage failures preserve edits in memory and provide an exact backup', async t => {
  const store = memoryStore();
  store.save = async () => { throw new StorageError('storage'); };
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'));
  assert.match(f.host.querySelector('#storage-status').textContent, /Falha ao salvar/);
  assert.equal(f.findButton('Ativar salvamento', f.host.querySelector('.storage-section')).hasAttribute('disabled'), false);
  assert.equal(f.findButton('Desativar e apagar salvamento').hasAttribute('disabled'), true);
  await f.click('Matriz'); await chooseRating(f, 'estudio-norte', 'concentracao', '0');
  const current = f.app.getDocument();
  assert.equal(current.decisions[0].ratings[0].value, 0);
  await files(f); await f.click('Baixar backup JSON');
  assert.deepEqual(parseDocument(f.downloads.at(-1).text), current);
  assert.equal(store.read().document, null);
});

test('a competing real IndexedDB revision blocks writes and preserves this session for backup', async t => {
  const indexedDB = new IDBFactory();
  const store = createStore({indexedDB, name: 'ui-real-conflict'});
  const other = createStore({indexedDB, name: 'ui-real-conflict'});
  const f = fixture({store}); t.after(() => { f.app.destroy(); other.close(); });
  assert.deepEqual(await indexedDB.databases(), []);
  await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'), false);
  await waitFor(() => f.host.querySelector('#storage-status').textContent === 'Salvo neste navegador');
  const previous = await other.load();
  const remote = applyCommand(previous.document, {type: 'decision.update', decisionId: 'espaco-de-trabalho', title: 'Outra aba', question: ''});
  await other.save(remote, previous.revision);
  await f.click('Matriz'); await chooseRating(f, 'estudio-norte', 'concentracao', '0');
  assert.match(f.host.querySelector('#storage-status').textContent, /Conflito/);
  assert.equal((await other.load()).document.decisions[0].title, 'Outra aba');
  assert.equal((await other.load()).document.decisions[0].ratings[0].value, 5);
  assert.equal(f.app.getDocument().decisions[0].ratings[0].value, 0);
  await files(f); await f.click('Baixar backup JSON');
  assert.deepEqual(parseDocument(f.downloads.at(-1).text), f.app.getDocument());
  await f.click('Abrir salvo', f.host.querySelector('.storage-section'));
  await waitFor(() => f.host.querySelector('.confirmation'));
  assert.equal(f.app.getDocument().decisions[0].title, 'Um espaço para trabalhar');
  await f.click('Confirmar');
  assert.equal(f.app.getDocument().decisions[0].title, 'Outra aba');
});

test('edits during an outstanding save are coalesced and use the committed revision', async t => {
  const store = memoryStore();
  const saved = [];
  let release;
  const originalSave = store.save.bind(store);
  store.save = async (document, revision) => {
    saved.push({document: clone(document), revision});
    if (saved.length === 1) await new Promise(resolve => { release = resolve; });
    return originalSave(document, revision);
  };
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'), false);
  await waitFor(() => saved.length === 1);
  await f.click('Matriz', f.host, false);
  await chooseRating(f, 'estudio-norte', 'concentracao', '0', false);
  await chooseRating(f, 'estudio-norte', 'concentracao', '1', false);
  await chooseRating(f, 'estudio-norte', 'concentracao', '2', false);
  assert.equal(saved.length, 1);
  release(); await f.app.flush(); await f.settle();
  assert.equal(saved.length, 2);
  assert.deepEqual(saved.map(item => item.revision), [0, 1]);
  assert.equal(saved[0].document.decisions[0].ratings[0].value, 5);
  assert.equal(saved[1].document.decisions[0].ratings[0].value, 2);
  assert.equal(store.read().document.decisions[0].ratings[0].value, 2);
});

test('session edits during a saved read prevent it from replacing newer local information', async t => {
  const store = memoryStore({revision: 5, document: createExampleDocument()});
  let release;
  store.load = () => new Promise(resolve => { release = resolve; });
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  await f.click('Abrir salvo', f.host.querySelector('.storage-section'), false);
  await waitFor(() => release);
  await f.click('Matriz', f.host, false); await chooseRating(f, 'estudio-norte', 'concentracao', '0', false);
  release({revision: 5, document: createExampleDocument()}); await f.settle();
  assert.equal(f.app.getDocument().decisions[0].ratings[0].value, 0);
  assert.equal(f.host.querySelector('.confirmation'), null);
  assert.match(f.host.querySelector('[role="alert"]').textContent, /sessão mudou/);
  assert.equal(store.calls.save.length, 0);
});

test('an asynchronous save failure updates feedback without discarding a draft form', async t => {
  const store = memoryStore();
  let rejectSave;
  store.save = () => new Promise((resolve, reject) => { rejectSave = reject; });
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'), false);
  await waitFor(() => rejectSave);
  await f.click('Matriz', f.host, false); await f.click('Editar contexto', f.host, false);
  f.fill('title', 'Rascunho ainda não salvo');
  rejectSave(new StorageError('storage')); await f.app.flush(); await f.settle();
  assert.equal(f.host.querySelector('[name="title"]').value, 'Rascunho ainda não salvo');
  assert.equal(f.app.getDocument().decisions[0].title, 'Um espaço para trabalhar');
  assert.match(f.host.querySelector('#storage-status').textContent, /Falha ao salvar/);
  assert.ok(f.host.querySelector('[role="alert"]'));
});

test('opening a saved document invalidates the pending import from its previous session', async t => {
  const saved = applyCommand(createExampleDocument(), {type: 'decision.update', decisionId: 'espaco-de-trabalho', title: 'Caderno salvo B', question: ''});
  const f = fixture({envelope: {revision: 6, document: saved}}); t.after(() => f.app.destroy());
  await example(f); await files(f);
  let release;
  const bytes = new TextEncoder().encode(serializeDocument(createExampleDocument()));
  const pending = f.app.importFile({name: 'antigo-A.json', size: bytes.length,
    arrayBuffer: () => new Promise(resolve => { release = () => resolve(bytes.buffer); })});
  await f.click('Abrir salvo', f.host.querySelector('.storage-section')); await f.click('Confirmar');
  assert.equal(f.app.getDocument().decisions[0].title, 'Caderno salvo B');
  release(); await pending; await f.settle();
  assert.equal(f.host.querySelector('.import-preview'), null);
  assert.equal(f.app.getDocument().decisions[0].title, 'Caderno salvo B');
  assert.equal(f.store.calls.save.length, 0);
});

test('destroy during a saved read keeps the disposed host empty and performs no write', async () => {
  const store = memoryStore();
  let release;
  store.load = () => new Promise(resolve => { release = resolve; });
  const f = fixture({store}); await files(f);
  await f.click('Abrir salvo', f.host.querySelector('.storage-section'), false);
  await waitFor(() => release);
  f.app.destroy();
  assert.equal(f.host.childNodes.length, 0);
  release({revision: 1, document: createExampleDocument()});
  await f.settle();
  assert.equal(f.host.childNodes.length, 0);
  assert.equal(store.calls.save.length, 0);
  assert.equal(store.calls.close.length, 1);
});

test('edits during clear remain temporary and cannot recreate the erased saved document', async t => {
  const store = memoryStore();
  const originalClear = store.clear.bind(store);
  let release;
  let clearing = false;
  store.clear = async revision => {
    clearing = true;
    await new Promise(resolve => { release = resolve; });
    return originalClear(revision);
  };
  const f = fixture({store}); t.after(() => f.app.destroy()); await example(f); await files(f);
  await f.click('Ativar salvamento', f.host.querySelector('.storage-section'));
  const writesBeforeClear = store.calls.save.length;
  await f.click('Desativar e apagar salvamento'); await f.click('Confirmar', f.host, false);
  await waitFor(() => clearing);
  await f.click('Matriz', f.host, false); await chooseRating(f, 'estudio-norte', 'concentracao', '0', false);
  assert.equal(store.calls.save.length, writesBeforeClear);
  release(); await waitFor(() => store.read().document === null); await f.settle();
  assert.equal(store.calls.save.length, writesBeforeClear);
  assert.equal(store.read().document, null);
  assert.equal(f.app.getDocument().decisions[0].ratings[0].value, 0);
  assert.match(f.host.querySelector('#storage-status').textContent, /Sessão temporária/);
  await files(f); await f.click('Baixar backup JSON');
  assert.equal(parseDocument(f.downloads.at(-1).text).decisions[0].ratings[0].value, 0);
});

test('mobile matrix markup preserves the rating scale and full criterion context', async t => {
  const f = fixture(); t.after(() => f.app.destroy());
  const current = await example(f);
  assert.match(f.host.querySelector('.matrix-explainer').textContent, /Escala: 0 é a menor nota e 5 é a maior/);
  const sheets = [...f.host.querySelectorAll('.mobile-matrix .alternative-sheet')];
  assert.equal(sheets.length, current.alternatives.length);
  for (const [index, sheet] of sheets.entries()) {
    const rows = [...sheet.querySelectorAll('.mobile-rating-row')];
    assert.equal(rows.length, current.criteria.length);
    for (const [criterionIndex, row] of rows.entries()) {
      const criterion = current.criteria[criterionIndex];
      assert.equal(row.querySelector('.criterion-description').textContent, criterion.description);
      assert.equal(row.querySelector('.criterion-name').textContent, criterion.name);
      assert.match(row.querySelector('.weight-label').textContent, new RegExp('Peso ' + criterion.weight));
      const control = row.querySelector('.rating-select');
      assert.equal(control.getAttribute('aria-label'),
        `Nota de ${current.alternatives[index].name} em ${criterion.name}`);
      assert.deepEqual([...control.querySelectorAll('option')].map(option => option.value), ['', '0', '1', '2', '3', '4', '5']);
    }
  }
  // This assertion concerns available DOM content; responsive visibility and
  // actual geometry are intentionally left to the real browser review.
});

test('all eight alternative columns stay bound to the matrix and the add limit recovers after removal', async t => {
  const f = fixture(); t.after(() => f.app.destroy()); await example(f);
  for (let index = 4; index <= LIMITS.maxAlternatives; index += 1) {
    await f.click('+ Alternativa');
    f.fill('name', 'Alternativa adicional ' + index); f.fill('notes', 'Contexto sintético');
    await f.submit();
    const table = f.host.querySelector('.matrix-table');
    assert.equal(table.getAttribute('data-alternatives'), String(index));
    assert.equal(table.querySelectorAll('thead th').length, index + 1);
    assert.equal(table.querySelectorAll('tbody tr').length, 4);
    for (const row of table.querySelectorAll('tbody tr')) assert.equal(row.querySelectorAll('td').length, index);
  }
  const addButton = f.findButton('+ Alternativa');
  assert.equal(addButton.hasAttribute('disabled'), true);
  assert.ok(addButton.getAttribute('data-focus'));
  assert.equal(f.host.querySelectorAll('.matrix-table .rating-select').length, 32);
  assert.equal(f.host.querySelectorAll('.mobile-matrix .rating-select').length, 32);
  await f.click('Alternativa adicional 8', f.host.querySelector('.matrix-table'));
  await f.click('Remover alternativa'); await f.click('Confirmar');
  assert.equal(f.app.getDocument().decisions[0].alternatives.length, 7);
  assert.equal(f.host.querySelector('.matrix-table').getAttribute('data-alternatives'), '7');
  assert.equal(f.findButton('+ Alternativa').hasAttribute('disabled'), false);
});
