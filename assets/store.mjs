/*
 * Transaction lifecycle adapted from Caderno de Revisões/Garantia Aberta.
 * Copyright (c) 2026 Contribuidores da LOFRANO TECNOLOGIA
 * SPDX-License-Identifier: MIT
 * See LICENSE and THIRD_PARTY_NOTICES.md in this repository.
 */
import { validateDocument } from './domain.mjs';

const MESSAGES = Object.freeze({
  conflict: 'O caderno salvo mudou em outra conexão. Abra a versão salva antes de tentar novamente.',
  unavailable: 'O salvamento neste navegador não está disponível.',
  storage: 'Não foi possível concluir a operação no salvamento local.',
  corrupt: 'O caderno salvo não passou pela validação. Nenhum dado foi sobrescrito.',
  revision_limit: 'O contador de revisões do salvamento local está esgotado.',
});

export class StorageError extends Error {
  constructor(code = 'storage') {
    const safe = Object.hasOwn(MESSAGES, code) ? code : 'storage';
    super(MESSAGES[safe]);
    this.name = 'StorageError';
    this.code = safe;
  }
}

function safeError(error, fallback = 'storage') {
  if (error instanceof StorageError) return error;
  if (error?.name === 'SecurityError' || error?.name === 'NotSupportedError') return new StorageError('unavailable');
  return new StorageError(fallback);
}

function checkRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new StorageError('storage');
}

function readEnvelope(value) {
  if (value === undefined) return { revision: 0, document: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'revision')
      || !Object.hasOwn(value, 'document') || !Number.isSafeInteger(value.revision)
      || value.revision < 1) throw new StorageError('corrupt');
  try {
    return { revision: value.revision,
      document: value.document === null ? null : validateDocument(value.document) };
  } catch {
    throw new StorageError('corrupt');
  }
}

/** No database is opened until an explicit load/save/clear operation. */
export function createStore(options = {}) {
  let indexedDB;
  let name;
  let suppliedFactory;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new StorageError('storage');
    suppliedFactory = Object.hasOwn(options, 'indexedDB');
    indexedDB = suppliedFactory ? options.indexedDB : undefined;
    name = Object.hasOwn(options, 'name') ? options.name : 'decisoes-abertas-v1';
  } catch (error) { throw safeError(error); }
  let state = 'idle';
  let connection = null;
  let opening = null;

  function ensureAvailable() {
    if (state === 'closed' || state === 'changed') throw new StorageError('storage');
    if (!suppliedFactory) {
      // Some browser privacy modes throw even when reading the global getter.
      try { indexedDB = globalThis.indexedDB; suppliedFactory = true; }
      catch { throw new StorageError('unavailable'); }
    }
    if (!indexedDB || typeof indexedDB.open !== 'function') throw new StorageError('unavailable');
    if (typeof name !== 'string' || !name.trim()) throw new StorageError('storage');
  }

  function open() {
    ensureAvailable();
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(safeError(error));
      };
      try {
        request = indexedDB.open(name, 1);
        request.onupgradeneeded = (event) => {
          try {
            if (settled || state === 'closed') { request.transaction.abort(); return; }
            // A new database starts at version0. Do not migrate foreign state.
            if (event.oldVersion > 0 && !request.result.objectStoreNames.contains('workspaces')) {
              fail(new StorageError('corrupt'));
              request.transaction.abort();
              return;
            }
            if (!request.result.objectStoreNames.contains('workspaces')) request.result.createObjectStore('workspaces');
          } catch (error) {
            fail(error);
            try { request.transaction.abort(); } catch { /* Already inactive. */ }
          }
        };
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new StorageError('storage'));
        request.onsuccess = () => {
          const db = request.result;
          if (settled || state === 'closed') { db.close(); fail(new StorageError('storage')); return; }
          if (!db.objectStoreNames.contains('workspaces')) {
            db.close(); fail(new StorageError('corrupt')); return;
          }
          state = 'open';
          connection = db;
          db.onversionchange = () => { state = 'changed'; db.close(); connection = null; };
          db.onclose = () => { if (state === 'open') state = 'changed'; connection = null; };
          settled = true;
          resolve(db);
        };
      } catch (error) { fail(error); }
    });
    return opening;
  }

  async function transact(mode, modify) {
    const db = await open();
    ensureAvailable();
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let failure;
      try {
        transaction = db.transaction('workspaces', mode);
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(failure || new StorageError('storage'));
        transaction.onerror = (event) => { failure ||= safeError(event.target?.error || transaction.error); };
        const store = transaction.objectStore('workspaces');
        const request = store.get('default');
        request.onerror = () => { failure = safeError(request.error); };
        request.onsuccess = () => {
          try {
            const current = readEnvelope(request.result);
            result = modify ? modify(current, store) : current;
          } catch (error) {
            failure = safeError(error);
            try { transaction.abort(); } catch { reject(failure); }
          }
        };
      } catch (error) {
        failure = safeError(error);
        if (transaction) {
          try { transaction.abort(); } catch { reject(failure); }
        } else reject(failure);
      }
    });
  }

  function write(document, expectedRevision) {
    return transact('readwrite', (current, store) => {
      if (current.revision !== expectedRevision) throw new StorageError('conflict');
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new StorageError('revision_limit');
      const next = { revision: current.revision + 1, document };
      store.put(next, 'default');
      return next;
    });
  }

  return Object.freeze({
    async load() { return transact('readonly'); },
    async save(document, expectedRevision) {
      ensureAvailable();
      checkRevision(expectedRevision);
      let validated;
      try { validated = validateDocument(document); } catch { throw new StorageError('storage'); }
      // Validation and detached copy finish before open() yields to the caller.
      return write(validated, expectedRevision);
    },
    async clear(expectedRevision) {
      ensureAvailable();
      checkRevision(expectedRevision);
      return write(null, expectedRevision);
    },
    close() {
      if (state === 'closed') return;
      state = 'closed';
      if (connection) connection.close();
      connection = null;
    },
  });
}
