import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Database } from './db.ts'
import type { ParsePair } from './parsePair.ts'

export interface WatcherSettings {
  watchFolder: string
  scanIntervalSeconds: number
}

export function stemOf(filePath: string): string {
  const name = path.basename(filePath)
  for (const suffix of ['_REPORT.pdf', '_TRACES.xlsm']) {
    if (name.toUpperCase().endsWith(suffix.toUpperCase())) return name.slice(0, -suffix.length)
  }
  return name.replace(/\.[^.]+$/, '')
}

export function sha256File(filePath: string): string {
  const digest = createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    let read = 0
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return digest.digest('hex')
}

export class FolderWatcher {
  settings: WatcherSettings
  db: Database
  parsePair: ParsePair
  timer: NodeJS.Timeout | null
  scanning: boolean

  constructor(settings: WatcherSettings, db: Database, parsePair: ParsePair) {
    this.settings = settings
    this.db = db
    this.parsePair = parsePair
    this.timer = null
    this.scanning = false
  }

  /** The expensive disk read, factored out so tests can spy on it directly
   * rather than on hashFile (which runs once per file every scan regardless
   * of whether it hits the cache below). */
  computeHash(filePath: string): string {
    return sha256File(filePath)
  }

  /** Reuses the stored digest when size and mtime are unchanged. */
  hashFile(filePath: string): string {
    const stat = fs.statSync(filePath, { bigint: true })
    const meta = this.db.sourceMeta(filePath)
    if (meta && meta.size_bytes === Number(stat.size) && meta.modified_ns === String(stat.mtimeNs)) {
      return meta.sha256
    }
    return this.computeHash(filePath)
  }

  start(): void {
    if (this.timer) return
    const tick = async () => {
      try {
        await this.scanOnce()
      } catch (error) {
        console.error('watcher scan failed:', error)
      }
      this.timer = setTimeout(tick, this.settings.scanIntervalSeconds * 1000)
    }
    this.timer = setTimeout(tick, 0)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Serialized so the background loop and a manual rescan never overlap. */
  async scanOnce(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      await this.scan()
    } finally {
      this.scanning = false
    }
  }

  private async scan(): Promise<void> {
    const root = this.settings.watchFolder
    fs.mkdirSync(root, { recursive: true })

    const groups = new Map<string, { pdf?: string; xlsm?: string }>()
    for (const entry of fs.readdirSync(root, { recursive: true, encoding: 'utf-8' })) {
      const full = path.resolve(root, entry)
      if (!fs.statSync(full).isFile()) continue
      const upper = path.basename(full).toUpperCase()
      const kind = upper.endsWith('_REPORT.PDF') ? 'pdf' : upper.endsWith('_TRACES.XLSM') ? 'xlsm' : null
      if (!kind) continue
      const stem = stemOf(full)
      const group = groups.get(stem) ?? {}
      group[kind] = full
      groups.set(stem, group)
    }

    const jobsByStem = new Map(this.db.listJobs().map((job) => [job.stem, job]))

    for (const [stem, pair] of groups) {
      const { pdf, xlsm } = pair
      let pdfHash: string | null = null
      let xlsmHash: string | null = null
      try {
        pdfHash = pdf ? this.hashFile(pdf) : null
        xlsmHash = xlsm ? this.hashFile(xlsm) : null
        if (pdf) this.db.registerSource(stem, 'pdf', pdf, pdfHash ?? '')
        if (xlsm) this.db.registerSource(stem, 'xlsm', xlsm, xlsmHash ?? '')
      } catch (error) {
        // A file vanished mid-scan (OneDrive sync churn) — skip this pair.
        console.error(`watcher: source for ${stem} unavailable, skipping:`, error)
        continue
      }

      if (!pdf || !xlsm) {
        this.db.updateJob(stem, 'pending_pair', {
          pdf_path: pdf ?? null, xlsm_path: xlsm ?? null, pdf_hash: pdfHash, xlsm_hash: xlsmHash,
          message: `Waiting for ${!pdf ? 'REPORT.pdf' : 'TRACES.xlsm'}`,
        })
        continue
      }

      const combinedHash = createHash('sha256').update(`${pdfHash}:${xlsmHash}`).digest('hex')
      const current = jobsByStem.get(stem)
      const sourceUnchanged = Boolean(
        current && current.pdf_hash === pdfHash && current.xlsm_hash === xlsmHash,
      )

      // A test the engineer deleted stays deleted until its source changes.
      if (current && current.status === 'deleted' && sourceUnchanged) continue

      // Unchanged source with a fully-parsed record: do not re-run the parser.
      // It is deterministic, and re-running would overwrite manual edits.
      if (sourceUnchanged && current && ['accepted', 'quarantined'].includes(current.status)) {
        const existingTest = current.test_id ? this.db.getTest(current.test_id) : null
        if (existingTest && existingTest.units?.trace) continue
      }

      this.db.updateJob(stem, 'processing', {
        pdf_path: pdf, xlsm_path: xlsm, pdf_hash: pdfHash, xlsm_hash: xlsmHash,
        message: 'Parsing FEV report and traces',
      })

      try {
        const test = await this.parsePair(pdf, xlsm)
        const existing = this.db.findIdentity(test, stem)
        let low = [...(test.lowConfidence ?? [])]
        if (existing) {
          const fieldMap: Record<string, string> = {
            project: 'project', cycle: 'cycle', config: 'config',
            transmission: 'transmission', vnNo: 'vnNo',
          }
          for (const [flag, field] of Object.entries(fieldMap)) {
            if (low.includes(flag) && ![null, undefined, '', 'Unknown'].includes(existing[field])) {
              test[field] = existing[field]
              low = low.filter((f) => f !== flag)
            }
          }
          for (const field of ['catalystState', 'stt', 'startSoc']) {
            if (!test[field] && existing[field] !== null && existing[field] !== undefined) {
              test[field] = existing[field]
            }
          }
          test.lowConfidence = low
        }
        const status = low.length ? 'quarantined' : 'accepted'
        const { testId: id, replaced } = this.db.saveTest(
          test, stem, combinedHash, status, `parsed with ${low.length} low-confidence field(s)`,
        )
        this.db.registerSource(stem, 'pdf', pdf, pdfHash ?? '', id)
        this.db.registerSource(stem, 'xlsm', xlsm, xlsmHash ?? '', id)
        this.db.updateJob(stem, status, {
          pdf_path: pdf, xlsm_path: xlsm, pdf_hash: pdfHash, xlsm_hash: xlsmHash, test_id: id,
          message: replaced
            ? 'Corrected source replaced active record'
            : low.length ? 'Ready for review' : 'Accepted',
        })
      } catch (error) {
        this.db.updateJob(stem, 'quarantined', {
          pdf_path: pdf, xlsm_path: xlsm, pdf_hash: pdfHash, xlsm_hash: xlsmHash,
          message: String(error).slice(0, 1000),
        })
      }
    }
  }
}
