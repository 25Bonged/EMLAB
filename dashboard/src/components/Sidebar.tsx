import { useEffect, useMemo, useState } from 'react'
import { useLibrary } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { usePrograms } from '../store/usePrograms'
import { CYCLE_ORDER, compliance } from '../lib/derive'
import { TARGET } from '../model/limits'
import { RagDot } from './common'
import { ProgramDialog } from './ProgramDialog'
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

type Dialog = { mode: 'create' } | { mode: 'rename'; id: string; name: string } | null

export function Sidebar() {
  const tests = useLibrary((s) => s.tests)
  const { selectedId, openTest } = useNav()
  const selectProgram = useNav((s) => s.selectProgram)
  const selectedProgram = useNav((s) => s.selectedProgram)

  const programs = usePrograms((s) => s.programs)
  const loadPrograms = usePrograms((s) => s.load)
  const createProgram = usePrograms((s) => s.create)
  const renameProgram = usePrograms((s) => s.rename)
  const removeProgram = usePrograms((s) => s.remove)

  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [dialog, setDialog] = useState<Dialog>(null)

  useEffect(() => { void loadPrograms() }, [loadPrograms])

  // program -> cycle -> tests, joining each program's tests by program_id
  const tree = useMemo(() => programs.map((prog) => {
    const inProg = tests.filter((t) => t.program_id === prog.id)
    const cycles = [...new Set([...CYCLE_ORDER, ...inProg.map((t) => t.cycle)])]
      .map((cyc) => ({ cycle: cyc, tests: inProg.filter((t) => t.cycle === cyc) }))
      .filter((c) => c.tests.length > 0)
    return { id: prog.id, name: prog.name, count: inProg.length, cycles }
  }), [programs, tests])

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 10px' }}>
        <span className="eyebrow">Programs</span>
        <button
          className="btn"
          style={{ padding: '2px 9px', fontSize: 12 }}
          onClick={() => setDialog({ mode: 'create' })}
          title="Create a program"
        >
          ＋ New
        </button>
      </div>

      {programs.length === 0 && (
        <div style={{ padding: '10px 8px', color: 'var(--ink-faint)', fontSize: 12.5, lineHeight: 1.5 }}>
          No programs yet. Create one to start dropping FEV reports into its folder.
        </div>
      )}

      {tree.map((p) => {
        const expandable = p.count > 0
        const expanded = expandable && open[p.id]
        const active = selectedProgram === p.id
        return (
          <div key={p.id} style={{ marginBottom: 2 }}>
            <div
              className="sb-program-row"
              style={{ ...treeRow(active), display: 'flex', alignItems: 'center' }}
              onClick={() => { selectProgram(p.id); if (expandable) toggle(p.id) }}
            >
              {expandable ? (
                <Switcher open={!!expanded} />
              ) : (
                <span className="sb-switcher" style={{ color: 'var(--ink-faint)' }}>·</span>
              )}
              <span className="font-display" style={{ fontWeight: 600, letterSpacing: '0.02em' }}>{p.name}</span>
              <span className="font-mono sb-count" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-faint)' }}>
                {p.count || '—'}
              </span>
              <span className="sb-actions" style={{ display: 'none', gap: 2, marginLeft: 6 }}>
                <button
                  title="Rename program"
                  onClick={(e) => { e.stopPropagation(); setDialog({ mode: 'rename', id: p.id, name: p.name }) }}
                  style={iconBtn}
                >✎</button>
                <button
                  title="Delete program (keeps files on disk)"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`Delete program “${p.name}” and its ${p.count} test(s)? Files on disk are kept.`)) {
                      void removeProgram(p.id)
                    }
                  }}
                  style={iconBtn}
                >🗑</button>
              </span>
            </div>
            {expanded &&
              p.cycles.map((c) => (
                <div className="sb-children" key={c.cycle}>
                  <CycleGroup cycle={c.cycle} tests={c.tests} selectedId={selectedId} onOpen={openTest} />
                </div>
              ))}
          </div>
        )
      })}

      {dialog?.mode === 'create' && (
        <ProgramDialog title="New program" onSubmit={createProgram} onClose={() => setDialog(null)} />
      )}
      {dialog?.mode === 'rename' && (
        <ProgramDialog
          title="Rename program"
          initial={dialog.name}
          onSubmit={(name) => renameProgram(dialog.id, name)}
          onClose={() => setDialog(null)}
        />
      )}
    </nav>
  )
}

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 12, padding: '0 2px',
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
