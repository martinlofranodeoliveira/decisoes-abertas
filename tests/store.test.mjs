import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocument } from '../assets/domain.mjs';
import { createExampleDocument } from '../assets/formats.mjs';
import { createStore, StorageError } from '../assets/store.mjs';

const NAME = 'decisions-test';

function opened(t, indexedDB = new IDBFactory(), name = NAME) {
  const store = createStore({ indexedDB, name });
  t.after(() => store.close());
  return store;
}

function openRaw(indexedDB, name = NAME, version) {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function rawTransaction(indexedDB, mode, callback, name = NAME) {
  const db = await openRaw(indexedDB, name);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspaces', mode);
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error);
      callback(transaction.objectStore('workspaces'), (value) => { result = value; });
    });
  } finally { db.close(); }
}

function rawPut(indexedDB, value, key = 'default') {
  return rawTransaction(indexedDB, 'readwrite', (store) => store.put(value, key));
}

function allRecords(indexedDB) {
  return rawTransaction(indexedDB, 'readonly', (store, done) => {
    store.getAll().onsuccess = (event) => done(event.target.result);
  });
}

function instrumentFactory(indexedDB, instrument) {
  return { open(...args) {
    const request = indexedDB.open(...args);
    request.addEventListener('success', () => instrument(request.result));
    return request;
  } };
}

test('constructing an adapter is lazy and loading an absent workspace writes no record', async (t) => {
  const indexedDB = new IDBFactory();
  let calls = 0;
  const factory = { open(...args) { calls += 1; return indexedDB.open(...args); } };
  const store = opened(t, factory);
  assert.equal(calls, 0);
  assert.deepEqual(await indexedDB.databases(), []);
  assert.deepEqual(await store.load(), { revision: 0, document: null });
  assert.deepEqual(await store.load(), { revision: 0, document: null });
  assert.equal(calls, 1);
  assert.deepEqual(await allRecords(indexedDB), []);
});

test('the default application database name and version are explicit', async (t) => {
  const indexedDB = new IDBFactory();
  const store = createStore({ indexedDB }); t.after(() => store.close());
  await store.load();
  assert.deepEqual(await indexedDB.databases(), [{ name: 'decisoes-abertas-v1', version: 1 }]);
});

test('save detaches inputs before yielding and returns detached committed records', async (t) => {
  const indexedDB = new IDBFactory();
  const store = opened(t, indexedDB);
  const document = createExampleDocument();
  const original = structuredClone(document);
  const saving = store.save(document, 0);
  document.decisions[0].title = 'Changed by caller before commit';
  document.decisions[0].snapshots.length = 0;
  const saved = await saving;
  assert.deepEqual(saved, { revision: 1, document: original });
  saved.document.decisions[0].ratings.length = 0;
  assert.deepEqual(await store.load(), { revision: 1, document: original });
  const loaded = await store.load(); loaded.document.decisions[0].alternatives[0].name = 'Changed load';
  assert.deepEqual(await store.load(), { revision: 1, document: original });
  store.close();
  assert.deepEqual(await opened(t, indexedDB).load(), { revision: 1, document: original });
});

test('independent connections saving one revision have exactly one committed winner', async (t) => {
  const indexedDB = new IDBFactory();
  const first = opened(t, indexedDB); const second = opened(t, indexedDB);
  const outcomes = await Promise.allSettled([
    first.save(createDocument(), 0), second.save(createExampleDocument(), 0),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const failure = outcomes.find((outcome) => outcome.status === 'rejected').reason;
  assert.ok(failure instanceof StorageError); assert.equal(failure.code, 'conflict');
  const winner = outcomes.find((outcome) => outcome.status === 'fulfilled').value;
  assert.deepEqual(await first.load(), winner); assert.deepEqual(await second.load(), winner);
});

test('stale clears cannot erase a later save', async (t) => {
  const indexedDB = new IDBFactory();
  const first = opened(t, indexedDB); const second = opened(t, indexedDB);
  const saved = await first.save(createExampleDocument(), 0);
  await assert.rejects(second.clear(0), { code: 'conflict' });
  assert.deepEqual(await second.load(), saved);
});

test('save and clear compete under the same transactional compare-and-swap', async (t) => {
  const indexedDB = new IDBFactory();
  const first = opened(t, indexedDB); const second = opened(t, indexedDB);
  await first.save(createDocument(), 0);
  const outcomes = await Promise.allSettled([first.save(createExampleDocument(), 1), second.clear(1)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((outcome) => outcome.status === 'rejected').reason.code, 'conflict');
  assert.deepEqual(await first.load(), outcomes.find((outcome) => outcome.status === 'fulfilled').value);
});

test('tombstones survive reopen and prevent stale revision ABA', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.save(createDocument(), 0);
  assert.deepEqual(await store.clear(1), { revision: 2, document: null });
  store.close();
  const again = opened(t, indexedDB);
  assert.deepEqual(await again.load(), { revision: 2, document: null });
  await assert.rejects(again.save(createDocument(), 0), { code: 'conflict' });
  assert.equal((await again.save(createExampleDocument(), 2)).revision, 3);
  assert.deepEqual(await again.clear(3), { revision: 4, document: null });
  assert.deepEqual(await again.clear(4), { revision: 5, document: null });
  assert.deepEqual(await allRecords(indexedDB), [{ revision: 5, document: null }]);
});

test('clearing a previously absent document still increments and retains a revision', async (t) => {
  const store = opened(t);
  assert.deepEqual(await store.clear(0), { revision: 1, document: null });
  await assert.rejects(store.save(createDocument(), 0), { code: 'conflict' });
});

test('clearing affects only the application key and leaves other databases intact', async (t) => {
  const indexedDB = new IDBFactory();
  const own = opened(t, indexedDB); const other = opened(t, indexedDB, 'another-test-app');
  const value = await other.save(createExampleDocument(), 0);
  await own.save(createDocument(), 0);
  await rawPut(indexedDB, 'unrelated value', 'unrelated-key');
  await own.clear(1);
  assert.deepEqual(await other.load(), value);
  assert.deepEqual(await allRecords(indexedDB), [{ revision: 2, document: null }, 'unrelated value']);
});

test('invalid caller data and revisions are rejected before opening a database', async (t) => {
  let openedCount = 0;
  const store = opened(t, { open() { openedCount += 1; throw new Error('should not open'); } });
  const invalid = createExampleDocument(); invalid.decisions[0].title = 'private-test-marker';
  invalid.decisions[0].ratings[0].value = 88;
  await assert.rejects(store.save(invalid, 0), (error) => error instanceof StorageError
    && error.code === 'storage' && !String(error).includes('private-test-marker') && !Object.hasOwn(error, 'cause'));
  for (const revision of [-1, 0.5, NaN, Infinity, '0', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.save(createDocument(), revision), { code: 'storage' });
    await assert.rejects(store.clear(revision), { code: 'storage' });
  }
  assert.equal(openedCount, 0);
});

test('corrupt persisted documents are rejected by load, save and clear without writes', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.save(createExampleDocument(), 0);
  const invalid = createExampleDocument(); invalid.decisions[0].title = 'private-test-marker';
  invalid.decisions[0].ratings[0].criterionId = 'missing';
  await rawPut(indexedDB, { revision: 1, document: invalid });
  const before = await allRecords(indexedDB);
  for (const operation of [() => store.load(), () => store.save(createDocument(), 1), () => store.clear(1)]) {
    await assert.rejects(operation(), (error) => error instanceof StorageError
      && error.code === 'corrupt' && !String(error).includes('private-test-marker') && !Object.hasOwn(error, 'cause'));
  }
  assert.deepEqual(await allRecords(indexedDB), before);
});

test('corrupt envelopes never become absence or permission to reset the revision', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.load();
  for (const invalid of [null, [], { revision: 0, document: null },
    { revision: -1, document: null }, { revision: 1.5, document: null },
    { revision: '1', document: null }, { revision: 1, document: [] },
    { revision: 1, document: null, extra: true }, { revision: 1 }, { document: null }]) {
    await rawPut(indexedDB, invalid);
    await assert.rejects(store.load(), { code: 'corrupt' });
    await assert.rejects(store.clear(0), { code: 'corrupt' });
  }
});

test('an exhausted stored revision cannot wrap around or be overwritten', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.load();
  const last = { revision: Number.MAX_SAFE_INTEGER, document: null };
  await rawPut(indexedDB, last);
  await assert.rejects(store.save(createDocument(), Number.MAX_SAFE_INTEGER), { code: 'revision_limit' });
  await assert.rejects(store.clear(Number.MAX_SAFE_INTEGER), { code: 'revision_limit' });
  assert.deepEqual(await store.load(), last);
});

test('request success followed by write transaction abort never reports a committed save', async (t) => {
  const indexedDB = new IDBFactory(); let abortNext = false; let putSucceeded = false;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (args[1] !== 'readwrite' || !abortNext) return transaction;
      abortNext = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name); const put = store.put.bind(store);
        store.put = (...putArgs) => {
          const request = put(...putArgs);
          request.addEventListener('success', () => { putSucceeded = true; transaction.abort(); });
          return request;
        };
        return store;
      };
      return transaction;
    };
  });
  const store = opened(t, factory); const original = await store.save(createDocument(), 0);
  abortNext = true;
  await assert.rejects(store.save(createExampleDocument(), 1), { code: 'storage' });
  assert.equal(putSucceeded, true); assert.deepEqual(await store.load(), original);
});

test('a read transaction aborted after its request succeeds never returns a document', async (t) => {
  const indexedDB = new IDBFactory(); let abortNext = false; let readSucceeded = false;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (args[1] !== 'readonly' || !abortNext) return transaction;
      abortNext = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name); const get = store.get.bind(store);
        store.get = (...getArgs) => {
          const request = get(...getArgs);
          request.addEventListener('success', () => { readSucceeded = true; transaction.abort(); });
          return request;
        };
        return store;
      };
      return transaction;
    };
  });
  const store = opened(t, factory); const saved = await store.save(createExampleDocument(), 0);
  abortNext = true;
  await assert.rejects(store.load(), { code: 'storage' });
  assert.equal(readSucceeded, true); assert.deepEqual(await store.load(), saved);
});

test('quota errors preserve the previous data and do not expose native messages', async (t) => {
  const indexedDB = new IDBFactory(); let failNext = false;
  const factory = instrumentFactory(indexedDB, (db) => {
    const transact = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = transact(...args);
      if (args[1] !== 'readwrite' || !failNext) return transaction;
      failNext = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name);
        store.put = () => { throw new DOMException('private-test-marker', 'QuotaExceededError'); };
        return store;
      };
      return transaction;
    };
  });
  const store = opened(t, factory); const saved = await store.save(createDocument(), 0);
  failNext = true;
  await assert.rejects(store.save(createExampleDocument(), 1), (error) => error instanceof StorageError
    && error.code === 'storage' && !String(error).includes('private-test-marker') && !Object.hasOwn(error, 'cause'));
  assert.deepEqual(await store.load(), saved);
});

test('a version change closes stale adapters without reopening a downgraded database', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  await store.save(createDocument(), 0);
  const upgraded = await openRaw(indexedDB, NAME, 2); t.after(() => upgraded.close());
  await assert.rejects(store.load(), { code: 'storage' });
  await assert.rejects(store.save(createDocument(), 1), { code: 'storage' });
  await assert.rejects(store.clear(1), { code: 'storage' });
  await assert.rejects(opened(t, indexedDB).load(), { code: 'storage' });
});

test('unavailable, closed and failed opens have sanitized explicit errors', async (t) => {
  const missing = opened(t, null);
  await assert.rejects(missing.load(), { code: 'unavailable' });
  const denied = opened(t, { open() { throw new DOMException('private-test-marker', 'SecurityError'); } });
  await assert.rejects(denied.load(), (error) => error.code === 'unavailable'
    && !String(error).includes('private-test-marker') && !Object.hasOwn(error, 'cause'));
  for (const name of ['', null, 99]) await assert.rejects(opened(t, new IDBFactory(), name).load(), { code: 'storage' });
  const closed = opened(t); closed.close(); closed.close();
  await assert.rejects(closed.load(), { code: 'storage' });
  await assert.rejects(closed.save(createDocument(), 0), { code: 'storage' });
  await assert.rejects(closed.clear(0), { code: 'storage' });
});

test('a throwing global IndexedDB getter stays lazy and never exposes native messages', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let reads = 0;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true,
    get() { reads += 1; throw new DOMException('private-test-marker', 'SecurityError'); } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete globalThis.indexedDB;
  });
  const store = createStore(); t.after(() => store.close());
  assert.equal(reads, 0);
  await assert.rejects(store.load(), (error) => error instanceof StorageError
    && error.code === 'unavailable' && !String(error).includes('private-test-marker')
    && !Object.hasOwn(error, 'cause'));
  assert.equal(reads, 1);
});

test('foreign database schema is not migrated or overwritten', async (t) => {
  const indexedDB = new IDBFactory();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('foreign');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  await assert.rejects(opened(t, indexedDB).load(), { code: 'corrupt' });
  const db = await openRaw(indexedDB); t.after(() => db.close());
  assert.deepEqual([...db.objectStoreNames], ['foreign']); assert.equal(db.version, 1);
});

test('closing while an opening request is pending does not leak a live connection', async (t) => {
  const indexedDB = new IDBFactory(); const store = opened(t, indexedDB);
  const pending = store.load(); store.close();
  await assert.rejects(pending, { code: 'storage' });
  // If the abandoned adapter kept a connection, this independent upgrade blocks.
  const db = await openRaw(indexedDB, NAME, 2); t.after(() => db.close());
  assert.equal(db.version, 2);
});
