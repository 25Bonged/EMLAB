import { create } from 'zustand'
import { api, type Program } from '../lib/api'

interface ProgramsState {
  programs: Program[]
  error: string | null
  load: () => Promise<void>
  create: (name: string) => Promise<void>
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
  create: async (name) => { await api.createProgram(name); await get().load() },
  rename: async (id, name) => { await api.renameProgram(id, name); await get().load() },
  remove: async (id) => { await api.removeProgram(id); await get().load() },
}))
