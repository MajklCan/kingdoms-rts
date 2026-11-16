/**
 * IndexedDB backend for the autosave slot (a save can outgrow what
 * localStorage comfortably holds next to the manual slots). Returns null
 * when the browser has no IndexedDB; a store that exists but is blocked
 * (private mode, denied storage) rejects, which AutosaveStore treats as
 * "no save".
 */

import type { AutosaveBackend } from './autosave-store';

const DB_NAME = 'kingdoms';
const DB_VERSION = 1;
const STORE = 'autosave';

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema must not be blocked by this one.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

export function createIdbBackend(): AutosaveBackend | null {
  let factory: IDBFactory | undefined;
  try {
    factory = globalThis.indexedDB;
  } catch {
    return null; // Access itself can throw when storage is denied.
  }
  if (!factory) return null;
  const idb = factory;
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
      dbPromise = openDb(idb);
      // A failed open is retried on the next call instead of cached forever.
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  };

  const transact = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | undefined> => {
    const database = await db();
    return new Promise<T | undefined>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = database.transaction(STORE, mode);
      } catch (err) {
        dbPromise = null; // Connection closed (version change); reopen next time.
        reject(err);
        return;
      }
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  };

  return {
    get: (key) => transact('readonly', (store) => store.get(key)),
    setAll: async (entries) => {
      await transact('readwrite', (store) => {
        for (const [key, value] of entries) store.put(value, key);
        return null;
      });
    },
    deleteAll: async (keys) => {
      await transact('readwrite', (store) => {
        for (const key of keys) store.delete(key);
        return null;
      });
    },
  };
}
