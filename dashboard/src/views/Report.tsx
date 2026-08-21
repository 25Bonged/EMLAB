import { useEffect, useMemo, useRef } from 'react'
import { useLibrary } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { useUnits } from '../store/useUnits'
import { confirmedRegulatoryCompliance, isRegulatoryBasisConfirmed, LIMITED, regulatoryProfile, targetCompliance, targetProfile } from '../lib/derive'
import { displayUnit, fmt, RAG_COLOR, type LimitProfile } from '../model/limits'
import { mean, cpu, wilson, percentile } from '../lib/stats'
import { coldStart, catalystLightoff, deteriorationByGroup } from '../lib/engineering'
import type { Pollutant } from '../model/types'

export function Report() {
  const tests = useLibrary((s) => s.tests)
  const loadDetail = useLibrary((s) => s.loadDetail)
  const { go } = useNav()
  const massUnit = useUnits((s) => s.massUnit)

  // Fleet cold-start & catalyst metrics need the full phase/trace detail, which
  // the summary list omits — hydrate each test once (guarded against re-requests).
  const hydrated = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const t of tests) {
      if (t.phases?.length || t.trace || hydrated.current.has(t.id)) continue
      hydrated.current.add(t.id)
      void loadDetail(t.id)
    }
  }, [tests, loadDetail])

  const a = useMemo(() => {
    const targetRows = tests.map((t) => ({ test: t, c: targetCompliance(t) })).filter((x): x is { test: typeof tests[number]; c: NonNullable<ReturnType<typeof targetCompliance>> } => x.c != null)
    const normRows = tests.map((t) => confirmedRegulatoryCompliance(t)).filter(Boolean)
    const normPass = normRows.filter((c) => c!.overall !== 'fail').length
    const normPending = tests.length - normRows.length
    const tgtPass = targetRows.filter(({ c }) => c.overall !== 'fail').length
    const wTgt = wilson(tgtPass, targetRows.length)
    const wNorm = wilson(normPass, normRows.length)
    const targets = uniqueProfiles(tests.map(targetProfile).filter(Boolean) as LimitProfile[])
    const regs = uniqueProfiles(tests.filter(isRegulatoryBasisConfirmed).map(regulatoryProfile).filter(Boolean) as LimitProfile[])

    const perPollutant = LIMITED.map((p) => {
      const vals = targetRows.map(({ test }) => test.results[p]).filter((v): v is number => v != null)
      const target = commonReportLimit(targetRows.map(({ test, c }) => limitFromValueAndMargin(test.results[p], c.perPollutant[p].margin)))
      if (target.mixed || target.value == null) return null
      return {
        p, n: vals.length, mean: mean(vals), p95: percentile(vals, 0.95), target: target.value,
        cpk: cpu(vals, target.value), pass: targetRows.filter(({ c }) => (c.perPollutant[p].margin ?? -1) >= 0).length,
      }
    }).filter((s): s is NonNullable<typeof s> => !!s && s.n > 0)

    const groups = new Map<string, typeof tests>()
    for (const t of tests) {
      const key = `${t.project} · ${t.config} · ${t.transmission} · ${t.cycle}`
      groups.set(key, [...(groups.get(key) ?? []), t])
    }
    const gateRows = [...groups.entries()].map(([name, rows]) => {
      const worst = LIMITED.map((p) => ({
        p, util: percentile(rows.map((t) => {
          const c = targetCompliance(t)
          const v = t.results[p]
          const m = c?.perPollutant[p].margin
          const limit = v == null || m == null ? null : v / (1 - m)
          return limit && v != null ? v / limit : null
        }).filter((v): v is number => v != null), 0.95),
      })).sort((x, y) => y.util - x.util)[0]
      const rowTargets = rows.map((t) => targetCompliance(t)).filter(Boolean)
      return {
        name, n: rows.length, lab: [...new Set(rows.map((t) => t.lab))].join('/'),
        targetCount: rowTargets.length,
        pass: rowTargets.filter((c) => c!.overall !== 'fail').length,
        worst: worst.p, util: worst.util,
        level: (worst.util > 1 ? 'fail' : worst.util > 0.8 ? 'warn' : 'pass') as 'fail' | 'warn' | 'pass',
      }
    }).sort((x, y) => y.util - x.util)

    // Fleet cold-start: average phase-1 mass share across tests with phase data.
    const csTests = tests.filter((t) => t.phases.length > 1)
    const csPolls = ['CO', 'THC', 'NOx', 'NMHC'] as Pollutant[]
    const coldStartRows = csPolls.map((p) => {
      const fracs = csTests.map((t) => coldStart(t).find((r) => r.pollutant === p)?.coldFraction).filter((v): v is number => v != null)
      return { p, share: fracs.length ? mean(fracs) * 100 : null, n: fracs.length }
    }).filter((r) => r.share != null)

    // Fleet catalyst light-off for the key regulated species (NOx, CO).
    const loTests = tests.filter((t) => t.trace?.preCat.length)
    const lightoff = (['NOx', 'CO'] as const).map((p) => {
      const times = loTests.map((t) => catalystLightoff(t, p)?.lightoffTime).filter((v): v is number => v != null)
      const convs = loTests.map((t) => catalystLightoff(t, p)?.timeWeightedConversion).filter((v): v is number => v != null)
      return { p, time: times.length ? mean(times) : null, conv: convs.length ? mean(convs) * 100 : null, n: loTests.length }
    }).filter((r) => r.time != null || r.conv != null)

    // Deterioration: only surface groups with a trustworthy fit.
    const dfGroups = deteriorationByGroup(tests, 'NOx', (t) => `${t.project} · ${t.config}`, 160000, {
      targetFor: targetProfile,
      normFor: (t) => (isRegulatoryBasisConfirmed(t) ? regulatoryProfile(t) : null),
    }).filter((g) => g.reliable && !g.mixedNorm && !g.mixedTarget)

    return {
      normPass, normCount: normRows.length, normPending, tgtPass, targetCount: targetRows.length, wTgt, wNorm, perPollutant, gateRows,
      coldStartRows, lightoff, dfGroups, csCount: csTests.length, loCount: loTests.length,
      regs, targets,
      level: normPending ? 'warn' : normPass < normRows.length ? 'fail' : targetRows.length && tgtPass < targetRows.length ? 'warn' : !targetRows.length ? 'warn' : 'pass',
      label: normPending ? 'BASIS REVIEW' : normPass < normRows.length ? 'REGULATORY ACTION' : targetRows.length && tgtPass < targetRows.length ? 'ENGINEERING ACTION' : !targetRows.length ? 'TARGET NOT SET' : 'READY',
      configs: new Set(tests.map((t) => `${t.config}-${t.transmission}`)).size,
      cycles: [...new Set(tests.map((t) => t.cycle))],
      labs: [...new Set(tests.map((t) => t.lab))],
      programs: [...new Set(tests.map((t) => t.project))],
    }
  }, [tests])

  if (!tests.length) {
    return <div style={{ padding: 40, color: 'var(--ink-faint)' }}>No tests loaded.</div>
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="report-root">
      <div className="report-actions no-print">
        <button className="btn" onClick={() => go('overview')}>← Back</button>
        <button className="btn btn-primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div className="report-sheet">
        <header className="report-head">
          <div>
            <div className="report-brand">EMLAB</div>
            <div className="report-sub">Emission Compilation - Engineering Summary</div>
          </div>
          <div className="report-meta">
            <div><strong>Program(s)</strong> {a.programs.join(', ')}</div>
            <div><strong>Generated</strong> {today}</div>
            <div><strong>Regulation</strong> {a.regs.join('; ') || 'Not applicable'}</div>
            <div><strong>Target</strong> {a.targets.join('; ') || 'No engineering target configured'}</div>
          </div>
        </header>

        <div className="report-verdict" data-level={a.level}>
          <div>
            <div className="eyebrow">Program readiness</div>
            <div className="report-verdict-label">{a.label}</div>
          </div>
          <div className="report-verdict-stats">
            <div><strong>{a.tgtPass}/{a.targetCount}</strong><span>within target</span></div>
            <div><strong>{a.normPass}/{a.normCount}</strong><span>confirmed regulation</span></div>
            <div><strong>{a.configs}</strong><span>configurations</span></div>
          </div>
        </div>

        <section>
          <h3 className="report-h">Statistical conformity</h3>
          <p className="report-p">
            Across {tests.length} compiled tests, {a.targetCount ? `${a.tgtPass} pass the configured engineering target` : 'no engineering target is configured'}
            (true population pass-rate {(a.wTgt.lo * 100).toFixed(0)}–{(a.wTgt.hi * 100).toFixed(0)}% at 95% confidence)
            and {a.normPass} pass the confirmed regulatory profile
            ({(a.wNorm.lo * 100).toFixed(0)}–{(a.wNorm.hi * 100).toFixed(0)}%). Coverage spans
            {' '}{a.cycles.join(', ')} cycles and {a.labs.join(', ')} laboratories.
            {a.normPending ? ` ${a.normPending} test${a.normPending === 1 ? '' : 's'} require regulatory basis confirmation before official release scoring.` : ''}
          </p>
          <table className="report-table">
            <thead><tr><th>Pollutant</th><th>n</th><th>Mean</th><th>P95</th><th>Target</th><th>Cpk</th><th>Pass</th></tr></thead>
            <tbody>
              {a.perPollutant.map((s) => (
                <tr key={s.p}>
                  <td><strong>{s.p}</strong> <span className="report-unit">{displayUnit(s.p, massUnit)}</span></td>
                  <td>{s.n}</td>
                  <td>{fmt(s.mean, s.p, massUnit)}</td>
                  <td>{fmt(s.p95, s.p, massUnit)}</td>
                  <td>{fmt(s.target, s.p, massUnit)}</td>
                  <td style={{ fontWeight: 700, color: s.cpk == null ? 'var(--ink-faint)' : s.cpk >= 1.33 ? RAG_COLOR.pass : s.cpk >= 1 ? RAG_COLOR.warn : RAG_COLOR.fail }}>{s.cpk == null ? '—' : s.cpk.toFixed(2)}</td>
                  <td>{s.pass}/{s.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="report-h">Configuration release gates</h3>
          <table className="report-table">
            <thead><tr><th>Configuration</th><th>Lab</th><th>Tests</th><th>Target pass</th><th>Worst driver</th><th>P95 exposure</th><th>Gate</th></tr></thead>
            <tbody>
              {a.gateRows.map((g) => (
                <tr key={g.name}>
                  <td><strong>{g.name}</strong></td>
                  <td>{g.lab}</td>
                  <td>{g.n}</td>
                  <td>{g.pass}/{g.targetCount}</td>
                  <td>{g.worst}</td>
                  <td>{g.util.toFixed(2)}×</td>
                  <td><span className="report-gate" style={{ color: RAG_COLOR[g.level], borderColor: `${RAG_COLOR[g.level]}55`, background: `${RAG_COLOR[g.level]}12` }}>{g.level === 'fail' ? 'FAIL' : g.level === 'warn' ? 'MARGINAL' : 'PASS'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {(a.coldStartRows.length > 0 || a.lightoff.length > 0) && (
          <section>
            <h3 className="report-h">Cold-start &amp; catalyst behaviour</h3>
            <p className="report-p">
              {a.coldStartRows.length > 0 && (
                <>Across {a.csCount} test{a.csCount === 1 ? '' : 's'} with phase data, phase-1 (cold) emissions account for{' '}
                  {a.coldStartRows.map((r, i) => (
                    <span key={r.p}>{i > 0 ? (i === a.coldStartRows.length - 1 ? ' and ' : ', ') : ''}<strong>{r.share!.toFixed(0)}%</strong> of {r.p}</span>
                  ))}{' '}of total cycle mass — confirming catalyst light-off as the primary lever. </>
              )}
              {a.lightoff.length > 0 && a.loCount > 0 && (
                <>Mean catalyst light-off (50% conversion) is{' '}
                  {a.lightoff.map((r, i) => (
                    <span key={r.p}>{i > 0 ? ', ' : ''}<strong>{r.time != null ? `${r.time.toFixed(0)} s` : 'n/a'}</strong> for {r.p}{r.conv != null ? ` (${r.conv.toFixed(0)}% time-weighted conversion)` : ''}</span>
                  ))} across {a.loCount} instrumented test{a.loCount === 1 ? '' : 's'}.</>
              )}
            </p>
          </section>
        )}

        {a.dfGroups.length > 0 && (
          <section>
            <h3 className="report-h">Ageing &amp; deterioration (NOx)</h3>
            <table className="report-table">
              <thead><tr><th>Configuration</th><th>Tests</th><th>R²</th><th>Current</th><th>Projected @160k km</th><th>DF</th></tr></thead>
              <tbody>
                {a.dfGroups.map((g) => (
                  <tr key={g.group}>
                    <td><strong>{g.group}</strong></td>
                    <td>{g.n}</td>
                    <td>{g.fit.r2.toFixed(2)}</td>
                    <td>{fmt(g.current, 'NOx', massUnit)}</td>
                    <td style={{ color: g.exceedsNorm ? RAG_COLOR.fail : g.exceedsTarget ? RAG_COLOR.warn : RAG_COLOR.pass }}>{fmt(g.projected, 'NOx', massUnit)}</td>
                    <td style={{ fontWeight: 700 }}>{g.df.toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="report-foot">
          EMLAB emission compilation · values in {massUnit} (PN in #/km) · regulatory basis and engineering target are resolved per test. Generated {today}.
        </footer>
      </div>
    </div>
  )
}

function uniqueProfiles(profiles: LimitProfile[]): string[] {
  return [...new Map(profiles.map((p) => [p.id, p.label])).values()]
}

function limitFromValueAndMargin(value: number | null, margin: number | null): number | null {
  return value == null || margin == null || margin >= 1 ? null : value / (1 - margin)
}

function commonReportLimit(values: (number | null)[]): { value: number | null; mixed: boolean } {
  const concrete = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (!concrete.length) return { value: null, mixed: false }
  if (concrete.length !== values.length) return { value: null, mixed: true }
  const first = concrete[0]
  return concrete.every((v) => Math.abs(v - first) <= Math.max(1e-9, Math.abs(first) * 1e-9))
    ? { value: first, mixed: false }
    : { value: null, mixed: true }
}
