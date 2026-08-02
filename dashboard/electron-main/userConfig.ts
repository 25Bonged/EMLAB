import fs from 'node:fs'
import path from 'node:path'

export type FolderPicker = () => Promise<string | null>

interface UserConfig {
  watch_folder: string
}

function configPath(userDataDir: string): string {
  return path.join(userDataDir, 'config.json')
}

export function readUserConfig(userDataDir: string): UserConfig | null {
  const file = configPath(userDataDir)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    // A corrupt config.json (e.g. from a crash mid-write) must not
    // permanently brick the app -- treat it the same as "no config" so the
    // first-run picker reappears instead of the app failing to start with
    // no way for a non-technical user to recover.
    return null
  }
}

function writeUserConfig(userDataDir: string, config: UserConfig): void {
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(config, null, 2))
}

/** Returns the persisted watch folder, or prompts via `pick` on first run. Returns null if the user cancels. */
export async function loadOrPromptWatchFolder(userDataDir: string, pick: FolderPicker): Promise<string | null> {
  const existing = readUserConfig(userDataDir)
  if (existing?.watch_folder) return existing.watch_folder

  const chosen = await pick()
  if (!chosen) return null
  writeUserConfig(userDataDir, { watch_folder: chosen })
  return chosen
}

export function setWatchFolder(userDataDir: string, folder: string): void {
  writeUserConfig(userDataDir, { watch_folder: folder })
}
