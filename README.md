# Fieldworker Recording

An offline-first app for recording archaeological fieldwork on a phone or tablet. It's built around UK single-context recording.

- **Works with no signal.** Install it to the home screen and it runs fully offline. Data stays on the device until you export it.
- **Contexts** have type-specific fields (cut, fill/layer/deposit, masonry), dimensions, levels and interpretation.
- **Stratigraphic relationships** are two-way: record "1001 fills 1000" and 1000 automatically gets "filled by 1001".
- **Matrix check** flags stratigraphic loops and contexts that are referenced but not yet recorded. It also gives a rough latest-to-earliest sequence.
- **Registers** for finds (small finds), samples, photos (with in-app camera) and drawings.
- **GPS capture** converts to British National Grid (EPSG:27700) and gives a 10-figure grid reference. It uses the OS Helmert transform, accurate to roughly 5 m, which is fine for phone GPS but not a substitute for GNSS survey.
- **Exports**
  - CSV registers for each record type (opens in Excel)
  - GeoJSON points for QGIS / ArcGIS Pro, with BNG eastings and northings as attributes
  - A full JSON backup, including photos, to move or archive a project

## Using it

1. Open the hosted app in Chrome (Android) or Safari (iPhone/iPad).
2. Use **Add to Home screen** so it works offline as an app.
3. Create a project, then record contexts, finds and so on.
4. **Export → Full backup at the end of every day.** Browser storage can be cleared by the device, so the backup file is your safety net.

## Hosting on GitHub Pages (free)

Repo **Settings → Pages → Deploy from a branch** → pick the branch and `/ (root)`. The app will be at `https://<user>.github.io/Fieldworker-Recording/`.

## Running locally

There's no build step. Any static web server works:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Changing what gets recorded

All forms, lists and exports are generated from **`js/schema.js`**. Add, remove or rename fields there. Field types available: `text`, `textarea`, `number`, `select`, `date`, `checkbox`, `contextRef`.

After changing any app file, bump `VERSION` in `sw.js` so installed devices pick up the update.

## Files

| File | Purpose |
|---|---|
| `js/schema.js` | Record types and fields — the place to customise |
| `js/app.js` | Screens, forms, GPS, photos |
| `js/db.js` | On-device storage (IndexedDB) |
| `js/osgb.js` | WGS84 → British National Grid conversion |
| `js/matrix.js` | Stratigraphic checks |
| `js/export.js` | CSV, GeoJSON and backup |
| `sw.js` | Offline caching |
