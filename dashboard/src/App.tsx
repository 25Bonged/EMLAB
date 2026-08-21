import { lazy, Suspense, useEffect, useRef } from 'react'
import { useLibrary } from './store/useLibrary'
import { useNav, type View } from './store/useNav'
import { Sidebar } from './components/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useUnits } from './store/useUnits'
import { usePrograms } from './store/usePrograms'
import emlabWordmark from './assets/emlab-wordmark.png'

const Overview = lazy(() => import('./views/Overview').then((module) => ({ default: module.Overview })))
const Intake = lazy(() => import('./views/Intake').then((module) => ({ default: module.Intake })))
const MasterTable = lazy(() => import('./views/MasterTable').then((module) => ({ default: module.MasterTable })))
const Compliance = lazy(() => import('./views/Compliance').then((module) => ({ default: module.Compliance })))
const Compare = lazy(() => import('./views/Compare').then((module) => ({ default: module.Compare })))
const Trends = lazy(() => import('./views/Trends').then((module) => ({ default: module.Trends })))
const Engineering = lazy(() => import('./views/Engineering').then((module) => ({ default: module.Engineering })))
const Report = lazy(() => import('./views/Report').then((module) => ({ default: module.Report })))
const TestDetail = lazy(() => import('./views/TestDetail').then((module) => ({ default: module.TestDetail })))

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
      <BrandHeader />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar />
        <main ref={mainRef} style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          <div className="app-canvas">
            <nav style={{ display: 'flex', alignItems: 'center', gap: 28, borderBottom: '1px solid var(--line)', marginBottom: 24 }}>
              <div style={{ display: 'flex', gap: 28, overflowX: 'auto', scrollbarWidth: 'none' }}>
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
              </div>
              <HeaderControls />
            </nav>
            {error && <div className="service-error">Backend connection: {error}</div>}
            <div key={view} className="rise">
              <ErrorBoundary label={view} resetKey={view}>
                <Suspense fallback={<div className="panel-pad muted">Loading...</div>}>
                  {body}
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function BrandHeader() {
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
      <img
        src={emlabWordmark}
        alt="EMLAB"
        style={{
          width: 112,
          height: 20,
          objectFit: 'contain',
          objectPosition: 'left center',
          display: 'block',
        }}
      />
      <span className="eyebrow" style={{ borderLeft: '1px solid var(--line-bright)', paddingLeft: 11 }}>
        Emission Test Dashboard
      </span>
    </header>
  )
}

function HeaderControls() {
  const count = useLibrary((s) => s.tests.length)
  const health = useLibrary((s) => s.health)
  const massUnit = useUnits((s) => s.massUnit)
  const setMassUnit = useUnits((s) => s.setMassUnit)
  const selectedProgram = useNav((s) => s.selectedProgram)
  const activeProgram = usePrograms((s) => s.programs.find((p) => p.id === selectedProgram))
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 9 }}>
      <span
        className="font-mono"
        title={activeProgram ? `New imports go into "${activeProgram.name}"` : 'No program open - importing will ask which program to use'}
        style={{
          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          color: activeProgram ? 'var(--aubergine)' : 'var(--ink-faint)',
          padding: '3px 10px', borderRadius: 99,
          background: activeProgram ? 'var(--aubergine-wash)' : 'transparent',
          border: activeProgram ? 'none' : '1px dashed var(--line-bright)',
        }}
      >
        {activeProgram ? activeProgram.name : 'No program open'}
      </span>
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
          flex: '0 0 auto',
          background: health?.ok ? 'var(--pass)' : 'var(--fail)',
          boxShadow: `0 0 0 4px ${health?.ok ? 'rgba(22,163,74,0.16)' : 'rgba(220,38,38,0.16)'}`,
        }}
      />
    </div>
  )
}
