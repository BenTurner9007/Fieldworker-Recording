// Exports: CSV registers, GeoJSON for QGIS / ArcGIS Pro, and full JSON backups.
import { db } from './db.js';
import { TYPES, RELATIONSHIPS } from './schema.js';

const LOCATION_COLS = ['latitude', 'longitude', 'accuracy_m', 'easting', 'northing', 'gridRef'];

function csvCell(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') v = v ? 'Y' : 'N';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function relationshipText(r) {
  return (r.relationships || [])
    .map((x) => `${RELATIONSHIPS[x.rel] || x.rel} ${x.target}`)
    .join('; ');
}

function flatten(record, type) {
  const def = TYPES[type];
  const row = { number: def.prefix + record.number };
  for (const f of def.fields) row[f.key] = record[f.key];
  if (type === 'context') row.relationships = relationshipText(record);
  if (def.location) {
    const loc = record.location || {};
    row.latitude = loc.lat;
    row.longitude = loc.lon;
    row.accuracy_m = loc.accuracy != null ? Math.round(loc.accuracy) : undefined;
    row.easting = loc.easting != null ? loc.easting.toFixed(1) : undefined;
    row.northing = loc.northing != null ? loc.northing.toFixed(1) : undefined;
    row.gridRef = loc.gridRef;
  }
  row.updated = record.updated;
  return row;
}

function columns(type) {
  const def = TYPES[type];
  const cols = ['number', ...def.fields.map((f) => f.key)];
  if (type === 'context') cols.push('relationships');
  if (def.location) cols.push(...LOCATION_COLS);
  cols.push('updated');
  return cols;
}

export async function registerCSV(project, type) {
  const records = await db.records(project.id, type);
  const cols = columns(type);
  const lines = [cols.join(',')];
  for (const r of records) {
    const row = flatten(r, type);
    lines.push(cols.map((c) => csvCell(row[c])).join(','));
  }
  return lines.join('\r\n');
}

/** GeoJSON in WGS84 (EPSG:4326) — opens directly in QGIS and ArcGIS Pro. BNG coords kept as attributes. */
export async function projectGeoJSON(project) {
  const records = await db.records(project.id);
  const features = records
    .filter((r) => r.location && r.location.lat != null)
    .map((r) => {
      const props = { record_type: r.type, site_code: project.siteCode, ...flatten(r, r.type) };
      delete props.latitude;
      delete props.longitude;
      for (const k of Object.keys(props)) if (props[k] === undefined || props[k] === '') delete props[k];
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.location.lon, r.location.lat] },
        properties: props,
      };
    });
  return JSON.stringify({ type: 'FeatureCollection', name: `${project.siteCode}_points`, features }, null, 2);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}

/** Full backup of one project, photos included. */
export async function projectBackup(project, { includePhotos = true } = {}) {
  const records = await db.records(project.id);
  const files = [];
  if (includePhotos) {
    for (const r of records) {
      for (const f of await db.filesFor(r.id)) {
        files.push({ id: f.id, recordId: f.recordId, name: f.name, mime: f.mime, data: await blobToDataURL(f.blob) });
      }
    }
  }
  return JSON.stringify({ app: 'fieldworker-recording', version: 1, exported: new Date().toISOString(), project, records, files });
}

export async function importBackup(text) {
  const data = JSON.parse(text);
  if (data.app !== 'fieldworker-recording' || !data.project) throw new Error('This is not a Fieldworker Recording backup file.');
  const existing = await db.get('projects', data.project.id);
  if (existing && !confirm(`Project ${existing.siteCode} already exists on this device. Overwrite it with the backup?`)) return null;
  await db.put('projects', data.project);
  for (const r of data.records || []) await db.put('records', r);
  for (const f of data.files || []) {
    await db.put('files', { id: f.id, recordId: f.recordId, name: f.name, mime: f.mime, blob: await dataURLToBlob(f.data) });
  }
  return data.project;
}

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
