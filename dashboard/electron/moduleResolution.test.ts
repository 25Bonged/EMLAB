import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// Vitest and Vite resolve extensionless specifiers; Node's
// --experimental-strip-types loader — which is how the backend actually runs
// (`npm run serve`, and the packaged Electron main process) — does not.
//
// That gap once let a broken backend ship green: `src/lib/j2951ForTest.ts`
// imported './j2951' with no extension, so every unit test and the typecheck
// passed while `npm run serve` died at startup with ERR_MODULE_NOT_FOUND.
//
// This loads the composition root the same way production does, in a child
// process, so any extensionless runtime import anywhere in the electron→src
// graph fails here instead of at a user's launch.
describe('electron module graph resolves under --experimental-strip-types', () => {
  const electronDir = resolve(__dirname)

  const importsCleanly = (entry: string) => {
    const file = resolve(electronDir, entry)
    execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', `await import(${JSON.stringify(file)})`],
      { stdio: 'pipe', timeout: 60_000 },
    )
  }

  // db.ts pulls the whole J2951 chain: j2951ForTest -> j2951 + model/cycles -> wltc3b.
  it('imports db.ts and everything it reaches', () => {
    expect(() => importsCleanly('db.ts')).not.toThrow()
  })

  // parsePair.ts reaches the ingest chain: normalize -> j2951ForTest.
  it('imports parsePair.ts and everything it reaches', () => {
    expect(() => importsCleanly('parsePair.ts')).not.toThrow()
  })

  it('imports backfill.ts and everything it reaches', () => {
    expect(() => importsCleanly('backfill.ts')).not.toThrow()
  })
})
