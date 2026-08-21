import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, ReferenceLine, Cell, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useLibrary, applyFilters } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { FilterBar } from '../components/FilterBar'
import { Panel, Eyebrow, RagDot } from '../components/common'
import { confirmedRegulatoryCompliance, isRegulatoryBasisConfirmed, LIMITED, compliance, regulatoryCompliance, regulatoryProfile, targetCompliance, targetProfile } from '../lib/derive'
import { displayUnit, displayValue, fmt, rag, RAG_COLOR, type LimitProfile } from '../model/limits'
import type { Pollutant, Test } from '../model/types'
import { useUnits } from '../store/useUnits'

export function Compliance() {
  const tests = useLibrary((s) => s.tests)
  const filters = useLibrary((s) => s.filters)
  const { openTest } = useNav()
  const massUnit = useUnits((s) => s.massUnit)
  const rows = useMemo(() => applyFilters(tests, filters), [tests, filters])
  const [mult, setMult] = useState(1)

  const baseTarget = useMemo(() => commonProfile(rows.map(targetProfile).filter(Boolean) as LimitProfile[]), [rows])
  const baseReg = useMemo(() => commonProfile(rows.filter(isRegulatoryBasisConfirmed).map(regulatoryProfile).filter(Boolean) as LimitProfile[]), [rows])
  const scaledTarget = useMemo<LimitProfile | null>(() => baseTarget ? ({
    ...baseTarget,
    id: 'whatif',
    label: `${baseTarget.label} ×${mult.toFixed(2)}`,
    limits: Object.fromEntries(
      Object.entries(baseTarget.limits).map(([k, v]) => [k, v == null ? null : v * mult]),
    ) as LimitProfile['limits'],
  }) : null, [baseTarget, mult])

  const normRows = rows.map((t) => confirmedRegulatoryCompliance(t)).filter(Boolean)
  const normPass = normRows.filter((c) => c!.overall !== 'fail').length
  const normPending = rows.length - normRows.length
  const tgtPass = rows.filter((t) => {
    const c = targetCompliance(t)
    return c ? c.overall !== 'fail' : false
  }).length

  return (
    <div>
      <Eyebrow>Compliance · resolved regulation vs engineering target</Eyebrow>
      <h2 className="font-display" style={{ fontSize: 22, fontWeight: 600, margin: '4px 0 14px' }}>
        Pollutant compliance
      </h2>
      <FilterBar />

      <Panel ticks={false}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', padding: '14px 18px', flexWrap: 'wrap' }}>
          <div>
            <Eyebrow>Target what-if</Eyebrow>
            <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginTop: 3 }}>
              {baseTarget ? `Temporary scenario for ${baseTarget.label}; not saved or exported.` : 'No common engineering target in the current filter.'}
            </div>
          </div>
          <input type="range" min={0.5} max={1.5} step={0.05} value={mult} onChange={(e) => setMult(+e.target.value)} style={{ flex: 1, minWidth: 180, accentColor: 'var(--aubergine)' }} />
          <div className="font-cluster" style={{ fontWeight: 700, fontSize: 20, minWidth: 70, textAlign: 'right', color: 'var(--aubergine)' }}>×{mult.toFixed(2)}</div>
          <button className="btn compact-btn" onClick={() => setMult(1)}>Reset</button>
        </div>
      </Panel>

      <div style={{ height: 16 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14, marginBottom: 16 }}>
        <PassCard label={baseReg ? `Pass vs ${baseReg.label}` : normPending ? 'Regulation basis pending' : 'Pass vs regulation'} pass={normPass} total={normRows.length} note={normPending ? `${normPending} need basis confirmation` : undefined} />
        <PassCard label={baseTarget ? (mult === 1 ? `Pass vs ${baseTarget.label}` : `Pass vs ${baseTarget.label} ×${mult.toFixed(2)}`) : 'Engineering target not configured'} pass={tgtPass} total={rows.length} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 16 }}>
        {LIMITED.map((p) => (
          <PollutantCard key={p} pollutant={p} tests={rows} massUnit={massUnit} normProfile={baseReg} targetProfile={scaledTarget} />
        ))}
      </div>

      <Panel ticks={false}>
        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line)' }}>
          <Eyebrow>Compliance matrix · vs target</Eyebrow>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={matHead}><span className="eyebrow">Test</span></th>
                {LIMITED.map((p) => (
                  <th key={p} style={{ ...matHead, textAlign: 'center' }}><span className="eyebrow">{p}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const c = scaledTarget ? compliance(t, scaledTarget) : (targetCompliance(t) ?? regulatoryCompliance(t))
                return (
                  <tr key={t.id} onClick={() => openTest(t.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--line)' }} className="row">
                    <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                      <span className="font-mono" style={{ fontSize: 12 }}>{t.config !== 'Unknown' ? `${t.config} · ` : ''}{t.cycle} · {t.date}</span>
                    </td>
                    {LIMITED.map((p) => (
                      <td key={p} style={{ textAlign: 'center', padding: '9px' }}>
                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                          <RagDot level={c.perPollutant[p].rag} />
                          <span className="font-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{fmt(t.results[p], p, massUnit)}</span>
                        </div>
                      </td>
                    ))}
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

const matHead: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', background: 'var(--panel)' }

function PassCard({ label, pass, total, note }: { label: string; pass: number; total: number; note?: string }) {
  const pct = total ? Math.round((pass / total) * 100) : 0
  const color = pct === 100 ? RAG_COLOR.pass : pct >= 70 ? RAG_COLOR.warn : RAG_COLOR.fail
  return (
    <Panel>
      <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 18 }}>
        <div>
          <Eyebrow>{label}</Eyebrow>
          <div className="font-cluster" style={{ fontSize: 34, fontWeight: 700, color, marginTop: 6 }}>
            {pass}<span style={{ color: 'var(--ink-faint)', fontSize: 16 }}> / {total}</span>
          </div>
        </div>
        {note && <div style={{ fontSize: 11, color: 'var(--warn)', marginLeft: 8 }}>{note}</div>}
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="font-cluster" style={{ fontSize: 28, fontWeight: 700, color }}>{pct}%</div>
          <div style={{ width: 120, height: 6, background: 'var(--bg-2)', borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: color }} />
          </div>
        </div>
      </div>
    </Panel>
  )
}

function PollutantCard({ pollutant, tests, massUnit, normProfile, targetProfile }: { pollutant: Pollutant; tests: Test[]; massUnit: 'mg/km' | 'g/km'; normProfile: LimitProfile | null; targetProfile: LimitProfile | null }) {
  const norm = normProfile?.limits[pollutant] ?? null
  const target = targetProfile?.limits[pollutant] ?? null
  const data = tests
    .filter((t) => t.results[pollutant] != null)
    .map((t) => ({
      name: `${t.config !== 'Unknown' ? t.config + ' ' : ''}${t.date?.slice(5) || t.id.slice(0, 6)}`,
      value: displayValue(t.results[pollutant], pollutant, massUnit) as number,
      canonical: t.results[pollutant] as number,
      id: t.id,
    }))
  const shownTarget = displayValue(target, pollutant, massUnit)
  const shownNorm = displayValue(norm, pollutant, massUnit)
  const worst = data.length ? Math.max(...data.map((d) => d.value)) : 0
  const axisMax = Math.max(worst * 1.1, (shownTarget ?? 0) * 1.2)

  return (
    <Panel>
      <div style={{ padding: '13px 15px 6px', display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="font-cluster" style={{ fontSize: 17, fontWeight: 700 }}>{pollutant}</span>
        <span className="eyebrow">{displayUnit(pollutant, massUnit)}</span>
        <span className="font-mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-faint)' }}>
          tgt {target != null ? fmt(target, pollutant, massUnit) : '—'}
        </span>
      </div>
      <div style={{ height: 132, padding: '0 6px 6px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 10, bottom: 2, left: 0 }} barCategoryGap="26%">
            <XAxis dataKey="name" hide />
            <YAxis domain={[0, axisMax || 'auto']} hide />
            <Tooltip
              cursor={{ fill: 'rgba(74,21,75,0.06)' }}
              contentStyle={{ background: '#fff', border: '1px solid var(--line-bright)', borderRadius: 10, fontSize: 12 }}
              labelFormatter={(_, p) => (p?.[0]?.payload?.name ?? '')}
              formatter={(v) => [Number(v).toLocaleString('en-US', { maximumFractionDigits: massUnit === 'g/km' ? 6 : 3 }), pollutant]}
            />
            {shownTarget != null && <ReferenceLine y={shownTarget} stroke={RAG_COLOR.warn} strokeDasharray="4 3" strokeWidth={1.2} />}
            {shownNorm != null && shownNorm <= axisMax && <ReferenceLine y={shownNorm} stroke={RAG_COLOR.fail} strokeDasharray="4 3" strokeWidth={1.2} />}
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.id} fill={RAG_COLOR[rag(d.canonical, target)]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

function commonProfile(profiles: LimitProfile[]): LimitProfile | null {
  if (!profiles.length) return null
  const first = profiles[0]
  return profiles.every((p) => p.id === first.id) ? first : null
}
