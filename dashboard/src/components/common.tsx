import type { ReactNode } from 'react'
import type { RagLevel } from '../model/types'
import { RAG_COLOR } from '../model/limits'

export function Panel({
  children,
  className = '',
  ticks = true,
}: {
  children: ReactNode
  className?: string
  ticks?: boolean
}) {
  return (
    <div data-reveal className={`panel ${ticks ? 'panel-ticks' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>
}

const RAG_LABEL: Record<RagLevel, string> = { pass: 'PASS', warn: 'MARGINAL', fail: 'FAIL', na: 'N/A' }

export function RagDot({ level, size = 8 }: { level: RagLevel; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        background: RAG_COLOR[level],
        boxShadow: level !== 'na' ? `0 0 0 3px ${RAG_COLOR[level]}22` : 'none',
        display: 'inline-block',
        flex: 'none',
      }}
    />
  )
}

export function RagBadge({ level }: { level: RagLevel }) {
  const c = RAG_COLOR[level]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        padding: '5px 11px',
        borderRadius: 90,
        color: c,
        border: `1px solid ${c}33`,
        background: `${c}12`,
      }}
    >
      <RagDot level={level} size={6} />
      {RAG_LABEL[level]}
    </span>
  )
}

export function Chip({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'cyan' }) {
  return (
    <span
      className="font-mono"
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 90,
        border: `1px solid ${tone === 'cyan' ? 'rgba(74,21,75,0.22)' : 'var(--line-bright)'}`,
        color: tone === 'cyan' ? 'var(--aubergine)' : 'var(--ink-dim)',
        background: tone === 'cyan' ? 'var(--aubergine-wash)' : '#faf8fb',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}
