const DATABASE_NAME = 'yes-pusher-world';
const DATABASE_VERSION = 1;
const STORE_NAME = 'confirmed-world';
const SNAPSHOT_KEY = 'latest';
const FALLBACK_KEY = 'yes-pusher:confirmed-world:v1';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open world database'));
  });
}

async function useStore(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('World storage request failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('World storage transaction aborted'));
    });
  } finally {
    database.close();
  }
}

function saveFallback(snapshot) {
  globalThis.localStorage?.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
}

function loadFallback() {
  try {
    const value = globalThis.localStorage?.getItem(FALLBACK_KEY);
    if (!value) return null;
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function saveConfirmedWorld(snapshot) {
  let fallbackSaved = false;
  try {
    // Write the synchronous fallback first so page-hide/reload events still
    // preserve the latest confirmed machine even if IndexedDB cannot finish.
    saveFallback(snapshot);
    fallbackSaved = true;
  } catch {
    fallbackSaved = false;
  }

  try {
    await useStore('readwrite', (store) => store.put(snapshot, SNAPSHOT_KEY));
    return true;
  } catch {
    return fallbackSaved;
  }
}

export async function loadConfirmedWorld() {
  try {
    const snapshot = await useStore('readonly', (store) => store.get(SNAPSHOT_KEY));
    return snapshot ?? loadFallback();
  } catch {
    return loadFallback();
  }
}

export async function clearConfirmedWorld() {
  try {
    await useStore('readwrite', (store) => store.delete(SNAPSHOT_KEY));
  } catch {
    // The localStorage fallback is still cleared below.
  }
  try {
    globalThis.localStorage?.removeItem(FALLBACK_KEY);
  } catch {
    // Storage may be unavailable in private or restricted browser modes.
  }
}
