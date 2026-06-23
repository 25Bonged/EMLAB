import { useMemo, useState } from 'react'
import {
  ScatterChart, Scatter, BarChart, Bar, Cell, XAxis, YAxis, ReferenceLine, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LabelList,
} from 'recharts'
import { useLibrary, applyFilters } from '../store/useLibrary'
import { FilterBar } from '../components/FilterBar'
import { Panel, Eyebrow } from '../components/common'
import { LIMITED } from '../lib/derive'
import { NORM, TARGET, displayUnit, fmt, RAG_COLOR } from '../model/limits'
import type { Pollutant } from '../model/types'
import { useUnits } from '../store/useUnits'
import { deteriorationByGroup, sttPairs, interLab } from '../lib/engineering'
import { cpu, wilson, mean, stdev } from '../lib/stats'

const GROUP_COLORS = ['#4a154b', '#1264a3', '#007a5a', '#b07d12', '#9b3d6b', '#3860be']
type Sub = 'deterioration' | 'conformity' | 'labstt'

export function Engineering() {
  const tests = useLibrary((s) => s.tests)
  const filters = useLibrary((s) => s.filters)
  const rows = useMemo(() => applyFilters(tests, filters), [tests, filters])
  const [sub, setSub] = useState<Sub>('deterioration')

  return (
    <div>
      <Eyebrow>Engineering analytics · ageing, capability &amp; correlation</Eyebrow>
      <h2 className="font-display page-title" style={{ marginBottom: 16 }}>Engineering analysis</h2>

      <div className="subtab-row">
        {([
          ['deterioration', 'Deterioration & ageing'],
          ['conformity', 'Conformity of production'],
          ['labstt', 'Lab & start-stop'],
        ] as [Sub, string][]).map(([id, label]) => (
          <button key={id} className="subtab" data-active={sub === id} onClick={() => setSub(id)}>{label}</button>
        ))}
      </div>

      <FilterBar />

      {sub === 'deterioration' && <Deterioration rows={rows} />}
      {sub === 'conformity' && <Conformity rows={rows} />}
      {sub === 'labstt' && <LabStt rows={rows} />}
    </div>
  )
}

/* ----------------------------- Deterioration ----------------------------- */

type GroupKey = 'config' | 'transmission' | 'cycle'

function Deterioration({ rows }: { rows: ReturnType<typeof applyFilters> }) {
  const massUnit = useUnits((s) => s.massUnit)
  const [poll, setPoll] = useState<Pollutant>('NOx')
  const [groupBy, setGroupBy] = useState<GroupKey>('config')
  const [ul, setUl] = useState(160000)

  const groups = useMemo(
    () => deteriorationByGroup(rows, poll, (t) => String(t[groupBy] ?? 'Unknown'), ul),
    [rows, poll, groupBy, ul],
  )
  const target = TARGET.limits[poll]
  const norm = NORM.limits[poll]
  const maxOdo = Math.max(0, ...groups.flatMap((g) => g.points.map((p) => p.x)))

  return (
    <>
      <div className="control-row">
        <Labeled label="Pollutant">
          <select value={poll} onChange={(e) => setPoll(e.target.value as Pollutant)}>
            {LIMITED.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Labeled>
        <Labeled label="Group by">
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupKey)}>
            <option value="config">Config</option>
            <option value="transmission">Transmission</option>
            <option value="cycle">Cycle</option>
          </select>
        </Labeled>
        <Labeled label="Useful life (km)">
          <input type="number" step={10000} min={10000} value={ul} onChange={(e) => setUl(Math.max(1000, +e.target.value || 160000))} style={{ width: 110 }} />
        </Labeled>
      </div>

      <Panel ticks={false}>
        <div className="panel-heading">
          <div>
            <Eyebrow>Emission vs odometer · linear deterioration</Eyebrow>
            <h3>{poll} ageing trend ({displayUnit(poll, massUnit)})</h3>
          </div>
          <span className="legend-inline"><i className="target-line" /> target {target != null ? fmt(target, poll, massUnit) : '—'}</span>
        </div>
        <div style={{ height: 320, padding: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 18, bottom: 8, left: 6 }}>
              <CartesianGrid stroke="var(--line)" />
              <XAxis type="number" dataKey="x" name="ODO" domain={[0, Math.max(1000, maxOdo * 1.05)]} tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={{ stroke: 'var(--line-bright)' }} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <YAxis type="number" dataKey="y" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => fmt(v, poll, massUnit)} />
              <Tooltip cursor={{ stroke: 'var(--line-bright)' }} contentStyle={tooltipStyle} formatter={(v, n) => (n === 'y' ? [fmt(Number(v), poll, massUnit), poll] : [`${v} km`, 'ODO'])} labelFormatter={() => ''} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {target != null && <ReferenceLine y={target} stroke={RAG_COLOR.warn} strokeDasharray="5 3" />}
              {norm != null && <ReferenceLine y={norm} stroke={RAG_COLOR.fail} strokeDasharray="5 3" />}
              {groups.map((g, i) => (
                <Scatter key={g.group} name={g.group} data={g.points} fill={GROUP_COLORS[i % GROUP_COLORS.length]} line lineType="fitting" isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div style={{ height: 16 }} />
      <Panel ticks={false}>
        <div className="panel-heading"><div><Eyebrow>Deterioration factor · projected to {Math.round(ul / 1000)}k km</Eyebrow><h3>DF &amp; end-of-life projection</h3></div></div>
        <div className="readiness-table-wrap">
          <table className="readiness-table">
            <thead><tr><th>{groupHeader(groupBy)}</th><th>Tests</th><th>Slope/1k km</th><th>R²</th><th>Current</th><th>Projected</th><th>DF</th><th>Verdict</th></tr></thead>
            <tbody>
              {groups.length === 0 && <tr><td colSpan={8} style={{ color: 'var(--ink-faint)', textAlign: 'center', padding: 24 }}>No mileage spread to fit a trend for {poll}.</td></tr>}
              {groups.map((g) => (
                <tr key={g.group} style={g.reliable ? undefined : { opacity: 0.72 }}>
                  <td><strong>{g.group}</strong><span>{g.minOdo}–{g.maxOdo} km</span></td>
                  <td>{g.n}</td>
                  <td className="font-mono">{fmt(g.fit.slope * 1000, poll, massUnit)}</td>
                  <td className="font-mono" style={{ color: g.fit.r2 >= 0.5 ? 'var(--ink)' : 'var(--warn)' }}>{g.fit.r2.toFixed(2)}</td>
                  <td className="font-mono">{fmt(g.current, poll, massUnit)}</td>
                  <td className="font-mono" style={g.reliable ? { color: g.exceedsNorm ? RAG_COLOR.fail : g.exceedsTarget ? RAG_COLOR.warn : RAG_COLOR.pass } : { color: 'var(--ink-faint)' }}>{g.reliable ? fmt(g.projected, poll, massUnit) : '—'}</td>
                  <td className="font-mono" style={{ fontWeight: 700 }}>{g.reliable ? `${g.df.toFixed(2)}×` : '—'}</td>
                  <td>{!g.reliable ? <Verdict tone="na">Insufficient spread</Verdict> : g.exceedsNorm ? <Verdict tone="fail">Breaches norm aged</Verdict> : g.exceedsTarget ? <Verdict tone="warn">Breaches target aged</Verdict> : <Verdict tone="pass">Holds to life</Verdict>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="analysis-note">Linear least-squares of {poll} vs odometer; projected to {ul.toLocaleString()} km. DF = projected ÷ current. R² near 0 means too little mileage spread to trust the slope.</div>
      </Panel>
    </>
  )
}

/* ----------------------------- Conformity (CoP) ----------------------------- */

function Conformity({ rows }: { rows: ReturnType<typeof applyFilters> }) {
  const massUnit = useUnits((s) => s.massUnit)
  const stats = useMemo(() => LIMITED.map((p) => {
    const vals = rows.map((t) => t.results[p]).filter((v): v is number => v != null)
    const target = TARGET.limits[p]!
    const norm = NORM.limits[p]!
    const tgtPass = vals.filter((v) => v <= target).length
    return {
      p, n: vals.length, mean: mean(vals), sd: stdev(vals),
      cpkTarget: cpu(vals, target), cpkNorm: cpu(vals, norm),
      tgtPass, normPass: vals.filter((v) => v <= norm).length, target, norm,
    }
  }).filter((s) => s.n > 0), [rows])

  const overallTargetPass = rows.filter((t) => LIMITED.every((p) => { const v = t.results[p]; return v == null || v <= TARGET.limits[p]! })).length
  const overallNormPass = rows.filter((t) => LIMITED.every((p) => { const v = t.results[p]; return v == null || v <= NORM.limits[p]! })).length
  const wTarget = wilson(overallTargetPass, rows.length)
  const wNorm = wilson(overallNormPass, rows.length)
  // Cpk ≥ 2 is "world-class"; clamp the bar scale so one huge-margin pollutant
  // doesn't squash the rest. Real value stays in the label and the table.
  const capData = stats.map((s) => ({ p: s.p, cpk: s.cpkTarget ?? 0, cpkBar: Math.min(s.cpkTarget ?? 0, 2) }))

  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <Panel><div className="metric-card">
          <Eyebrow>Fleet pass vs target · 95% CI</Eyebrow>
          <div className="metric-value" style={{ color: RAG_COLOR.warn }}>{(wTarget.p * 100).toFixed(0)}%</div>
          <span>{overallTargetPass}/{rows.length} · true rate {(wTarget.lo * 100).toFixed(0)}–{(wTarget.hi * 100).toFixed(0)}% (Wilson)</span>
        </div></Panel>
        <Panel><div className="metric-card">
          <Eyebrow>Fleet pass vs BS6.2 norm · 95% CI</Eyebrow>
          <div className="metric-value" style={{ color: wNorm.p === 1 ? RAG_COLOR.pass : RAG_COLOR.fail }}>{(wNorm.p * 100).toFixed(0)}%</div>
          <span>{overallNormPass}/{rows.length} · true rate {(wNorm.lo * 100).toFixed(0)}–{(wNorm.hi * 100).toFixed(0)}% (Wilson)</span>
        </div></Panel>
      </div>

      <div style={{ height: 16 }} />
      <Panel ticks={false}>
        <div className="panel-heading"><div><Eyebrow>Process capability vs target · Cpk ≥ 1.33 to release</Eyebrow><h3>Capability index (Cpk)</h3></div></div>
        <div style={{ height: 240, padding: '8px 16px 12px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={capData} margin={{ top: 18, right: 12, bottom: 4, left: 0 }} barCategoryGap="28%">
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="p" tick={{ fontSize: 12, fill: 'var(--ink)' }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 2]} ticks={[0, 0.5, 1, 1.33, 2]} tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={false} tickLine={false} width={36} />
              <Tooltip cursor={{ fill: 'rgba(74,21,75,0.06)' }} contentStyle={tooltipStyle} formatter={(_v, _n, p) => [Number(p?.payload?.cpk).toFixed(2), 'Cpk']} />
              <ReferenceLine y={1.33} stroke={RAG_COLOR.pass} strokeDasharray="5 3" label={{ value: '1.33', position: 'right', fontSize: 10, fill: RAG_COLOR.pass }} />
              <Bar dataKey="cpkBar" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {capData.map((d) => <Cell key={d.p} fill={d.cpk >= 1.33 ? RAG_COLOR.pass : d.cpk >= 1 ? RAG_COLOR.warn : RAG_COLOR.fail} />)}
                <LabelList dataKey="cpk" position="top" formatter={(v) => (Number(v) >= 2 ? `${Number(v).toFixed(0)}` : Number(v).toFixed(2))} style={{ fontSize: 10, fill: 'var(--ink-dim)' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div style={{ height: 16 }} />
      <Panel ticks={false}>
        <div className="panel-heading"><div><Eyebrow>Per-pollutant capability summary</Eyebrow><h3>Statistical conformity</h3></div></div>
        <div className="readiness-table-wrap">
          <table className="readiness-table">
            <thead><tr><th>Pollutant</th><th>n</th><th>Mean</th><th>σ</th><th>Target</th><th>Cpk(tgt)</th><th>Pass(tgt)</th><th>Pass(norm)</th></tr></thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.p}>
                  <td><strong>{s.p}</strong><span>{displayUnit(s.p, massUnit)}</span></td>
                  <td>{s.n}</td>
                  <td className="font-mono">{fmt(s.mean, s.p, massUnit)}</td>
                  <td className="font-mono">{fmt(s.sd, s.p, massUnit)}</td>
                  <td className="font-mono">{fmt(s.target, s.p, massUnit)}</td>
                  <td className="font-mono" style={{ fontWeight: 700, color: s.cpkTarget == null ? 'var(--ink-faint)' : s.cpkTarget >= 1.33 ? RAG_COLOR.pass : s.cpkTarget >= 1 ? RAG_COLOR.warn : RAG_COLOR.fail }}>{s.cpkTarget == null ? '—' : s.cpkTarget.toFixed(2)}</td>
                  <td className="font-mono">{s.tgtPass}/{s.n}</td>
                  <td className="font-mono">{s.normPass}/{s.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="analysis-note">Cpk = (limit − mean) ÷ 3σ (one-sided upper; floor is 0). ≥1.33 ≈ &lt;32 ppm out of spec. Wilson intervals give the plausible true pass-rate for the sampled population.</div>
      </Panel>
    </>
  )
}

/* ----------------------------- Lab & STT ----------------------------- */

function LabStt({ rows }: { rows: ReturnType<typeof applyFilters> }) {
  const massUnit = useUnits((s) => s.massUnit)
  const [poll, setPoll] = useState<Pollutant>('NOx')
  const labRows = useMemo(() => interLab(rows, poll), [rows, poll])
  const stt = useMemo(() => sttPairs(rows, poll), [rows, poll])

  return (
    <>
      <div className="control-row">
        <Labeled label="Pollutant">
          <select value={poll} onChange={(e) => setPoll(e.target.value as Pollutant)}>
            {LIMITED.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Labeled>
      </div>

      <Panel ticks={false}>
        <div className="panel-heading"><div><Eyebrow>Reproducibility · matched config / cycle cohorts</Eyebrow><h3>Inter-lab correlation</h3></div></div>
        <div className="readiness-table-wrap">
          <table className="readiness-table">
            <thead><tr><th>Cohort</th><th>Lab A</th><th>Lab A mean</th><th>Lab B</th><th>Lab B mean</th><th>Δ %</th></tr></thead>
            <tbody>
              {labRows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--ink-faint)', textAlign: 'center', padding: 24 }}>No cohort has results from two labs for {poll}.</td></tr>}
              {labRows.map((r) => (
                <tr key={r.group}>
                  <td><strong>{r.group}</strong></td>
                  <td>{r.labA.lab} <span style={{ color: 'var(--ink-faint)' }}>(n{r.labA.n})</span></td>
                  <td className="font-mono">{fmt(r.labA.mean, poll, massUnit)}</td>
                  <td>{r.labB.lab} <span style={{ color: 'var(--ink-faint)' }}>(n{r.labB.n})</span></td>
                  <td className="font-mono">{fmt(r.labB.mean, poll, massUnit)}</td>
                  <td className="font-mono" style={{ fontWeight: 700, color: deltaColor(r.deltaPct) }}>{r.deltaPct > 0 ? '+' : ''}{r.deltaPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div style={{ height: 16 }} />
      <Panel ticks={false}>
        <div className="panel-heading"><div><Eyebrow>Start-stop sensitivity · matched vehicle/catalyst pairs</Eyebrow><h3>STT ON vs OFF</h3></div></div>
        <div className="readiness-table-wrap">
          <table className="readiness-table">
            <thead><tr><th>Pair</th><th>STT ON</th><th>STT OFF</th><th>Δ % (OFF vs ON)</th></tr></thead>
            <tbody>
              {stt.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--ink-faint)', textAlign: 'center', padding: 24 }}>No matched STT ON/OFF pair for {poll}.</td></tr>}
              {stt.map((s) => (
                <tr key={s.key}>
                  <td><strong>{s.config} · {s.cycle}</strong><span>{s.key}</span></td>
                  <td className="font-mono">{fmt(s.on, poll, massUnit)}</td>
                  <td className="font-mono">{fmt(s.off, poll, massUnit)}</td>
                  <td className="font-mono" style={{ fontWeight: 700, color: deltaColor(s.deltaPct) }}>{s.deltaPct > 0 ? '+' : ''}{s.deltaPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="analysis-note">Pairs are matched on config · transmission · cycle · catalyst · VN. A positive Δ means start-stop OFF emits more than ON.</div>
      </Panel>
    </>
  )
}

/* ----------------------------- shared ----------------------------- */

const tooltipStyle = { background: '#fff', border: '1px solid var(--line-bright)', borderRadius: 10, fontSize: 12 }
const groupHeader = (k: GroupKey) => (k === 'config' ? 'Configuration' : k === 'transmission' ? 'Transmission' : 'Cycle')
const deltaColor = (d: number) => (Math.abs(d) < 5 ? 'var(--pass)' : Math.abs(d) < 15 ? 'var(--warn)' : 'var(--fail)')

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="eyebrow" style={{ marginBottom: 5 }}>{label}</div>{children}</div>
}
function Verdict({ tone, children }: { tone: 'pass' | 'warn' | 'fail' | 'na'; children: React.ReactNode }) {
  const c = RAG_COLOR[tone]
  return <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 90, color: c, background: `${c}14`, border: `1px solid ${c}33`, whiteSpace: 'nowrap' }}>{children}</span>
}
