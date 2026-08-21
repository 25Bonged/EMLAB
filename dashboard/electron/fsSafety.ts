import fs from 'node:fs'

/**
 * A write into the program/watch folder tree has been observed to hang far
 * longer than any real disk operation -- 7s+ even in a bare script outside
 * Electron, 60s+ (never returning) from inside the running app -- when that
 * tree sits under a corporate OneDrive-redirected folder and this app is
 * unsigned: AV/EDR scanning or a cloud-sync placeholder round-trip that a
 * trusted binary doesn't hit. See electron-main/index.ts's startup folder
 * resolution for the original repro (isolated with a from-scratch minimal
 * Electron app, confirmed not EMLAB-specific).
 *
 * Every write into that tree needs the same bound, not just the first one:
 * a folder that was created successfully at startup is not proof a *later*
 * write there will also be fast -- confirmed by reproducing the hang against
 * an already-existing directory. Two call sites hit this for real:
 *   - POST /api/programs (server.ts) -- synchronous mkdirSync blocked the
 *     whole Hono server on a single request, surfacing as a "Saving..."
 *     dialog that never resolves or errors, with nothing in any log.
 *   - FolderWatcher.scan (watcher.ts) -- runs on a repeating timer (every
 *     scanIntervalSeconds), so an unguarded mkdirSync there doesn't just
 *     fail one action, it can freeze the entire app at any moment during
 *     otherwise-idle background use.
 *
 * fs.promises.mkdir (not fs.mkdirSync) is required for the timeout to work
 * at all: a *synchronous* call blocks Node's single JS thread outright, so
 * nothing -- including a setTimeout -- can fire until it returns. The
 * promise-based call runs on libuv's threadpool instead, which is what lets
 * a same-process timer race it.
 */
export async function mkdirWithTimeout(dir: string, timeoutMs = 15_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      `Timed out after ${timeoutMs / 1000}s creating "${dir}". This folder is likely inside a `
      + 'OneDrive-synced or otherwise monitored location that is blocking access for this app. '
      + 'Try a local (non-synced) folder, or check with IT about antivirus/DLP policies for this application.',
    )), timeoutMs)
  })
  try {
    await Promise.race([fs.promises.mkdir(dir, { recursive: true }), timeout])
  } finally {
    clearTimeout(timer!)
  }
}
