import path from 'node:path'
import fs from 'node:fs'

export interface Settings {
  watchFolder: string
  databasePath: string
  port: number
  scanIntervalSeconds: number
  dashboardDist: string
  outlookDownloader?: string
}

export function loadSettings(overrides: Partial<Settings> = {}): Settings {
  const configPath = process.env.EMLAB_CONFIG ?? ''
  let raw: Record<string, unknown> = {}
  if (configPath && fs.existsSync(configPath)) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  }
  const base = configPath ? path.dirname(configPath) : process.cwd()
  const resolve = (v: string) => (path.isAbsolute(v) ? v : path.resolve(base, v))
  return {
    watchFolder: resolve(process.env.EMLAB_WATCH_FOLDER ?? (raw.watch_folder as string) ?? './watch'),
    databasePath: resolve(process.env.EMLAB_DATABASE_PATH ?? (raw.database_path as string) ?? './data/emissions.db'),
    port: Number(process.env.EMLAB_PORT ?? raw.port ?? 8000),
    scanIntervalSeconds: Number(process.env.EMLAB_SCAN_INTERVAL ?? raw.scan_interval_seconds ?? 15),
    dashboardDist: resolve((raw.dashboard_dist as string) ?? './dist'),
    outlookDownloader: raw.outlook_downloader ? resolve(String(raw.outlook_downloader)) : undefined,
    ...overrides,
  }
}
