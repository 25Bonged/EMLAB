import { serve } from '@hono/node-server'
import { loadSettings } from './config.ts'
import { Database } from './db.ts'
import { FolderWatcher } from './watcher.ts'
import { createServer } from './server.ts'
import { parsePair } from './parsePair.ts'

const settings = loadSettings()
const db = new Database(settings.databasePath)
const watcher = new FolderWatcher(settings, db, parsePair)
const app = createServer(db, watcher, settings)

watcher.start()

const server = serve({ fetch: app.fetch, port: settings.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`EMLAB backend listening on http://127.0.0.1:${info.port}`)
})

function shutdown() {
  watcher.stop()
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
