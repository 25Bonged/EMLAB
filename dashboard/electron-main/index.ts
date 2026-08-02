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
