import { useRef, useState } from 'react'
import { useLibrary } from '../store/useLibrary'
import { useNav } from '../store/useNav'
import { usePrograms } from '../store/usePrograms'
import { ProgramDialog } from './ProgramDialog'
import { ProgramPickerDialog } from './ProgramPickerDialog'

export function UploadDropzone({ compact = false }: { compact?: boolean }) {
  const importFiles = useLibrary((s) => s.importFiles)
  const progress = useLibrary((s) => s.progress)
  const health = useLibrary((s) => s.health)
  const programs = usePrograms((s) => s.programs)
  const createProgram = usePrograms((s) => s.create)
  const selectedProgram = useNav((s) => s.selectedProgram)
  const selectProgram = useNav((s) => s.selectProgram)

  const [drag, setDrag] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Files staged while asking which program they belong to (see resolveProgram
  // below) — only ever set between that ask and the follow-up pick/create.
  const [pending, setPending] = useState<File[] | null>(null)
  const [picker, setPicker] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  async function doImport(files: File[], programId: string) {
    setMsg(null)
    try {
      const n = await importFiles(files, programId)
      setMsg(n > 0 ? `Imported ${n} test${n > 1 ? 's' : ''}.` : 'No report/trace files found.')
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error))
    }
    setTimeout(() => setMsg(null), 4000)
  }

  // Every import needs a program to land in — there is no "unassigned"
  // bucket. If one is already open in the sidebar, use it without asking:
  // that is the common case, dropping more reports into the program you are
  // already looking at. Otherwise which program to use is genuinely
  // ambiguous (pick from several, or none exist yet), so ask rather than
  // silently importing with no program at all, which was the previous
  // behaviour (the files landed with no program_id and never showed up
  // anywhere in the sidebar tree).
  function handle(files: File[]) {
    if (!files.length) return
    if (selectedProgram) { void doImport(files, selectedProgram); return }
    setPending(files)
    if (programs.length === 0) setCreateOpen(true)
    else setPicker(true)
  }

  async function handleCreate(name: string) {
    const program = await createProgram(name)
    selectProgram(program.id)
    const files = pending
    setPending(null)
    if (files) await doImport(files, program.id)
  }

  function handlePick(id: string) {
    selectProgram(id)
    setPicker(false)
    const files = pending
    setPending(null)
    if (files) void doImport(files, id)
  }

  if (health && !health.can_edit) return null

  return (
    <>
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

      {createOpen && (
        <ProgramDialog
          title="New program"
          onSubmit={handleCreate}
          onClose={() => { setCreateOpen(false); setPending(null) }}
        />
      )}
      {picker && (
        <ProgramPickerDialog
          programs={programs}
          fileCount={pending?.length ?? 0}
          onPick={handlePick}
          onCreateNew={() => { setPicker(false); setCreateOpen(true) }}
          onClose={() => { setPicker(false); setPending(null) }}
        />
      )}
    </>
  )
}
