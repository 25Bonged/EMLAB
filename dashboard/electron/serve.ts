import { serve } from '@hono/node-server'
import { loadSettings } from './config.ts'
import { Database } from './db.ts'
import { FolderWatcher } from './watcher.ts'
import { createServer } from './server.ts'
import { parsePair } from './parsePair.ts'
import { backfillJ2951 } from './backfill.ts'

const settings = loadSettings()
const db = new Database(settings.databasePath)

const backfilled = backfillJ2951(db)
if (backfilled > 0) console.log(`J2951: backfilled ${backfilled} test(s)`)

const watcher = new FolderWatcher(settings, db, parsePair)
// Standalone dev server. The packaged Electron app always tokenises the API;
// here it is opt-in via EMLAB_TOKEN so the vite browser workflow still works.
const authToken = process.env.EMLAB_TOKEN || undefined
if (!authToken) {
  console.warn('EMLAB: API is UNAUTHENTICATED (set EMLAB_TOKEN to require a token). Dev use only.')
}
const app = createServer(db, watcher, settings, authToken)

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
