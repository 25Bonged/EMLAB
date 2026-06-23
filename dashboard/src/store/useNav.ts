import { create } from 'zustand'

export type View = 'overview' | 'intake' | 'table' | 'compliance' | 'compare' | 'trends' | 'engineering' | 'report' | 'detail'

interface NavState {
  view: View
  selectedId: string | null
  compareA: string | null
  compareB: string | null
  go: (view: View) => void
  openTest: (id: string) => void
  setCompare: (slot: 'A' | 'B', id: string | null) => void
  startCompare: (a: string, b?: string) => void
}

export const useNav = create<NavState>((set) => ({
  view: 'overview',
  selectedId: null,
  compareA: null,
  compareB: null,
  go: (view) => set({ view }),
  openTest: (id) => set({ view: 'detail', selectedId: id }),
  setCompare: (slot, id) => set(slot === 'A' ? { compareA: id } : { compareB: id }),
  startCompare: (a, b) => set({ view: 'compare', compareA: a, compareB: b ?? null }),
}))
