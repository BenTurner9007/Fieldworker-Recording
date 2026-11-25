// Tiny IndexedDB wrapper. The phone's own copy of the data — everything works
// offline against this, and sync.js copies changes to and from the shared database.
//
// Stores:
//   projects  { id, siteCode, name, ... }
//   records   { id, projectId, type, number, ... }   type = context|find|sample|photo|drawing
//   files     { id, recordId, projectId, blob, name, mime, path }   photo images
//
// Bookkeeping fields on every item:
//   updated    when it was last edited (ISO time)
//   updatedBy  who edited it (email, when signed in)
//   dirty      true = changed on this phone and not yet uploaded
//   deleted    true = deleted, waiting to tell the database (when sharing is on)

const DB_NAME = 'fieldworker-recording';
const DB_VERSION = 1;

/** Set by the app: who's signed in, and whether deletes need to be synced. */
export const session = { email: '', sharing: false };

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

const live = (x) => x && !x.deleted;

export const db = {
  // ----- raw access (used by sync) -----
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

  // ----- app-level helpers (skip deleted items, mark edits for upload) -----

  /** Save a user edit: stamps time and user, and queues it for upload. */
  async save(storeName, value) {
    value.updated = new Date().toISOString();
    value.dirty = true;
    if (session.email) {
      value.updatedBy = session.email;
      value.createdBy ||= session.email;
    }
    return this.put(storeName, value);
  },
  async projects() {
    return (await this.all('projects')).filter(live);
  },
  async records(projectId, type) {
    const list = type
      ? await this.byIndex('records', 'projectType', [projectId, type])
      : await this.byIndex('records', 'projectId', projectId);
    return list.filter(live).sort((a, b) => numericSort(a.number, b.number));
  },
  async filesFor(recordId) {
    return (await this.byIndex('files', 'recordId', recordId)).filter(live);
  },
  async removeFile(id) {
    const f = await this.get('files', id);
    if (!f) return;
    if (session.sharing) await this.save('files', { ...f, deleted: true, blob: null });
    else await this.delete('files', id);
  },
  async deleteRecord(id) {
    for (const f of await this.filesFor(id)) await this.removeFile(f.id);
    const r = await this.get('records', id);
    if (!r) return;
    if (session.sharing) await this.save('records', { ...r, deleted: true });
    else await this.delete('records', id);
  },
  async deleteProject(projectId) {
    for (const r of await this.records(projectId)) await this.deleteRecord(r.id);
    const p = await this.get('projects', projectId);
    if (session.sharing) await this.save('projects', { ...p, deleted: true });
    else await this.delete('projects', projectId);
  },
  /** Remove from this phone only (used when the database says something was deleted). */
  async forgetRecord(id) {
    for (const f of await this.byIndex('files', 'recordId', id)) await this.delete('files', f.id);
    await this.delete('records', id);
  },
  async pendingCount() {
    let n = 0;
    for (const s of ['projects', 'records', 'files']) n += (await this.all(s)).filter((x) => x.dirty).length;
    return n;
  },
};

export function numericSort(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
}
