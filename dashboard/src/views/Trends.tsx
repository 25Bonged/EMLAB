import { useMemo, useState } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from 'recharts'
import { useLibrary, applyFilters } from '../store/useLibrary'
import { FilterBar } from '../components/FilterBar'
import { Panel, Eyebrow } from '../components/common'
import { isRegulatoryBasisConfirmed, LIMITED, regulatoryProfile, targetProfile } from '../lib/derive'
import { displayUnit, displayValue, fmt, RAG_COLOR, type LimitProfile } from '../model/limits'
import type { Pollutant, Test } from '../model/types'
import { useUnits } from '../store/useUnits'

const GROUP_COLORS = ['#4a154b', '#1264a3', '#007a5a', '#b07d12', '#9b3d6b', '#3860be']
type GroupKey = 'projectConfig' | 'project' | 'config' | 'transmission' | 'lab' | 'cycle'
type XKey = 'odo' | 'date'

export function Trends() {
  const tests = useLibrary((s) => s.tests)
  const filters = useLibrary((s) => s.filters)
  const rows = useMemo(() => applyFilters(tests, filters), [tests, filters])
  const [poll, setPoll] = useState<Pollutant>('NOx')
  const [xk, setXk] = useState<XKey>('odo')
  const [group, setGroup] = useState<GroupKey>('projectConfig')
  const massUnit = useUnits((s) => s.massUnit)

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; data: { x: number; y: number; label: string }[] }>()
    for (const t of rows) {
      const y = t.results[poll]
      const xv = xk === 'odo' ? t.odo : t.date ? Date.parse(t.date) : null
      if (y == null || xv == null) continue
      const key = groupValue(t, group)
      const g = m.get(key) ?? { name: key, data: [] }
      g.data.push({ x: xv, y: displayValue(y, poll, massUnit)!, label: `${t.config} ${t.cycle} ${t.date}` })
      m.set(key, g)
    }
    return [...m.values()]
  }, [rows, poll, xk, group, massUnit])

  const commonTarget = commonProfile(rows.map(targetProfile).filter(Boolean) as LimitProfile[])
  const commonReg = commonProfile(rows.filter(isRegulatoryBasisConfirmed).map(regulatoryProfile).filter(Boolean) as LimitProfile[])
  const target = commonTarget?.limits[poll] ?? null
  const norm = commonReg?.limits[poll] ?? null
  const shownTarget = displayValue(target, poll, massUnit)
  const shownNorm = displayValue(norm, poll, massUnit)
  const maxY = Math.max(...rows.map((t) => displayValue(t.results[poll], poll, massUnit) ?? 0), shownTarget ?? 0, shownNorm ?? 0) * 1.12

  return (
    <div>
      <Eyebrow>Trends · ageing &amp; grouped comparison</Eyebrow>
      <h2 className="font-display" style={{ fontSize: 22, fontWeight: 600, margin: '4px 0 14px' }}>
        Emission trends
      </h2>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <Labeled label="Pollutant">
          <select value={poll} onChange={(e) => setPoll(e.target.value as Pollutant)}>
            {LIMITED.concat('CO2').map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Labeled>
        <Labeled label="X axis">
          <select value={xk} onChange={(e) => setXk(e.target.value as XKey)}>
            <option value="odo">ODO (km) · ageing</option>
            <option value="date">Test date</option>
          </select>
        </Labeled>
        <Labeled label="Group by">
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            <option value="projectConfig">Program + config</option>
            <option value="project">Program</option>
            <option value="config">Config</option>
            <option value="transmission">Transmission</option>
            <option value="lab">Lab (FEV/ARAI)</option>
            <option value="cycle">Cycle</option>
          </select>
        </Labeled>
      </div>
      <FilterBar />

      <Panel ticks={false} className="rise">
        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Eyebrow>{poll} ({displayUnit(poll, massUnit)}) vs {xk === 'odo' ? 'ODO' : 'date'}</Eyebrow>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 10.5 }} className="font-mono">
            {target != null && <Legendish color={RAG_COLOR.warn} text={`target ${fmt(target, poll, massUnit)}`} />}
            {norm != null && <Legendish color={RAG_COLOR.fail} text={`norm ${fmt(norm, poll, massUnit)}`} />}
          </span>
        </div>
        <div style={{ height: 340, padding: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
              <CartesianGrid stroke="var(--line)" />
              <XAxis
                type="number" dataKey="x" name={xk}
                domain={['dataMin', 'dataMax']}
                tick={{ fontSize: 10, fill: 'var(--ink-faint)' }}
                tickFormatter={(v) => (xk === 'date' ? new Date(v).toISOString().slice(5, 10) : `${Math.round(Number(v) / 1000)}k`)}
                axisLine={{ stroke: 'var(--line-bright)' }} tickLine={false}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[0, maxY || 'auto']}
                width={52}
                tickFormatter={(v) => {
                  const n = Number(v)
                  return Math.abs(n) >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : n.toPrecision(2)
                }}
                tick={{ fontSize: 10, fill: 'var(--ink-faint)' }}
                axisLine={false}
                tickLine={false}
              />
              <ZAxis range={[70, 71]} />
              <Tooltip
                cursor={{ stroke: 'var(--line-bright)' }}
                contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--line-bright)', borderRadius: 8, fontSize: 12 }}
                formatter={(v, n) => (n === 'y' ? [Number(v).toLocaleString('en-US', { maximumFractionDigits: massUnit === 'g/km' ? 6 : 3 }), poll] : [String(v), String(n)])}
                labelFormatter={() => ''}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {shownTarget != null && <ReferenceLine y={shownTarget} stroke={RAG_COLOR.warn} strokeDasharray="5 3" />}
              {shownNorm != null && <ReferenceLine y={shownNorm} stroke={RAG_COLOR.fail} strokeDasharray="5 3" />}
              {groups.map((g, i) => (
                <Scatter key={g.name} name={g.name} data={g.data} fill={GROUP_COLORS[i % GROUP_COLORS.length]} line={xk === 'odo'} lineType="fitting" isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      {!groups.length && (
        <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13, marginTop: 20 }}>
          No data for {poll} on the selected axis.
        </div>
      )}
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}
function Legendish({ color, text }: { color: string; text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--ink-dim)' }}>
      <span style={{ width: 14, height: 0, borderTop: `2px dashed ${color}` }} />
      {text}
    </span>
  )
}

const groupValue = (t: Test, k: GroupKey): string => {
  const project = String(t.project || 'Unknown')
  if (k === 'projectConfig') return `${project} · ${t.config || 'Unknown'}`
  if (k === 'project') return project
  return String(t[k] ?? 'Unknown')
}

function commonProfile(profiles: LimitProfile[]): LimitProfile | null {
  if (!profiles.length) return null
  const first = profiles[0]
  return profiles.every((p) => p.id === first.id) ? first : null
}
