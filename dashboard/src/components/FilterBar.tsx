import { useLibrary } from '../store/useLibrary'
import { distinct } from '../lib/derive'

const FIELDS: { key: 'project' | 'cycle' | 'config' | 'transmission' | 'lab'; label: string }[] = [
  { key: 'project', label: 'Program' },
  { key: 'cycle', label: 'Cycle' },
  { key: 'config', label: 'Config' },
  { key: 'transmission', label: 'Trans' },
  { key: 'lab', label: 'Lab' },
]

export function FilterBar() {
  const tests = useLibrary((s) => s.tests)
  const filters = useLibrary((s) => s.filters)
  const setFilter = useLibrary((s) => s.setFilter)
  const reset = useLibrary((s) => s.resetFilters)
  const active = Object.values(filters).some(Boolean)

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
      {FIELDS.map((f) => (
        <select
          key={f.key}
          value={filters[f.key] ?? ''}
          onChange={(e) => setFilter({ [f.key]: e.target.value || undefined })}
        >
          <option value="">{f.label}: all</option>
          {distinct(tests, f.key).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ))}
      <input
        placeholder="Search model / VN…"
        value={filters.search ?? ''}
        onChange={(e) => setFilter({ search: e.target.value || undefined })}
        style={{ minWidth: 150 }}
      />
      {active && (
        <button className="btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={reset}>
          Clear
        </button>
      )}
    </div>
  )
}
