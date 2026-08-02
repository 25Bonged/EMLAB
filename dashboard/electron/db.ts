import { createHash } from 'node:crypto'

const RUN_TS = /(\d{4}-\d{2}-\d{2})[ _T](\d{2}-\d{2}-\d{2})/

export function identityKey(test: Record<string, any>, fallbackStem: string): string {
  const fields = [
    String(test.vehicleModel || '').trim().toLowerCase(),
    String(test.vnNo || '').trim().toLowerCase(),
    String(test.date || '').trim(),
    String(test.cycle || '').trim().toLowerCase(),
  ]
  if (fields.filter(Boolean).length < 3) return `stem|${fallbackStem.toLowerCase()}`
  const match = RUN_TS.exec(fallbackStem || '')
  const runTs = match ? `${match[1]}_${match[2]}` : ''
  return [...fields, runTs].join('|')
}

export function testId(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 24)
}

export function utcnow(): string {
  return new Date().toISOString()
}
