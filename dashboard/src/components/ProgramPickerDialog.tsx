import type { Program } from '../lib/api'

/** Shown when an import has no program to land in — files are already
 *  staged by the caller, this only decides which program gets them. */
export function ProgramPickerDialog({
  programs, fileCount, onPick, onCreateNew, onClose,
}: {
  programs: Program[]
  fileCount: number
  onPick: (id: string) => void
  onCreateNew: () => void
  onClose: () => void
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,10,22,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
    >
      <div onClick={(e) => e.stopPropagation()} className="panel" style={{ width: 360, padding: 20 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Add to which program?</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginBottom: 14 }}>
          {fileCount} file{fileCount === 1 ? '' : 's'} ready to import. No program is open — pick one, or create a new one.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto', marginBottom: 14 }}>
          {programs.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn"
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => onPick(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button type="button" className="btn btn-primary" onClick={onCreateNew}>＋ New program</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
