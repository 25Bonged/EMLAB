# User-created programs (folder-per-program) — Design

**Date:** 2026-08-03
**Status:** Approved (pending spec review)

## Problem

Programs in the sidebar are hardcoded (`PROJECT_ORDER = ['STLA', 'Honda', 'RNTBCI']`)
and each test's program is *guessed* from its filename (`classifyProject`:
CITROEN→STLA, HONDA→Honda, …) out of a **single** watch folder. Consequences:

- A fresh install (e.g. a colleague's) shows the original author's programs
  (STLA/Honda/RNTBCI), which are meaningless to them.
- Users cannot define their own programs.
- Program assignment relies on brittle filename heuristics.

## Goal

Users create their own programs. Each program is its own folder. A test belongs
to a program because it lives in that program's folder — not because of a
filename guess. A fresh install starts with **no** programs.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Folder setup | App creates and manages a subfolder per program |
| Root location | Sensible default (`Documents/EMLAB`), changeable in Settings; no first-run prompt |
| Management | Create + Rename + Delete |
| Delete semantics | Removes the program + its tests from the library; **leaves the folder and files on disk** |
| Rename semantics | Display-name only; the on-disk folder path stays fixed from creation |
| Manual import | Parsed tests are assigned to the **currently open program** (a program must be selected) |
| Program assignment | Program = the folder a test was ingested from (retires `classifyProject` for assignment) |

## Architecture

This lives in the **Electron data layer** (`electron/`) plus the React frontend
(`dashboard/src/`). The retired Python `backend/` and the stale `:8000` server
are not involved.

### Data model — programs registry (new source of truth)

New table `programs` in the Electron SQLite DB (`electron/schema.ts`):

```sql
CREATE TABLE IF NOT EXISTS programs (
  id          TEXT PRIMARY KEY,   -- stable id (slug or uuid), never changes
  name        TEXT NOT NULL,      -- display name, editable via rename
  folder      TEXT NOT NULL UNIQUE, -- absolute path, fixed at creation
  created_at  TEXT NOT NULL
);
```

The **registry — not the folders on disk — is the source of truth** for which
programs exist. This decoupling is what makes "delete but keep files" correct:
delete removes the row; the folder remains but is no longer watched or shown.

`tests` gains a stable link column `program_id TEXT` (references `programs.id`).
The existing `tests.project` column is kept as a **denormalized display name**
so the current frontend (sidebar grouping, filters, `derive.ts`) keeps working
unchanged. On rename, `programs.name` and every linked `tests.project` are
updated together.

### Root & program folders

- Config gains a `root` folder (repurposing the existing `watchFolder`
  plumbing in `electron/config.ts` + `electron-main/userConfig.ts`).
- Default: `<Documents>/EMLAB`. No first-run prompt. Changeable in Settings.
- Creating a program `STLA` performs `mkdir <root>/<sanitized-name>` and inserts
  a row with that folder path. If the sanitized folder name collides with an
  existing folder, append a numeric suffix (`STLA-2`) so the path stays unique.

### Ingestion — program from folder

The watcher (`electron/watcher.ts`) iterates **registered programs** and scans
each program's `folder`. Every test ingested from a program's folder is tagged
`program_id = <program.id>` and `project = <program.name>`. `classifyProject` is
no longer used to assign the program (it may remain only as dead-code removal
candidate; not called on the watch path).

### First-run / empty state

- Remove the `PROJECT_ORDER` hardcode; the sidebar renders the live programs
  list.
- Zero programs → sidebar shows an empty state with a **＋ New Program** button;
  the Overview shows a "Create a program to begin" prompt.
- Cycle sub-grouping (WLTP/MIDC/NEDC) stays data-derived beneath each program.

### Program management (UI)

- **Create:** ＋ New Program → dialog for a name. Validate: non-empty, unique
  (case-insensitive) among programs, filesystem-safe. → `mkdir` + insert row →
  the empty program appears in the tree.
- **Rename:** dialog/inline edit → update `programs.name` (+ cascade to
  `tests.project`). Folder path unchanged.
- **Delete:** confirm dialog → delete the program row, its tests, its ingestion
  jobs. Leave the folder + files on disk. Watcher will not re-add (the folder is
  no longer registered).

### API (Electron server, `electron/server.ts`)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/programs` | List programs (id, name, folder, counts) |
| POST | `/api/programs` | Create `{ name }` → mkdir + row |
| PATCH | `/api/programs/:id` | Rename `{ name }` |
| DELETE | `/api/programs/:id` | Remove program + its tests, keep files |

Frontend: extend `dashboard/src/lib/api.ts` and add a `usePrograms` store slice;
the sidebar and empty state consume it. Manual import path (`UploadDropzone` /
`useLibrary.importFiles`) passes the active `program_id`.

## Testing

- Programs CRUD (create makes folder + row; duplicate name rejected; delete
  removes tests but leaves files; rename updates name + cascades to tests).
- Watcher assigns `program_id`/`project` from the folder it scanned.
- Deleted program's unchanged folder is not resurrected on rescan.
- Empty state renders with no programs; sidebar renders the live list.

## Out of scope (this version)

- Renaming the on-disk folder.
- Moving/merging tests between programs.
- Sharing/multi-user program definitions.
- Nested program hierarchies (programs stay flat; cycle grouping is derived).
