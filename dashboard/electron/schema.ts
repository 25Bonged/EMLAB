export const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('pending_pair','processing','quarantined','accepted','replaced')),
  project TEXT, cycle TEXT, config TEXT, transmission TEXT, lab TEXT,
  vehicle_model TEXT, vn_no TEXT, vin_sample_id TEXT, test_date TEXT,
  catalyst_state TEXT, odo REAL, imported_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  parser_version TEXT NOT NULL, data_json TEXT NOT NULL, low_confidence_json TEXT NOT NULL,
  combined_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_tests_status ON tests(status);
CREATE INDEX IF NOT EXISTS idx_tests_date ON tests(test_date);
CREATE INDEX IF NOT EXISTS idx_tests_filters ON tests(project, cycle, config, transmission, lab);

CREATE TABLE IF NOT EXISTS pollutant_results (
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  pollutant TEXT NOT NULL, value REAL, unit TEXT NOT NULL,
  PRIMARY KEY(test_id, pollutant)
);
CREATE TABLE IF NOT EXISTS phases (
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  phase_index INTEGER NOT NULL, name TEXT NOT NULL, distance_km REAL, data_json TEXT NOT NULL,
  PRIMARY KEY(test_id, phase_index)
);
CREATE TABLE IF NOT EXISTS trace_points (
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  channel TEXT NOT NULL, point_index INTEGER NOT NULL, time_s REAL NOT NULL, data_json TEXT NOT NULL,
  PRIMARY KEY(test_id, channel, point_index)
);
CREATE TABLE IF NOT EXISTS source_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id TEXT REFERENCES tests(id) ON DELETE SET NULL,
  stem TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, modified_ns TEXT NOT NULL,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  stem TEXT PRIMARY KEY, status TEXT NOT NULL, pdf_path TEXT, xlsm_path TEXT,
  pdf_hash TEXT, xlsm_hash TEXT, message TEXT, first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, test_id TEXT REFERENCES tests(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS replacement_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, test_id TEXT NOT NULL,
  previous_hash TEXT, replacement_hash TEXT, replaced_at TEXT NOT NULL,
  parser_outcome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manual_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT, test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  patch_json TEXT NOT NULL, changed_at TEXT NOT NULL, changed_by TEXT NOT NULL
);
`

export const POLLUTANT_UNITS: Record<string, string> = {
  CO: 'mg/km', THC: 'mg/km', NOx: 'mg/km', CO2: 'mg/km',
  CH4: 'mg/km', NMHC: 'mg/km', PM: 'mg/km', PN: '#/km',
}

export const POLLUTANTS = ['CO', 'THC', 'NOx', 'CO2', 'CH4', 'NMHC', 'PM', 'PN']
