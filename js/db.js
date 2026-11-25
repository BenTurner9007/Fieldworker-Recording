// Tiny IndexedDB wrapper. All data stays on the device until exported.
//
// Stores:
//   projects  { id, siteCode, name, ... }
//   records   { id, projectId, type, number, ... }   type = context|find|sample|photo|drawing
//   files     { id, recordId, blob, name, mime }      photo images

const DB_NAME = 'fieldworker-recording';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
        s.createIndex('projectType', ['projectId', 'type']);
      }
      if (!db.objectStoreNames.contains('files')) {
        const s = db.createObjectStore('files', { keyPath: 'id' });
        s.createIndex('recordId', 'recordId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export const db = {
  async get(storeName, id) {
    return wrap((await store(storeName)).get(id));
  },
  async all(storeName) {
    return wrap((await store(storeName)).getAll());
  },
  async put(storeName, value) {
    await wrap((await store(storeName, 'readwrite')).put(value));
    return value;
  },
  async delete(storeName, id) {
    return wrap((await store(storeName, 'readwrite')).delete(id));
  },
  async byIndex(storeName, index, key) {
    return wrap((await store(storeName)).index(index).getAll(key));
  },

  // Convenience helpers
  async records(projectId, type) {
    const list = type
      ? await this.byIndex('records', 'projectType', [projectId, type])
      : await this.byIndex('records', 'projectId', projectId);
    return list.sort((a, b) => numericSort(a.number, b.number));
  },
  async filesFor(recordId) {
    return this.byIndex('files', 'recordId', recordId);
  },
  async deleteRecord(id) {
    for (const f of await this.filesFor(id)) await this.delete('files', f.id);
    await this.delete('records', id);
  },
  async deleteProject(projectId) {
    for (const r of await this.records(projectId)) await this.deleteRecord(r.id);
    await this.delete('projects', projectId);
  },
};

export function numericSort(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
}
