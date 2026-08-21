import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, ReferenceLine, Cell, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useLibrary } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { UploadDropzone } from '../components/UploadDropzone'
import { Panel, Eyebrow, RagBadge, Chip } from '../components/common'
import { confirmedRegulatoryCompliance, LIMITED, regulatoryCompliance, targetCompliance } from '../lib/derive'
import { displayUnit, fmt, RAG_COLOR } from '../model/limits'
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
            Readiness separates regulatory compliance from configured project engineering targets.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="release-verdict" data-level={analysis.releaseLevel}>
            <span className="eyebrow">Program readiness</span>
            <strong>{analysis.releaseLabel}</strong>
            <span>{analysis.targetPass}/{analysis.targetConfigured} tests within configured target</span>
          </div>
          <button className="btn btn-primary" onClick={() => go('report')}>Generate client report →</button>
        </div>
      </section>

      <div className="kpi-grid">
        <Metric label="Target pass rate" value={analysis.targetConfigured ? `${analysis.targetRate}%` : 'N/A'} sub={analysis.targetConfigured ? `${analysis.targetPass} of ${analysis.targetConfigured}` : `${analysis.noTarget} tests without target`} tone={analysis.targetConfigured && analysis.targetRate === 100 ? 'pass' : 'warn'} />
        <Metric label="Regulatory pass" value={analysis.normConfirmed ? `${analysis.normRate}%` : 'N/A'} sub={analysis.normConfirmed ? `${analysis.normPass} of ${analysis.normConfirmed} confirmed` : `${analysis.normUnconfirmed} need basis confirmation`} tone={analysis.normConfirmed && analysis.normRate === 100 ? 'pass' : 'warn'} />
        <Metric label="Open target breaches" value={analysis.targetBreaches} sub={`${analysis.failTests} affected tests`} tone={analysis.targetBreaches ? 'fail' : 'pass'} />
        <Metric label="Data confidence" value={`${analysis.confidence}%`} sub={`${analysis.reviewCount} tests need review`} tone={analysis.reviewCount ? 'warn' : 'pass'} />
        <Metric label="Worst exposure" value={analysis.targetConfigured ? `${analysis.worstUtil.toFixed(2)}×` : 'N/A'} sub={analysis.targetConfigured ? `${analysis.worstPollutant} P95 / target` : 'No configured target'} tone={analysis.worstUtil > 1 ? 'fail' : analysis.worstUtil > 0.8 ? 'warn' : 'pass'} />
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
  const normRows = tests.map((t) => confirmedRegulatoryCompliance(t)).filter(Boolean)
  const normConfirmed = normRows.length
  const normUnconfirmed = tests.length - normConfirmed
  const normPass = normRows.filter((c) => c!.overall !== 'fail').length
  const targetRows = tests.map((t) => ({ test: t, c: targetCompliance(t) })).filter((x): x is { test: Test; c: NonNullable<ReturnType<typeof targetCompliance>> } => x.c != null)
  const targetConfigured = targetRows.length
  const noTarget = tests.length - targetConfigured
  const targetPass = targetRows.filter(({ c }) => c.overall !== 'fail').length
  const failTests = targetConfigured - targetPass
  const reviewCount = tests.filter((t) => t.lowConfidence.length > 0).length
  const exposure = LIMITED.map((pollutant) => {
    const values = targetRows
      .map(({ test, c }) => {
        const limit = c.perPollutant[pollutant].margin == null || test.results[pollutant] == null ? null
          : test.results[pollutant]! / (1 - c.perPollutant[pollutant].margin!)
        return limit ? test.results[pollutant]! / limit : null
      })
      .filter((v): v is number => v != null)
    const utilization = values.length ? percentile(values, 0.95) : 0
    return { pollutant, utilization, color: utilization > 1 ? RAG_COLOR.fail : utilization > 0.8 ? RAG_COLOR.warn : RAG_COLOR.pass }
  }).sort((a, b) => b.utilization - a.utilization)
  const worst = exposure[0]
  const targetBreaches = targetRows.reduce((sum, { c }) => sum + LIMITED.filter((p) => c.perPollutant[p].rag === 'fail').length, 0)

  const grouped = new Map<string, Test[]>()
  for (const test of tests) {
    const key = `${test.config} · ${test.transmission} · ${test.cycle}`
    grouped.set(key, [...(grouped.get(key) ?? []), test])
  }
  const groups = [...grouped.entries()].map(([name, rows]) => {
    const pollutantExposure = LIMITED.map((p) => ({
      p,
      util: percentile(rows.map((t) => {
        const c = targetCompliance(t)
        const m = c?.perPollutant[p].margin
        const v = t.results[p]
        const limit = m == null || v == null ? null : v / (1 - m)
        return limit ? v! / limit : null
      }).filter((v): v is number => v != null), 0.95),
    })).sort((a, b) => b.util - a.util)[0]
    const rowsWithTarget = rows.map((t) => targetCompliance(t)).filter(Boolean)
    const pass = rowsWithTarget.filter((c) => c!.overall !== 'fail').length
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
  if (targetConfigured) {
    const worstFailCount = targetRows.filter(({ c }) => c.perPollutant[worst.pollutant].rag === 'fail').length
    insights.push({
      title: `${worst.pollutant} is the primary engineering-target driver`,
      detail: `P95 is ${worst.utilization.toFixed(2)}x target with ${worstFailCount} failing test${worstFailCount === 1 ? '' : 's'}. Treat as an engineering indicator before calibration action.`,
      tone: worst.utilization > 1 ? 'fail' : 'warn',
    })
  } else {
    insights.push({
      title: 'No engineering target is configured',
      detail: `${noTarget} accepted test${noTarget === 1 ? '' : 's'} are shown against regulation only. Configure a project target before target pass/fail is reported.`,
      tone: 'warn',
    })
  }
  const normFails = normConfirmed - normPass
  insights.push({
    title: normUnconfirmed ? `${normUnconfirmed} test${normUnconfirmed === 1 ? '' : 's'} need regulatory basis confirmation` : normFails ? `${normFails} regulatory exception${normFails === 1 ? '' : 's'} require containment` : 'Regulatory envelope is protected',
    detail: normUnconfirmed ? 'Confirm M/N class, ignition type and OBD stage before treating regulation pass/fail as official.' : normFails ? 'These results exceed the confirmed regulation profile and should be isolated until root cause is closed.' : 'All confirmed evidence remains within the regulatory profiles.',
    tone: normUnconfirmed ? 'warn' : normFails ? 'fail' : 'pass',
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

  const targetRate = targetConfigured ? Math.round((targetPass / targetConfigured) * 100) : 0
  const normRate = normConfirmed ? Math.round((normPass / normConfirmed) * 100) : 0
  return {
    normPass, normConfirmed, normUnconfirmed, targetPass, targetConfigured, noTarget, failTests, reviewCount, targetBreaches, exposure, groups, insights,
    targetRate, normRate,
    confidence: Math.round(((tests.length - reviewCount) / tests.length) * 100),
    configCount: new Set(tests.map((t) => `${t.config}-${t.transmission}`)).size,
    cycles: [...new Set(tests.map((t) => t.cycle))],
    labs: [...new Set(tests.map((t) => t.lab))],
    worstPollutant: worst.pollutant,
    worstUtil: worst.utilization,
    releaseLevel: normUnconfirmed ? 'warn' : normRate < 100 ? 'fail' : targetConfigured && targetRate < 100 ? 'warn' : !targetConfigured ? 'warn' : 'pass',
    releaseLabel: normUnconfirmed ? 'BASIS REVIEW' : normRate < 100 ? 'REGULATORY ACTION' : targetConfigured && targetRate < 100 ? 'ENGINEERING ACTION' : !targetConfigured ? 'TARGET NOT SET' : 'READY',
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
  const c = targetCompliance(test) ?? regulatoryCompliance(test)
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
