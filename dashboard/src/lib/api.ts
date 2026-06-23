import type { Test } from '../model/types'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

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
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
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
  exportUrl: (includeNonaccepted = false) => `${API_BASE}/export.xlsx?include_nonaccepted=${includeNonaccepted}`,
  evidenceUrl: (id: string, kind: 'pdf' | 'xlsm') => `${API_BASE}/tests/${id}/evidence/${kind}`,
}
