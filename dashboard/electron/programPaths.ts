import path from 'node:path'

// Windows reserved device names (case-insensitive) — a folder named CON/PRN/…
// is rejected by the OS, so map them to the fallback.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Turn a program name into a filesystem-safe folder segment.
 *  Collapses path separators, Windows-illegal chars, dots, whitespace and
 *  control chars to '_', so a name can never contain a `.`/`..` traversal
 *  component or otherwise escape the root. */
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .trim()
    // Matching control chars is the point: they must be stripped from a name
    // that becomes a path segment, or a crafted name can smuggle them onto
    // the filesystem. Hence the rule is disabled for this line only.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*.\s\x00-\x1f-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned || RESERVED.test(cleaned)) return 'program'
  return cleaned
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
