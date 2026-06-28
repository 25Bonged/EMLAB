import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import Settings
from app.db import Database
from app.watcher import FolderWatcher


def parsed_test():
    return {
        "id": "FEV_SAMPLE",
        "project": "STLA",
        "cycle": "WLTP",
        "config": "CC24",
        "transmission": "MB6",
        "lab": "FEV",
        "vehicleModel": "CITROEN AIRCROSS",
        "vinSampleId": "VIN",
        "vnNo": "9740",
        "date": "2026-03-18",
        "catalystState": "Fresh",
        "stt": "ON",
        "startSoc": 96,
        "inertia": 1464,
        "odo": 139,
        "distanceKm": 14.96,
        "phaseCount": 3,
        "rld": {"A": 48.3, "B": -0.1, "C": 0.04},
        "fuel": {"name": "E20"},
        "conditions": {},
        "results": {"CO": 325.3, "THC": 7.59, "NOx": 24.73, "CO2": 134752, "CH4": 2.68, "NMHC": 4.42, "PM": 1.32, "PN": 3.38e9},
        "phases": [],
        "trace": {"dilute": [], "preCat": [], "postCat": []},
        "units": {
            "resultsCanonical": "mg/km",
            "resultsSource": "mg/km",
            "trace": {"dilute": {"NOx": "ppm"}, "preCat": {"NOx": "ppm"}, "postCat": {"NOx": "ppm"}},
        },
        "source": {},
        "lowConfidence": [],
        "importedAt": "2026-06-20T00:00:00Z",
    }


class WatcherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.watch = root / "watch"
        self.watch.mkdir()
        settings = Settings(self.watch, root / "test.db", "127.0.0.1", 8000, 1, root)
        self.db = Database(settings)
        self.watcher = FolderWatcher(settings, self.db)
        self.pdf = self.watch / "FEV_SAMPLE_REPORT.pdf"
        self.xlsm = self.watch / "FEV_SAMPLE_TRACES.xlsm"

    def tearDown(self):
        self.tmp.cleanup()

    @patch("app.watcher.parse_pair", return_value=parsed_test())
    def test_pending_pair_completion_idempotency_and_correction(self, parser):
        self.pdf.write_bytes(b"pdf-v1")
        self.watcher.scan_once()
        self.assertEqual(self.db.list_jobs()[0]["status"], "pending_pair")

        self.xlsm.write_bytes(b"xlsm-v1")
        self.watcher.scan_once()
        job = self.db.list_jobs()[0]
        self.assertEqual(job["status"], "accepted")
        test_id = job["test_id"]
        self.assertEqual(parser.call_count, 1)

        self.watcher.scan_once()
        self.assertEqual(parser.call_count, 1)
        self.assertEqual(len(self.db.audit(test_id)), 0)

        self.pdf.write_bytes(b"pdf-corrected")
        self.watcher.scan_once()
        self.assertEqual(parser.call_count, 2)
        self.assertEqual(len(self.db.audit(test_id)), 1)

    @patch("app.watcher.parse_pair", return_value=parsed_test())
    def test_same_day_repeat_runs_stay_distinct(self, parser):
        # Same vehicle, VN, cycle, and calendar day — two runs differing only by
        # the time in the filename must produce two records, not one overwriting
        # the other.
        for ts in ("09-51-01", "15-22-40"):
            stem = f"CITROEN_AIRCROSS_MT_9740_5099_2026-03-18_{ts}"
            (self.watch / f"{stem}_REPORT.pdf").write_bytes(f"pdf-{ts}".encode())
            (self.watch / f"{stem}_TRACES.xlsm").write_bytes(f"xlsm-{ts}".encode())
        self.watcher.scan_once()
        self.assertEqual(len(self.db.list_tests()), 2)
        self.assertEqual(parser.call_count, 2)

    @patch("app.watcher.parse_pair", return_value=parsed_test())
    @patch("app.watcher.sha256", side_effect=lambda p: hashlib.sha256(p.read_bytes()).hexdigest())
    def test_unchanged_files_are_not_rehashed(self, sha, parser):
        self.pdf.write_bytes(b"pdf-v1")
        self.xlsm.write_bytes(b"xlsm-v1")
        self.watcher.scan_once()
        hashed_after_first = sha.call_count  # pdf + xlsm hashed once
        self.watcher.scan_once()  # nothing changed
        self.assertEqual(sha.call_count, hashed_after_first)

    @patch("app.watcher.parse_pair", return_value=parsed_test())
    def test_deleted_test_is_not_resurrected(self, parser):
        self.pdf.write_bytes(b"pdf-v1")
        self.xlsm.write_bytes(b"xlsm-v1")
        self.watcher.scan_once()
        test_id = self.db.list_jobs()[0]["test_id"]
        self.assertTrue(self.db.delete_test(test_id))
        self.assertEqual(len(self.db.list_tests()), 0)

        self.watcher.scan_once()  # unchanged source must not bring it back
        self.assertEqual(len(self.db.list_tests()), 0)
        self.assertEqual(parser.call_count, 1)

    @patch("app.watcher.parse_pair")
    def test_unchanged_quarantined_not_reparsed_and_edits_survive(self, parser):
        quarantined = parsed_test()
        quarantined["lowConfidence"] = ["results"]  # a flag the watcher cannot auto-correct
        parser.return_value = quarantined
        self.pdf.write_bytes(b"pdf-v1")
        self.xlsm.write_bytes(b"xlsm-v1")
        self.watcher.scan_once()
        self.assertEqual(self.db.list_tests()[0]["status"], "quarantined")
        test_id = self.db.list_jobs()[0]["test_id"]

        self.db.patch_test(test_id, {"vehicleModel": "EDITED MODEL"})
        self.watcher.scan_once()  # unchanged source
        self.assertEqual(parser.call_count, 1)  # not re-parsed
        self.assertEqual(self.db.get_test(test_id)["vehicleModel"], "EDITED MODEL")  # edit preserved


if __name__ == "__main__":
    unittest.main()
