import { useRef, useState } from 'react'
import { useLibrary } from '../store/useLibrary'

export function UploadDropzone({ compact = false }: { compact?: boolean }) {
  const importFiles = useLibrary((s) => s.importFiles)
  const progress = useLibrary((s) => s.progress)
  const health = useLibrary((s) => s.health)
  const [drag, setDrag] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  async function handle(files: File[]) {
    if (!files.length) return
    setMsg(null)
    try {
      const n = await importFiles(files)
      setMsg(n > 0 ? `Imported ${n} test${n > 1 ? 's' : ''}.` : 'No report/trace files found.')
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error))
    }
    setTimeout(() => setMsg(null), 4000)
  }

  if (health && !health.can_edit) return null

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        handle([...e.dataTransfer.files])
      }}
      className="panel"
      style={{
        padding: compact ? '14px 16px' : '34px 24px',
        textAlign: 'center',
        borderStyle: 'dashed',
        borderColor: drag ? 'var(--cyan)' : 'var(--line-bright)',
        background: drag ? 'var(--aubergine-wash)' : '#fcfbfd',
        transition: 'all 0.15s',
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".zip,.pdf,.xlsm,.xlsx"
        hidden
        onChange={(e) => handle([...(e.target.files ?? [])])}
      />
      <input
        ref={dirRef}
        type="file"
        hidden
        // @ts-expect-error non-standard directory attributes
        webkitdirectory=""
        directory=""
        multiple
        onChange={(e) => handle([...(e.target.files ?? [])])}
      />
      {progress ? (
        <div className="font-mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>
          {progress.stage} · {progress.done}/{progress.total}
        </div>
      ) : (
        <>
          {!compact && (
            <div
              className="font-display"
              style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}
            >
              Drop a compilation workbook or test folder
            </div>
          )}
          <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginBottom: compact ? 10 : 16 }}>
            {compact ? 'Add tests / workbook' : 'Excel compilation, REPORT.pdf and TRACES.xlsm files are parsed automatically'}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => dirRef.current?.click()}>
              Select folder
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Select zip / files
            </button>
          </div>
          {msg && (
            <div className="font-mono" style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 10 }}>
              {msg}
            </div>
          )}
        </>
      )}
    </div>
  )
}
