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
