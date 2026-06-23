import { useEffect, useRef } from 'react'
import { useLibrary } from './store/useLibrary'
import { useNav, type View } from './store/useNav'
import { Sidebar } from './components/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Overview } from './views/Overview'
import { MasterTable } from './views/MasterTable'
import { Compliance } from './views/Compliance'
import { Compare } from './views/Compare'
import { Trends } from './views/Trends'
import { Engineering } from './views/Engineering'
import { Report } from './views/Report'
import { TestDetail } from './views/TestDetail'
import { Intake } from './views/Intake'
import { useUnits } from './store/useUnits'

const TABS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'intake', label: 'Intake' },
  { id: 'table', label: 'Master Table' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'compare', label: 'Compare' },
  { id: 'trends', label: 'Trends' },
  { id: 'engineering', label: 'Engineering' },
]

export default function App() {
  const load = useLibrary((s) => s.load)
  const refresh = useLibrary((s) => s.refresh)
  const error = useLibrary((s) => s.error)
  const { view, go } = useNav()
  const testCount = useLibrary((s) => s.tests.length)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 10000)
    return () => window.clearInterval(timer)
  }, [refresh])

  // Return to the top of the canvas whenever the active view changes; the
  // staggered panel entrance is handled in CSS and re-plays on each remount.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [view, testCount])

  const body =
    view === 'intake' ? <Intake />
    : view === 'table' ? <MasterTable />
    : view === 'compliance' ? <Compliance />
    : view === 'compare' ? <Compare />
    : view === 'trends' ? <Trends />
    : view === 'engineering' ? <Engineering />
    : view === 'report' ? <Report />
    : view === 'detail' ? <TestDetail />
    : <Overview />

  return (
    <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar />
        <main ref={mainRef} style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          <div className="app-canvas">
            <nav style={{ display: 'flex', gap: 28, borderBottom: '1px solid var(--line)', marginBottom: 24, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {TABS.map((t) => (
                <button key={t.id} className="tab" data-active={view === t.id} onClick={() => go(t.id)}>
                  {t.label}
                </button>
              ))}
              {view === 'detail' && (
                <button className="tab" data-active>
                  Test Detail
                </button>
              )}
            </nav>
            {error && <div className="service-error">Backend connection: {error}</div>}
            <div key={view} className="rise">
              <ErrorBoundary label={view} resetKey={view}>
                {body}
              </ErrorBoundary>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function Header() {
  const count = useLibrary((s) => s.tests.length)
  const health = useLibrary((s) => s.health)
  const massUnit = useUnits((s) => s.massUnit)
  const setMassUnit = useUnits((s) => s.setMassUnit)
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 30px',
        borderBottom: '1px solid var(--line)',
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        position: 'relative',
        zIndex: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: 'linear-gradient(150deg, var(--aubergine), var(--aubergine-press))',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontFamily: "'Inter Tight', sans-serif",
            fontWeight: 700,
            fontSize: 15,
            boxShadow: '0 6px 16px -8px rgba(74,21,75,0.7)',
          }}
        >
          E
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 11 }}>
          <span className="font-cluster" style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
            EMLAB
          </span>
          <span className="eyebrow" style={{ borderLeft: '1px solid var(--line-bright)', paddingLeft: 11 }}>
            Emission Test Dashboard
          </span>
        </div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
        <label className="unit-switch">
          <span>Mass unit</span>
          <select value={massUnit} onChange={(e) => setMassUnit(e.target.value as 'mg/km' | 'g/km')}>
            <option value="mg/km">mg/km</option>
            <option value="g/km">g/km</option>
          </select>
        </label>
        <span
          className="font-mono"
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}
        >
          {count} test{count !== 1 ? 's' : ''} loaded
        </span>
        <span
          title={health?.ok ? 'Watcher online' : 'Backend offline'}
          style={{
            width: 9,
            height: 9,
            borderRadius: 99,
            background: health?.ok ? 'var(--pass)' : 'var(--fail)',
            boxShadow: `0 0 0 4px ${health?.ok ? 'rgba(22,163,74,0.16)' : 'rgba(220,38,38,0.16)'}`,
          }}
        />
      </div>
    </header>
  )
}
