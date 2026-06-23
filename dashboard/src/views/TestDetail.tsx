import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { useLibrary } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { Panel, Eyebrow, RagBadge, RagDot, Chip } from '../components/common'
import { ALL_POLL, LIMITED, compliance } from '../lib/derive'
import { NORM, TARGET, displayUnit, fmt, rag, RAG_COLOR, TRACE_UNIT } from '../model/limits'
import type { Pollutant, Test } from '../model/types'
import { api } from '../lib/api'
import { useUnits } from '../store/useUnits'
import { coldStart, catalystLightoff, cycleMetrics, reconcile, type TraceChannel as LOChannel } from '../lib/engineering'

export function TestDetail() {
  const tests = useLibrary((s) => s.records)
  const patch = useLibrary((s) => s.patchTest)
  const remove = useLibrary((s) => s.remove)
  const approve = useLibrary((s) => s.approve)
  const health = useLibrary((s) => s.health)
  const loadDetail = useLibrary((s) => s.loadDetail)
  const massUnit = useUnits((s) => s.massUnit)
  const { selectedId, go, startCompare } = useNav()
  const t = tests.find((x) => x.id === selectedId)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  if (!t) return <Panel><div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-dim)' }}>No test selected.</div></Panel>

  const cT = compliance(t, TARGET)

  return (
    <div>
      <button className="btn" style={{ padding: '5px 11px', fontSize: 12, marginBottom: 14 }} onClick={() => go('table')}>← Back</button>

      <Panel className="rise">
        <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <Eyebrow>{t.project} · {t.lab}</Eyebrow>
            <h2 className="font-cluster" style={{ fontSize: 25, fontWeight: 700, margin: '4px 0 8px' }}>{t.vehicleModel}</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip tone="cyan">{t.cycle}</Chip>
              {t.config !== 'Unknown' && <Chip>{t.config}</Chip>}
              <Chip>{t.transmission}</Chip>
              <Chip>{t.lab}</Chip>
              <Chip>{t.date}</Chip>
              {t.vnNo && <Chip>VN {t.vnNo}</Chip>}
              {t.vinSampleId && <Chip>VIN {t.vinSampleId}</Chip>}
              {t.catalystState && <Chip>{t.catalystState}</Chip>}
              {t.stt && <Chip>STT {t.stt}</Chip>}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
            <RagBadge level={cT.overall} />
            <div style={{ display: 'flex', gap: 8 }}>
              {health?.can_edit && <button className="btn" style={{ padding: '5px 11px', fontSize: 12 }} onClick={() => setEditing((e) => !e)}>{editing ? 'Close' : 'Edit tags'}</button>}
              <button className="btn" style={{ padding: '5px 11px', fontSize: 12 }} onClick={() => startCompare(t.id)}>Compare</button>
              {t.status === 'quarantined' && health?.can_edit && <button className="btn btn-primary" style={{ padding: '5px 11px', fontSize: 12 }} onClick={() => void approve(t.id)}>Approve</button>}
              {health?.can_edit && <button className="btn" style={{ padding: '5px 11px', fontSize: 12, color: 'var(--fail)' }} onClick={() => { void remove(t.id); go('table') }}>Delete</button>}
            </div>
          </div>
        </div>

        {t.lowConfidence.length > 0 && (
          <div style={{ padding: '8px 20px', borderTop: '1px solid var(--line)', color: 'var(--warn)', fontSize: 12 }} className="font-mono">
            ⚑ Needs review: {t.lowConfidence.join(', ')} — verify via “Edit tags”.
          </div>
        )}

        {editing && <EditPanel test={t} onSave={(p) => { void patch(t.id, p); setEditing(false) }} />}

        <div style={{ padding: '0 20px 16px', display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <Meta label="Distance" value={t.distanceKm != null ? `${t.distanceKm} km` : '—'} />
          <Meta label="Inertia" value={t.inertia != null ? `${t.inertia} kg` : '—'} />
          <Meta label="ODO" value={t.odo != null ? `${t.odo} km` : '—'} />
          <Meta label="Fuel" value={t.fuel.name ?? '—'} />
          <Meta label="Fuel econ" value={t.fuel.consumptionL100 != null ? `${t.fuel.consumptionL100} l/100km` : '—'} />
          <Meta label="Ambient" value={t.conditions.ambientC != null ? `${t.conditions.ambientC} °C` : '—'} />
          <Meta label="RLD A/B/C" value={t.rld.A != null ? `${t.rld.A} / ${t.rld.B} / ${t.rld.C}` : '—'} />
          <Meta label="Library status" value={(t.status ?? 'accepted').replace('_', ' ')} />
          <Meta label="Source result unit" value={t.units?.resultsSource ?? 'mg/km'} />
          {t.source.pdf && <a className="evidence-link" href={api.evidenceUrl(t.id, 'pdf')} target="_blank" rel="noreferrer">Open report PDF ↗</a>}
          {t.source.xlsm && <a className="evidence-link" href={api.evidenceUrl(t.id, 'xlsm')}>Download traces XLSM ↓</a>}
        </div>
      </Panel>

      <div style={{ height: 16 }} />
      <Eyebrow>Results · vs norm &amp; target</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, margin: '10px 0 18px' }}>
        {ALL_POLL.map((p) => <ResultCell key={p} test={t} p={p} massUnit={massUnit} />)}
      </div>

      {t.phases.length > 1 && <ColdStartPanel test={t} massUnit={massUnit} />}

      {t.phases.length > 0 && <PhaseTable test={t} massUnit={massUnit} />}

      {t.trace && <QAPanel test={t} massUnit={massUnit} />}

      {t.trace && <TraceSection test={t} />}
    </div>
  )
}

function ColdStartPanel({ test, massUnit }: { test: Test; massUnit: 'mg/km' | 'g/km' }) {
  const rows = useMemo(() => coldStart(test), [test])
  if (!rows.length) return null
  return (
    <>
      <div style={{ height: 16 }} />
      <Panel ticks={false}>
        <div className="panel-heading"><div><Eyebrow>Cold-start contribution · phase-1 share of cycle mass</Eyebrow><h3>Cold-start analysis</h3></div></div>
        <div style={{ padding: '8px 18px 14px' }}>
          {rows.map((r) => {
            const pct = Math.round(r.coldFraction * 100)
            const tone = pct >= 60 ? RAG_COLOR.fail : pct >= 40 ? RAG_COLOR.warn : RAG_COLOR.pass
            return (
              <div key={r.pollutant} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 150px', gap: 14, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="font-cluster" style={{ fontWeight: 700, fontSize: 15 }}>{r.pollutant}</span>
                <div style={{ height: 9, background: 'var(--bg-2)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: tone, borderRadius: 6, transition: 'width .4s ease' }} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="font-mono" style={{ fontWeight: 700, color: tone }}>{pct}%</span>
                  <span className="font-mono" style={{ color: 'var(--ink-faint)', fontSize: 11, marginLeft: 8 }}>{r.coldPenalty >= 0 ? '+' : ''}{fmt(r.coldPenalty, r.pollutant, massUnit)} {displayUnit(r.pollutant, massUnit)}</span>
                </div>
              </div>
            )
          })}
        </div>
        <div className="analysis-note">Phase-1 (cold) share of total cycle mass = phase-1 mass ÷ Σ phase mass. Penalty = phase-1 specific − mean of hot phases. High CO/THC cold share points to catalyst light-off as the lever.</div>
      </Panel>
    </>
  )
}

function QAPanel({ test, massUnit }: { test: Test; massUnit: 'mg/km' | 'g/km' }) {
  const cm = useMemo(() => cycleMetrics(test), [test])
  const rec = useMemo(() => reconcile(test), [test])
  if (!cm) return null
  const distTone = cm.distanceErrorPct == null ? RAG_COLOR.na : Math.abs(cm.distanceErrorPct) < 1 ? RAG_COLOR.pass : Math.abs(cm.distanceErrorPct) < 3 ? RAG_COLOR.warn : RAG_COLOR.fail
  return (
    <>
      <div style={{ height: 16 }} />
      <Panel ticks={false}>
        <div className="panel-heading"><div><Eyebrow>Data quality · cycle validity &amp; trace reconciliation</Eyebrow><h3>Test QA</h3></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 0, padding: '4px 6px' }}>
          <QAStat label="Trace distance" value={`${cm.distanceComputed.toFixed(2)} km`} />
          <QAStat label="Reported distance" value={cm.distanceReported != null ? `${cm.distanceReported.toFixed(2)} km` : '—'} />
          <QAStat label="Distance error" value={cm.distanceErrorPct != null ? `${cm.distanceErrorPct > 0 ? '+' : ''}${cm.distanceErrorPct.toFixed(2)}%` : '—'} color={distTone} />
          <QAStat label="Idle time" value={`${cm.idlePct.toFixed(0)}%`} />
          <QAStat label="Avg / max speed" value={`${cm.avgSpeed.toFixed(0)} / ${cm.maxSpeed.toFixed(0)} km/h`} />
          <QAStat label="Max acceleration" value={`${cm.maxAccel.toFixed(2)} m/s²`} />
        </div>
        {rec.length > 0 && (
          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--line)' }}>
            <table className="readiness-table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Pollutant</th><th>Reported</th><th>Trace-integrated</th><th>Δ %</th></tr></thead>
              <tbody>
                {rec.map((r) => {
                  const tone = Math.abs(r.deltaPct) < 5 ? RAG_COLOR.pass : Math.abs(r.deltaPct) < 15 ? RAG_COLOR.warn : RAG_COLOR.fail
                  return (
                    <tr key={r.pollutant}>
                      <td><strong>{r.pollutant}</strong></td>
                      <td className="font-mono">{fmt(r.reported, r.pollutant, massUnit)}</td>
                      <td className="font-mono">{fmt(r.integrated, r.pollutant, massUnit)}</td>
                      <td className="font-mono" style={{ fontWeight: 700, color: tone }}>{r.deltaPct > 0 ? '+' : ''}{r.deltaPct.toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="analysis-note">Distance from ∫ speed·dt vs the reported bag distance flags instrumentation/driver issues. Reconciliation integrates the trace mass channels against reported bag results — large Δ suggests analyzer drift or a parse error.</div>
      </Panel>
    </>
  )
}

function QAStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '12px 14px' }}>
      <div className="eyebrow">{label}</div>
      <div className="font-mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 5, color: color ?? 'var(--ink)' }}>{value}</div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="font-mono" style={{ fontSize: 13, marginTop: 3 }}>{value}</div>
    </div>
  )
}

function ResultCell({ test, p, massUnit }: { test: Test; p: Pollutant; massUnit: 'mg/km' | 'g/km' }) {
  const v = test.results[p]
  const target = TARGET.limits[p]
  const norm = NORM.limits[p]
  const r = rag(v, target)
  const limited = LIMITED.includes(p)
  const pctOfTarget = v != null && target ? Math.min((v / target) * 100, 100) : 0
  return (
    <Panel>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="font-cluster" style={{ fontSize: 16, fontWeight: 700 }}>{p}</span>
          <span className="eyebrow">{displayUnit(p, massUnit)}</span>
          {limited && <RagDot level={r} size={7} />}
        </div>
        <div className="font-mono" style={{ fontSize: 19, marginTop: 6, color: limited ? RAG_COLOR[r] : 'var(--ink)' }}>{fmt(v, p, massUnit)}</div>
        {limited && target != null && (
          <>
            <div style={{ height: 5, background: 'var(--bg-2)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${pctOfTarget}%`, height: '100%', background: RAG_COLOR[r] }} />
            </div>
            <div className="font-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 5 }}>
              tgt {fmt(target, p, massUnit)} · norm {norm != null ? fmt(norm, p, massUnit) : '—'}
            </div>
          </>
        )}
      </div>
    </Panel>
  )
}

function PhaseTable({ test, massUnit }: { test: Test; massUnit: 'mg/km' | 'g/km' }) {
  return (
    <Panel ticks={false} className="rise">
      <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line)' }}><Eyebrow>Phase breakdown · Specific [{massUnit}]</Eyebrow></div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '10px 16px' }}><span className="eyebrow">Phase</span></th>
              <th style={{ textAlign: 'right', padding: '10px' }}><span className="eyebrow">Dist</span></th>
              {(['CO', 'THC', 'NOx', 'CO2', 'CH4', 'NMHC'] as Pollutant[]).map((p) => (
                <th key={p} style={{ textAlign: 'right', padding: '10px' }}><span className="eyebrow">{p}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {test.phases.map((ph, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '9px 16px' }} className="font-mono">{ph.name}</td>
                <td style={{ padding: '9px', textAlign: 'right' }} className="font-mono">{ph.distanceKm ?? '—'}</td>
                {(['CO', 'THC', 'NOx', 'CO2', 'CH4', 'NMHC'] as Pollutant[]).map((p) => (
                  <td key={p} style={{ padding: '9px', textAlign: 'right' }} className="font-mono">{ph.specific[p] != null ? fmt(ph.specific[p]!, p, massUnit) : '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

type TracePoll = 'NOx' | 'CO' | 'THC' | 'CH4' | 'NMHC' | 'CO2'

function TraceSection({ test }: { test: Test }) {
  const [poll, setPoll] = useState<TracePoll>('NOx')
  const tr = test.trace!
  const diluteUnit = test.units?.trace?.dilute?.[poll] ?? TRACE_UNIT[poll] ?? ''
  const preUnit = test.units?.trace?.preCat?.[poll] ?? TRACE_UNIT[poll] ?? ''

  const speedData = useMemo(() => tr.dilute.map((d) => ({ t: d.t, speed: d.speed ?? 0, conc: d[poll] ?? 0 })), [tr, poll])

  // catalyst conversion efficiency from pre/post cat ppm
  const catData = useMemo(() => {
    const post = new Map(tr.postCat.map((d) => [d.t, d]))
    return tr.preCat.map((pre) => {
      const po = post.get(pre.t)
      const a = pre[poll] ?? 0
      const b = po?.[poll] ?? 0
      const eff = a > 1 ? Math.max(0, Math.min(100, ((a - b) / a) * 100)) : null
      return { t: pre.t, pre: a, post: b, eff }
    })
  }, [tr, poll])

  const lo = useMemo(() => catalystLightoff(test, poll as LOChannel), [test, poll])

  return (
    <>
      <div style={{ height: 16 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Eyebrow>Trace &amp; catalyst analysis · native concentration units</Eyebrow>
        <select value={poll} onChange={(e) => setPoll(e.target.value as TracePoll)} style={{ marginLeft: 'auto' }}>
          {(['NOx', 'CO', 'THC', 'CH4', 'NMHC', 'CO2'] as TracePoll[]).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <Panel ticks={false}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><Eyebrow>Speed [km/h] &amp; dilute {poll} [{diluteUnit}] over cycle</Eyebrow></div>
        <div style={{ height: 200, padding: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={speedData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={{ stroke: 'var(--line-bright)' }} tickLine={false} unit="s" />
              <YAxis yAxisId="l" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--line-bright)', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="l" type="monotone" dataKey="speed" stroke="var(--ink-faint)" dot={false} strokeWidth={1} name="speed km/h" isAnimationActive={false} />
              <Line yAxisId="r" type="monotone" dataKey="conc" stroke="var(--cyan)" dot={false} strokeWidth={1.4} name={`${poll} dilute [${diluteUnit}]`} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div style={{ height: 14 }} />
      <Panel ticks={false}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <Eyebrow>Catalyst {poll} [{preUnit}]: pre vs post + conversion efficiency</Eyebrow>
        </div>
        {lo && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', borderBottom: '1px solid var(--line)' }}>
            <QAStat label={`${poll} light-off (50%)`} value={lo.lightoffTime != null ? `${lo.lightoffTime.toFixed(0)} s` : 'not reached'} color={lo.lightoffTime == null ? RAG_COLOR.fail : lo.lightoffTime < 60 ? RAG_COLOR.pass : lo.lightoffTime < 120 ? RAG_COLOR.warn : RAG_COLOR.fail} />
            <QAStat label="Time-weighted conversion" value={`${(lo.timeWeightedConversion * 100).toFixed(1)}%`} color={lo.timeWeightedConversion > 0.9 ? RAG_COLOR.pass : lo.timeWeightedConversion > 0.75 ? RAG_COLOR.warn : RAG_COLOR.fail} />
            <QAStat label={`Peak pre-cat ${poll}`} value={`${lo.peakPreCat.toFixed(0)} ${preUnit}`} />
            <QAStat label="Pre-light-off slip index" value={`${lo.slipIndex.toFixed(0)} ${preUnit}·s`} />
          </div>
        )}
        <div style={{ height: 220, padding: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={catData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id="pre" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--fail)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--fail)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="post" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--pass)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--pass)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={{ stroke: 'var(--line-bright)' }} tickLine={false} unit="s" />
              <YAxis yAxisId="ppm" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="eff" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--line-bright)', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area yAxisId="ppm" type="monotone" dataKey="pre" stroke="var(--fail)" fill="url(#pre)" strokeWidth={1.2} name={`pre-cat ${poll} [${preUnit}]`} dot={false} isAnimationActive={false} />
              <Area yAxisId="ppm" type="monotone" dataKey="post" stroke="var(--pass)" fill="url(#post)" strokeWidth={1.2} name={`post-cat ${poll} [${preUnit}]`} dot={false} isAnimationActive={false} />
              <Line yAxisId="eff" type="monotone" dataKey="eff" stroke="var(--amber)" dot={false} strokeWidth={1.4} name="conversion %" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </>
  )
}

function EditPanel({ test, onSave }: { test: Test; onSave: (p: Partial<Test>) => void }) {
  const [v, setV] = useState({
    vehicleModel: test.vehicleModel ?? '', vinSampleId: test.vinSampleId ?? '', vnNo: test.vnNo ?? '',
    lab: test.lab ?? '', project: test.project, cycle: test.cycle, config: test.config,
    transmission: test.transmission, catalystState: test.catalystState ?? '', stt: test.stt ?? '',
  })
  const f = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value })
  return (
    <div style={{ padding: '16px 20px', borderTop: '1px solid var(--line)', background: 'var(--aubergine-wash)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <Field label="Vehicle model"><input value={v.vehicleModel} onChange={f('vehicleModel')} style={{ width: 200 }} /></Field>
      <Field label="VIN / Sample ID"><input value={v.vinSampleId} onChange={f('vinSampleId')} placeholder="VIN" style={{ width: 190 }} /></Field>
      <Field label="VN no."><input value={v.vnNo} onChange={f('vnNo')} style={{ width: 90 }} /></Field>
      <Field label="Lab">
        <select value={v.lab} onChange={f('lab')}>{[...new Set([v.lab, 'FEV', 'ARAI', 'Unknown'].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}</select>
      </Field>
      <Field label="Program"><input value={v.project} onChange={f('project')} style={{ width: 110 }} /></Field>
      <Field label="Cycle">
        <select value={v.cycle} onChange={f('cycle')}>{[...new Set([v.cycle, 'WLTP', 'MIDC', 'NEDC', 'Unknown'])].map((c) => <option key={c}>{c}</option>)}</select>
      </Field>
      <Field label="Config"><input value={v.config} onChange={f('config')} style={{ width: 90 }} /></Field>
      <Field label="Transmission"><input value={v.transmission} onChange={f('transmission')} style={{ width: 100 }} /></Field>
      <Field label="Catalyst"><input value={v.catalystState} onChange={f('catalystState')} placeholder="fresh / 1k / 3k" style={{ width: 120 }} /></Field>
      <Field label="STT">
        <select value={v.stt} onChange={f('stt')}><option value="">—</option><option>ON</option><option>OFF</option></select>
      </Field>
      <button
        className="btn btn-primary"
        style={{ padding: '10px 20px' }}
        onClick={() => {
          const patch: Partial<Test> = {
            vehicleModel: v.vehicleModel.trim(), vinSampleId: v.vinSampleId.trim(), vnNo: v.vnNo.trim(), lab: v.lab,
            project: v.project, cycle: v.cycle, config: v.config, transmission: v.transmission,
            catalystState: v.catalystState || undefined, stt: (v.stt || null) as Test['stt'],
            lowConfidence: test.lowConfidence.filter((x) => !['project', 'cycle', 'config', 'transmission', 'metadata'].includes(x)),
          }
          onSave(patch)
        }}
      >
        Save tags
      </button>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>{children}</div>
}
