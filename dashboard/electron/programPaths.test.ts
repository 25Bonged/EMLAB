import { describe, it, expect } from 'vitest'
import { sanitizeFolderName, uniqueProgramFolder } from './programPaths.ts'

describe('sanitizeFolderName', () => {
  it('keeps safe names', () => {
    expect(sanitizeFolderName('STLA')).toBe('STLA')
  })
  it('replaces path-unsafe characters', () => {
    expect(sanitizeFolderName('A/B: C*?')).toBe('A_B_C')
  })
  it('falls back when empty after stripping', () => {
    expect(sanitizeFolderName('///')).toBe('program')
  })
  it('neutralises traversal names', () => {
    expect(sanitizeFolderName('..')).toBe('program')
    expect(sanitizeFolderName('.')).toBe('program')
    expect(sanitizeFolderName('...')).toBe('program')
    expect(sanitizeFolderName('../../etc')).toBe('etc')
    expect(sanitizeFolderName('a/../b')).toBe('a_b')
  })
  it('rejects Windows reserved device names', () => {
    expect(sanitizeFolderName('CON')).toBe('program')
    expect(sanitizeFolderName('com1')).toBe('program')
  })
})

describe('uniqueProgramFolder traversal safety', () => {
  it('never escapes the root for a traversal name', () => {
    expect(uniqueProgramFolder('/root', '..', () => false)).toBe('/root/program')
    expect(uniqueProgramFolder('/root', '../../etc/passwd', () => false)).toBe('/root/etc_passwd')
  })
})

describe('uniqueProgramFolder', () => {
  it('returns root/name when free', () => {
    expect(uniqueProgramFolder('/root', 'STLA', () => false)).toBe('/root/STLA')
  })
  it('suffixes on collision', () => {
    const taken = new Set(['/root/STLA'])
    expect(uniqueProgramFolder('/root', 'STLA', (p) => taken.has(p))).toBe('/root/STLA-2')
  })
})
