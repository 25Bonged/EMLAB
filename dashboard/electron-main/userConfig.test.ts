import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadOrPromptWatchFolder } from './userConfig.ts'

describe('loadOrPromptWatchFolder', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'emlab-uc-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('prompts and persists on first run', async () => {
    const picked = path.join(dir, 'OneDrive-Reports')
    const pick = async () => picked
    const folder = await loadOrPromptWatchFolder(dir, pick)
    expect(folder).toBe(picked)
    const saved = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf-8'))
    expect(saved.watch_folder).toBe(picked)
  })

  it('reuses the saved folder on a later run without prompting', async () => {
    const picked = path.join(dir, 'OneDrive-Reports')
    let calls = 0
    const pick = async () => { calls++; return picked }
    await loadOrPromptWatchFolder(dir, pick)
    const second = await loadOrPromptWatchFolder(dir, pick)
    expect(second).toBe(picked)
    expect(calls).toBe(1)
  })

  it('returns null if the user cancels the first-run picker', async () => {
    const pick = async () => null
    const folder = await loadOrPromptWatchFolder(dir, pick)
    expect(folder).toBeNull()
    expect(existsSync(path.join(dir, 'config.json'))).toBe(false)
  })
})
