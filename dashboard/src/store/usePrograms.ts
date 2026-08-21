import { create } from 'zustand'
import { api, type Program } from '../lib/api'

interface ProgramsState {
  programs: Program[]
  error: string | null
  load: () => Promise<void>
  // Returns the created program (not just void) so a caller that's staging
  // an import behind a "no program yet" prompt can select and target it
  // immediately, without a second round trip to find it in the reloaded list.
  create: (name: string) => Promise<Program>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const usePrograms = create<ProgramsState>((set, get) => ({
  programs: [],
  error: null,
  load: async () => {
    try {
      set({ programs: await api.programs(), error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
  create: async (name) => { const program = await api.createProgram(name); await get().load(); return program },
  rename: async (id, name) => { await api.renameProgram(id, name); await get().load() },
  remove: async (id) => { await api.removeProgram(id); await get().load() },
}))
