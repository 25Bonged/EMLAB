#!/usr/bin/env python3
"""One-shot extraction of the WLTC 3b target schedule and the J2951 golden
fixture from J2951_DriveTrace_Analyser_ANYVEHICLE.xlsx.

Run once; the outputs are committed and the workbook is not needed again.

  python3 scripts/extract-j2951-data.py <path-to-workbook>
"""
import json
import math
import sys
from pathlib import Path

import openpyxl

REPO = Path(__file__).resolve().parents[1]
SCHEDULE_TS = REPO / "dashboard/src/model/wltc3b.ts"
FIXTURE_JSON = REPO / "dashboard/src/lib/__fixtures__/j2951-cc24-2026-07-01.json"

# Bench_Comparison row for CC24_bench_2026-07-01; constants from
# Calculator_ANY_VEHICLE B6:B11.
EXPECTED = {
    "iwr": -2.985231813933137,
    "rmsse": 0.9566506397579931,
    "dr": 0.9925338889279515,
    "er": 0.971738539785873,
    "eer": 1.021400148590032,
    "ascr": 0.9660694116439054,
}
CONSTANTS = {"dt": 1.0, "massKg": 1464.0, "f0": 122.2, "f1": 0.684, "f2": 0.0434, "kr": 1.03}


def read_pair(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb["Calculator_ANY_VEHICLE"]
    rows = ws.iter_rows(min_row=30, max_row=15029, max_col=3, values_only=True)
    pairs = [(r[1], r[2]) for r in rows if r[1] is not None and r[2] is not None]
    return [p[0] for p in pairs], [p[1] for p in pairs]


def indices(target, actual, c):
    dt, m, f0, f1, f2, kr = (c["dt"], c["massKg"], c["f0"], c["f1"], c["f2"], c["kr"])

    def iw(v):
        return sum(max(0.0, 0.5 * (v[i] / 3.6) ** 2 - 0.5 * (v[i - 1] / 3.6) ** 2)
                   for i in range(1, len(v)))

    def dist(v):
        return sum(v) * dt / 3600

    def absdv(v):
        return sum(abs(v[i] - v[i - 1]) for i in range(1, len(v)))

    def energy(v):
        total = 0.0
        for i in range(len(v) - 1):
            prev = v[i - 1] if i > 0 else v[i]
            a = ((v[i + 1] - prev) / (2 * dt)) / 3.6
            total += max(0.0, ((f0 * v[i] + f1 * v[i] ** 2 + f2 * v[i] ** 3)
                               + kr * m * a * v[i]) / 3600)
        return total * dt / 3600

    iwt, iwa = iw(target), iw(actual)
    dr = dist(actual) / dist(target)
    er = energy(actual) / energy(target)
    return {
        "iwr": 100 * (iwa - iwt) / iwt,
        "rmsse": math.sqrt(sum((actual[i] - target[i]) ** 2
                               for i in range(len(target))) / len(target)),
        "dr": dr,
        "er": er,
        "eer": dr / er,
        "ascr": absdv(actual) / absdv(target),
    }


def fmt(v):
    return f"{v:.1f}".rstrip("0").rstrip(".") or "0"


def main():
    workbook = Path(sys.argv[1])
    target, actual = read_pair(workbook)

    assert len(target) == 1478, f"expected 1478 target points, got {len(target)}"
    assert abs(sum(target) / 3600 - 15.0123) < 1e-3, "target distance is not WLTC 3b"

    got = indices(target, actual, CONSTANTS)
    for key, want in EXPECTED.items():
        assert abs(got[key] - want) < 1e-9, f"{key}: got {got[key]!r}, want {want!r}"
    print("verified all six indices against the workbook")

    SCHEDULE_TS.parent.mkdir(parents=True, exist_ok=True)
    SCHEDULE_TS.write_text(
        "// WLTC Class 3b, Low + Medium + High — 1478 points at 1 Hz (t = 0…1477).\n"
        "// Phase distances 3.0947 / 4.7559 / 7.1617 km, total 15.0123 km.\n"
        "// Extracted verbatim from J2951_DriveTrace_Analyser_ANYVEHICLE.xlsx,\n"
        "// sheet Calculator_ANY_VEHICLE column B, by scripts/extract-j2951-data.py.\n"
        "// Do not hand-edit.\n"
        "export const WLTC_3B_LMH_CSV =\n  '" + ",".join(fmt(v) for v in target) + "'\n",
        encoding="utf-8",
    )

    FIXTURE_JSON.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_JSON.write_text(
        json.dumps({
            "run": "CC24_bench_2026-07-01",
            "source": "J2951_DriveTrace_Analyser_ANYVEHICLE.xlsx / Calculator_ANY_VEHICLE",
            "constants": CONSTANTS,
            "expected": EXPECTED,
            "target": target,
            "actual": actual,
        }),
        encoding="utf-8",
    )
    print(f"wrote {SCHEDULE_TS} ({SCHEDULE_TS.stat().st_size} bytes)")
    print(f"wrote {FIXTURE_JSON} ({FIXTURE_JSON.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
