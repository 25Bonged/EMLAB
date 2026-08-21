# Electron Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the Node backend from plan 1 (`dashboard/electron/{db,watcher,export,server,config,parsePair}.ts`) in an Electron shell that opens a window, runs the HTTP server on an ephemeral loopback port, isolates parsing in a `utilityProcess`, and handles first-run folder selection — so the app runs as a double-clickable desktop app with zero Python and zero fixed ports.

**Architecture:** Electron main process creates the `Database`/`FolderWatcher`/Hono server exactly as `electron/serve.ts` does in plan 1, but binds port 0 and reads back the OS-assigned port; a preload script exposes that port to the renderer via `contextBridge`; `dashboard/src/lib/api.ts` gets a one-line change to read it. Parsing moves out of the main process into a `utilityProcess` child, matching the design spec's isolation requirement — a corrupt PDF must not be able to freeze or crash the window.

**Tech Stack:** Electron 43 (`utilityProcess`, `contextBridge`, `dialog`, `app.getPath`), the plan-1 backend module, unchanged React frontend.

**Precondition:** Plan 1 (`docs/superpowers/plans/2026-08-02-node-backend-port.md`) is fully implemented and its Definition of Done is met — `dashboard/electron/` exists and `npm test` is green.

---

## Verified environment facts

Checked against the installed `electron@43.2.0` and `@electron/*` typings before writing this plan — not assumed:

- `utilityProcess.fork(modulePath, args?, options?)` returns a `UtilityProcess`. Parent side: `.postMessage(message)`, `.on('message', listener)`, `.on('exit', listener)`, `.kill()`. Child side (inside the forked script): `process.parentPort.on('message', (e) => ...)`, `process.parentPort.postMessage(message)`. `fork` can only be called after `app`'s `ready` event.
- `contextBridge.exposeInMainWorld(apiKey, api)` exists on `electron.d.ts:7190`.
- `dialog.showOpenDialog(options)` returns `Promise<OpenDialogReturnValue>` with a `filePaths: string[]` and `canceled: boolean`.
- `app.getPath('userData')` is a valid argument (typed union includes `'userData'`).
- `app-builder-lib`'s `Configuration` (what `electron-builder` reads) has top-level `mac`, `dmg`, `win`, `nsis`, `directories` keys — used in plan 3, confirmed here so plan 2's `package.json` "build" stanza and plan 3 don't disagree on shape.

## File structure

| File | Responsibility |
|---|---|
| `dashboard/electron-main/index.ts` | App lifecycle, window creation, server startup, IPC wiring |
| `dashboard/electron-main/parseWorker.ts` | The forked `utilityProcess` entry point — imports `parsePair`, replies over `parentPort` |
| `dashboard/electron-main/parsePairProcess.ts` | Main-process-side wrapper: forks `parseWorker.ts` once, exposes a `ParsePair`-shaped function backed by request/response over `postMessage` |
| `dashboard/electron-main/userConfig.ts` | Reads/writes `userData/config.json`; first-run folder picker |
| `dashboard/electron-main/preload.ts` | `contextBridge.exposeInMainWorld('emlab', { apiBase })` |
| `dashboard/electron-main/*.test.ts` | Vitest for the pieces that don't need a real Electron runtime |

`electron-main/` is a sibling of `electron/` (the plan-1 backend), not nested inside it — the backend module has no Electron dependency and plan 1's tests must keep running without Electron installed as a peer concern. `electron-main/` is the only place that imports the `electron` package.

Electron's main process is loaded as CommonJS by default unless `package.json` sets `"type": "module"` — it already does (`dashboard/package.json` has `"type": "module"`), and Electron 43 supports ESM main processes. `electron-main/index.ts` is written as ESM to match the rest of the project.

---

### Task 1: Package scaffold and dev script

**Files:**
- Modify: `dashboard/package.json`
- Create: `dashboard/tsconfig.electron-main.json`
- Modify: `dashboard/tsconfig.json`

- [ ] **Step 1: Confirm electron and electron-builder are installed**

```bash
cd dashboard && npm ls electron electron-builder --depth=0
```

Expected: both listed under `devDependencies`. If missing, run `npm install -D electron@latest electron-builder@latest`.

- [ ] **Step 2: Create `dashboard/tsconfig.electron-main.json`**

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.electron-main.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "types": ["node", "electron"],
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["electron-main"]
}
```

- [ ] **Step 3: Reference it from `dashboard/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.electron.json" },
    { "path": "./tsconfig.electron-main.json" }
  ]
}
```

- [ ] **Step 4: Add the `main` field and a dev script to `dashboard/package.json`**

Add `"main": "electron-main/index.ts"` at the top level (Electron loads this after the build step rewrites it to `.js` — see Task 9). The dev script needs `EMLAB_DEV=1` set before Electron launches; npm's `scripts` cannot set env vars portably across mac/Windows without a helper, so install `cross-env`:

```bash
npm install -D cross-env
```

Add to `"scripts"`:

```json
    "electron:dev": "cross-env EMLAB_DEV=1 electron --experimental-strip-types electron-main/index.ts",
```

- [ ] **Step 5: Verify tsc still passes with the new project reference**

Run: `cd dashboard && npx tsc -b`
Expected: exits 0 (the `electron-main` directory doesn't exist yet, but an empty `include` glob is not an error for a referenced project until Task 2 adds files — if `tsc -b` errors on a missing directory, create an empty `dashboard/electron-main/.gitkeep` first).

- [ ] **Step 6: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/tsconfig.json dashboard/tsconfig.electron-main.json
git commit -m "chore: scaffold electron-main module"
```

---

### Task 2: User config — first-run folder picker and userData paths

Pure logic, testable under Vitest without launching Electron: given a `userData` directory (injected, not read from `app.getPath` directly) and a picker function (injected), resolve settings.

**Files:**
- Create: `dashboard/electron-main/userConfig.ts`
- Create: `dashboard/electron-main/userConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadOrPromptWatchFolder } from './userConfig.ts'

describe('loadOrPromptWatchFolder', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'emlab-uc-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('prompts and persists on first run', async () => {
    const picked = path.join(dir, 'OneDrive-Reports')
    const pick = async () => picked
    const folder = await loadOrPromptWatchFolder(dir, pick)
    expect(folder).toBe(picked)
    const saved = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf-8'))
    expect(saved.watch_folder).toBe(picked)
  })

  it('reuses the saved folder on a later run without prompting', async () => {
    const picked = path.join(dir, 'OneDrive-Reports')
    let calls = 0
    const pick = async () => { calls++; return picked }
    await loadOrPromptWatchFolder(dir, pick)
    const second = await loadOrPromptWatchFolder(dir, pick)
    expect(second).toBe(picked)
    expect(calls).toBe(1)
  })

  it('returns null if the user cancels the first-run picker', async () => {
    const pick = async () => null
    const folder = await loadOrPromptWatchFolder(dir, pick)
    expect(folder).toBeNull()
    expect(existsSync(path.join(dir, 'config.json'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd dashboard && npx vitest run electron-main/userConfig.test.ts`
Expected: FAIL — cannot resolve `./userConfig.ts`.

- [ ] **Step 3: Implement `dashboard/electron-main/userConfig.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'

export type FolderPicker = () => Promise<string | null>

interface UserConfig {
  watch_folder: string
}

function configPath(userDataDir: string): string {
  return path.join(userDataDir, 'config.json')
}

export function readUserConfig(userDataDir: string): UserConfig | null {
  const file = configPath(userDataDir)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function writeUserConfig(userDataDir: string, config: UserConfig): void {
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(config, null, 2))
}

/** Returns the persisted watch folder, or prompts via `pick` on first run. Returns null if the user cancels. */
export async function loadOrPromptWatchFolder(userDataDir: string, pick: FolderPicker): Promise<string | null> {
  const existing = readUserConfig(userDataDir)
  if (existing?.watch_folder) return existing.watch_folder

  const chosen = await pick()
  if (!chosen) return null
  writeUserConfig(userDataDir, { watch_folder: chosen })
  return chosen
}

export function setWatchFolder(userDataDir: string, folder: string): void {
  writeUserConfig(userDataDir, { watch_folder: folder })
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd dashboard && npx vitest run electron-main/userConfig.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/electron-main/userConfig.ts dashboard/electron-main/userConfig.test.ts
git commit -m "feat: add first-run folder persistence, decoupled from Electron's dialog API"
```

---

### Task 3: Parse worker — the utilityProcess child

This is the script `utilityProcess.fork()` launches. It cannot be unit-tested under Vitest in the normal sense (it depends on `process.parentPort`, which only exists inside a real forked utility process) — instead, Task 4 tests the request/response *protocol* against a real forked instance, which exercises this file for real.

**Files:**
- Create: `dashboard/electron-main/parseWorker.ts`

- [ ] **Step 1: Create `dashboard/electron-main/parseWorker.ts`**

```ts
import { parsePair } from '../electron/parsePair.ts'

interface ParseRequest {
  id: number
  pdfPath: string
  xlsmPath: string
}

process.parentPort.on('message', (event) => {
  const { id, pdfPath, xlsmPath } = event.data as ParseRequest
  parsePair(pdfPath, xlsmPath)
    .then((result) => process.parentPort.postMessage({ id, ok: true, result }))
    .catch((error) => process.parentPort.postMessage({ id, ok: false, error: String(error?.message ?? error) }))
})
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd dashboard && npx tsc -b`
Expected: exits 0. (`process.parentPort` is typed globally by the `"electron"` types entry added to `tsconfig.electron-main.json` in Task 1.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/electron-main/parseWorker.ts
git commit -m "feat: add utilityProcess parse worker entry point"
```

---

### Task 4: Parse process wrapper — request/response over postMessage

Forks `parseWorker.ts` once, keeps it alive, and exposes a `ParsePair`-shaped async function (same shape the plan-1 `FolderWatcher` already accepts as its third constructor argument — no changes needed to `watcher.ts`). Multiple in-flight requests are matched by an incrementing `id`, since `utilityProcess` messages are unordered relative to concurrent callers only in theory (Node's IPC is FIFO in practice, but the watcher only ever issues one parse at a time per `scanOnce()` — the id-matching is defense against that changing later, not a currently-exercised race).

This test **forks a real utility process** — it needs Electron's binary, not plain Node, so it runs via `electron` in test mode. This is the one test in the plan that cannot run under plain `vitest run`.

**Files:**
- Create: `dashboard/electron-main/parsePairProcess.ts`
- Create: `dashboard/electron-main/parsePairProcess.manual-test.ts`

- [ ] **Step 1: Implement `dashboard/electron-main/parsePairProcess.ts`**

No TDD red/green cycle here — write directly, then verify manually in Step 2, because the object under test only functions inside a running Electron app (`utilityProcess.fork` requires `app.ready`).

```ts
import { utilityProcess, type UtilityProcess } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ParsePair } from '../electron/parsePair.ts'

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'parseWorker.ts')

interface PendingRequest {
  resolve: (value: Record<string, any>) => void
  reject: (error: Error) => void
}

export function createParsePairProcess(): { parsePair: ParsePair; dispose: () => void } {
  let child: UtilityProcess | null = null
  let nextId = 1
  const pending = new Map<number, PendingRequest>()

  function ensureChild(): UtilityProcess {
    if (child) return child
    child = utilityProcess.fork(WORKER_PATH, [], { execArgv: ['--experimental-strip-types'] })
    child.on('message', (message: { id: number; ok: boolean; result?: any; error?: string }) => {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.ok) request.resolve(message.result)
      else request.reject(new Error(message.error))
    })
    child.on('exit', (code) => {
      for (const request of pending.values()) request.reject(new Error(`parse worker exited with code ${code}`))
      pending.clear()
      child = null
    })
    return child
  }

  const parsePair: ParsePair = (pdfPath, xlsmPath) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ensureChild().postMessage({ id, pdfPath, xlsmPath })
    })

  return {
    parsePair,
    dispose: () => { child?.kill(); child = null },
  }
}
```

- [ ] **Step 2: Write a manual verification script**

Create `dashboard/electron-main/parsePairProcess.manual-test.ts` — run once by hand (not part of `npm test`, since it needs the Electron binary and `app.ready`):

```ts
import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createParsePairProcess } from './parsePairProcess.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

app.whenReady().then(async () => {
  const { parsePair, dispose } = createParsePairProcess()
  try {
    await parsePair(path.join(HERE, 'does-not-exist.pdf'), path.join(HERE, 'does-not-exist.xlsm'))
    console.error('FAIL: expected a rejection for a missing file')
    process.exitCode = 1
  } catch (error) {
    console.log('OK: worker rejected as expected:', String(error))
  } finally {
    dispose()
    app.quit()
  }
})
```

- [ ] **Step 3: Run it and confirm the worker round-trips an error correctly**

```bash
cd dashboard && npx electron --experimental-strip-types electron-main/parsePairProcess.manual-test.ts
```

Expected: prints `OK: worker rejected as expected: Error: ENOENT...` and exits 0. This proves the fork, the `postMessage`/`parentPort` request-response cycle, and error propagation all work end-to-end inside a real Electron process — the one thing that cannot be verified under Vitest.

- [ ] **Step 4: Delete the manual test file after confirming it passes**

It served its purpose as a one-time verification gate; keeping it around would be dead code that never runs in CI (Electron's binary isn't available in the plan-1/plan-3 test job — see plan 3). If future changes to `parsePairProcess.ts` need re-verification, recreate it from this task.

```bash
rm dashboard/electron-main/parsePairProcess.manual-test.ts
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/electron-main/parsePairProcess.ts
git commit -m "feat: isolate PDF/XLSM parsing in a utilityProcess, verified via manual fork test"
```

---

### Task 5: Preload script

**Files:**
- Create: `dashboard/electron-main/preload.ts`

- [ ] **Step 1: Create `dashboard/electron-main/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('emlab', {
  apiBase: (): Promise<string> => ipcRenderer.invoke('emlab:api-base'),
})
```

- [ ] **Step 2: Declare the injected global for the renderer's TypeScript**

Create `dashboard/src/emlab-global.d.ts`:

```ts
export {}

declare global {
  interface Window {
    emlab?: {
      apiBase(): Promise<string>
    }
  }
}
```

- [ ] **Step 3: Verify both typecheck**

Run: `cd dashboard && npx tsc -b`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add dashboard/electron-main/preload.ts dashboard/src/emlab-global.d.ts
git commit -m "feat: add preload bridge exposing the backend port to the renderer"
```

---

### Task 6: Frontend — the one-line change

Per the design spec, this is the entire frontend diff. `window.emlab` is only defined when running inside Electron; the existing `/api` default keeps `npm run dev` (Vite + the plan-1 `npm run serve` proxy) working unchanged.

**Files:**
- Modify: `dashboard/src/lib/api.ts:1-3`

- [ ] **Step 1: Change the `API_BASE` resolution**

Current (`dashboard/src/lib/api.ts:3`):

```ts
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
```

Replace with:

```ts
let apiBaseOverride: string | null = null
if (typeof window !== 'undefined' && window.emlab) {
  apiBaseOverride = await window.emlab.apiBase()
}
const API_BASE = apiBaseOverride ?? import.meta.env.VITE_API_BASE ?? '/api'
```

This makes the module's top level `await` — confirm `dashboard/src/lib/api.ts` has no synchronous named export consumed before module resolution completes (it doesn't; `api` is a single object literal exported at the bottom, and Vite's ESM output supports top-level await). If any consumer destructures `api` at import time before this resolves, that consumer breaks; grep for it in Step 2.

- [ ] **Step 2: Confirm no caller assumes synchronous availability**

```bash
cd dashboard && grep -rn "from '../lib/api'\|from './lib/api'" src --include="*.tsx" --include="*.ts"
```

Read each match. `api.ts`'s functions are already only called from inside async store actions (`dashboard/src/store/useLibrary.ts`), never at module-eval time — top-level await in `api.ts` is safe.

- [ ] **Step 3: Run the existing frontend test suite**

Run: `cd dashboard && npm test`
Expected: all `src/**` and `electron/**` tests still pass. `electron-main/**` tests (Tasks 2 and, once written, Task 8) also run since `vite.config.ts`'s `include` will be widened in Task 8.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/api.ts
git commit -m "feat: resolve API base from the Electron preload bridge when present"
```

---

### Task 7: Main process — window, server, IPC

Ties together the plan-1 backend, Task 2's folder picker, Task 4's parse process, and Task 5's preload/IPC handler.

**Files:**
- Create: `dashboard/electron-main/index.ts`

- [ ] **Step 1: Create `dashboard/electron-main/index.ts`**

```ts
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { serve } from '@hono/node-server'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Database } from '../electron/db.ts'
import { FolderWatcher } from '../electron/watcher.ts'
import { createServer } from '../electron/server.ts'
import { loadOrPromptWatchFolder } from './userConfig.ts'
import { createParsePairProcess } from './parsePairProcess.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DASHBOARD_ROOT = path.join(HERE, '..')
const IS_DEV = Boolean(process.env.EMLAB_DEV)

let mainWindow: BrowserWindow | null = null
let resolvedApiBase = ''

async function pickWatchFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose the folder EMLAB should watch for FEV reports',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

async function start(): Promise<void> {
  const userDataDir = app.getPath('userData')
  const watchFolder = await loadOrPromptWatchFolder(userDataDir, pickWatchFolder)
  if (!watchFolder) {
    app.quit()
    return
  }

  const settings = {
    watchFolder,
    databasePath: path.join(userDataDir, 'emissions.db'),
    port: 0,
    scanIntervalSeconds: 3,
    dashboardDist: path.join(DASHBOARD_ROOT, 'dist'),
  }

  const db = new Database(settings.databasePath)
  const { parsePair, dispose: disposeParser } = createParsePairProcess()
  const watcher = new FolderWatcher(settings, db, parsePair)
  const honoApp = createServer(db, watcher, settings)

  const server = serve({ fetch: honoApp.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
    resolvedApiBase = `http://127.0.0.1:${info.port}/api`
    watcher.start()
    createWindow()
  })

  app.on('before-quit', () => {
    watcher.stop()
    disposeParser()
    server.close()
    db.close()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(HERE, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (IS_DEV) {
    mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    mainWindow.loadFile(path.join(DASHBOARD_ROOT, 'dist', 'index.html'))
  }
}

ipcMain.handle('emlab:api-base', () => resolvedApiBase)

app.whenReady().then(start)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
```

Note the preload path is `preload.js`, not `preload.ts` — Electron's `webPreferences.preload` loads compiled JS; Task 9 wires the build step that produces it. Running under `npm run electron:dev` with `--experimental-strip-types`, this resolves against the `.ts` source directly only for the **main** entry (passed on the Electron CLI), not for `preload`, which Electron always loads as a plain file path — Task 9 must produce `electron-main/preload.js` even in dev.

- [ ] **Step 2: Adjust `electron:dev` to also watch/build the preload script**

Since `--experimental-strip-types` only applies to the file Electron itself is invoked with, `preload.ts` needs a separate compile step even in dev. Add to `dashboard/package.json` `"scripts"`:

```json
    "build:preload": "esbuild electron-main/preload.ts --bundle --platform=node --external:electron --outfile=electron-main/preload.js",
```

```bash
npm install -D esbuild
```

Update `electron:dev` to build the preload first:

```json
    "electron:dev": "npm run build:preload && cross-env EMLAB_DEV=1 electron --experimental-strip-types electron-main/index.ts",
```

- [ ] **Step 3: Verify it typechecks**

Run: `cd dashboard && npx tsc -b`
Expected: exits 0.

- [ ] **Step 4: Manual verification — launch the real app against the Vite dev server**

This requires a display and cannot run in a headless CI shell; run it locally.

```bash
cd dashboard
npm run dev &         # starts Vite on :5173
sleep 2
npm run electron:dev
```

Expected: a native window opens, shows a folder-picker dialog (first run), and after choosing a folder loads the dashboard from `http://127.0.0.1:5173` with data served from the ephemeral backend port. Check the Overview and Intake views render without console errors. Stop both processes (`Ctrl+C`, then `kill %1`) when done.

- [ ] **Step 5: Commit**

```bash
git add dashboard/electron-main/index.ts dashboard/package.json dashboard/package-lock.json
git commit -m "feat: add Electron main process wiring window, server, and IPC"
```

---

### Task 8: Widen Vitest to cover electron-main

**Files:**
- Modify: `dashboard/vite.config.ts:12-15`

- [ ] **Step 1: Update the `test.include` glob**

```ts
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'electron-main/**/*.test.ts'],
  },
```

- [ ] **Step 2: Run the full suite**

Run: `cd dashboard && npm test`
Expected: PASS — plan 1's 19 backend tests, Task 2's 3 userConfig tests, and all existing `src/**` tests, all green. `parsePairProcess.ts` and `index.ts` have no `.test.ts` (they require a real Electron runtime, verified manually in Tasks 4 and 7).

- [ ] **Step 3: Commit**

```bash
git add dashboard/vite.config.ts
git commit -m "test: include electron-main in the Vitest run"
```

---

### Task 9: Production build wiring

Electron's packaged app cannot use `--experimental-strip-types` at runtime the same way dev does — for a reproducible, fast-starting production build, compile `electron-main/` and `electron/` to plain JS. This task adds the build step; plan 3 packages the output.

**Files:**
- Modify: `dashboard/package.json`
- Create: `dashboard/tsconfig.build.json`

- [ ] **Step 1: Create `dashboard/tsconfig.build.json`**

A emitting variant of the electron configs, used only for the production build:

```json
{
  "extends": "./tsconfig.electron-main.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "./build-electron",
    "rootDir": ".",
    "module": "esnext",
    "moduleResolution": "bundler"
  },
  "include": ["electron", "electron-main"]
}
```

- [ ] **Step 2: Add build scripts to `dashboard/package.json`**

```json
    "build:electron": "tsc -p tsconfig.build.json && npm run build:preload",
```

Update `build:preload`'s outfile to also land in `build-electron`:

```json
    "build:preload": "esbuild electron-main/preload.ts --bundle --platform=node --external:electron --outfile=build-electron/electron-main/preload.js",
```

- [ ] **Step 3: Update `index.ts`'s preload path resolution for the packaged case**

In `dashboard/electron-main/index.ts`, the `preload: path.join(HERE, 'preload.js')` line already works unchanged: when compiled, `HERE` (derived from `import.meta.url`) resolves to `build-electron/electron-main/`, which is exactly where Step 2 places `preload.js`. No code change — this step is verification only.

- [ ] **Step 4: Update `package.json`'s `main` field for production**

The dev `main` (`electron-main/index.ts`, loaded via the Electron CLI's `--experimental-strip-types`) differs from what a packaged app needs (plain `.js`, no flag). electron-builder's `files`/`main` resolution is finalized in plan 3; for now, verify the build output is runnable directly:

```bash
cd dashboard && npm run build && npm run build:electron
npx electron build-electron/electron-main/index.js
```

Expected: same manual window-and-picker behavior as Task 7 Step 4, but loading `dist/index.html` instead of the Vite dev server (since `EMLAB_DEV` is unset).

- [ ] **Step 5: Commit**

```bash
git add dashboard/package.json dashboard/tsconfig.build.json
git commit -m "build: add production TypeScript compilation for the Electron main process"
```

---

## Definition of done for this plan

- `dashboard/electron-main/` contains `index.ts`, `preload.ts`, `parseWorker.ts`, `parsePairProcess.ts`, `userConfig.ts`, plus tests for the pure-logic pieces.
- `npm run electron:dev` opens a working window against the Vite dev server, backed by the plan-1 Node backend on an ephemeral port.
- `npm run build && npm run build:electron` produces a runnable `build-electron/electron-main/index.js` that loads the built dashboard from `dist/`.
- First run prompts for a watch folder via a native dialog and persists it to `userData/config.json`; subsequent runs skip the prompt.
- Parsing runs in a separate OS process (`utilityProcess`), verified by the manual fork test in Task 4.
- `dashboard/src/lib/api.ts` is the only file changed in `src/`.

This is the handoff point to **plan 3** (electron-builder packaging + GitHub Actions CI/CD), which packages `build-electron/` and `dist/` into signed-or-unsigned installers.

---

## Self-review notes

- **Spec coverage:** Loopback HTTP server on ephemeral port → Task 7. First-run folder picker → Task 2 (logic) + Task 7 (dialog wiring). `userData` paths for DB and config → Task 2, Task 7. `utilityProcess` parsing isolation → Tasks 3–4, with the empirically-verified API surface recorded up front. One-line `api.ts` change → Task 6, with an explicit grep step proving no caller depends on synchronous availability.
- **Naming consistency checked:** `createParsePairProcess()` returns `{ parsePair, dispose }` in Task 4 and both are consumed with those exact names in Task 7. `loadOrPromptWatchFolder(userDataDir, pick)` signature in Task 2 matches its Task 7 call site exactly (`pickWatchFolder` matches the `FolderPicker` type: `() => Promise<string | null>`).
- **Placeholder scan:** none. The one deliberately-temporary artifact (`parsePairProcess.manual-test.ts`) is created, run, and explicitly deleted within Task 4 rather than left as dead code — called out as such, not a placeholder.
- **What is NOT unit-tested, and why:** `electron-main/index.ts` and the real `utilityProcess` fork can only run inside a launched Electron binary with a display for the window (or headless flags for the process side). Task 4's fork behavior is verified once via a manual script that is then deleted; Task 7's window is verified manually via explicit steps. This is a known limitation of Electron main-process testing, not an oversight — it is documented rather than glossed over.
