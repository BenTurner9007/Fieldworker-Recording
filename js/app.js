import { db, uid } from './db.js';
import { TYPES, PROJECT_FIELDS, RELATIONSHIPS, RECIPROCAL } from './schema.js';
import { wgs84ToBNG, toGridRef } from './osgb.js';
import { registerCSV, projectGeoJSON, projectBackup, importBackup, download } from './export.js';
import { checkMatrix } from './matrix.js';

const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $back = document.getElementById('back');

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => new Date().toISOString().slice(0, 10);
const pref = {
  get: (k, d = '') => { try { return localStorage.getItem('fr:' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('fr:' + k, v); } catch { /* ignore */ } },
};

function toast(msg, kind = 'ok') {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function setHeader(title, backHref) {
  $title.textContent = title;
  document.title = title === 'Fieldworker' ? 'Fieldworker Recording' : `${title} · Fieldworker`;
  $back.hidden = !backHref;
  $back.onclick = () => (location.hash = backHref);
}

function fieldHTML(f, value) {
  const id = `f-${f.key}`;
  const req = f.required ? ' required' : '';
  const hint = f.hint ? ` placeholder="${esc(f.hint)}"` : '';
  let input;
  switch (f.type) {
    case 'textarea':
      input = `<textarea id="${id}" name="${f.key}" rows="3"${hint}${req}>${esc(value)}</textarea>`;
      break;
    case 'select':
      input = `<select id="${id}" name="${f.key}"${req}><option value=""></option>${f.options
        .map((o) => `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`)
        .join('')}</select>`;
      break;
    case 'checkbox':
      return `<label class="field check${f.wide ? ' wide' : ''}"><input type="checkbox" id="${id}" name="${f.key}"${value ? ' checked' : ''}> ${esc(f.label)}</label>`;
    case 'number':
      input = `<input id="${id}" name="${f.key}" type="number" step="any" inputmode="decimal" value="${esc(value)}"${hint}${req}>`;
      break;
    case 'contextRef':
      input = `<input id="${id}" name="${f.key}" type="text" inputmode="numeric" list="context-list" value="${esc(value)}"${hint}${req}>`;
      break;
    default:
      input = `<input id="${id}" name="${f.key}" type="${f.type}" value="${esc(value)}"${hint}${req}>`;
  }
  return `<div class="field${f.wide ? ' wide' : ''}" data-key="${f.key}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}</div>`;
}

// Look inputs up by name (form.elements["length"] would return the element count!)
const field = (form, name) => form.querySelector(`[name="${name}"]`);

function readForm(form, fields, target) {
  for (const f of fields) {
    const el = field(form, f.key);
    if (!el) continue;
    if (f.type === 'checkbox') target[f.key] = el.checked;
    else if (f.type === 'number') target[f.key] = el.value === '' ? '' : Number(el.value);
    else target[f.key] = el.value.trim();
  }
  return target;
}

async function nextNumber(projectId, type) {
  const list = await db.records(projectId, type);
  const nums = list.map((r) => parseInt(r.number, 10)).filter((n) => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : TYPES[type].startNumber;
}

// ---------- views ----------

async function viewProjects() {
  setHeader('Fieldworker');
  const projects = (await db.all('projects')).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  $app.innerHTML = `
    <section class="stack">
      <div class="row">
        <a class="btn primary" href="#/project/new">+ New project</a>
        <label class="btn">Import backup<input type="file" accept=".json,application/json" id="import" hidden></label>
      </div>
      ${projects.length ? '' : `<div class="empty">
        <h2>No projects yet</h2>
        <p>Create a project for each site. Everything is stored on this device and works offline — export a backup regularly.</p>
      </div>`}
      <ul class="cards">
        ${projects.map((p) => `
          <li><a class="card" href="#/p/${p.id}">
            <strong>${esc(p.siteCode)}</strong> <span>${esc(p.name)}</span>
            <small>${esc([p.projectType, p.client].filter(Boolean).join(' · '))}</small>
          </a></li>`).join('')}
      </ul>
    </section>`;
  document.getElementById('import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const p = await importBackup(await file.text());
      if (p) { toast(`Imported ${p.siteCode}`); location.hash = `#/p/${p.id}`; }
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

async function viewProjectEdit(id) {
  const project = id === 'new' ? { id: uid(), startDate: today() } : await db.get('projects', id);
  if (!project) return notFound();
  const isNew = id === 'new';
  setHeader(isNew ? 'New project' : `Edit ${project.siteCode}`, isNew ? '#/' : `#/p/${id}`);
  $app.innerHTML = `
    <form class="form" id="form">
      <div class="grid">${PROJECT_FIELDS.map((f) => fieldHTML(f, project[f.key])).join('')}</div>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" id="del">Delete project</button>'}
        <button class="btn primary">Save project</button>
      </div>
    </form>`;
  const form = document.getElementById('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    readForm(form, PROJECT_FIELDS, project);
    project.updated = new Date().toISOString();
    await db.put('projects', project);
    toast('Project saved');
    location.hash = `#/p/${project.id}`;
  };
  const del = document.getElementById('del');
  if (del) del.onclick = async () => {
    const typed = prompt(`This deletes ${project.siteCode} and ALL its records and photos from this device.\n\nType the site code to confirm:`);
    if (typed !== project.siteCode) return;
    await db.deleteProject(project.id);
    toast('Project deleted');
    location.hash = '#/';
  };
}

async function viewProject(pid, tab) {
  const project = await db.get('projects', pid);
  if (!project) return notFound();
  tab = TYPES[tab] || tab === 'export' || tab === 'matrix' ? tab : pref.get('tab', 'context');
  pref.set('tab', tab);
  setHeader(project.siteCode, '#/');

  const all = await db.records(pid);
  const counts = Object.fromEntries(Object.keys(TYPES).map((t) => [t, all.filter((r) => r.type === t).length]));

  const tabs = [
    ...Object.entries(TYPES).map(([t, d]) => [t, `${d.plural} <span class="count">${counts[t]}</span>`]),
    ['matrix', 'Matrix'],
    ['export', 'Export'],
  ];

  $app.innerHTML = `
    <div class="project-head">
      <div><strong>${esc(project.name)}</strong><small>${esc([project.ngr, project.projectType].filter(Boolean).join(' · '))}</small></div>
      <a class="btn small" href="#/project/${pid}">Edit</a>
    </div>
    <nav class="tabs">${tabs.map(([t, l]) => `<a href="#/p/${pid}/${t}" class="${t === tab ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <section id="tab"></section>`;

  const $tab = document.getElementById('tab');
  if (tab === 'export') return renderExport($tab, project, counts);
  if (tab === 'matrix') return renderMatrix($tab, project, all.filter((r) => r.type === 'context'));
  renderList($tab, project, tab, all.filter((r) => r.type === tab));
}

function renderList($el, project, type, records) {
  const def = TYPES[type];
  $el.innerHTML = `
    <div class="row">
      <a class="btn primary" href="#/p/${project.id}/${type}/new">+ New ${def.label.toLowerCase()}</a>
      <input type="search" id="q" placeholder="Search ${def.plural.toLowerCase()}…" aria-label="Search">
    </div>
    ${records.length ? '' : `<div class="empty"><p>No ${def.plural.toLowerCase()} recorded yet.</p></div>`}
    <ul class="list" id="list">
      ${records.map((r) => `
        <li data-search="${esc(JSON.stringify(r).toLowerCase())}">
          <a href="#/p/${project.id}/${type}/${r.id}">
            <span class="num">${esc(def.prefix + r.number)}</span>
            <span class="sum">${esc(def.summary(r) || '—')}</span>
            ${r.location ? '<span class="pin" title="Has location">●</span>' : ''}
          </a>
        </li>`).join('')}
    </ul>`;
  document.getElementById('q').oninput = (e) => {
    const q = e.target.value.toLowerCase().trim();
    for (const li of document.querySelectorAll('#list li')) li.hidden = q && !li.dataset.search.includes(q);
  };
}

function renderExport($el, project, counts) {
  const safe = project.siteCode.replace(/[^\w-]+/g, '_');
  $el.innerHTML = `
    <div class="stack">
      <div class="panel">
        <h3>Registers (CSV)</h3>
        <p>Opens in Excel, or join to features in QGIS / ArcGIS Pro.</p>
        <div class="row wrap">${Object.entries(TYPES).map(([t, d]) =>
          `<button class="btn" data-csv="${t}" ${counts[t] ? '' : 'disabled'}>${d.plural} (${counts[t]})</button>`).join('')}</div>
      </div>
      <div class="panel">
        <h3>GIS points (GeoJSON)</h3>
        <p>Every record with a GPS location, as points in WGS84. Drag straight into QGIS or ArcGIS Pro. British National Grid eastings and northings are included as attributes.</p>
        <button class="btn" id="geojson">Download GeoJSON</button>
      </div>
      <div class="panel">
        <h3>Backup</h3>
        <p>A single file containing the whole project, including photos. Use it to move a project between devices or to archive it. <strong>Back up at the end of every day.</strong></p>
        <div class="row wrap">
          <button class="btn primary" id="backup">Full backup</button>
          <button class="btn" id="backup-lite">Backup without photos</button>
        </div>
      </div>
    </div>`;
  $el.querySelectorAll('[data-csv]').forEach((b) => (b.onclick = async () => {
    const t = b.dataset.csv;
    download(`${safe}_${TYPES[t].plural.toLowerCase()}.csv`, '﻿' + (await registerCSV(project, t)), 'text/csv');
  }));
  document.getElementById('geojson').onclick = async () =>
    download(`${safe}_points.geojson`, await projectGeoJSON(project), 'application/geo+json');
  const backup = async (includePhotos) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    download(`${safe}_backup_${stamp}.json`, await projectBackup(project, { includePhotos }), 'application/json');
    pref.set(`backup:${project.id}`, new Date().toISOString());
  };
  document.getElementById('backup').onclick = () => backup(true);
  document.getElementById('backup-lite').onclick = () => backup(false);
}

function renderMatrix($el, project, contexts) {
  const { missing, cycles, levels, isolated } = checkMatrix(contexts);
  const link = (n) => {
    const c = contexts.find((x) => String(x.number) === n);
    return c ? `<a class="ctx" href="#/p/${project.id}/context/${c.id}">${esc(n)}</a>` : `<span class="ctx missing">${esc(n)}</span>`;
  };
  $el.innerHTML = `
    <div class="stack">
      ${cycles.length ? `<div class="panel bad"><h3>Stratigraphic loops (${cycles.length})</h3>
        <p>These contexts are recorded as both earlier and later than each other. Check the relationships.</p>
        <ul>${cycles.map((c) => `<li>${c.map(link).join(' → ')}</li>`).join('')}</ul></div>` : ''}
      ${missing.length ? `<div class="panel warn"><h3>Referenced but not recorded (${missing.length})</h3>
        <p>${missing.map(link).join(' ')}</p></div>` : ''}
      ${isolated.length ? `<div class="panel"><h3>No relationships yet (${isolated.length})</h3>
        <p>${isolated.map(link).join(' ')}</p></div>` : ''}
      ${!cycles.length && !missing.length && contexts.length ? '<div class="panel good"><h3>No problems found</h3></div>' : ''}
      ${levels.length ? `<div class="panel"><h3>Sequence (latest at top)</h3>
        <p class="muted">A rough phasing by stratigraphic depth — a quick sense-check, not a finished Harris matrix.</p>
        <ol class="levels">${levels.map((l) => `<li>${l.map(link).join('')}</li>`).join('')}</ol></div>` : ''}
      ${contexts.length ? '' : '<div class="empty"><p>Record some contexts with relationships to see the sequence.</p></div>'}
    </div>`;
}

async function viewRecord(pid, type, rid) {
  const project = await db.get('projects', pid);
  const def = TYPES[type];
  if (!project || !def) return notFound();
  const isNew = rid === 'new';
  const record = isNew
    ? { id: uid(), projectId: pid, type, number: await nextNumber(pid, type), recorder: pref.get('recorder'), date: today(), relationships: [] }
    : await db.get('records', rid);
  if (!record) return notFound();
  const original = isNew ? null : structuredClone(record);

  setHeader(`${isNew ? 'New ' : ''}${def.label} ${def.prefix}${record.number}`, `#/p/${pid}/${type}`);

  const contexts = await db.records(pid, 'context');
  const pendingImages = []; // images added before save
  const removedImages = [];
  const existingImages = isNew ? [] : await db.filesFor(record.id);

  $app.innerHTML = `
    <datalist id="context-list">${contexts.map((c) => `<option value="${esc(c.number)}">${esc(TYPES.context.summary(c))}</option>`).join('')}</datalist>
    <form class="form" id="form" novalidate>
      <div class="grid">
        <div class="field"><label for="f-number">${def.label} number *</label>
          <input id="f-number" name="number" type="text" inputmode="numeric" value="${esc(record.number)}" required></div>
        ${def.fields.map((f) => fieldHTML(f, record[f.key])).join('')}
      </div>

      ${type === 'context' ? `
        <fieldset class="panel"><legend>Stratigraphic relationships</legend>
          <ul class="rels" id="rels"></ul>
          <div class="row">
            <select id="rel-type" aria-label="Relationship">${Object.entries(RELATIONSHIPS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
            <input id="rel-target" type="text" inputmode="numeric" list="context-list" placeholder="Context no." aria-label="Context number">
            <button type="button" class="btn" id="rel-add">Add</button>
          </div>
          <p class="muted">The matching relationship is added to the other context automatically when you save.</p>
        </fieldset>` : ''}

      ${def.hasImages ? `
        <fieldset class="panel"><legend>Images</legend>
          <div class="thumbs" id="thumbs"></div>
          <label class="btn">📷 Take / add photo<input type="file" accept="image/*" capture="environment" id="img" multiple hidden></label>
        </fieldset>` : ''}

      ${def.location ? `
        <fieldset class="panel"><legend>Location</legend>
          <div id="loc"></div>
          <div class="row wrap">
            <button type="button" class="btn" id="gps">📍 Capture GPS</button>
            <button type="button" class="btn" id="gps-clear" hidden>Clear</button>
          </div>
        </fieldset>` : ''}

      <div class="actions sticky">
        ${isNew ? '' : '<button type="button" class="btn danger" id="del">Delete</button>'}
        <button type="button" class="btn" id="save-new">Save &amp; new</button>
        <button class="btn primary">Save</button>
      </div>
    </form>`;

  const form = document.getElementById('form');

  // Show/hide fields depending on other values (e.g. context type)
  const applyShowIf = () => {
    const current = readForm(form, def.fields, { ...record });
    for (const f of def.fields) {
      if (!f.showIf) continue;
      const el = form.querySelector(`[data-key="${f.key}"]`);
      if (el) el.hidden = !f.showIf(current);
    }
  };
  form.addEventListener('change', applyShowIf);
  applyShowIf();

  // Relationships
  if (type === 'context') {
    const $rels = document.getElementById('rels');
    const draw = () => {
      $rels.innerHTML = record.relationships.length
        ? record.relationships.map((r, i) => `<li>${esc(RELATIONSHIPS[r.rel])} <strong>${esc(r.target)}</strong>
            <button type="button" class="x" data-i="${i}" aria-label="Remove">✕</button></li>`).join('')
        : '<li class="muted">None yet</li>';
      $rels.querySelectorAll('.x').forEach((b) => (b.onclick = () => { record.relationships.splice(+b.dataset.i, 1); draw(); }));
    };
    draw();
    const add = () => {
      const rel = document.getElementById('rel-type').value;
      const $t = document.getElementById('rel-target');
      const target = $t.value.trim();
      if (!target) return;
      if (target === String(field(form, "number").value).trim()) return toast('A context can’t relate to itself', 'err');
      if (!record.relationships.some((r) => r.rel === rel && r.target === target)) record.relationships.push({ rel, target });
      $t.value = '';
      $t.focus();
      draw();
    };
    document.getElementById('rel-add').onclick = add;
    document.getElementById('rel-target').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  }

  // Images
  if (def.hasImages) {
    const $thumbs = document.getElementById('thumbs');
    const drawThumbs = () => {
      const items = [...existingImages.filter((f) => !removedImages.includes(f.id)), ...pendingImages];
      $thumbs.innerHTML = '';
      for (const f of items) {
        const fig = document.createElement('figure');
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f.blob);
        img.alt = f.name;
        img.onclick = () => window.open(img.src, '_blank');
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'x';
        x.textContent = '✕';
        x.setAttribute('aria-label', 'Remove image');
        x.onclick = () => {
          const i = pendingImages.indexOf(f);
          if (i >= 0) pendingImages.splice(i, 1);
          else removedImages.push(f.id);
          drawThumbs();
        };
        fig.append(img, x);
        $thumbs.append(fig);
      }
    };
    drawThumbs();
    document.getElementById('img').onchange = async (e) => {
      for (const file of e.target.files) {
        pendingImages.push({ id: uid(), recordId: record.id, name: file.name, mime: file.type, blob: await shrink(file) });
      }
      e.target.value = '';
      drawThumbs();
    };
  }

  // Location
  if (def.location) {
    const $loc = document.getElementById('loc');
    const $clear = document.getElementById('gps-clear');
    const drawLoc = () => {
      const l = record.location;
      $clear.hidden = !l;
      $loc.innerHTML = l
        ? `<dl class="loc">
            <dt>Grid ref</dt><dd><strong>${esc(l.gridRef)}</strong></dd>
            <dt>E / N</dt><dd>${l.easting.toFixed(1)} / ${l.northing.toFixed(1)}</dd>
            <dt>Lat / Lon</dt><dd>${l.lat.toFixed(6)}, ${l.lon.toFixed(6)}</dd>
            <dt>Accuracy</dt><dd class="${l.accuracy > 10 ? 'warn-text' : ''}">± ${Math.round(l.accuracy)} m</dd>
          </dl>`
        : '<p class="muted">No location captured. Phone GPS is typically ±3–10 m — fine for finding things again, not for survey.</p>';
    };
    drawLoc();
    document.getElementById('gps').onclick = (e) => captureGPS(e.target, (loc) => { record.location = loc; drawLoc(); });
    $clear.onclick = () => { delete record.location; drawLoc(); };
  }

  // Save
  const save = async () => {
    const number = String(field(form, "number").value).trim();
    if (!number) { toast('Number is required', 'err'); field(form, "number").focus(); return false; }
    for (const f of def.fields) {
      const el = field(form, f.key);
      const hidden = el && el.closest('.field')?.hidden;
      if (f.required && el && !hidden && !el.value.trim()) {
        toast(`${f.label} is required`, 'err');
        el.focus();
        return false;
      }
    }
    const siblings = await db.records(pid, type);
    if (siblings.some((r) => r.id !== record.id && String(r.number) === number)) {
      toast(`${def.label} ${def.prefix}${number} already exists`, 'err');
      return false;
    }

    readForm(form, def.fields, record);
    record.number = /^\d+$/.test(number) ? Number(number) : number;
    record.updated = new Date().toISOString();
    if (record.recorder) pref.set('recorder', record.recorder);

    await db.put('records', record);
    for (const f of pendingImages) await db.put('files', f);
    for (const id of removedImages) await db.delete('files', id);
    if (type === 'context') await syncReciprocals(pid, original, record, siblings);

    project.updated = record.updated;
    await db.put('projects', project);
    toast(`${def.label} ${def.prefix}${record.number} saved`);
    return true;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (await save()) location.hash = `#/p/${pid}/${type}`;
  };
  document.getElementById('save-new').onclick = async () => {
    if (await save()) { location.hash = `#/p/${pid}/${type}/new`; if (isNew) route(); }
  };
  const del = document.getElementById('del');
  if (del) del.onclick = async () => {
    if (!confirm(`Delete ${def.label.toLowerCase()} ${def.prefix}${record.number}? This cannot be undone.`)) return;
    await db.deleteRecord(record.id);
    toast('Deleted');
    location.hash = `#/p/${pid}/${type}`;
  };
}

/** Keep relationships two-way: "1001 cuts 1002" also records "1002 cut by 1001". */
async function syncReciprocals(pid, before, after, contexts) {
  const key = (r) => `${r.rel}|${r.target}`;
  const oldSet = new Map((before?.relationships || []).map((r) => [key(r), r]));
  const newSet = new Map((after.relationships || []).map((r) => [key(r), r]));
  const me = String(after.number);
  const oldMe = before ? String(before.number) : me;
  const byNumber = (n) => contexts.find((c) => String(c.number) === String(n) && c.id !== after.id);

  const changed = new Map();
  const touch = (c) => { changed.set(c.id, c); c.relationships ||= []; return c; };

  // Removed relationships -> remove reciprocal
  for (const [k, r] of oldSet) {
    if (newSet.has(k) && oldMe === me) continue;
    const other = byNumber(r.target);
    if (!other) continue;
    touch(other).relationships = other.relationships.filter((x) => !(x.rel === RECIPROCAL[r.rel] && x.target === oldMe));
  }
  // Added relationships -> add reciprocal
  for (const r of newSet.values()) {
    const other = byNumber(r.target);
    if (!other) continue;
    const inv = { rel: RECIPROCAL[r.rel], target: me };
    if (!other.relationships?.some((x) => x.rel === inv.rel && x.target === inv.target)) touch(other).relationships.push(inv);
  }
  for (const c of changed.values()) await db.put('records', c);
}

function captureGPS(btn, done) {
  if (!navigator.geolocation) return toast('GPS is not available on this device', 'err');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Getting fix…';
  // Watch for a few seconds and keep the most accurate reading.
  let best = null;
  const finish = () => {
    navigator.geolocation.clearWatch(watch);
    clearTimeout(timer);
    btn.disabled = false;
    btn.textContent = label;
    if (!best) return toast('No GPS fix — try again outdoors', 'err');
    const { latitude: lat, longitude: lon, accuracy, altitude } = best.coords;
    const { easting, northing } = wgs84ToBNG(lat, lon);
    done({ lat, lon, accuracy, altitude, easting, northing, gridRef: toGridRef(easting, northing, 10), time: new Date(best.timestamp).toISOString() });
    toast(`Location captured (± ${Math.round(accuracy)} m)`);
  };
  const watch = navigator.geolocation.watchPosition(
    (pos) => {
      if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
      btn.textContent = `Getting fix… ± ${Math.round(best.coords.accuracy)} m`;
      if (best.coords.accuracy <= 4) finish();
    },
    (err) => { if (!best) { finish(); toast(err.message, 'err'); } },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
  const timer = setTimeout(finish, 12000);
}

/** Resize photos to max 2000 px so a day's work doesn't fill the device. */
async function shrink(file, max = 2000) {
  try {
    const bmp = await createImageBitmap(file);
    if (Math.max(bmp.width, bmp.height) <= max) return file;
    const scale = max / Math.max(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  } catch {
    return file;
  }
}

function notFound() {
  setHeader('Not found', '#/');
  $app.innerHTML = '<div class="empty"><p>That page or record doesn’t exist.</p><a class="btn" href="#/">Back to projects</a></div>';
}

// ---------- router ----------
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) return await viewProjects();
    if (parts[0] === 'project') return await viewProjectEdit(parts[1] || 'new');
    if (parts[0] === 'p' && parts.length <= 3) return await viewProject(parts[1], parts[2]);
    if (parts[0] === 'p' && parts.length === 4) return await viewRecord(parts[1], parts[2], parts[3]);
    notFound();
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${esc(err.message)}</p><a class="btn" href="#/">Home</a></div>`;
  }
}

// Never fail silently in the field: surface any unexpected error.
window.addEventListener('unhandledrejection', (e) => toast(`Error: ${e.reason?.message || e.reason}`, 'err'));
window.addEventListener('error', (e) => toast(`Error: ${e.message}`, 'err'));

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (navigator.storage?.persist) navigator.storage.persist();
