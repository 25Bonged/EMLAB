import path from 'node:path'

/** Turn a program name into a filesystem-safe folder segment. */
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?* -]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'program'
}

/**
 * Absolute folder path for a new program under `root`, appending -2, -3, … if
 * the sanitized path is already taken. `exists` reports whether a candidate
 * path is in use (real fs check in production, injected in tests).
 */
export function uniqueProgramFolder(root: string, name: string, exists: (p: string) => boolean): string {
  const base = sanitizeFolderName(name)
  let candidate = path.join(root, base)
  let n = 2
  while (exists(candidate)) {
    candidate = path.join(root, `${base}-${n}`)
    n += 1
  }
  return candidate
}
