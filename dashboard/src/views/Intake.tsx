import { useMemo } from 'react'
import { useLibrary } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { Panel, Eyebrow, Chip } from '../components/common'

const STATUS_LABEL = {
  pending_pair: 'Pending pair',
  processing: 'Processing',
  quarantined: 'Quarantined',
  accepted: 'Accepted',
  replaced: 'Replaced',
} as const

export function Intake() {
  const records = useLibrary((s) => s.records)
  const jobs = useLibrary((s) => s.ingestion)
  const health = useLibrary((s) => s.health)
  const rescan = useLibrary((s) => s.rescan)
  const approve = useLibrary((s) => s.approve)
  const { openTest } = useNav()
  const quarantined = useMemo(() => records.filter((test) => test.status === 'quarantined'), [records])
  const activeJobs = jobs.filter((job) => job.status !== 'accepted')

  return (
    <div>
      <div className="section-title-row">
        <div>
          <Eyebrow>Daily intake · source evidence governance</Eyebrow>
          <h2 className="font-display page-title">FEV ingestion &amp; review</h2>
        </div>
        {health?.can_edit && (
          <button className="btn btn-primary" onClick={() => void rescan()}>
            {health.outlook_sync_available ? 'Sync Outlook & rescan' : 'Rescan source'}
          </button>
        )}
      </div>

      <div className="intake-summary">
        <Summary label="Accepted library" value={records.filter((t) => t.status === 'accepted').length} tone="pass" />
        <Summary label="Pending pairs" value={jobs.filter((j) => j.status === 'pending_pair').length} tone="warn" />
        <Summary label="Quarantined" value={quarantined.length} tone="fail" />
        <Summary label="Watcher" value={health?.ok ? 'ONLINE' : 'OFFLINE'} tone={health?.ok ? 'pass' : 'fail'} />
      </div>

      <Panel ticks={false}>
        <div className="panel-heading">
          <div><Eyebrow>Watched source</Eyebrow><h3>{health?.watch_folder ?? 'Connecting…'}</h3></div>
          <Chip>{health?.can_edit ? 'Host PC · edit enabled' : 'LAN viewer · read only'}</Chip>
        </div>
        <div className="intake-list">
          {activeJobs.length === 0 && <Empty text="No pending or failed ingestion jobs." />}
          {activeJobs.map((job) => (
            <div className="intake-job" key={job.stem} data-status={job.status}>
              <span className="status-light" />
              <div>
                <strong>{job.stem}</strong>
                <span>{job.message || STATUS_LABEL[job.status ?? 'processing']}</span>
              </div>
              <div className="pair-state">
                <Chip>{job.pdf_path ? 'PDF ✓' : 'PDF missing'}</Chip>
                <Chip>{job.xlsm_path ? 'XLSM ✓' : 'XLSM missing'}</Chip>
              </div>
              <span className="font-mono job-time">{new Date(job.updated_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div style={{ height: 16 }} />
      <Panel ticks={false}>
        <div className="panel-heading"><div><Eyebrow>Local engineering action</Eyebrow><h3>Quarantine review queue</h3></div></div>
        <div className="intake-list">
          {quarantined.length === 0 && <Empty text="No tests require review." />}
          {quarantined.map((test) => (
            <div className="intake-job" key={test.id} data-status="quarantined">
              <span className="status-light" />
              <button className="intake-open" onClick={() => openTest(test.id)}>
                <strong>{test.config} · {test.transmission} · {test.cycle} · {test.date}</strong>
                <span>{test.vehicleModel} · VN {test.vnNo || '—'} · flags: {test.lowConfidence.join(', ') || 'parser exception'}</span>
              </button>
              {health?.can_edit && <button className="btn compact-btn" onClick={() => void approve(test.id)}>Approve</button>}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function Summary({ label, value, tone }: { label: string; value: string | number; tone: 'pass' | 'warn' | 'fail' }) {
  return <Panel><div className="metric-card"><Eyebrow>{label}</Eyebrow><div className={`metric-value tone-${tone}`}>{value}</div></div></Panel>
}

function Empty({ text }: { text: string }) {
  return <div className="intake-empty">{text}</div>
}
