import { useMemo, useState } from 'react'
import { useLibrary, applyFilters } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { FilterBar } from '../components/FilterBar'
import { Panel, Eyebrow, RagDot, Chip } from '../components/common'
import { ALL_POLL, LIMITED, compliance } from '../lib/derive'
import { TARGET, displayUnit, fmt, RAG_COLOR } from '../model/limits'
import type { Pollutant, Test } from '../model/types'
import { api } from '../lib/api'
import { useUnits } from '../store/useUnits'

type SortKey = 'date' | 'project' | 'cycle' | 'config' | Pollutant

export function MasterTable() {
  const tests = useLibrary((s) => s.tests)
  const filters = useLibrary((s) => s.filters)
  const { openTest } = useNav()
  const massUnit = useUnits((s) => s.massUnit)
  const [sort, setSort] = useState<SortKey>('date')
  const [dir, setDir] = useState<1 | -1>(-1)

  const rows = useMemo(() => {
    const filtered = applyFilters(tests, filters)
    const get = (t: Test): string | number => {
      if (ALL_POLL.includes(sort as Pollutant)) return t.results[sort as Pollutant] ?? -1
      return (t as unknown as Record<string, string>)[sort] ?? ''
    }
    return filtered.sort((a, b) => (get(a) > get(b) ? dir : get(a) < get(b) ? -dir : 0))
  }, [tests, filters, sort, dir])

  const toggle = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === 1 ? -1 : 1))
    else {
      setSort(k)
      setDir(-1)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <Eyebrow>Master table · vs STLA target</Eyebrow>
          <h2 className="font-display" style={{ fontSize: 22, fontWeight: 600, margin: '4px 0 0' }}>
            {rows.length} test{rows.length !== 1 ? 's' : ''}
          </h2>
        </div>
        <a className="btn" style={{ marginLeft: 'auto', textDecoration: 'none' }} href={api.exportUrl(false)}>Export Excel</a>
      </div>
      <FilterBar />
      <Panel ticks={false} className="rise">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                <Th onClick={() => toggle('date')} active={sort === 'date'} dir={dir} sticky>Date</Th>
                <Th onClick={() => toggle('config')} active={sort === 'config'} dir={dir}>Cfg</Th>
                <Th>Cycle</Th>
                <Th>Trans</Th>
                <Th>Lab</Th>
                <Th align="right">ODO</Th>
                {ALL_POLL.map((p) => (
                  <Th key={p} onClick={() => toggle(p)} active={sort === p} dir={dir} align="right">
                    {p}
                  </Th>
                ))}
                <Th>Status</Th>
              </tr>
              <tr>
                <td colSpan={6} />
                {ALL_POLL.map((p) => (
                  <td key={p} className="eyebrow" style={{ textAlign: 'right', padding: '0 10px 6px', fontSize: 8.5, color: 'var(--ink-faint)' }}>
                    {displayUnit(p, massUnit)}
                  </td>
                ))}
                <td />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const c = compliance(t, TARGET)
                return (
                  <tr
                    key={t.id}
                    onClick={() => openTest(t.id)}
                    style={{ cursor: 'pointer', borderTop: '1px solid var(--line)' }}
                    className="row"
                  >
                    <td style={td}><span className="font-mono">{t.date || '—'}</span></td>
                    <td style={td}>{t.config !== 'Unknown' ? <Chip>{t.config}</Chip> : <span style={{ color: 'var(--ink-faint)' }}>—</span>}</td>
                    <td style={td}><Chip tone="cyan">{t.cycle}</Chip></td>
                    <td style={td}>{t.transmission}</td>
                    <td style={td}>{t.lab}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="font-mono">{t.odo ?? '—'}</td>
                    {ALL_POLL.map((p) => (
                      <td key={p} style={{ ...td, textAlign: 'right' }} className="font-mono">
                        <span style={{ color: LIMITED.includes(p) ? RAG_COLOR[c.perPollutant[p].rag] : 'var(--ink-dim)' }}>
                          {fmt(t.results[p], p, massUnit)}
                        </span>
                      </td>
                    ))}
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <RagDot level={c.overall} />
                        {t.lowConfidence.length > 0 && (
                          <span title={`Needs review: ${t.lowConfidence.join(', ')}`} style={{ color: 'var(--warn)', fontSize: 12 }}>
                            ⚑
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <style>{`.row:hover td{background:var(--aubergine-wash)}`}</style>
    </div>
  )
}

const td: React.CSSProperties = { padding: '9px 10px', color: 'var(--ink)', whiteSpace: 'nowrap' }

function Th({
  children,
  onClick,
  active,
  dir,
  align = 'left',
  sticky,
}: {
  children?: React.ReactNode
  onClick?: () => void
  active?: boolean
  dir?: 1 | -1
  align?: 'left' | 'right'
  sticky?: boolean
}) {
  return (
    <th
      onClick={onClick}
      style={{
        textAlign: align,
        padding: '10px',
        cursor: onClick ? 'pointer' : 'default',
        position: sticky ? 'sticky' : undefined,
        left: sticky ? 0 : undefined,
        background: 'var(--panel)',
        borderBottom: '1px solid var(--line-bright)',
        whiteSpace: 'nowrap',
      }}
    >
      <span className="eyebrow" style={{ color: active ? 'var(--cyan)' : undefined }}>
        {children} {active ? (dir === 1 ? '↑' : '↓') : ''}
      </span>
    </th>
  )
}
