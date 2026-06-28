import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { useLibrary } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { Panel, Eyebrow, RagDot, Chip } from '../components/common'
import { ALL_POLL, LIMITED, compliance } from '../lib/derive'
import { TARGET, displayUnit, fmt, RAG_COLOR } from '../model/limits'
import type { Pollutant, Test, TracePoint } from '../model/types'
import { useUnits } from '../store/useUnits'

export function Compare() {
  const tests = useLibrary((s) => s.tests)
  const loadDetail = useLibrary((s) => s.loadDetail)
  const massUnit = useUnits((s) => s.massUnit)
  const { compareA, compareB, setCompare } = useNav()
  const A = tests.find((t) => t.id === compareA) ?? null
  const B = tests.find((t) => t.id === compareB) ?? null

  useEffect(() => {
    if (compareA) void loadDetail(compareA)
    if (compareB) void loadDetail(compareB)
  }, [compareA, compareB, loadDetail])

  return (
    <div>
      <Eyebrow>Compare · two tests side by side</Eyebrow>
      <h2 className="font-display" style={{ fontSize: 22, fontWeight: 600, margin: '4px 0 16px' }}>
        Test comparison
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 1fr', gap: 12, marginBottom: 18, alignItems: 'center' }}>
        <TestPicker label="Test A" tests={tests} value={compareA} onChange={(id) => setCompare('A', id)} accent="var(--cyan)" />
        <div className="font-display" style={{ textAlign: 'center', color: 'var(--ink-faint)', fontWeight: 700 }}>VS</div>
        <TestPicker label="Test B" tests={tests} value={compareB} onChange={(id) => setCompare('B', id)} accent="var(--link)" />
      </div>

      {!A || !B ? (
        <Panel><div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-dim)' }}>Select two tests to compare.</div></Panel>
      ) : (
        <>
          <Panel ticks={false} className="rise">
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line)' }}><Eyebrow>Emission results · Δ vs STLA target</Eyebrow></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={cTh}><span className="eyebrow">Pollutant</span></th>
                    <th style={{ ...cTh, textAlign: 'right' }}><span className="eyebrow" style={{ color: 'var(--cyan)' }}>A</span></th>
                    <th style={{ ...cTh, textAlign: 'right' }}><span className="eyebrow" style={{ color: 'var(--link)' }}>B</span></th>
                    <th style={{ ...cTh, textAlign: 'right' }}><span className="eyebrow">Δ</span></th>
                    <th style={{ ...cTh, textAlign: 'right' }}><span className="eyebrow">Δ %</span></th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_POLL.map((p) => <DeltaRow key={p} p={p} A={A} B={B} massUnit={massUnit} />)}
                </tbody>
              </table>
            </div>
          </Panel>

          <div style={{ height: 16 }} />
          <TraceCompare A={A} B={B} />
        </>
      )}
    </div>
  )
}

const cTh: React.CSSProperties = { textAlign: 'left', padding: '11px 16px', background: 'var(--panel)' }

function DeltaRow({ p, A, B, massUnit }: { p: Pollutant; A: Test; B: Test; massUnit: 'mg/km' | 'g/km' }) {
  const a = A.results[p]
  const b = B.results[p]
  const cA = compliance(A, TARGET).perPollutant[p].rag
  const cB = compliance(B, TARGET).perPollutant[p].rag
  const delta = a != null && b != null ? b - a : null
  const pct = a != null && b != null && a !== 0 ? (b - a) / a : null
  const better = delta != null ? (delta < 0 ? 'var(--pass)' : delta > 0 ? 'var(--fail)' : 'var(--ink-dim)') : 'var(--ink-faint)'
  return (
    <tr style={{ borderTop: '1px solid var(--line)' }}>
      <td style={{ padding: '10px 16px' }}>
        <span className="font-cluster" style={{ fontWeight: 600 }}>{p}</span>
        <span className="eyebrow" style={{ marginLeft: 8 }}>{displayUnit(p, massUnit)}</span>
      </td>
      <td style={{ ...cell, color: LIMITED.includes(p) ? RAG_COLOR[cA] : 'var(--ink)' }}>{fmt(a, p, massUnit)}</td>
      <td style={{ ...cell, color: LIMITED.includes(p) ? RAG_COLOR[cB] : 'var(--ink)' }}>{fmt(b, p, massUnit)}</td>
      <td style={{ ...cell, color: better }}>{delta == null ? '—' : `${delta > 0 ? '+' : ''}${fmt(delta, p, massUnit)}`}</td>
      <td style={{ ...cell, color: better }}>{pct == null ? '—' : `${pct > 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`}</td>
    </tr>
  )
}
const cell: React.CSSProperties = { padding: '10px 16px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }

function TestPicker({
  label, tests, value, onChange, accent,
}: { label: string; tests: Test[]; value: string | null; onChange: (id: string) => void; accent: string }) {
  const t = tests.find((x) => x.id === value)
  return (
    <Panel>
      <div style={{ padding: '12px 14px' }}>
        <Eyebrow><span style={{ color: accent }}>{label}</span></Eyebrow>
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', margin: '8px 0' }}>
          <option value="">Select test…</option>
          {tests.map((x) => (
            <option key={x.id} value={x.id}>{`${x.config !== 'Unknown' ? x.config + ' ' : ''}${x.cycle} · ${x.date} · ${x.vnNo}`}</option>
          ))}
        </select>
        {t && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <Chip tone="cyan">{t.cycle}</Chip><Chip>{t.transmission}</Chip><Chip>{t.lab}</Chip>
            {t.odo != null && <Chip>ODO {t.odo}</Chip>}
            <RagDot level={compliance(t, TARGET).overall} />
          </div>
        )}
      </div>
    </Panel>
  )
}

// Continuous trace channels that can be plotted over the cycle. PM/PN mass is
// gravimetric (no second-by-second trace), so it is intentionally excluded.
const TRACE_CHANNELS: { key: keyof TracePoint; label: string }[] = [
  { key: 'NOx', label: 'NOx' },
  { key: 'CO', label: 'CO' },
  { key: 'CO2', label: 'CO₂' },
  { key: 'THC', label: 'THC' },
  { key: 'CH4', label: 'CH₄' },
  { key: 'NMHC', label: 'NMHC' },
  { key: 'O2', label: 'O₂' },
  { key: 'PN', label: 'PN' },
]

function TraceCompare({ A, B }: { A: Test; B: Test }) {
  const [series, setSeries] = useState<keyof TracePoint>('NOx')

  // Only offer channels that actually carry numeric data in at least one trace,
  // so the selector never lands the user on an empty plot.
  const channels = useMemo(() => {
    const has = (key: keyof TracePoint) =>
      A.trace?.dilute.some((d) => typeof d[key] === 'number') ||
      B.trace?.dilute.some((d) => typeof d[key] === 'number')
    return TRACE_CHANNELS.filter((c) => has(c.key))
  }, [A, B])

  // Keep the selection valid as the test pair (and thus available channels) changes.
  const active: keyof TracePoint = channels.some((c) => c.key === series) ? series : channels[0]?.key ?? series
  const unit = A.units?.trace?.dilute?.[active] ?? B.units?.trace?.dilute?.[active] ?? ''
  const label = channels.find((c) => c.key === active)?.label ?? String(active)

  const data = useMemo(() => {
    if (!A.trace || !B.trace) return null
    const map = new Map<number, { t: number; A?: number; B?: number; spd?: number }>()
    for (const d of A.trace.dilute) map.set(d.t, { t: d.t, A: d[active], spd: d.speed })
    for (const d of B.trace.dilute) {
      const e = map.get(d.t) ?? { t: d.t }
      e.B = d[active]
      map.set(d.t, e)
    }
    return [...map.values()].sort((x, y) => x.t - y.t)
  }, [A, B, active])

  if (!data) return (
    <Panel><div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>
      No trace (.xlsm) data available for one of these tests.
    </div></Panel>
  )

  return (
    <Panel ticks={false}>
      <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Eyebrow>Dilute {label} concentration over cycle · A vs B{unit ? ` · ${unit}` : ''}</Eyebrow>
        {channels.length > 1 && (
          <div role="tablist" aria-label="Trace channel" style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {channels.map((c) => {
              const on = c.key === active
              return (
                <button
                  key={c.key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSeries(c.key)}
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: 90,
                    cursor: 'pointer',
                    color: on ? 'var(--aubergine)' : 'var(--ink-dim)',
                    border: `1px solid ${on ? 'rgba(74,21,75,0.32)' : 'var(--line-bright)'}`,
                    background: on ? 'var(--aubergine-wash)' : '#faf8fb',
                  }}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div style={{ height: 240, padding: 14 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: -10 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={{ stroke: 'var(--line-bright)' }} tickLine={false} unit="s" />
            <YAxis tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--line-bright)', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="A" stroke="var(--cyan)" dot={false} strokeWidth={1.8} name={`A · ${A.date}`} isAnimationActive={false} />
            <Line type="monotone" dataKey="B" stroke="var(--link)" dot={false} strokeWidth={1.8} name={`B · ${B.date}`} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}
