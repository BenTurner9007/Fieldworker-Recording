// Sharing: sign-in, and two-way sync between this phone and the Supabase database.
//
// How it works:
//   - Every edit is saved on the phone first (so it works with no signal) and
//     marked "dirty".
//   - When there's a connection, dirty items are uploaded, then anything other
//     people changed since the last sync is downloaded.
//   - If two people edit the same record, the most recent edit wins.
//   - Photos upload to private storage; other phones download them only when
//     someone opens that record (saves mobile data).
import { db, session } from './db.js';

const CFG = window.FIELDWORKER_CONFIG || {};
const BUCKET = 'fieldwork-photos';
const PAGE = 1000;
const OVERLAP_MS = 2 * 60 * 1000; // re-check the last 2 minutes each pull, in case of slow commits

export const cloud = {
  enabled: !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase),
  client: null,
  user: null,     // { email }
  member: null,   // row from fw_team: { email, name, initials, role }
};

export const status = { state: 'idle', pending: 0, last: null, error: '' };

const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem('fw-sync:' + k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('fw-sync:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function setStatus(state, error = '') {
  status.state = state;
  status.error = error;
  if (state === 'ok') status.last = new Date().toISOString();
  emit('fw:status', status);
}

async function refreshPending() {
  status.pending = await db.pendingCount();
  emit('fw:status', status);
}

// ---------- sign-in ----------

export async function initCloud() {
  if (!cloud.enabled) {
    session.sharing = false;
    return;
  }
  session.sharing = true;
  cloud.client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  let user = null;
  try {
    const { data } = await cloud.client.auth.getSession();
    user = data.session?.user || null;
  } catch { /* offline: fall back to the remembered user below */ }
  // Offline with an expired token: keep working locally; sync resumes once back online.
  if (!user) user = store.get('user');
  setUser(user);

  cloud.client.auth.onAuthStateChange((event, s) => {
    if (s?.user) setUser(s.user);
    else if (event === 'SIGNED_OUT') setUser(null);
  });

  if (cloud.user) {
    loadMember();
    startAutoSync();
  }
  refreshPending();
}

function setUser(user) {
  cloud.user = user ? { email: user.email } : null;
  session.email = cloud.user?.email || '';
  store.set('user', cloud.user);
  cloud.member = cloud.user ? store.get('member') : null;
}

async function loadMember() {
  if (!navigator.onLine) return;
  const { data } = await cloud.client.from('fw_team').select('*').ilike('email', cloud.user.email).maybeSingle();
  cloud.member = data || null;
  store.set('member', cloud.member);
  emit('fw:member', cloud.member);
}

export async function signIn(email, password) {
  const { data, error } = await cloud.client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  setUser(data.user);
  await loadMember();
  if (!cloud.member) {
    await cloud.client.auth.signOut();
    setUser(null);
    throw new Error('Signed in, but this email isn’t on the team list yet. Ask an admin to add you.');
  }
  startAutoSync();
  syncNow();
}

export async function signOut() {
  await cloud.client.auth.signOut().catch(() => {});
  setUser(null);
  store.set('member', null);
  stopAutoSync();
}

export async function changePassword(password) {
  const { error } = await cloud.client.auth.updateUser({ password });
  if (error) throw error;
}

// ---------- team (admins) ----------

export async function listTeam() {
  const { data, error } = await cloud.client.from('fw_team').select('*').order('name');
  if (error) throw error;
  return data;
}
export async function saveMember(m) {
  const { error } = await cloud.client.from('fw_team').upsert({ ...m, email: m.email.toLowerCase().trim() });
  if (error) throw error;
}
export async function removeMember(email) {
  const { error } = await cloud.client.from('fw_team').delete().eq('email', email);
  if (error) throw error;
}

// ---------- row mapping ----------

const strip = (x) => {
  const { dirty, blob, uploaded, ...rest } = x;
  return rest;
};

const iso = (t) => (t ? new Date(t).toISOString() : new Date().toISOString());

const toRow = {
  projects: (p) => ({
    id: p.id, site_code: p.siteCode || '', name: p.name || '', data: strip(p),
    deleted: !!p.deleted, updated_at: iso(p.updated), updated_by: p.updatedBy || session.email,
  }),
  records: (r) => {
    const loc = r.location || {};
    return {
      id: r.id, project_id: r.projectId, type: r.type, number: String(r.number), data: strip(r),
      latitude: loc.lat ?? null, longitude: loc.lon ?? null, easting: loc.easting ?? null, northing: loc.northing ?? null,
      deleted: !!r.deleted, updated_at: iso(r.updated), updated_by: r.updatedBy || session.email,
    };
  },
  files: (f) => ({
    id: f.id, record_id: f.recordId, project_id: f.projectId, path: f.path, name: f.name || '', mime: f.mime || '',
    deleted: !!f.deleted, updated_at: iso(f.updated), updated_by: f.updatedBy || session.email,
  }),
};

const fromRow = {
  projects: (row) => ({ ...row.data, id: row.id, deleted: false, dirty: false, updated: row.updated_at }),
  records: (row) => ({
    ...row.data, id: row.id, projectId: row.project_id, type: row.type,
    number: /^\d+$/.test(row.number) ? Number(row.number) : row.number,
    deleted: false, dirty: false, updated: row.updated_at,
  }),
  files: (row, local) => ({
    id: row.id, recordId: row.record_id, projectId: row.project_id, path: row.path, name: row.name, mime: row.mime,
    blob: local?.blob || null, uploaded: true, deleted: false, dirty: false, updated: row.updated_at,
  }),
};

const TABLE = { projects: 'fw_projects', records: 'fw_records', files: 'fw_files' };

// ---------- sync ----------

let running = null;
let again = false;

/** Upload local changes and download everyone else's. Safe to call any time. */
export function syncNow() {
  if (!cloud.enabled || !cloud.user) return Promise.resolve();
  if (running) { again = true; return running; }
  running = doSync().finally(() => {
    running = null;
    if (again) { again = false; syncNow(); }
  });
  return running;
}

let timer = null;
/** Sync shortly after an edit (batches several quick saves together). */
export function syncSoon(ms = 1500) {
  refreshPending();
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

async function doSync() {
  if (!navigator.onLine) { await refreshPending(); return setStatus('offline'); }
  setStatus('syncing');
  try {
    await push();
    const changed = await pull();
    setStatus('ok');
    if (changed) emit('fw:changed', { changed });
  } catch (err) {
    console.error('Sync failed', err);
    const msg = err?.message || String(err);
    setStatus(/fetch|network/i.test(msg) ? 'offline' : 'error', msg);
  }
  await refreshPending();
}

/** Mark an item clean, unless it was edited again while uploading. */
async function markClean(storeName, sent, extra = {}) {
  const cur = await db.get(storeName, sent.id);
  if (!cur || cur.updated !== sent.updated) return;
  if (cur.deleted) return db.delete(storeName, cur.id); // the database has the deletion now
  await db.put(storeName, { ...cur, ...extra, dirty: false });
}

async function push() {
  const sb = cloud.client;
  for (const s of ['projects', 'records']) {
    const dirty = (await db.all(s)).filter((x) => x.dirty);
    for (let i = 0; i < dirty.length; i += 200) {
      const chunk = dirty.slice(i, i + 200);
      const { error } = await sb.from(TABLE[s]).upsert(chunk.map(toRow[s]));
      if (error) throw error;
      for (const x of chunk) await markClean(s, x);
    }
  }

  for (const f of (await db.all('files')).filter((x) => x.dirty)) {
    if (!f.projectId) f.projectId = (await db.get('records', f.recordId))?.projectId;
    const ext = (f.mime || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const path = f.path || `${f.projectId}/${f.recordId}/${f.id}.${ext}`;
    if (f.deleted) {
      await sb.storage.from(BUCKET).remove([path]);
    } else if (!f.uploaded) {
      if (!f.blob) continue;
      const { error } = await sb.storage.from(BUCKET).upload(path, f.blob, { upsert: true, contentType: f.mime || 'image/jpeg' });
      if (error) throw error;
    }
    const { error } = await sb.from('fw_files').upsert(toRow.files({ ...f, path }));
    if (error) throw error;
    await markClean('files', f, { path, uploaded: true });
  }
}

async function pull() {
  const sb = cloud.client;
  let changed = 0;
  for (const s of ['projects', 'records', 'files']) {
    const cursor = store.get(`cursor:${s}`);
    const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
    let latest = cursor;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(TABLE[s]).select('*')
        .gt('synced_at', since).order('synced_at').range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data) {
        if (await apply(s, row)) changed++;
        if (!latest || Date.parse(row.synced_at) > Date.parse(latest)) latest = row.synced_at;
      }
      if (data.length < PAGE) break;
    }
    store.set(`cursor:${s}`, latest);
  }
  return changed;
}

/** Bring one database row into the phone's copy. Returns true if anything changed. */
async function apply(s, row) {
  const local = await db.get(s, row.id);
  // Edited here more recently and not uploaded yet: keep ours, it'll upload next time.
  if (local?.dirty && Date.parse(local.updated) > Date.parse(row.updated_at)) return false;
  // Already have exactly this version.
  if (local && !local.dirty && local.updated && Date.parse(local.updated) === Date.parse(row.updated_at)) return false;

  if (row.deleted) {
    if (!local) return false;
    if (s === 'records') await db.forgetRecord(row.id);
    else await db.delete(s, row.id);
    return true;
  }
  await db.put(s, fromRow[s](row, local));
  return true;
}

/** Fetch a photo that another phone uploaded (and keep it for offline use). */
export async function downloadFile(f) {
  if (f.blob || !f.path || !cloud.client || !navigator.onLine) return f.blob || null;
  const { data, error } = await cloud.client.storage.from(BUCKET).download(f.path);
  if (error) return null;
  const cur = await db.get('files', f.id);
  if (cur) await db.put('files', { ...cur, blob: data });
  return data;
}

// ---------- automatic syncing ----------

let interval = null;
let channel = null;

function startAutoSync() {
  if (interval) return;
  syncNow();
  interval = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60_000);
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', onVisible);
  // Live updates: when someone else saves, pull it straight away.
  channel = cloud.client.channel('fieldwork');
  for (const t of Object.values(TABLE)) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => syncSoon(800));
  }
  channel.subscribe();
}

function stopAutoSync() {
  clearInterval(interval);
  interval = null;
  window.removeEventListener('online', syncNow);
  document.removeEventListener('visibilitychange', onVisible);
  if (channel) cloud.client.removeChannel(channel);
  channel = null;
}

function onVisible() {
  if (document.visibilityState === 'visible') syncNow();
}
