import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { serve } from '@hono/node-server'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Database } from '../electron/db.ts'
import { FolderWatcher } from '../electron/watcher.ts'
import { createServer } from '../electron/server.ts'
import { backfillJ2951 } from '../electron/backfill.ts'
import { createParsePairProcess } from './parsePairProcess.ts'

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

let mainWindow: BrowserWindow | null = null
let resolvedApiBase = ''
let apiToken = ''
let resolvedAppUrl = ''

async function start(): Promise<void> {
  const userDataDir = app.getPath('userData')
  // Programs live in subfolders of this root. Sensible default, no prompt; a
  // future Settings screen can relocate it. Each program the user creates
  // becomes a subfolder here (see electron/server.ts POST /api/programs).
  const watchFolder = path.join(app.getPath('documents'), 'EMLAB')
  fs.mkdirSync(watchFolder, { recursive: true })

  const settings = {
    watchFolder,
    databasePath: path.join(userDataDir, 'emissions.db'),
    port: 0,
    scanIntervalSeconds: 3,
    dashboardDist: path.join(DASHBOARD_ROOT, 'dist'),
  }

  const db = new Database(settings.databasePath)

  const backfilled = backfillJ2951(db)
  if (backfilled > 0) console.log(`J2951: backfilled ${backfilled} test(s)`)

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
      // Explicit rather than relying on the default: this window renders text
      // parsed out of third-party PDFs, so the renderer is treated as hostile.
      sandbox: true,
      webviewTag: false,
    },
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
