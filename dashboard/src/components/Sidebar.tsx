import { useMemo, useState } from 'react'
import { useLibrary } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { CYCLE_ORDER, PROJECT_ORDER, compliance } from '../lib/derive'
import { TARGET } from '../model/limits'
import { RagDot } from './common'
import type { Test } from '../model/types'

/** Rotating chevron switcher (points down when open, right when collapsed) —
 *  same affordance as antd's <Tree showLine>. */
function Switcher({ open }: { open: boolean }) {
  return (
    <span className="sb-switcher" aria-hidden>
      <svg width="10" height="10" viewBox="0 0 12 12" style={{ transform: `rotate(${open ? 0 : -90}deg)` }}>
        <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export function Sidebar() {
  const tests = useLibrary((s) => s.tests)
  const { selectedId, openTest } = useNav()
  const [open, setOpen] = useState<Record<string, boolean>>({ STLA: true })

  // group: project -> cycle -> tests
  const tree = useMemo(() => {
    const projects = [...new Set([...PROJECT_ORDER, ...tests.map((t) => t.project)])]
    return projects
      .map((proj) => {
        const inProj = tests.filter((t) => t.project === proj)
        const cycles = [...new Set([...CYCLE_ORDER, ...inProj.map((t) => t.cycle)])]
          .map((cyc) => ({ cycle: cyc, tests: inProj.filter((t) => t.cycle === cyc) }))
          .filter((c) => c.tests.length > 0)
        return { project: proj, count: inProj.length, cycles }
      })
      .filter((p) => p.count > 0 || PROJECT_ORDER.includes(p.project))
  }, [tests])

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }))

  return (
    <nav
      style={{
        width: 248,
        flex: 'none',
        borderRight: '1px solid var(--line)',
        background: 'rgba(255,255,255,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        overflowY: 'auto',
        padding: '16px 12px 40px',
      }}
    >
      <div className="eyebrow" style={{ padding: '4px 8px 10px' }}>
        Programs
      </div>
      {tree.map((p) => {
        const expandable = p.count > 0
        const expanded = expandable && open[p.project]
        return (
          <div key={p.project} style={{ marginBottom: 2 }}>
            <button
              onClick={() => expandable && toggle(p.project)}
              style={{ ...treeRow(false), cursor: expandable ? 'pointer' : 'default' }}
              className="font-display"
            >
              {expandable ? (
                <Switcher open={!!expanded} />
              ) : (
                <span className="sb-switcher" style={{ color: 'var(--ink-faint)' }}>·</span>
              )}
              <span style={{ fontWeight: 600, letterSpacing: '0.02em' }}>{p.project}</span>
              <span className="font-mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-faint)' }}>
                {p.count || '—'}
              </span>
            </button>
            {expanded && (
              <div className="sb-children">
                {p.cycles.map((c) => (
                  <CycleGroup
                    key={c.cycle}
                    cycle={c.cycle}
                    tests={c.tests}
                    selectedId={selectedId}
                    onOpen={openTest}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function CycleGroup({
  cycle,
  tests,
  selectedId,
  onOpen,
}: {
  cycle: string
  tests: Test[]
  selectedId: string | null
  onOpen: (id: string) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button onClick={() => setOpen(!open)} style={treeRow(false)} className="font-mono sb-branch">
        <Switcher open={open} />
        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--aubergine)' }}>{cycle}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-faint)' }}>{tests.length}</span>
      </button>
      {open && (
        <div className="sb-children">
          {tests
            .slice()
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .map((t) => {
              const v = compliance(t, TARGET).overall
              const active = t.id === selectedId
              return (
                <button
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  style={treeRow(active)}
                  className="sb-branch"
                  title={t.id}
                >
                  <RagDot level={v} size={7} />
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: active ? 'var(--ink)' : 'var(--ink-dim)',
                    }}
                  >
                    {t.config !== 'Unknown' ? `${t.config} ` : ''}
                    {t.date || t.id.slice(0, 12)}
                  </span>
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}

function treeRow(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    background: active ? 'var(--aubergine-wash)' : 'none',
    border: 'none',
    borderRadius: 8,
    color: active ? 'var(--aubergine)' : 'var(--ink)',
    padding: '7px 10px',
    cursor: 'pointer',
    fontSize: 13,
    transition: 'background 0.15s ease, color 0.15s ease',
  }
}
