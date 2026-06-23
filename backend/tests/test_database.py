import json
import tempfile
import unittest
from pathlib import Path

from app.config import Settings
from app.db import Database


def sample_test(value=10.0):
    return {
        "id": "sample",
        "project": "STLA",
        "cycle": "WLTP",
        "config": "CC24",
        "transmission": "MB6",
        "lab": "FEV",
        "vehicleModel": "CITROEN AIRCROSS",
        "vinSampleId": "VIN",
        "vnNo": "9740",
        "date": "2026-03-18",
        "results": {"CO": value, "THC": 1, "NOx": 2, "CO2": 3, "CH4": 4, "NMHC": 5, "PM": 0.1, "PN": 1e9},
        "phases": [],
        "trace": {"dilute": [{"t": 1, "NOx": 2}], "preCat": [], "postCat": []},
        "source": {},
        "lowConfidence": [],
        "importedAt": "2026-06-20T00:00:00Z",
    }


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        settings = Settings(root, root / "test.db", "127.0.0.1", 8000, 1, root)
        self.db = Database(settings)

    def tearDown(self):
        self.tmp.cleanup()

    def test_idempotent_hash_and_replacement_audit(self):
        test_id, replaced = self.db.save_test(sample_test(), "stem", "hash-a", "accepted", "ok")
        self.assertFalse(replaced)
        same_id, replaced = self.db.save_test(sample_test(), "stem", "hash-a", "accepted", "ok")
        self.assertEqual(test_id, same_id)
        self.assertFalse(replaced)
        same_id, replaced = self.db.save_test(sample_test(20), "stem", "hash-b", "accepted", "corrected")
        self.assertEqual(test_id, same_id)
        self.assertTrue(replaced)
        self.assertEqual(len(self.db.audit(test_id)), 1)

    def test_quarantined_excluded_from_formal_list(self):
        self.db.save_test(sample_test(), "accepted", "a", "accepted", "ok")
        other = sample_test()
        other["vnNo"] = "9999"
        self.db.save_test(other, "quarantined", "b", "quarantined", "review")
        self.assertEqual(len(self.db.list_tests(include_nonaccepted=True)), 2)
        self.assertEqual(len(self.db.list_tests(include_nonaccepted=False)), 1)


if __name__ == "__main__":
    unittest.main()
