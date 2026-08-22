import type { BrowserWindow as BrowserWindowType } from 'electron'
import { serve } from '@hono/node-server'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Electron's main process only reliably provides its API through the
// CommonJS `require('electron')` path, which its bootstrap patches
// Module._load to intercept. Both the static named import
// (`import { app } from 'electron'`) and the default-import (`import
// electron from 'electron'`) forms go through Node's own ESM loader instead,
// which in testing resolved *something* for 'electron' but inconsistently:
// sometimes a named export like utilityProcess was simply missing
// (SyntaxError at import time), sometimes app/BrowserWindow resolved but
// were undefined at first read (a load-order race, reproduced identically in
// the compiled build-electron/**/*.js output, not just under
// --experimental-strip-types -- this is not a dev-only quirk). `createRequire`
// gets a real CJS require in this ESM file and goes through the same
// Module._load path every plain (non-TypeScript) Electron app has always
// used, which is the one Electron's bootstrap actually guarantees.
// `typeof import('electron')` is erased at compile time (a type query, not a
// value import) so it restores full typing -- strict-null narrowing on
// mainWindow included -- without going anywhere near the runtime ESM path.
const electron = createRequire(import.meta.url)('electron') as typeof import('electron')
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = electron
// Turned out NOT to be electron-specific: this hit the exact same failure as
// 'electron' above. `import { autoUpdater } from 'electron-updater'` typechecks
// and runs fine under Vite/tsx in dev, but electron-updater is also a plain
// CJS module (a normal package.json "main", not Electron's intercepted
// require), and Node's ESM loader's static named-export analysis of a CJS
// module is unreliable in exactly this way once packaged into asar --
// confirmed by the packaged app's own crash dialog: "SyntaxError: Named
// export 'autoUpdater' not found ... CommonJS modules can always be imported
// via the default export". Same fix as 'electron': go through createRequire
// for a real CJS require instead of Node's ESM interop.
const { autoUpdater } = createRequire(import.meta.url)('electron-updater') as typeof import('electron-updater')
import { Database } from '../electron/db.ts'
import { FolderWatcher } from '../electron/watcher.ts'
import { createServer } from '../electron/server.ts'
import { backfillFilenameMetadata, backfillJ2951 } from '../electron/backfill.ts'
import { createParsePairProcess } from './parsePairProcess.ts'
import { mkdirWithTimeout } from '../electron/fsSafety.ts'
import { sanitizeFolderName } from '../electron/programPaths.ts'

// Electron derives app.name -- and therefore app.getPath('userData') -- from
// package.json's `name`, which is "dashboard". Unset, the shipped app would
// keep its database and config in ~/Library/Application Support/dashboard
// (%APPDATA%\dashboard on Windows): generic, and liable to collide with any
// other app named "dashboard". Set explicitly BEFORE the first getPath call.
// Changing this after release would orphan every installed user's data, so it
// has to be right before the first build goes out.
app.setName('EMLAB')

// Two EMLAB processes would each open their own DatabaseSync handle on the
// *same* emissions.db file (db.ts sets no WAL mode and no busy_timeout) and
// run their own FolderWatcher against the same watch folder on independent
// timers -- concurrent writes from two processes to one SQLite file produce
// sporadic "database is locked" failures, and two watchers can race parsing
// the same source files. A second launch (double-clicked icon, launched
// again before the first window finished closing -- an easy, ordinary thing
// for a user to do, not an edge case) must not become a second process.
// requestSingleInstanceLock() makes every launch after the first hand its
// argv to the first instance's 'second-instance' listener (registered below,
// once mainWindow exists) and quit immediately instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // Nothing Electron-specific has started yet for this process (no window,
  // no db, no server) -- app.quit() only *requests* a graceful shutdown and
  // returns immediately, so without an explicit exit here every line below,
  // including the app.whenReady().then(start) at the bottom of this file,
  // would still run and race the first instance to open the same database.
  // A plain process.exit() is safe this early and guarantees none of it does.
  app.quit()
  process.exit(0)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))

// A fixed '..' is wrong in production: dev runs this file from
// dashboard/electron-main/ (one level below dashboard/), but the compiled
// build runs it from dashboard/build-electron/electron-main/ (two levels
// below) -- '..' would resolve to build-electron/, which has no dist/.
// Walking up to the nearest package.json finds dashboard/ correctly in both
// cases, and in a packaged app too (electron-builder ships package.json
// alongside build-electron/ and dist/ at the same level).
function findDashboardRoot(startDir: string): string {
  let dir = startDir
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`could not locate dashboard/ (no package.json found above ${startDir})`)
    dir = parent
  }
  return dir
}

const DASHBOARD_ROOT = findDashboardRoot(HERE)
const IS_DEV = Boolean(process.env.EMLAB_DEV)
const UPDATES_ENABLED = process.env.EMLAB_ENABLE_UPDATES === '1'

let mainWindow: BrowserWindowType | null = null
let resolvedApiBase = ''
let apiToken = ''
let resolvedAppUrl = ''

// Fail loud through the existing startup error dialog rather than leave the
// user staring at a window that never appears, with no way to tell a slow
// disk (see fsSafety.ts) from a crash.
const FOLDER_SETUP_TIMEOUT_MS = 15_000

// Programs live under Electron's own userData directory, not Documents. On
// corporate Windows machines Documents is often OneDrive-synced and monitored
// by DLP/Defender; we have already seen folder creation there hang or time out
// when creating a new project. userData is local app storage, so EMLAB can
// create STLA/RNTBCI/etc. without depending on OneDrive policy.
async function resolveWatchFolder(userDataDir: string): Promise<string> {
  const localRoot = path.join(userDataDir, 'Programs')
  await mkdirWithTimeout(localRoot, FOLDER_SETUP_TIMEOUT_MS)
  return localRoot
}

async function localizeProgramFolders(db: Database, watchFolder: string): Promise<number> {
  const root = path.resolve(watchFolder)
  let changed = 0
  for (const program of db.listPrograms()) {
    const current = path.resolve(String(program.folder))
    if (current === root || current.startsWith(root + path.sep)) continue
    const localFolder = path.join(root, sanitizeFolderName(String(program.name)))
    await mkdirWithTimeout(localFolder, FOLDER_SETUP_TIMEOUT_MS)
    if (db.updateProgramFolder(String(program.id), localFolder)) changed += 1
  }
  return changed
}

// autoUpdater is an EventEmitter -- Node throws if an 'error' event fires
// with no listener attached, which would otherwise crash the whole app over
// something as routine as "this machine has no internet right now" or
// "GitHub returned a 404 because no release has been published yet" (true
// until a release is actually published -- see electron-builder.yml).
autoUpdater.on('error', (error) => console.error('EMLAB: update check failed:', error))

// When explicitly enabled with EMLAB_ENABLE_UPDATES=1, checks the GitHub Releases feed configured in electron-builder.yml
// (publish:), downloads a newer build if one exists, and swaps it in the
// next time the user quits the app -- no dialog, no interruption, nothing
// for the user to do. Silently does nothing (not a crash, not a visible
// error) if: no release has been published yet, the machine is offline, or
// the download's code-signing publisher doesn't match this build's -- the
// last case matters concretely here because the current build is
// self-signed (see the code-signing notes elsewhere in this repo); every
// future build needs to reuse that exact same certificate/publisher identity
// for updates to be accepted at all, and it must be replaced by a real CA
// certificate before this is trustworthy for anyone but you to rely on.
function checkForUpdates(): void {
  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('EMLAB: update check failed:', error)
  })
}

async function start(): Promise<void> {
  if (!IS_DEV) {
    // The default menu (File/Edit/View/Window/Help -- Reload, Toggle
    // Developer Tools, Actual Size, ...) is Chromium/Electron boilerplate
    // aimed at web developers, not this app's users. Keep it in dev, where
    // reload and devtools are genuinely useful while iterating, but drop it
    // entirely from the shipped build for a cleaner, less confusing window.
    Menu.setApplicationMenu(null)
  }

  const userDataDir = app.getPath('userData')
  const watchFolder = await resolveWatchFolder(userDataDir)

  const settings = {
    watchFolder,
    databasePath: path.join(userDataDir, 'emissions.db'),
    port: 0,
    scanIntervalSeconds: 15,
    dashboardDist: path.join(DASHBOARD_ROOT, 'dist'),
    outlookDownloader: path.join(
      app.isPackaged ? process.resourcesPath : path.dirname(DASHBOARD_ROOT),
      app.isPackaged ? 'outlook-downloader' : 'scripts/outlook-downloader',
      'run_emlab_downloader.bat',
    ),
  }

  const db = new Database(settings.databasePath)
  const localized = await localizeProgramFolders(db, watchFolder)
  if (localized > 0) {
    console.log(`EMLAB: moved ${localized} program folder reference(s) to local app storage: ${watchFolder}`)
  }

  const backfilled = backfillJ2951(db)
  if (backfilled > 0) console.log(`J2951: backfilled ${backfilled} test(s)`)
  const metadataBackfilled = backfillFilenameMetadata(db)
  if (metadataBackfilled > 0) console.log(`EMLAB: backfilled filename metadata for ${metadataBackfilled} test(s)`)

  const { parsePair, dispose: disposeParser } = createParsePairProcess()
  const watcher = new FolderWatcher(settings, db, parsePair)
  // 256 bits of entropy, regenerated each launch and never written to disk.
  // Only the renderer receives it, via the contextIsolated preload bridge.
  apiToken = randomBytes(32).toString('hex')
  const honoApp = createServer(db, watcher, settings, apiToken)

  const server = serve({ fetch: honoApp.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
    resolvedApiBase = `http://127.0.0.1:${info.port}/api`
    resolvedAppUrl = `http://127.0.0.1:${info.port}/`
    watcher.start()
    createWindow()
    if (!IS_DEV && UPDATES_ENABLED) checkForUpdates()
  })

  app.on('before-quit', () => {
    watcher.stop()
    disposeParser()
    server.close()
    db.close()
  })
}

// electron-builder's `icon:` (electron-builder.yml) only brands the built
// .exe/.app resource. The live BrowserWindow -- taskbar, alt-tab, title bar --
// takes its icon from this constructor option independently, and defaults to
// Electron's own logo when unset. That default is what showed up during dev
// (electron.exe runs unpackaged, so it has no EMLAB .exe resource to inherit
// from) and would keep showing even in a packaged build if this were
// skipped. .ico carries multiple resolutions natively on Windows; .png is
// the portable fallback electron's nativeImage understands everywhere else.
const APP_ICON = path.join(DASHBOARD_ROOT, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: ' ',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(HERE, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Explicit rather than relying on the default: this window renders text
      // parsed out of third-party PDFs, so the renderer is treated as hostile.
      sandbox: true,
      webviewTag: false,
    },
  })
  // Both fire only on genuine failure (not routine renderer console noise),
  // and both were previously silent: a bad preload path or a load failure
  // (e.g. the CORS/IPv4-vs-IPv6 dev-server mismatches found and fixed this
  // session) used to produce nothing but a window that looked hung or blank,
  // with no clue in any log why.
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => console.error('EMLAB: preload failed:', preloadPath, error))
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('EMLAB: page failed to load:', code, desc, url))
  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    mainWindow?.setTitle(' ')
  })

  // The renderer should only ever show our own loopback UI. Without these two
  // guards, any navigation the page can trigger — a link built from parsed
  // report text, a window.open — would load remote content inside a desktop
  // app window. Both are denied; anything genuinely external goes to the
  // user's real browser instead.
  const isOwnOrigin = (target: string): boolean => {
    try {
      const u = new URL(target)
      return (u.protocol === 'http:' || u.protocol === 'https:')
        && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
    } catch {
      return false
    }
  }

  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!isOwnOrigin(target)) event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwnOrigin(url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Load over the loopback HTTP server, NOT loadFile(). Vite emits absolute
  // asset paths ("/assets/index-*.js"), which under file:// resolve against
  // the filesystem root and 404 -- index.html renders, no script ever runs,
  // and you get a blank white window. Serving over http:// resolves them
  // correctly and puts the UI on the same origin as the API, so the relative
  // /api URLs in api.ts (including the evidence and export download links)
  // work without any cross-origin special-casing.
  mainWindow.loadURL(IS_DEV ? 'http://127.0.0.1:5173' : resolvedAppUrl)
}

ipcMain.handle('emlab:api-config', () => ({ base: resolvedApiBase, token: apiToken }))

app.whenReady().then(start).catch((error) => {
  // Without this, a rejection anywhere in start() (a corrupt config file, a
  // dialog error, a port the OS refuses to hand out) becomes an unhandled
  // rejection: no window, no error dialog, no quit -- the app just sits
  // there looking hung, and a non-technical user has no way to tell why.
  console.error('EMLAB failed to start:', error)
  dialog.showErrorBox('EMLAB failed to start', String(error?.message ?? error))
  app.quit()
})

// Fires in the *first* (already-running) instance whenever a later launch
// hits the requestSingleInstanceLock() check above and is turned away. That
// second launch already exited (see above), so the only useful thing to do
// here is make sure the user actually sees the app they were trying to open,
// instead of it silently doing nothing.
app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
