import { create } from 'zustand'

export type MassUnit = 'mg/km' | 'g/km'

interface UnitState {
  massUnit: MassUnit
  setMassUnit: (unit: MassUnit) => void
}

const saved = typeof window !== 'undefined' ? window.localStorage.getItem('emlab-mass-unit') : null

export const useUnits = create<UnitState>((set) => ({
  massUnit: saved === 'g/km' ? 'g/km' : 'mg/km',
  setMassUnit: (massUnit) => {
    window.localStorage.setItem('emlab-mass-unit', massUnit)
    set({ massUnit })
  },
}))
