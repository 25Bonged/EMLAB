import { create } from 'zustand'
import type { Test } from '../model/types'
import type { IngestProgress } from '../ingest/ingest'
import { api, type Health, type IngestionJob } from '../lib/api'
import { useNav } from './useNav'

export interface Filters {
  project?: string
  cycle?: string
  config?: string
  transmission?: string
  lab?: string
  search?: string
}

interface LibraryState {
  tests: Test[]
  records: Test[]
  ingestion: IngestionJob[]
  health: Health | null
  loading: boolean
  progress: IngestProgress | null
  error: string | null
  filters: Filters
  load: () => Promise<void>
  refresh: () => Promise<void>
  loadDetail: (id: string) => Promise<void>
  importFiles: (files: File[]) => Promise<number>
  patchTest: (id: string, patch: Partial<Test>) => Promise<void>
  approve: (id: string) => Promise<void>
  quarantine: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  rescan: () => Promise<void>
  setFilter: (f: Partial<Filters>) => void
  resetFilters: () => void
}

async function fetchState() {
  const [records, ingestion, health] = await Promise.all([api.tests(), api.ingestion(), api.health()])
  return {
    records,
    tests: records.filter((test) => test.status === 'accepted' || !test.status),
    ingestion,
    health,
  }
}

export const useLibrary = create<LibraryState>((set, get) => ({
  tests: [],
  records: [],
  ingestion: [],
  health: null,
  loading: false,
  progress: null,
  error: null,
  filters: {},
  load: async () => {
    set({ loading: true, error: null })
    try {
      set({ ...(await fetchState()), loading: false })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },
  refresh: async () => {
    try {
      const next = await fetchState()
      set((state) => {
        const records = next.records.map((summary) => {
          const current = state.records.find((test) => test.id === summary.id)
          return current?.trace
            ? { ...summary, trace: current.trace, phases: current.phases, units: current.units ?? summary.units }
            : summary
        })
        return {
          ...next,
          records,
          tests: records.filter((test) => test.status === 'accepted' || !test.status),
          error: null,
        }
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
  loadDetail: async (id) => {
    const detail = await api.test(id)
    set((state) => ({
      records: state.records.map((test) => test.id === id ? detail : test),
      tests: state.tests.map((test) => test.id === id ? detail : test),
    }))
  },
  importFiles: async (files) => {
    if (!get().health?.can_edit) throw new Error('Imports are allowed only from the host engineering PC')
    set({ loading: true, progress: { stage: 'Reading files…', done: 0, total: 1 }, error: null })
    try {
      // pdfjs/xlsx/jszip are heavy and only needed for manual browser uploads
      // (production ingest is server-side). Load them on demand so they stay
      // out of the main bundle.
      const { ingestFiles } = await import('../ingest/ingest')
      const parsed = await ingestFiles(files, (progress) => set({ progress }))
      const result = await api.importParsed(parsed, useNav.getState().selectedProgram)
      set({ ...(await fetchState()), loading: false, progress: null })
      return result.count
    } catch (error) {
      set({ loading: false, progress: null, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },
  patchTest: async (id, patch) => {
    await api.patchTest(id, patch)
    set(await fetchState())
  },
  approve: async (id) => {
    await api.approve(id)
    set(await fetchState())
  },
  quarantine: async (id) => {
    await api.quarantine(id)
    set(await fetchState())
  },
  remove: async (id) => {
    await api.remove(id)
    set(await fetchState())
  },
  rescan: async () => {
    await api.rescan()
    set(await fetchState())
  },
  setFilter: (f) => set({ filters: { ...get().filters, ...f } }),
  resetFilters: () => set({ filters: {} }),
}))

export function applyFilters(tests: Test[], f: Filters): Test[] {
  return tests.filter((t) => {
    if (f.project && t.project !== f.project) return false
    if (f.cycle && t.cycle !== f.cycle) return false
    if (f.config && t.config !== f.config) return false
    if (f.transmission && t.transmission !== f.transmission) return false
    if (f.lab && t.lab !== f.lab) return false
    if (f.search) {
      const s = f.search.toLowerCase()
      if (!`${t.id} ${t.vehicleModel} ${t.vnNo} ${t.vinSampleId}`.toLowerCase().includes(s)) return false
    }
    return true
  })
}
