import { AppError, LIMITS, createDocument, validateDocument, applyCommand, analyzeDecision } from './domain.mjs';
import { serializeDocument, parseDocument, exportDecisionMarkdown, exportDecisionCsv, createExampleDocument } from './formats.mjs';
import { createStore } from './store.mjs';

const TABS = [['matrix', 'Matriz'], ['analysis', 'Análise'], ['history', 'Registros'], ['files', 'Arquivos']];
const percent = value => value === null ? '—' : (value / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const dateText = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export function mountApp(host, dependencies = {}) {
  const document = host.ownerDocument;
  const store = dependencies.store || createStore();
  const nextId = dependencies.id || (() => globalThis.crypto.randomUUID());
  const now = dependencies.now || (() => new Date().toISOString());
  const state = { document: createDocument(), selected: null, tab: 'matrix', editor: null,
    confirmation: null, importPreview: null, snapshot: null, error: '', notice: '',
    enabled: false, storageBusy: false, revision: 0, saveState: 'off', epoch: 0, dirty: false };
  let pendingSave = null, saveTask = Promise.resolve(), saving = false, importGeneration = 0, alive = true;

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (name.startsWith('on')) node.addEventListener(name.slice(2).toLowerCase(), value);
      else if (name === 'class') node.className = value;
      else if (name === 'value') node.value = value;
      else if (name === 'checked' || name === 'disabled') { if (value) { node[name] = true; node.setAttribute(name, ''); } }
      else if (value !== null && value !== undefined) node.setAttribute(name, String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  const selected = () => state.document.decisions.find(item => item.id === state.selected) || null;
  function fail(error) {
    if (!alive) return;
    state.error = error instanceof AppError || ['conflict', 'unavailable', 'storage', 'corrupt', 'revision_limit'].includes(error?.code)
      ? error.message : 'Não foi possível concluir a operação. Seu caderno continua disponível; faça um backup e tente novamente.';
    updateFeedback();
  }
  function run(fn) { try { const result = fn(); if (result?.catch) result.catch(fail); } catch (error) { fail(error); } }
  function button(label, fn, options = {}) {
    return h('button', { type: 'button', 'data-focus': 'action-' + (options['aria-label'] || label) + '-' + (options.class || ''), ...options, onclick: () => run(fn) }, label);
  }
  function updateFeedback() {
    if (!alive) return;
    const region = host.querySelector('#feedback');
    if (region) region.replaceChildren(...[
      state.error ? h('div', { class: 'notice error', role: 'alert' }, h('p', {}, state.error), button('Fechar aviso', () => { state.error = ''; updateFeedback(); }, { class: 'text-button' })) : null,
      state.notice ? h('p', { class: 'notice', role: 'status' }, state.notice) : null,
    ].filter(Boolean));
    const status = host.querySelector('#storage-status');
    if (status) status.textContent = state.saveState === 'busy' ? 'Salvando…' : state.saveState === 'ready' ? 'Salvo neste navegador' : state.saveState === 'conflict' ? 'Conflito: faça backup da sessão' : state.saveState === 'error' ? 'Falha ao salvar: sessão preservada' : 'Sessão temporária';
    for (const control of host.querySelectorAll('[data-storage-action]')) {
      const action = control.getAttribute('data-storage-action');
      control.disabled = state.storageBusy || (action === 'enable' && state.enabled) || (action === 'clear' && !state.enabled);
      if (action === 'enable') control.textContent = state.enabled ? 'Salvamento ativo' : 'Ativar salvamento';
    }
  }
  async function drainSaves() {
    saving = true;
    state.saveState = 'busy'; updateFeedback();
    try {
      while (pendingSave && state.enabled) {
        const item = pendingSave; pendingSave = null;
        const receipt = await store.save(item.document, state.revision);
        state.revision = receipt.revision;
        if (item.epoch === state.epoch) state.dirty = false;
      }
      state.saveState = state.enabled ? 'ready' : 'off';
    } catch (error) {
      pendingSave = null; state.enabled = false;
      state.saveState = error.code === 'conflict' ? 'conflict' : 'error'; fail(error);
    } finally { saving = false; updateFeedback(); }
  }
  function scheduleSave() {
    if (!state.enabled) return;
    pendingSave = { document: validateDocument(state.document), epoch: state.epoch };
    if (!saving) saveTask = drainSaves();
  }
  function accept(next, selection = state.selected) {
    const valid = validateDocument(next);
    state.document = valid; state.selected = valid.decisions.some(d => d.id === selection) ? selection : valid.decisions[0]?.id || null;
    state.epoch++; importGeneration++; state.dirty = true; state.editor = null; state.confirmation = null; state.importPreview = null; state.snapshot = null;
    state.error = ''; state.notice = ''; scheduleSave(); render();
  }
  function command(value) { accept(applyCommand(state.document, value)); }
  function confirm(message, action) { state.confirmation = { message, action }; state.editor = null; render(); host.querySelector('#confirm-action')?.focus(); }
  function replaceWith(next, message) {
    const replace = () => { accept(next); state.notice = message; updateFeedback(); };
    if (state.document.decisions.length) confirm('Substituir o caderno desta sessão? Exporte um backup para preservar as comparações atuais.', replace);
    else replace();
  }
  function openEnvelope(envelope) {
    if (!alive) return;
    importGeneration++;
    state.document = validateDocument(envelope.document); state.selected = state.document.decisions[0]?.id || null;
    state.revision = envelope.revision; state.enabled = true; state.saveState = 'ready'; state.epoch++; state.dirty = false;
    state.confirmation = null; state.editor = null; state.importPreview = null; state.snapshot = null; state.notice = 'Caderno salvo aberto. As próximas alterações serão salvas neste navegador.';
    state.error = ''; render();
  }
  async function storageAction(mode) {
    if (!alive || state.storageBusy) return;
    state.storageBusy = true; const before = state.epoch; render();
    try {
      await saveTask;
      if (!alive) return;
      const envelope = await store.load();
      if (!alive) return;
      if (state.epoch !== before) throw new AppError('changed', 'A sessão mudou durante a leitura. Tente abrir o caderno salvo novamente.');
      if (envelope.document) {
        if (mode === 'enable' || state.document.decisions.length) confirm('Há um caderno salvo neste navegador. Abrir esse caderno substitui a sessão atual; exporte seu backup antes de continuar.', () => openEnvelope(envelope));
        else openEnvelope(envelope);
      } else if (mode === 'open') { state.notice = 'Ainda não há um caderno salvo neste navegador.'; updateFeedback(); }
      else { state.revision = envelope.revision; state.enabled = true; scheduleSave(); state.notice = 'Salvamento ativado para esta sessão.'; updateFeedback(); }
    } finally { state.storageBusy = false; render(); }
  }
  async function clearSaved() {
    if (!alive || state.storageBusy) return;
    state.storageBusy = true;
    try {
      await saveTask;
      if (!alive) return;
      if (!state.enabled) throw new AppError('storage', 'O salvamento está interrompido. Exporte a sessão e abra o caderno salvo para conferir a revisão atual.');
      state.enabled = false; pendingSave = null; state.saveState = 'off';
      const result = await store.clear(state.revision);
      state.revision = result.revision; state.confirmation = null;
      state.notice = 'O salvamento foi apagado. Sua sessão continua aberta e pode ser exportada.';
    } catch (error) { state.saveState = error.code === 'conflict' ? 'conflict' : 'error'; throw error; }
    finally { state.storageBusy = false; render(); }
  }
  function download(filename, text, type) {
    if (dependencies.download) return dependencies.download(filename, text, type);
    const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob);
    const anchor = h('a', { href: url, download: filename }); document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const backup = () => download('decisoes-abertas.json', serializeDocument(state.document), 'application/json;charset=utf-8');
  function exportMarkdown(decision = selected()) { if (decision) download('comparacao.md', exportDecisionMarkdown(decision), 'text/markdown;charset=utf-8'); }
  async function importFile(file) {
    if (!file) return;
    const generation = ++importGeneration;
    state.importPreview = null; state.error = ''; state.notice = ''; render();
    if (file.size > LIMITS.maxDocumentBytes) throw new AppError('document_limit', 'O arquivo excede 2 MiB. Escolha um backup menor.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { if (generation !== importGeneration) return; throw new AppError('encoding', 'O arquivo não contém texto UTF-8 válido. Escolha um backup JSON deste aplicativo.'); }
    if (generation !== importGeneration) return;
    state.importPreview = parseDocument(text); state.error = ''; state.notice = ''; render(); host.querySelector('#import-confirm')?.focus();
  }
  const fieldValue = (form, name) => form.querySelector(`[name="${name}"]`).value;
  function field(name, label, value = '', options = {}) {
    const multiline = options.multiline; const attrs = { name, id: 'field-' + name, ...options }; delete attrs.multiline;
    const input = h(multiline ? 'textarea' : options.select ? 'select' : 'input', attrs);
    if (options.select) { input.removeAttribute('select'); for (const [v, labelText] of options.select) input.append(h('option', { value: v }, labelText)); }
    input.value = value;
    return h('label', { class: 'field', for: 'field-' + name }, h('span', {}, label), input);
  }
  function editorPanel(decision) {
    const editor = state.editor; if (!editor) return null;
    const form = h('form', { class: 'editor', id: 'editor-form' });
    const add = (...items) => form.append(...items.filter(Boolean));
    let title, submit;
    if (editor.kind === 'decision') {
      title = decision ? 'Editar contexto' : 'Nova comparação';
      add(field('title', 'Título da comparação', decision?.title || '', { required: true, maxlength: 120, autofocus: true }));
      add(field('question', 'Pergunta ou contexto', decision?.question || '', { multiline: true, maxlength: 2000, rows: 3 }));
      submit = () => {
        const name = fieldValue(form, 'title');
        if (decision) command({ type: 'decision.update', decisionId: decision.id, title: name, question: fieldValue(form, 'question') });
        else { const id = nextId(); const doc = applyCommand(state.document, { type: 'decision.add', id, title: name }); accept(applyCommand(doc, { type: 'decision.update', decisionId: id, title: name, question: fieldValue(form, 'question') }), id); }
      };
    } else if (editor.kind === 'alternative') {
      const item = decision.alternatives.find(a => a.id === editor.id);
      title = item ? 'Editar alternativa' : 'Adicionar alternativa';
      add(field('name', 'Nome da alternativa', item?.name || '', { required: true, maxlength: 120, autofocus: true }), field('notes', 'Contexto da alternativa', item?.notes || '', { multiline: true, maxlength: 1000, rows: 3 }));
      submit = () => command({ type: item ? 'alternative.update' : 'alternative.add', decisionId: decision.id, ...(item ? { alternativeId: item.id } : { id: nextId() }), name: fieldValue(form, 'name'), notes: fieldValue(form, 'notes') });
      if (item) add(button('Remover alternativa', () => confirm('Remover esta alternativa da matriz atual? Os registros anteriores serão preservados.', () => command({ type: 'alternative.remove', decisionId: decision.id, alternativeId: item.id })), { class: 'text-button danger' }));
    } else if (editor.kind === 'criterion') {
      const item = decision.criteria.find(c => c.id === editor.id);
      title = item ? 'Editar critério' : 'Adicionar critério';
      add(field('name', 'Nome do critério', item?.name || '', { required: true, maxlength: 120, autofocus: true }), field('weight', 'Peso relativo (0 a 100)', item?.weight ?? 20, { type: 'number', required: true, min: 0, max: 100, step: 1 }), h('p', { class: 'help' }, 'Peso 0 desativa o critério. Os pesos não precisam somar 100.'), field('description', 'O que uma nota alta representa?', item?.description || '', { multiline: true, maxlength: 1000, rows: 3 }));
      submit = () => command({ type: item ? 'criterion.update' : 'criterion.add', decisionId: decision.id, ...(item ? { criterionId: item.id } : { id: nextId() }), name: fieldValue(form, 'name'), weight: Number(fieldValue(form, 'weight')), description: fieldValue(form, 'description') });
      if (item) add(button('Remover critério', () => confirm('Remover o critério e suas notas da matriz atual? Os registros anteriores serão preservados.', () => command({ type: 'criterion.remove', decisionId: decision.id, criterionId: item.id })), { class: 'text-button danger' }));
    } else if (editor.kind === 'rating') {
      const alternative = decision.alternatives.find(a => a.id === editor.alternativeId), criterion = decision.criteria.find(c => c.id === editor.criterionId);
      const rating = decision.ratings.find(r => r.alternativeId === alternative.id && r.criterionId === criterion.id);
      title = 'Observação da nota';
      add(h('p', { class: 'form-context' }, alternative.name, ' · ', criterion.name), field('note', 'Evidência ou justificativa', rating.note, { multiline: true, maxlength: 500, rows: 4, autofocus: true }));
      submit = () => command({ type: 'rating.set', decisionId: decision.id, alternativeId: alternative.id, criterionId: criterion.id, value: rating.value, note: fieldValue(form, 'note') });
    } else if (editor.kind === 'snapshot') {
      title = 'Criar registro da matriz';
      add(h('p', { class: 'help' }, 'Guarda uma cópia do contexto, critérios, notas e conclusão atuais. Alterações futuras não mudam esta cópia.'), field('label', 'Nome do registro', '', { required: true, maxlength: 120, autofocus: true }));
      submit = () => { command({ type: 'snapshot.add', decisionId: decision.id, id: nextId(), label: fieldValue(form, 'label'), createdAt: now() }); state.tab = 'history'; render(); };
    }
    form.prepend(h('h2', {}, title));
    form.append(h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Salvar'), button('Cancelar', () => { state.editor = null; render(); }, { class: 'secondary' })));
    form.addEventListener('submit', event => { event.preventDefault(); run(submit); });
    return form;
  }
  function edit(kind, details = {}) { if (kind === 'decision' && !selected()) state.tab = 'matrix'; state.editor = { kind, ...details }; state.confirmation = null; render(); host.querySelector('#editor-form [autofocus]')?.focus(); }
  function ratingControl(decision, alternative, criterion, readOnly) {
    const rating = decision.ratings.find(r => r.alternativeId === alternative.id && r.criterionId === criterion.id);
    if (readOnly) return h('div', { class: 'readonly-rating' }, h('strong', {}, rating.value === null ? '—' : rating.value), rating.note ? h('p', { class: 'cell-note-text' }, rating.note) : null);
    const selector = h('select', { class: 'rating-select', 'aria-label': `Nota de ${alternative.name} em ${criterion.name}`, 'data-focus': `rating-${alternative.id}-${criterion.id}` }, [['', '—'], ...[0, 1, 2, 3, 4, 5].map(n => [String(n), String(n)])].map(([value, text]) => h('option', { value }, text)));
    selector.value = rating.value === null ? '' : String(rating.value);
    selector.addEventListener('change', () => run(() => command({ type: 'rating.set', decisionId: decision.id, alternativeId: alternative.id, criterionId: criterion.id, value: selector.value === '' ? null : Number(selector.value), note: rating.note })));
    return h('div', { class: 'rating-cell', 'data-score': rating.value === null ? 'missing' : rating.value }, selector,
      button(rating.note ? 'Ver observação' : 'Observação', () => edit('rating', { alternativeId: alternative.id, criterionId: criterion.id }), { class: 'cell-note', 'aria-label': `Observação de ${alternative.name} em ${criterion.name}` }));
  }
  function scoreSummary(result, analysis) {
    if (!analysis.activeWeight) return h('div', { class: 'score-summary' }, h('strong', { class: 'score-value' }, '—'), h('span', {}, 'Sem peso ativo'));
    if (analysis.canRank) return h('div', { class: 'score-summary' }, h('strong', { class: 'score-value' }, percent(result.scorePermille)), h('span', {}, `${result.rank}º lugar${result.tied ? ' · empate' : ''}`));
    return h('div', { class: 'score-summary incomplete' }, h('strong', { class: 'score-value range' }, `${percent(result.minPermille)} a ${percent(result.maxPermille)}`), h('span', {}, result.missingCount ? `${result.missingCount} nota(s) a responder` : 'Aguardando as outras alternativas'));
  }
  function matrixView(decision, readOnly = false) {
    const analysis = analyzeDecision(decision);
    const table = h('table', { class: 'matrix-table', 'data-alternatives': decision.alternatives.length }, h('caption', { class: 'sr-only' }, 'Notas por alternativa e critério; 0 é a menor nota e 5 é a maior.'));
    const head = h('tr', {}, h('th', { scope: 'col', class: 'criteria-heading' }, h('strong', {}, 'Critérios'), h('span', {}, 'Notas de 0 a 5')));
    for (const [index, alternative] of decision.alternatives.entries()) head.append(h('th', { scope: 'col' }, readOnly ? h('strong', {}, alternative.name) : button(alternative.name, () => edit('alternative', { id: alternative.id }), { class: 'alternative-name' }), scoreSummary(analysis.alternatives[index], analysis)));
    table.append(h('thead', {}, head));
    const body = h('tbody');
    for (const criterion of decision.criteria) {
      const label = h('th', { scope: 'row', class: criterion.weight ? '' : 'inactive-criterion' },
        readOnly ? h('strong', {}, criterion.name) : button(criterion.name, () => edit('criterion', { id: criterion.id }), { class: 'criterion-name' }),
        h('span', { class: 'weight-label' }, criterion.weight ? `Peso ${criterion.weight} · ${percent(Math.round(1000 * criterion.weight / analysis.activeWeight))}` : 'Peso 0 · inativo'),
        criterion.description ? h('span', { class: 'criterion-description' }, criterion.description) : null);
      body.append(h('tr', {}, label, decision.alternatives.map(alternative => h('td', { class: criterion.weight ? '' : 'inactive-cell' }, ratingControl(decision, alternative, criterion, readOnly)))));
    }
    table.append(body);
    const mobile = h('div', { class: 'mobile-matrix' });
    for (const [index, alternative] of decision.alternatives.entries()) mobile.append(h('section', { class: 'alternative-sheet' }, h('div', { class: 'mobile-alternative-heading' }, readOnly ? h('h3', {}, alternative.name) : button(alternative.name, () => edit('alternative', { id: alternative.id }), { class: 'alternative-name' }), scoreSummary(analysis.alternatives[index], analysis)),
      decision.criteria.map(criterion => h('div', { class: 'mobile-rating-row' }, h('div', {}, readOnly ? h('strong', {}, criterion.name) : button(criterion.name, () => edit('criterion', { id: criterion.id }), { class: 'criterion-name' }), h('span', { class: 'weight-label' }, `Peso ${criterion.weight}${criterion.weight ? '' : ' · inativo'}`), criterion.description ? h('span', { class: 'criterion-description' }, criterion.description) : null), ratingControl(decision, alternative, criterion, readOnly)))));
    return h('section', { class: 'matrix-surface' }, h('div', { class: 'section-heading' }, h('h2', {}, readOnly ? 'Matriz registrada' : 'Sua matriz de comparação'), !readOnly ? button('+ Alternativa', () => edit('alternative'), { class: 'secondary compact', disabled: decision.alternatives.length >= LIMITS.maxAlternatives }) : null),
      h('p', { class: 'matrix-explainer' }, 'Escala: 0 é a menor nota e 5 é a maior. ', !analysis.canRank ? (analysis.activeWeight ? 'Preencha todas as notas ativas para comparar posições. Os intervalos mostram a pontuação possível.' : 'Adicione critérios com peso maior que zero para iniciar o cálculo.') : 'Todas as notas ativas estão preenchidas. Os resultados refletem os critérios e pesos informados.'),
      decision.alternatives.length && decision.criteria.length ? [h('div', { class: 'table-viewport', tabindex: 0, 'aria-label': 'Tabela de comparação, rolável quando necessário' }, table), mobile] : h('div', { class: 'matrix-empty' }, h('h3', {}, 'Monte a estrutura da sua comparação'), h('p', {}, 'Adicione alternativas e critérios. Depois, dê notas de 0 a 5; deixe em branco quando ainda não souber.'), !readOnly ? h('div', { class: 'button-row' }, button('Adicionar alternativa', () => edit('alternative'), { class: 'primary' }), button('Adicionar critério', () => edit('criterion'), { class: 'secondary' })) : null),
      !readOnly && decision.alternatives.length && decision.criteria.length ? h('div', { class: 'matrix-bottom' }, button('+ Critério', () => edit('criterion'), { class: 'text-button', disabled: decision.criteria.length >= LIMITS.maxCriteria }), h('span', {}, `${analysis.activeCriteria} critérios ativos · peso total ${analysis.activeWeight}`)) : null);
  }
  function analysisView(decision) {
    const analysis = analyzeDecision(decision);
    const form = h('form', { class: 'conclusion-form' }, h('h2', {}, 'Sua conclusão'), h('p', { class: 'help' }, 'A escolha é sua e pode diferir da pontuação. Registre também as informações que a matriz não representa.'),
      field('choice', 'Alternativa escolhida', decision.choice.alternativeId || '', { select: [['', 'Ainda não escolhi'], ...decision.alternatives.map(a => [a.id, a.name])] }),
      field('reason', 'Justificativa e próximos passos', decision.choice.reason, { multiline: true, maxlength: 4000, rows: 7 }), h('button', { type: 'submit', class: 'primary' }, 'Salvar conclusão'));
    form.addEventListener('submit', event => { event.preventDefault(); run(() => { command({ type: 'choice.set', decisionId: decision.id, alternativeId: fieldValue(form, 'choice') || null, reason: fieldValue(form, 'reason') }); state.notice = 'Conclusão salva na sessão. Crie um registro para guardar uma cópia desta versão.'; updateFeedback(); }); });
    return h('div', { class: 'analysis-layout' }, h('section', { class: 'analysis-surface' }, h('h2', {}, 'Como o resultado é calculado'), h('p', {}, 'Somamos nota × peso para cada critério ativo. A pontuação máxima é 5 × peso total; a porcentagem usa essa mesma base para todas as alternativas.'),
      h('p', { class: 'formula' }, `Máximo possível: 5 × ${analysis.activeWeight} = ${5 * analysis.activeWeight} pontos`),
      analysis.alternatives.map(result => h('section', { class: 'contribution' }, h('div', { class: 'result-heading' }, h('h3', {}, result.name), scoreSummary(result, analysis)),
        result.contributions.map(part => { const criterion = decision.criteria.find(c => c.id === part.criterionId); return h('div', { class: 'contribution-row' }, h('span', {}, criterion.name, !part.active ? ' (inativo)' : ''), h('span', {}, part.value === null ? 'Não respondido' : `${part.value} × ${part.weight} = ${part.points}`)); }),
        h('p', { class: 'contribution-total' }, `${result.points} pontos observados de ${result.maxPoints} possíveis · cobertura ${percent(result.coveragePermille)}`))),
      !decision.alternatives.length ? h('p', {}, 'Adicione alternativas na Matriz para ver os cálculos.') : null), h('section', { class: 'conclusion-surface' }, form, button('Criar registro desta versão', () => edit('snapshot'), { class: 'secondary', disabled: decision.snapshots.length >= LIMITS.maxSnapshots })));
  }
  function historyView(decision) {
    const snapshot = decision.snapshots.find(s => s.id === state.snapshot);
    return h('section', { class: 'history-surface' }, h('div', { class: 'section-heading' }, h('h2', {}, 'Versões que você registrou'), button('Criar registro', () => edit('snapshot'), { class: 'primary', disabled: decision.snapshots.length >= LIMITS.maxSnapshots })), h('p', { class: 'help' }, 'Cada registro guarda uma cópia completa da matriz e da conclusão. É um histórico local editável pelo proprietário do backup, sem assinatura digital.'),
      !decision.snapshots.length ? h('div', { class: 'plain-empty' }, h('h3', {}, 'Ainda não há registros'), h('p', {}, 'Quando quiser preservar o raciocínio desta versão, crie um registro. Você pode continuar editando a matriz depois.')) : decision.snapshots.map(item => h('article', { class: 'history-row' }, h('div', {}, h('h3', {}, item.label), h('p', { class: 'help' }, dateText(item.createdAt), ' · horário local')), h('div', { class: 'button-row' }, button(state.snapshot === item.id ? 'Fechar registro' : 'Ver registro', () => { state.snapshot = state.snapshot === item.id ? null : item.id; render(); }, { class: 'secondary compact' }), button('Markdown', () => exportMarkdown({ id: item.id, ...item.matrix, snapshots: [] }), { class: 'text-button' }), button('Remover', () => confirm('Remover este registro histórico? Esta operação não altera a matriz atual.', () => command({ type: 'snapshot.remove', decisionId: decision.id, snapshotId: item.id })), { class: 'text-button danger' })))),
      snapshot ? h('section', { class: 'snapshot-view' }, h('h2', {}, snapshot.label), h('p', { class: 'help' }, 'Cópia registrada · ', dateText(snapshot.createdAt)), h('h3', {}, snapshot.matrix.title), h('p', {}, snapshot.matrix.question), matrixView(snapshot.matrix, true), h('h3', {}, 'Conclusão registrada'), h('p', {}, snapshot.matrix.alternatives.find(a => a.id === snapshot.matrix.choice.alternativeId)?.name || 'Ainda sem alternativa escolhida'), h('p', { class: 'long-text' }, snapshot.matrix.choice.reason || 'Sem justificativa registrada.')) : null);
  }
  function filesView(decision) {
    const preview = state.importPreview;
    return h('section', { class: 'files-layout' }, h('div', { class: 'file-section' }, h('h2', {}, 'Leve seu caderno com você'), h('p', {}, 'O backup JSON preserva todas as comparações, notas, conclusões e registros. Você pode abri-lo novamente aqui, inclusive em outro navegador.'), button('Baixar backup JSON', backup, { class: 'primary' }), h('h3', {}, 'Compartilhar esta comparação'), h('p', { class: 'help' }, 'Markdown reúne contexto e cálculo. CSV contém as notas da matriz; textos com início de fórmula recebem apóstrofo. Esses relatórios não substituem o backup.'), h('div', { class: 'button-row' }, button('Exportar Markdown', () => exportMarkdown(), { class: 'secondary', disabled: !decision }), button('Exportar notas CSV', () => { if (decision) download('matriz-comparativa.csv', exportDecisionCsv(decision), 'text/csv;charset=utf-8'); }, { class: 'secondary', disabled: !decision }))),
      h('div', { class: 'file-section' }, h('h2', {}, 'Abrir um backup'), h('p', {}, 'Escolha um arquivo JSON de até 2 MiB. Você verá as contagens antes de substituir a sessão. Arquivos inválidos não alteram seu caderno.'), h('label', { class: 'field', for: 'backup-file' }, h('span', {}, 'Arquivo JSON'), h('input', { id: 'backup-file', type: 'file', accept: '.json,application/json', onchange: event => run(() => importFile(event.target.files[0])) })),
        preview ? h('div', { class: 'import-preview' }, h('h3', {}, 'Backup validado'), h('p', {}, `${preview.decisions.length} comparação(ões) · ${preview.decisions.reduce((n, d) => n + d.alternatives.length, 0)} alternativas · ${preview.decisions.reduce((n, d) => n + d.snapshots.length, 0)} registros`), h('p', { class: 'help' }, 'A confirmação substitui o caderno da sessão inteira. Se o salvamento estiver ativo, a substituição também será salva.'), h('div', { class: 'button-row' }, button('Substituir pelo backup', () => { accept(preview); state.notice = 'Backup aberto integralmente.'; updateFeedback(); }, { class: 'primary', id: 'import-confirm' }), button('Cancelar importação', () => { importGeneration++; state.importPreview = null; render(); }, { class: 'secondary' }))) : null),
      h('div', { class: 'file-section storage-section' }, h('h2', {}, 'Salvar neste navegador'), h('p', {}, 'O salvamento é opcional e pertence a esta origem e perfil do navegador. Na próxima visita, use Abrir salvo. Não há conta nem sincronização entre dispositivos.'), h('div', { class: 'button-row' }, button(state.enabled ? 'Salvamento ativo' : 'Ativar salvamento', () => storageAction('enable'), { class: 'secondary', 'data-storage-action': 'enable', disabled: state.enabled || state.storageBusy }), button('Abrir salvo', () => storageAction('open'), { class: 'secondary', 'data-storage-action': 'open', disabled: state.storageBusy }), button('Desativar e apagar salvamento', () => confirm('Apagar o caderno salvo deste navegador? A sessão atual continuará em memória; faça um backup antes de fechar a página.', clearSaved), { class: 'text-button danger', 'data-storage-action': 'clear', disabled: !state.enabled || state.storageBusy })), h('p', { class: 'help' }, 'Se outra aba mudar a revisão, o aplicativo interrompe as gravações e conserva esta sessão para backup.')));
  }
  function emptyView() {
    return h('section', { class: 'welcome' }, h('div', { class: 'welcome-copy' }, h('h1', {}, 'Dê forma à sua próxima escolha.'), h('p', {}, 'Compare alternativas com critérios que fazem sentido para você. Veja o que pesa no resultado e guarde o raciocínio, além da resposta.'), h('div', { class: 'button-row' }, button('Criar comparação', () => { state.selected = null; edit('decision'); }, { class: 'primary' }), button('Explorar exemplo fictício', () => replaceWith(createExampleDocument(), 'Exemplo fictício aberto. Nenhuma informação real foi consultada.'), { class: 'secondary' })), h('p', { class: 'help' }, 'Comece sem conta. Os dados ficam nesta sessão até você escolher salvar ou exportar.')),
      h('div', { class: 'welcome-method' }, h('h2', {}, 'Uma decisão, com contexto'), h('ol', {}, h('li', {}, h('strong', {}, 'Coloque as opções lado a lado'), h('span', {}, 'Defina alternativas e o que importa na comparação.')), h('li', {}, h('strong', {}, 'Dê peso aos seus critérios'), h('span', {}, 'Preencha notas de 0 a 5 e identifique o que ainda falta.')), h('li', {}, h('strong', {}, 'Registre o porquê'), h('span', {}, 'A pontuação informa. A conclusão continua sendo sua.')))));
  }
  function render() {
    if (!alive) return;
    const focused = document.activeElement?.getAttribute('data-focus');
    const focusWasWithin = host.contains(document.activeElement);
    const decision = selected();
    const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Comparações' }, h('div', { class: 'sidebar-heading' }, h('h2', {}, 'Meu caderno'), h('span', { class: 'count' }, state.document.decisions.length)), button('+ Nova comparação', () => { state.selected = null; edit('decision'); }, { class: 'secondary new-comparison', disabled: state.document.decisions.length >= LIMITS.maxDecisions }),
      h('nav', { class: 'decision-list', 'aria-label': 'Escolher comparação' }, state.document.decisions.map(item => button(item.title, () => { state.selected = item.id; state.editor = null; state.snapshot = null; state.confirmation = null; state.importPreview = null; render(); }, { class: 'decision-link', 'aria-current': item.id === state.selected ? 'page' : null }))),
      h('div', { class: 'sidebar-tools' }, button('Backup e salvamento', () => { state.tab = 'files'; state.editor = null; render(); }, { class: 'text-button' }), button('Abrir salvo', () => storageAction('open'), { class: 'text-button', disabled: state.storageBusy }), h('p', { class: 'session-note' }, 'Seu caderno é local. Exporte um backup para levar a outro dispositivo.')));
    const main = h('main', { id: 'workspace', class: 'workspace', tabindex: -1 }, h('div', { class: 'context-bar' }, h('span', { id: 'storage-status', class: 'storage-state', role: 'status' }), decision ? button('Backup JSON', backup, { class: 'text-button' }) : null), h('div', { id: 'feedback' }));
    if (decision) main.append(h('div', { class: 'workspace-heading' }, h('div', {}, h('h1', {}, decision.title), h('p', { class: 'question' }, decision.question || 'Edite o contexto para registrar a pergunta desta comparação.')), button('Editar contexto', () => edit('decision'), { class: 'secondary compact' })));
    if (decision || state.tab === 'files') main.append(h('nav', { class: 'tabs', 'aria-label': 'Áreas da comparação' }, TABS.map(([key, label]) => button(label, () => { state.tab = key; state.editor = null; state.confirmation = null; render(); }, { class: 'tab', 'aria-current': state.tab === key ? 'page' : null, disabled: !decision && key !== 'files' }))));
    if (state.confirmation) main.append(h('section', { class: 'confirmation', role: 'alertdialog', 'aria-labelledby': 'confirm-title' }, h('h2', { id: 'confirm-title' }, 'Confirme para continuar'), h('p', {}, state.confirmation.message), h('div', { class: 'button-row' }, button('Confirmar', state.confirmation.action, { id: 'confirm-action', class: 'primary' }), button('Cancelar', () => { state.confirmation = null; render(); }, { class: 'secondary' }))));
    const editor = editorPanel(decision); if (editor) main.append(editor);
    if (state.tab === 'files') main.append(filesView(decision));
    else if (!decision) { if (!editor) main.append(emptyView()); }
    else if (state.tab === 'matrix') main.append(matrixView(decision));
    else if (state.tab === 'analysis') main.append(analysisView(decision));
    else if (state.tab === 'history') main.append(historyView(decision));
    if (decision) main.append(h('div', { class: 'workspace-end' }, h('p', {}, 'Notas e pesos são informados por você. O aplicativo não pesquisa nem recomenda alternativas.'), button('Remover comparação', () => confirm('Remover esta comparação e todos os seus registros deste caderno? Exporte um backup para preservá-los.', () => command({ type: 'decision.remove', decisionId: decision.id })), { class: 'text-button danger' })));
    host.replaceChildren(h('div', { class: 'app-shell' }, sidebar, main)); updateFeedback();
    let restored = false;
    if (focused) for (const input of host.querySelectorAll('[data-focus]')) if (input.getAttribute('data-focus') === focused && input.offsetParent !== null) { input.focus(); restored = true; break; }
    if (!restored && focusWasWithin) {
      const target = host.querySelector('#editor-form h2') || host.querySelector('.snapshot-view h2') || host.querySelector('main h1') || host.querySelector('main');
      if (target) { target.setAttribute('tabindex', '-1'); target.focus(); }
    }
  }
  render();
  return { getDocument: () => validateDocument(state.document), flush: () => saveTask, importFile,
    destroy: () => { alive = false; importGeneration++; pendingSave = null; state.enabled = false; store.close(); host.replaceChildren(); } };
}

if (globalThis.document?.querySelector('#app')) mountApp(globalThis.document.querySelector('#app'));
