import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, ReferenceLine, Cell, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useLibrary } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { UploadDropzone } from '../components/UploadDropzone'
import { Panel, Eyebrow, RagBadge, Chip } from '../components/common'
import { LIMITED, compliance } from '../lib/derive'
import { NORM, TARGET, displayUnit, fmt, RAG_COLOR } from '../model/limits'
import type { Test } from '../model/types'
import { useUnits } from '../store/useUnits'

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]
}

export function Overview() {
  const tests = useLibrary((s) => s.tests)
  const { openTest, startCompare, go } = useNav()
  const massUnit = useUnits((s) => s.massUnit)

  const analysis = useMemo(() => buildAnalysis(tests), [tests])

  if (!tests.length) {
    return (
      <div style={{ maxWidth: 620, margin: '6vh auto' }}>
        <Eyebrow>No data loaded</Eyebrow>
        <h1 className="font-display" style={{ fontSize: 34, fontWeight: 600, margin: '6px 0 18px' }}>
          Start the emissions release cockpit
        </h1>
        <UploadDropzone />
      </div>
    )
  }

  return (
    <div>
      <section className="cockpit-hero">
        <div>
          <Eyebrow>Program release cockpit · engineering target governance</Eyebrow>
          <h1 className="font-display cockpit-title">Emission compilation intelligence</h1>
          <p className="cockpit-copy">
            Consolidated view across {analysis.configCount} configurations, {analysis.cycles.length} cycles and {analysis.labs.length} labs.
            Release status is driven by the worst regulated pollutant against the STLA engineering target.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="release-verdict" data-level={analysis.releaseLevel}>
            <span className="eyebrow">Program readiness</span>
            <strong>{analysis.releaseLabel}</strong>
            <span>{analysis.targetPass}/{tests.length} tests within target</span>
          </div>
          <button className="btn btn-primary" onClick={() => go('report')}>Generate client report →</button>
        </div>
      </section>

      <div className="kpi-grid">
        <Metric label="Target pass rate" value={`${analysis.targetRate}%`} sub={`${analysis.targetPass} of ${tests.length}`} tone={analysis.targetRate === 100 ? 'pass' : 'warn'} />
        <Metric label="Regulatory pass" value={`${analysis.normRate}%`} sub={`${analysis.normPass} of ${tests.length} vs BS6.2`} tone={analysis.normRate === 100 ? 'pass' : 'fail'} />
        <Metric label="Open target breaches" value={analysis.targetBreaches} sub={`${analysis.failTests} affected tests`} tone={analysis.targetBreaches ? 'fail' : 'pass'} />
        <Metric label="Data confidence" value={`${analysis.confidence}%`} sub={`${analysis.reviewCount} tests need review`} tone={analysis.reviewCount ? 'warn' : 'pass'} />
        <Metric label="Worst exposure" value={`${analysis.worstUtil.toFixed(2)}×`} sub={`${analysis.worstPollutant} P95 / target`} tone={analysis.worstUtil > 1 ? 'fail' : analysis.worstUtil > 0.8 ? 'warn' : 'pass'} />
      </div>

      <div className="overview-grid">
        <Panel ticks={false} className="risk-panel">
          <div className="panel-heading">
            <div>
              <Eyebrow>Target exposure · 95th percentile</Eyebrow>
              <h3>Pollutant release margin</h3>
            </div>
            <span className="legend-inline"><i className="target-line" /> target = 1.00×</span>
          </div>
          <div style={{ height: 290, padding: '6px 18px 12px 6px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analysis.exposure} layout="vertical" margin={{ top: 4, right: 24, bottom: 12, left: 10 }}>
                <XAxis type="number" domain={[0, Math.max(1.2, analysis.worstUtil * 1.12)]} tickFormatter={(v) => `${Number(v).toFixed(1)}×`} tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="pollutant" width={42} tick={{ fontSize: 12, fill: 'var(--ink)' }} axisLine={false} tickLine={false} />
                <ReferenceLine x={1} stroke="var(--amber)" strokeDasharray="5 4" />
                <Tooltip
                  cursor={{ fill: 'rgba(74,21,75,0.05)' }}
                  contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--line-bright)', borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => [`${Number(v).toFixed(2)}× target`, 'P95 utilization']}
                />
                <Bar dataKey="utilization" radius={[0, 5, 5, 0]} isAnimationActive={false}>
                  {analysis.exposure.map((item) => <Cell key={item.pollutant} fill={item.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel ticks={false}>
          <div className="panel-heading">
            <div>
              <Eyebrow>Automated engineering review</Eyebrow>
              <h3>Priority observations</h3>
            </div>
          </div>
          <div className="insight-list">
            {analysis.insights.map((insight, i) => (
              <div className="insight-row" key={i} data-tone={insight.tone}>
                <span className="insight-index">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{insight.title}</strong>
                  <p>{insight.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="overview-grid lower">
        <Panel ticks={false}>
          <div className="panel-heading">
            <div>
              <Eyebrow>Configuration × cycle readiness</Eyebrow>
              <h3>Release gate matrix</h3>
            </div>
            <button className="btn compact-btn" onClick={() => go('compliance')}>Deep dive →</button>
          </div>
          <div className="readiness-table-wrap">
            <table className="readiness-table">
              <thead>
                <tr><th>Configuration</th><th>Tests</th><th>Target pass</th><th>Worst driver</th><th>P95 exposure</th><th>Gate</th></tr>
              </thead>
              <tbody>
                {analysis.groups.map((group) => (
                  <tr key={group.name}>
                    <td><strong>{group.name}</strong><span>{group.labs}</span></td>
                    <td>{group.count}</td>
                    <td>{group.pass}/{group.count}</td>
                    <td>{group.worst}</td>
                    <td className="font-mono">{group.util.toFixed(2)}×</td>
                    <td><RagBadge level={group.level} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel ticks={false}>
          <div className="panel-heading">
            <div>
              <Eyebrow>Latest test activity</Eyebrow>
              <h3>Recent evidence</h3>
            </div>
            <button className="btn compact-btn" onClick={() => go('table')}>All tests →</button>
          </div>
          <div>
            {analysis.recent.map((test) => <RecentRow key={test.id} test={test} massUnit={massUnit} onOpen={() => openTest(test.id)} />)}
          </div>
        </Panel>
      </div>

      <div className="utility-row">
        <UploadDropzone compact />
        <button className="btn utility-action" onClick={() => analysis.recent[0] && startCompare(analysis.recent[0].id, analysis.recent[1]?.id)}>
          Compare latest evidence
        </button>
        <button className="btn utility-action" onClick={() => go('trends')}>Open ageing &amp; catalyst trends</button>
      </div>
    </div>
  )
}

function buildAnalysis(tests: Test[]) {
  const normPass = tests.filter((t) => compliance(t, NORM).overall !== 'fail').length
  const targetPass = tests.filter((t) => compliance(t, TARGET).overall !== 'fail').length
  const failTests = tests.length - targetPass
  const reviewCount = tests.filter((t) => t.lowConfidence.length > 0).length
  const exposure = LIMITED.map((pollutant) => {
    const target = TARGET.limits[pollutant]!
    const values = tests.map((t) => t.results[pollutant]).filter((v): v is number => v != null)
    const utilization = percentile(values, 0.95) / target
    return { pollutant, utilization, color: utilization > 1 ? RAG_COLOR.fail : utilization > 0.8 ? RAG_COLOR.warn : RAG_COLOR.pass }
  }).sort((a, b) => b.utilization - a.utilization)
  const worst = exposure[0]
  const targetBreaches = tests.reduce((sum, t) => sum + LIMITED.filter((p) => compliance(t, TARGET).perPollutant[p].rag === 'fail').length, 0)

  const grouped = new Map<string, Test[]>()
  for (const test of tests) {
    const key = `${test.config} · ${test.transmission} · ${test.cycle}`
    grouped.set(key, [...(grouped.get(key) ?? []), test])
  }
  const groups = [...grouped.entries()].map(([name, rows]) => {
    const pollutantExposure = LIMITED.map((p) => ({
      p,
      util: percentile(rows.map((t) => t.results[p]).filter((v): v is number => v != null), 0.95) / TARGET.limits[p]!,
    })).sort((a, b) => b.util - a.util)[0]
    const pass = rows.filter((t) => compliance(t, TARGET).overall !== 'fail').length
    return {
      name,
      count: rows.length,
      pass,
      worst: pollutantExposure.p,
      util: pollutantExposure.util,
      labs: [...new Set(rows.map((t) => t.lab))].join(' / '),
      level: (pollutantExposure.util > 1 ? 'fail' : pollutantExposure.util > 0.8 ? 'warn' : 'pass') as 'fail' | 'warn' | 'pass',
    }
  }).sort((a, b) => b.util - a.util)

  const insights: { title: string; detail: string; tone: 'fail' | 'warn' | 'pass' }[] = []
  const worstFailCount = tests.filter((t) => compliance(t, TARGET).perPollutant[worst.pollutant].rag === 'fail').length
  insights.push({
    title: `${worst.pollutant} is the primary release driver`,
    detail: `P95 is ${worst.utilization.toFixed(2)}× target with ${worstFailCount} failing test${worstFailCount === 1 ? '' : 's'}. Prioritize calibration and hardware correlation here.`,
    tone: worst.utilization > 1 ? 'fail' : 'warn',
  })
  const normFails = tests.length - normPass
  insights.push({
    title: normFails ? `${normFails} regulatory exception${normFails === 1 ? '' : 's'} require containment` : 'Regulatory envelope is protected',
    detail: normFails ? 'These results exceed the BS6.2 limit and should be isolated from release evidence until root cause is closed.' : 'All compiled evidence remains within the applicable BS6.2 limits.',
    tone: normFails ? 'fail' : 'pass',
  })
  const off = tests.filter((t) => t.stt === 'OFF' && t.results.CO != null)
  const on = tests.filter((t) => t.stt === 'ON' && t.results.CO != null)
  if (off.length && on.length) {
    const offCo = percentile(off.map((t) => t.results.CO as number), 0.5)
    const onCo = percentile(on.map((t) => t.results.CO as number), 0.5)
    const delta = onCo ? ((offCo - onCo) / onCo) * 100 : 0
    insights.push({
      title: 'STT sensitivity is visible in the compiled evidence',
      detail: `Median CO with STT OFF is ${delta >= 0 ? `${delta.toFixed(0)}% higher` : `${Math.abs(delta).toFixed(0)}% lower`} than STT ON. Confirm on matched vehicle/catalyst pairs before calibration action.`,
      tone: Math.abs(delta) > 15 ? 'warn' : 'pass',
    })
  }
  insights.push({
    title: `${reviewCount} test${reviewCount === 1 ? '' : 's'} have incomplete classification`,
    detail: reviewCount ? 'Resolve inferred cycle/configuration tags before using these rows in a formal release pack.' : 'All records have sufficient metadata for configuration-level comparison.',
    tone: reviewCount ? 'warn' : 'pass',
  })

  const targetRate = Math.round((targetPass / tests.length) * 100)
  const normRate = Math.round((normPass / tests.length) * 100)
  return {
    normPass, targetPass, failTests, reviewCount, targetBreaches, exposure, groups, insights,
    targetRate, normRate,
    confidence: Math.round(((tests.length - reviewCount) / tests.length) * 100),
    configCount: new Set(tests.map((t) => `${t.config}-${t.transmission}`)).size,
    cycles: [...new Set(tests.map((t) => t.cycle))],
    labs: [...new Set(tests.map((t) => t.lab))],
    worstPollutant: worst.pollutant,
    worstUtil: worst.utilization,
    releaseLevel: normRate < 100 ? 'fail' : targetRate < 100 ? 'warn' : 'pass',
    releaseLabel: normRate < 100 ? 'HOLD' : targetRate < 100 ? 'ENGINEERING ACTION' : 'READY',
    recent: [...tests].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
  }
}

function Metric({ label, value, sub, tone }: { label: string; value: string | number; sub: string; tone: 'pass' | 'warn' | 'fail' }) {
  return (
    <Panel>
      <div className="metric-card">
        <Eyebrow>{label}</Eyebrow>
        <div className="metric-value" style={{ color: RAG_COLOR[tone] }}>{value}</div>
        <span>{sub}</span>
      </div>
    </Panel>
  )
}

function RecentRow({ test, massUnit, onOpen }: { test: Test; massUnit: 'mg/km' | 'g/km'; onOpen: () => void }) {
  const c = compliance(test, TARGET)
  const critical = LIMITED.map((p) => ({ p, m: c.perPollutant[p].margin ?? 99 })).sort((a, b) => a.m - b.m)[0]
  return (
    <button onClick={onOpen} className="recent-evidence">
      <div>
        <strong>{test.config} · {test.transmission}</strong>
        <span>{test.cycle} · {test.lab} · {test.date}</span>
        <div><Chip>{test.catalystState || `VN ${test.vnNo}`}</Chip>{test.stt && <Chip>STT {test.stt}</Chip>}</div>
      </div>
      <div className="critical-result">
        <span className="eyebrow">Critical</span>
        <strong style={{ color: RAG_COLOR[c.perPollutant[critical.p].rag] }}>{critical.p}</strong>
        <span>{fmt(test.results[critical.p], critical.p, massUnit)} {displayUnit(critical.p, massUnit)}</span>
      </div>
      <RagBadge level={c.overall} />
    </button>
  )
}
