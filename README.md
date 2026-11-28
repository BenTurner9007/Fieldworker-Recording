# Fieldworker Recording

An offline-first app for recording archaeological fieldwork on a phone or tablet. It's built around UK single-context recording.

- **Works with no signal.** Install it to the home screen and it runs fully offline.
- **Team sharing (optional).** Everyone signs in, and records sync to one shared database whenever there's signal. See [Team sharing setup](#team-sharing-setup). Without it, data stays on the device until you export it.
- **Feature and intervention registers:** numbers are issued in order. A context picks its feature and intervention from these registers, and typing a number that has not been issued offers to check it out on the spot.
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

## Team sharing setup

This uses the same free Supabase setup as the Harcourt Kanban. It takes about 15 minutes, once.

**How it behaves in the field:** every record saves on the phone first, so it works with no signal. The chip at the top right shows the state: **✓ Synced**, **↑ 3 to sync**, or **Offline · 3**. Changes upload as soon as there's a connection, and other people's records appear on your phone. If two people edit the same record, the most recent edit wins. If two phones give out the same context number while offline, the list flags it so someone can renumber one of them.

### 1. Create the database

1. At [supabase.com](https://supabase.com), click **New project** and choose the **London** region. You can also reuse the kanban's project: all the tables here start with `fw_`, so nothing clashes.
2. Open **SQL Editor**. Paste in all of [`supabase/schema.sql`](supabase/schema.sql), **change the email at the bottom to yours**, then click **Run**. That makes you the first admin.
3. Open a new query, paste in [`supabase/views.sql`](supabase/views.sql) and click **Run**. This adds the tidy export tables.

### 2. Create your login

1. Go to **Authentication → Users → Add user → Create new user**. Use the same email, set a password and tick **Auto confirm user**.
2. Go to **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up".

### 3. Connect the app

In Supabase, open **Project Settings → API**. Copy the **Project URL** and the **anon public** (or publishable) key into [`config.js`](config.js), then commit. The app asks everyone to sign in from then on.

### 4. Add your team

1. In the app, go to **👥 Team & account → Add someone**. Enter their name, initials and email. Choose *Admin* only if they should be able to manage the team.
2. In Supabase, go to **Authentication → Users → Add user** with the same email and a temporary password, and tick *Auto confirm user*.
3. Send them the app link and the temporary password. They can change it in **Team & account**.

To remove someone, tap ✕ next to their name. Their access stops straight away, but their records stay.

### Getting the data out

| Want | How |
|---|---|
| Spreadsheet of contexts, features, finds, etc. | Supabase **Table Editor** → pick a `fw_contexts` / `fw_features` / `fw_interventions` / `fw_finds` / `fw_samples` / `fw_photos` / `fw_drawings` view → **Export → CSV** |
| Relationships for a Harris matrix | The `fw_relationships` view: one row per relationship |
| Live layer in **QGIS** | Layer → Add Layer → **PostgreSQL**. Details are in Supabase under **Connect → Session pooler**. Set SSL mode to *require* and add any `fw_` view. Each view has a `geom` point column in EPSG:27700. |
| **ArcGIS Pro** | Same connection details, via **Insert → Connections → New Database Connection** (PostgreSQL). Or export GeoJSON from the app. |
| One project from a phone | In the app: **Export** tab → CSV / GeoJSON / backup. This works offline. |
| Everything, raw | The `fw_projects`, `fw_records` and `fw_files` tables. Photos are in **Storage → fieldwork-photos**. |

Deleting in the app only flags a record (`deleted = true`), so it can be recovered from the database.

### Good to know (Supabase free plan)

- **A project pauses after 7 days with no use.** Open the Supabase dashboard to wake it. Between jobs, the phones just keep everything until it's back.
- **1 GB of photo storage** is roughly 2,500 photos, because they're shrunk on upload. Upgrade the plan or archive old projects when it fills.
- **Changing the fields:** after editing `js/schema.js`, run `node tools/make-views.mjs`, then run the new `supabase/views.sql` in Supabase.

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
| `config.js` | Supabase details: leave empty for single-device mode |
| `js/db.js` | On-device storage (IndexedDB) |
| `js/sync.js` | Sign-in and syncing with the shared database |
| `supabase/schema.sql` | Database tables, team list and access rules |
| `supabase/views.sql` | Export views (generated by `tools/make-views.mjs`) |
| `js/osgb.js` | WGS84 → British National Grid conversion |
| `js/matrix.js` | Stratigraphic checks |
| `js/export.js` | CSV, GeoJSON and backup |
| `sw.js` | Offline caching |
