import type { Test } from '../model/types'

// In the packaged app the base URL and API token come from Electron's preload
// bridge, which no other local process can read. In browser dev there is no
// bridge, the vite proxy supplies the base, and the server runs untokenised.
let bridge: { base: string; token: string } | null = null
if (typeof window !== 'undefined' && window.emlab) {
  bridge = await window.emlab.apiConfig()
}
const API_BASE = bridge?.base ?? import.meta.env.VITE_API_BASE ?? '/api'
const AUTH_HEADERS: Record<string, string> = bridge?.token ? { 'x-emlab-token': bridge.token } : {}

export interface Health {
  ok: boolean
  can_edit: boolean
  watch_folder: string
  database: string
}

export interface IngestionJob {
  stem: string
  status: Test['status']
  pdf_path: string | null
  xlsm_path: string | null
  message: string | null
  first_seen_at: string
  updated_at: string
  test_id: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS, ...(init?.headers ?? {}) },
  })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail ?? `API ${response.status}`)
  return response.json() as Promise<T>
}

export const api = {
  health: () => request<Health>('/health'),
  tests: () => request<Test[]>('/tests?include_nonaccepted=true&summary=true'),
  test: (id: string) => request<Test>(`/tests/${id}`),
  ingestion: () => request<IngestionJob[]>('/ingestion'),
  patchTest: (id: string, patch: Partial<Test>) => request<Test>(`/tests/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  approve: (id: string) => request<{ ok: true }>(`/tests/${id}/approve`, { method: 'POST' }),
  quarantine: (id: string) => request<{ ok: true }>(`/tests/${id}/quarantine`, { method: 'POST' }),
  remove: (id: string) => request<{ ok: true }>(`/tests/${id}`, { method: 'DELETE' }),
  rescan: () => request<{ ok: true }>('/ingestion/rescan', { method: 'POST' }),
  importParsed: (tests: Test[]) => request<{ count: number }>('/tests/import-parsed', { method: 'POST', body: JSON.stringify({ tests }) }),
  // Downloads go through fetch rather than a plain <a href> so they can carry
  // the auth header. Putting the token in the URL instead would leak it into
  // browser history and any logs.
  downloadExport: (includeNonaccepted = false) =>
    download(`/export.xlsx?include_nonaccepted=${includeNonaccepted}`, 'emission_compilation.xlsx'),
  downloadEvidence: (id: string, kind: 'pdf' | 'xlsm') =>
    download(`/tests/${id}/evidence/${kind}`, `${id}.${kind}`),
  /** Fire-and-forget wrapper: a failed download must say so, not vanish into
   *  an unhandled rejection the way a dead <a href> silently would. */
  downloadOrReport(run: () => Promise<void>, what: string): void {
    void run().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`${what} failed:`, error)
      window.alert(`${what} failed — ${detail}`)
    })
  },
}

/** Fetch a binary endpoint with auth and hand it to the browser as a file. */
async function download(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { headers: AUTH_HEADERS })
  if (!response.ok) {
    throw new Error((await response.json().catch(() => null))?.detail ?? `Download failed (${response.status})`)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const named = /filename="([^"]+)"/.exec(disposition)?.[1]
  const url = URL.createObjectURL(await response.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = named ?? fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
