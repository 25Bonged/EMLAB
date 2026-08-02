# SAE J2951 Drive-Trace Indices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute the six SAE J2951 drive-trace indices (IWR, RMSSE, DR, ER, EER, ASCR) for every ingested emission test and surface them in the Engineering view, TestDetail and MasterTable.

**Architecture:** Pure math lives in a dependency-free module tested against a golden fixture extracted from the reference workbook. It is invoked at ingest time and the result is stored on `Test.j2951`, because `electron/server.ts` strips traces from the list route — so a fleet-wide table cannot compute indices client-side. A version-guarded backfill recomputes stored results on server start.

**Tech Stack:** TypeScript, React 19, Vitest (`environment: 'node'`), Hono + node:sqlite backend, Recharts. Python 3 + openpyxl for one-shot data extraction.

**Spec:** `docs/superpowers/specs/2026-08-02-j2951-drive-trace-indices-design.md`

---

## Conventions

All source files in this repo use **2-space indent, no semicolons, single quotes**. Match this exactly in every file you touch.

All test commands run from the `dashboard/` directory. The test runner is Vitest, configured in `dashboard/vite.config.ts` with `include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'electron-main/**/*.test.ts']`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/extract-j2951-data.py` | **Create.** One-shot extraction of schedule + fixture from the workbook. Self-verifying. |
| `dashboard/src/model/wltc3b.ts` | **Create (generated).** WLTC 3b target schedule as a CSV string. |
| `dashboard/src/lib/__fixtures__/j2951-cc24-2026-07-01.json` | **Create (generated).** Golden fixture: 1478-point target/actual pair + expected indices. |
| `dashboard/src/model/types.ts` | **Modify.** Add `J2951*` types; add `vehicleRld` and `j2951` to `Test`. |
| `dashboard/src/lib/j2951.ts` | **Create.** Pure math + verdict banding. Imports types only. |
| `dashboard/src/model/cycles.ts` | **Create.** Schedule registry; `getSchedule(cycle)`. |
| `dashboard/src/lib/j2951Result.ts` | **Create.** Orchestration: `Test` + schedule + road load → `J2951Result`, with all guards. |
| `dashboard/src/ingest/pdfReport.ts` | **Modify.** Parse Vehicle A/B/C. |
| `dashboard/src/ingest/normalize.ts` | **Modify.** Populate `vehicleRld` and `j2951` in `buildTest`. |
| `dashboard/electron/db.ts` | **Modify.** Allow road-load fields in `patchTest`; add `setJ2951`. |
| `dashboard/electron/backfill.ts` | **Create.** Version-guarded recompute pass. |
| `dashboard/electron/index.ts` | **Modify.** Run backfill on start. |
| `dashboard/src/views/Engineering.tsx` | **Modify.** New "Drive quality" subtab. |
| `dashboard/src/views/TestDetail.tsx` | **Modify.** J2951 card. |
| `dashboard/src/views/MasterTable.tsx` | **Modify.** IWR + RMSSE columns. |

**Deviation from the spec worth noting:** the spec's file table put orchestration in `j2951.ts`. This plan splits it into `j2951Result.ts` so that `j2951.ts` stays importable with zero dependencies beyond types, which is what makes the fixture test trivial. Also, the spec says backfill reads speed from the `trace_points` table; it does not need to — `db.listTests()` returns `data_json`, which is `JSON.stringify(test)` **including** `trace`. Only the HTTP route strips traces. Task 11 uses `listTests()`.

---

## Task 1: Extract the schedule and golden fixture

The reference workbook lives outside the repo at
`/Users/chayan/Downloads/transient/output/ais175_fe_review/J2951_DriveTrace_Analyser_ANYVEHICLE.xlsx`.
This task pulls what we need into the repo permanently, so the workbook is never needed again. The script asserts the extracted data reproduces all six published indices before writing anything.

**Files:**
- Create: `scripts/extract-j2951-data.py`
- Generate: `dashboard/src/model/wltc3b.ts`
- Generate: `dashboard/src/lib/__fixtures__/j2951-cc24-2026-07-01.json`

- [ ] **Step 1: Write the extraction script**

Create `scripts/extract-j2951-data.py`:

```python
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
```

- [ ] **Step 2: Run it**

```bash
python3 scripts/extract-j2951-data.py "/Users/chayan/Downloads/transient/output/ais175_fe_review/J2951_DriveTrace_Analyser_ANYVEHICLE.xlsx"
```

Expected output:

```
verified all six indices against the workbook
wrote .../dashboard/src/model/wltc3b.ts (6675 bytes)
wrote .../dashboard/src/lib/__fixtures__/j2951-cc24-2026-07-01.json (18149 bytes)
```

If the assertions fail, stop — the workbook is not the expected one. Do not proceed.

- [ ] **Step 3: Commit**

```bash
git add scripts/extract-j2951-data.py dashboard/src/model/wltc3b.ts dashboard/src/lib/__fixtures__/j2951-cc24-2026-07-01.json
git commit -m "feat: extract WLTC 3b schedule and J2951 golden fixture"
```

---

## Task 2: Types

**Files:**
- Modify: `dashboard/src/model/types.ts`

- [ ] **Step 1: Add the J2951 types**

Append to `dashboard/src/model/types.ts`, after the existing `RagLevel` declaration at the bottom:

```ts
/* ---------------------------- SAE J2951 drive trace ---------------------------- */

export interface J2951Indices {
  iwr: number // %
  rmsse: number // km/h
  dr: number
  er: number | null // null when vehicle road load is unavailable
  eer: number | null
  ascr: number
  distTargetKm: number
  distActualKm: number
  iwTargetJkg: number
  iwActualJkg: number
}

export interface J2951Inputs {
  massKg: number
  f0: number
  f1: number
  f2: number
  kr: number
  source: 'parsed' | 'override'
}

export type J2951Unavailable = 'no_trace' | 'no_schedule' | 'sample_rate' | 'length_mismatch'

export interface J2951Verdict {
  iwr: RagLevel
  rmsse: RagLevel
  overall: RagLevel
}

export interface J2951Result {
  calcVersion: number
  scheduleId: string | null
  sampleRateHz: number | null
  indices: J2951Indices | null
  verdict: J2951Verdict | null
  inputs: J2951Inputs | null
  unavailable?: J2951Unavailable
  detail?: string
}
```

- [ ] **Step 2: Add the two fields to `Test`**

In the `Test` interface, immediately after the existing `rld` line (currently `dashboard/src/model/types.ts:72`), replace:

```ts
  rld: { A: number | null; B: number | null; C: number | null }
```

with:

```ts
  /** Dyno Set A/B/C from the report remarks line — the dyno's own setting. */
  rld: { A: number | null; B: number | null; C: number | null }
  /** Vehicle A/B/C from the page-1 vehicle table — the coefficients J2951 needs.
   *  Distinct from `rld`; do not substitute one for the other. */
  vehicleRld: { A: number | null; B: number | null; C: number | null }
```

Then add to the same interface, after `trace?: TraceRecord`:

```ts
  j2951?: J2951Result | null
```

- [ ] **Step 3: Verify it compiles**

Run: `cd dashboard && npx tsc -b --noEmit`

Expected: errors in `normalize.ts` only, complaining that `vehicleRld` is missing from the object literal returned by `buildTest`. That is expected and fixed in Task 8. Any other error means something is wrong.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/model/types.ts
git commit -m "feat: add J2951 result types and vehicleRld to Test"
```

---

## Task 3: Core math — inertial work and IWR

TDD. Write the fixture test first; it will fail until Task 4 completes the module. Build it up index by index.

**Files:**
- Create: `dashboard/src/lib/j2951.ts`
- Test: `dashboard/src/lib/j2951.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/lib/j2951.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { inertialWork, distanceKm, absSpeedChange, rmsse } from './j2951'

describe('j2951 primitives', () => {
  it('inertialWork sums only positive kinetic-energy increments', () => {
    // 0 → 36 km/h (10 m/s) → 0. Only the acceleration counts: ½·10² = 50 J/kg.
    expect(inertialWork([0, 36, 0])).toBeCloseTo(50, 9)
  })

  it('inertialWork ignores the deceleration entirely', () => {
    expect(inertialWork([36, 0])).toBe(0)
  })

  it('distanceKm integrates speed over time', () => {
    // 36 km/h held for 3600 samples at dt=1 → 36 km.
    expect(distanceKm(new Array(3600).fill(36), 1)).toBeCloseTo(36, 9)
  })

  it('absSpeedChange sums the magnitude of every step', () => {
    expect(absSpeedChange([0, 10, 4, 4])).toBeCloseTo(16, 9)
  })

  it('rmsse is the root mean square of the pointwise error', () => {
    expect(rmsse([0, 0, 0, 0], [1, -1, 1, -1])).toBeCloseTo(1, 9)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/lib/j2951.test.ts`

Expected: FAIL — `Failed to resolve import "./j2951"`.

- [ ] **Step 3: Write the primitives**

Create `dashboard/src/lib/j2951.ts`:

```ts
// SAE J2951 drive-trace indices, transcribed from
// J2951_DriveTrace_Analyser_ANYVEHICLE.xlsx / sheet Calculator_ANY_VEHICLE.
// Verified to 6 decimal places against that workbook — see j2951.test.ts.
//
// Every index here assumes speeds in km/h on a 1 Hz chassis-dyno roll-speed
// trace. IWR is a one-sided sum of positive kinetic-energy increments, so
// high-frequency ripple adds work that never cancels: the same runs move from
// +8.05 % at 10 Hz to +1.43 % at 1 Hz. Feeding this an ECU wheel-speed channel
// measures sensor noise, not the driver. The sample-rate guard in
// j2951Result.ts enforces that; do not bypass it.

import type { J2951Indices, J2951Verdict, RagLevel } from '../model/types'

/** Bump to force a backfill recompute of every stored result. */
export const CALC_VERSION = 1

/** Rotational inertia allowance, AIS-175 Annex B2 §3.1. */
export const KR_DEFAULT = 1.03

/** Limits from the calculator sheet. The marginal band is inferred — the
 *  workbook labels −4.038 % MARGINAL but never states the threshold. */
export const IWR_PASS_PCT = 4.0
export const IWR_MARGINAL_PCT = 5.0
export const RMSSE_PASS_KMH = 1.3

export interface J2951Constants {
  dt: number
  massKg: number
  f0: number
  f1: number
  f2: number
  kr: number
}

/** Σ max(0, ΔKE) over the trace, in J/kg. */
export function inertialWork(v: number[]): number {
  let sum = 0
  for (let i = 1; i < v.length; i++) {
    sum += Math.max(0, 0.5 * (v[i] / 3.6) ** 2 - 0.5 * (v[i - 1] / 3.6) ** 2)
  }
  return sum
}

/** Σv·dt / 3600, in km. */
export function distanceKm(v: number[], dt: number): number {
  let sum = 0
  for (const s of v) sum += s
  return (sum * dt) / 3600
}

/** Σ|Δv| over the trace — the ASCR numerator/denominator. */
export function absSpeedChange(v: number[]): number {
  let sum = 0
  for (let i = 1; i < v.length; i++) sum += Math.abs(v[i] - v[i - 1])
  return sum
}

/** Root mean square speed error, km/h. Traces must be the same length. */
export function rmsse(target: number[], actual: number[]): number {
  let sum = 0
  for (let i = 0; i < target.length; i++) sum += (actual[i] - target[i]) ** 2
  return Math.sqrt(sum / target.length)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npx vitest run src/lib/j2951.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/j2951.ts dashboard/src/lib/j2951.test.ts
git commit -m "feat: add J2951 primitive index calculations"
```

---

## Task 4: Core math — road-load energy, full index set, verdict

The energy term carries two boundary conventions inherited verbatim from the workbook. They are not tidy, and changing them changes the answer.

**Files:**
- Modify: `dashboard/src/lib/j2951.ts`
- Modify: `dashboard/src/lib/j2951.test.ts`

- [ ] **Step 1: Write the failing fixture test**

Append to `dashboard/src/lib/j2951.test.ts`:

```ts
import { computeIndices, positiveEnergyKwh, verdictFor } from './j2951'
import fixture from './__fixtures__/j2951-cc24-2026-07-01.json'

describe('j2951 against the reference workbook', () => {
  const { target, actual, constants, expected } = fixture

  it('reproduces all six indices to 6 decimal places', () => {
    const ix = computeIndices(target, actual, constants)
    expect(ix.iwr).toBeCloseTo(expected.iwr, 6)
    expect(ix.rmsse).toBeCloseTo(expected.rmsse, 6)
    expect(ix.dr).toBeCloseTo(expected.dr, 6)
    expect(ix.er!).toBeCloseTo(expected.er, 6)
    expect(ix.eer!).toBeCloseTo(expected.eer, 6)
    expect(ix.ascr).toBeCloseTo(expected.ascr, 6)
  })

  it('reports the integrated distances', () => {
    const ix = computeIndices(target, actual, constants)
    expect(ix.distActualKm).toBeCloseTo(14.900194, 5)
    expect(ix.distTargetKm).toBeCloseTo(15.012278, 5)
  })

  it('omits ER and EER when road load is unavailable, keeping the rest', () => {
    const ix = computeIndices(target, actual, null)
    expect(ix.er).toBeNull()
    expect(ix.eer).toBeNull()
    expect(ix.iwr).toBeCloseTo(expected.iwr, 6)
    expect(ix.rmsse).toBeCloseTo(expected.rmsse, 6)
    expect(ix.dr).toBeCloseTo(expected.dr, 6)
    expect(ix.ascr).toBeCloseTo(expected.ascr, 6)
  })
})

describe('j2951 energy boundary conventions', () => {
  const c = { dt: 1, massKg: 1000, f0: 100, f1: 0, f2: 0, kr: 1 }

  it('excludes the last sample, which has no successor', () => {
    // Constant 36 km/h: acceleration is zero everywhere, so each counted
    // sample contributes 100·36/3600 = 1 kW. Four samples → three counted.
    const kwh = positiveEnergyKwh([36, 36, 36, 36], c)
    expect(kwh).toBeCloseTo((3 * 1 * 1) / 3600, 12)
  })

  it('uses v0 in place of the nonexistent v-1, still halving, on the first sample', () => {
    // v = [36, 72, 72], counted samples i=0 and i=1.
    //   i=0: a = (72 − 36)/(2·1)/3.6 = 5 m/s²  ← the workbook convention
    //        P = (100·36 + 1·1000·5·36)/3600 = 183600/3600 = 51 kW
    //   i=1: a = (72 − 36)/(2·1)/3.6 = 5 m/s²
    //        P = (100·72 + 1·1000·5·72)/3600 = 367200/3600 = 102 kW
    // Total 153 kW·s. If the first sample used the un-halved one-sided
    // difference instead, this comes out 0.08417 — so this case discriminates.
    const kwh = positiveEnergyKwh([36, 72, 72], c)
    expect(kwh).toBeCloseTo(153 / 3600, 12)
    expect(kwh).toBeCloseTo(0.0425, 12)
  })
})

describe('j2951 verdict banding', () => {
  const base = {
    rmsse: 0.9, dr: 1, er: null, eer: null, ascr: 1,
    distTargetKm: 15, distActualKm: 15, iwTargetJkg: 1, iwActualJkg: 1,
  }

  it('passes inside ±4.0 %', () => {
    expect(verdictFor({ ...base, iwr: -2.99 }).iwr).toBe('pass')
    expect(verdictFor({ ...base, iwr: 4.0 }).iwr).toBe('pass')
  })

  it('warns between 4.0 and 5.0 % — the workbook MARGINAL band', () => {
    expect(verdictFor({ ...base, iwr: -4.038 }).iwr).toBe('warn')
  })

  it('fails beyond 5.0 %', () => {
    expect(verdictFor({ ...base, iwr: 8.05 }).iwr).toBe('fail')
  })

  it('fails RMSSE above 1.3 km/h and takes the worst as overall', () => {
    const v = verdictFor({ ...base, iwr: 0, rmsse: 1.4 })
    expect(v.rmsse).toBe('fail')
    expect(v.overall).toBe('fail')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/lib/j2951.test.ts`

Expected: FAIL — `computeIndices` and `verdictFor` are not exported.

- [ ] **Step 3: Add the energy term, index assembly and verdict**

Append to `dashboard/src/lib/j2951.ts`:

```ts
/**
 * Σ max(0, P)·dt / 3600 — positive tractive energy in kWh.
 *
 * P = ((F0·v + F1·v² + F2·v³) + kr·m·a·v) / 3600  [kW], v in km/h.
 *
 * Two boundary conventions come straight from the workbook and must not be
 * "fixed": the first sample uses (v₁ − v₀)/(2·dt) — substituting v₀ for the
 * nonexistent v₋₁ while still halving — and the last sample contributes
 * nothing at all, because it has no successor.
 */
export function positiveEnergyKwh(v: number[], c: J2951Constants): number {
  let sum = 0
  for (let i = 0; i < v.length - 1; i++) {
    const prev = i > 0 ? v[i - 1] : v[i]
    const accel = (v[i + 1] - prev) / (2 * c.dt) / 3.6
    const road = c.f0 * v[i] + c.f1 * v[i] ** 2 + c.f2 * v[i] ** 3
    sum += Math.max(0, (road + c.kr * c.massKg * accel * v[i]) / 3600)
  }
  return (sum * c.dt) / 3600
}

/**
 * All six indices. Traces must already be aligned and equal length.
 * Pass `constants: null` when vehicle road load is unknown — ER and EER come
 * back null and everything else is still computed.
 */
export function computeIndices(
  target: number[],
  actual: number[],
  constants: J2951Constants | null,
): J2951Indices {
  const dt = constants?.dt ?? 1
  const iwTargetJkg = inertialWork(target)
  const iwActualJkg = inertialWork(actual)
  const distTargetKm = distanceKm(target, dt)
  const distActualKm = distanceKm(actual, dt)
  const dr = distTargetKm > 0 ? distActualKm / distTargetKm : 0
  const dvTarget = absSpeedChange(target)

  let er: number | null = null
  if (constants) {
    const eTarget = positiveEnergyKwh(target, constants)
    er = eTarget > 0 ? positiveEnergyKwh(actual, constants) / eTarget : null
  }

  return {
    iwr: iwTargetJkg > 0 ? (100 * (iwActualJkg - iwTargetJkg)) / iwTargetJkg : 0,
    rmsse: rmsse(target, actual),
    dr,
    er,
    eer: er != null && er > 0 ? dr / er : null,
    ascr: dvTarget > 0 ? absSpeedChange(actual) / dvTarget : 0,
    distTargetKm,
    distActualKm,
    iwTargetJkg,
    iwActualJkg,
  }
}

const worst = (a: RagLevel, b: RagLevel): RagLevel => {
  const rank: Record<RagLevel, number> = { pass: 0, na: 1, warn: 2, fail: 3 }
  return rank[a] >= rank[b] ? a : b
}

/** Band the indices. "MARGINAL" is display text for `warn`, not a fourth level. */
export function verdictFor(ix: J2951Indices): J2951Verdict {
  const mag = Math.abs(ix.iwr)
  const iwr: RagLevel = mag <= IWR_PASS_PCT ? 'pass' : mag <= IWR_MARGINAL_PCT ? 'warn' : 'fail'
  const rmsseLevel: RagLevel = ix.rmsse <= RMSSE_PASS_KMH ? 'pass' : 'fail'
  return { iwr, rmsse: rmsseLevel, overall: worst(iwr, rmsseLevel) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npx vitest run src/lib/j2951.test.ts`

Expected: PASS, 14 tests. The fixture test passing is the proof that the transcription is correct.

`resolveJsonModule` is already enabled in `dashboard/tsconfig.app.json`, so the fixture import needs no config change. Note that `verbatimModuleSyntax` is also on — every type-only import must use `import type`, as the code above does.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/j2951.ts dashboard/src/lib/j2951.test.ts
git commit -m "feat: complete J2951 index set, verified against reference workbook"
```

---

## Task 5: Cycle schedule registry

**Files:**
- Create: `dashboard/src/model/cycles.ts`
- Test: `dashboard/src/model/cycles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/model/cycles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getSchedule } from './cycles'

describe('cycle schedules', () => {
  it('returns the WLTC 3b schedule for WLTP', () => {
    const s = getSchedule('WLTP')!
    expect(s.id).toBe('WLTC_3B_LMH')
    expect(s.speeds.length).toBe(1478)
    expect(s.speeds[0]).toBe(0)
    expect(Math.max(...s.speeds)).toBeCloseTo(97.4, 6)
  })

  it('integrates to the published WLTC 3b distance', () => {
    const s = getSchedule('WLTP')!
    const km = s.speeds.reduce((a, b) => a + b, 0) / 3600
    expect(km).toBeCloseTo(15.0123, 3)
  })

  it('has no schedule for MIDC or NEDC', () => {
    expect(getSchedule('MIDC')).toBeNull()
    expect(getSchedule('NEDC')).toBeNull()
    expect(getSchedule('Unknown')).toBeNull()
  })

  it('parses the CSV only once', () => {
    expect(getSchedule('WLTP')!.speeds).toBe(getSchedule('WLTP')!.speeds)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/model/cycles.test.ts`

Expected: FAIL — `Failed to resolve import "./cycles"`.

- [ ] **Step 3: Write the registry**

Create `dashboard/src/model/cycles.ts`:

```ts
// Reference 1 Hz target speed schedules, keyed by the library's cycle name.
//
// Only WLTP ships a schedule. MIDC and NEDC deliberately have none: computing
// a J2951 index against a guessed schedule is worse than computing none, so
// those tests resolve to `unavailable: 'no_schedule'` and say so in the UI.

import { WLTC_3B_LMH_CSV } from './wltc3b'

export interface CycleSchedule {
  id: string
  label: string
  /** Target speed in km/h at 1 Hz, t = 0…n−1. */
  speeds: number[]
  sampleRateHz: number
}

const CSV_BY_CYCLE: Record<string, { id: string; label: string; csv: string }> = {
  WLTP: { id: 'WLTC_3B_LMH', label: 'WLTC Class 3b · Low+Medium+High', csv: WLTC_3B_LMH_CSV },
}

const cache = new Map<string, CycleSchedule>()

/** The reference schedule for a cycle, or null when none is available. */
export function getSchedule(cycle: string): CycleSchedule | null {
  const spec = CSV_BY_CYCLE[cycle]
  if (!spec) return null
  const hit = cache.get(cycle)
  if (hit) return hit
  const schedule: CycleSchedule = {
    id: spec.id,
    label: spec.label,
    speeds: spec.csv.split(',').map(Number),
    sampleRateHz: 1,
  }
  cache.set(cycle, schedule)
  return schedule
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npx vitest run src/model/cycles.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/model/cycles.ts dashboard/src/model/cycles.test.ts
git commit -m "feat: add cycle schedule registry with WLTC 3b"
```

---

## Task 6: Orchestration and guards

This is where a test becomes a result, and where every failure mode gets a distinct reason code instead of a plausible-looking number.

**Files:**
- Create: `dashboard/src/lib/j2951Result.ts`
- Test: `dashboard/src/lib/j2951Result.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/lib/j2951Result.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resultForTest } from './j2951Result'
import { getSchedule } from '../model/cycles'
import type { Test, TracePoint } from '../model/types'

const speeds = getSchedule('WLTP')!.speeds

/** A test whose measured trace is the schedule itself, starting at t=1 like
 *  the real bench export does (the t=0 sample is prepended by the aligner). */
function testWith(overrides: Partial<Test> = {}, dt = 1): Test {
  const dilute: TracePoint[] = speeds.slice(1).map((speed, i) => ({ t: (i + 1) * dt, speed }))
  return {
    id: 'T', project: 'STLA', cycle: 'WLTP', config: 'CC24', transmission: 'MB6',
    lab: 'FEV', vehicleModel: 'm', vinSampleId: '', vnNo: '', date: '2026-07-01',
    inertia: 1464,
    rld: { A: 48.3933, B: -0.111, C: 0.04692 },
    vehicleRld: { A: 122.2, B: 0.684, C: 0.0434 },
    fuel: {}, conditions: {},
    results: { CO: null, THC: null, NOx: null, CO2: null, CH4: null, NMHC: null, PM: null, PN: null },
    phases: [], trace: { dilute, preCat: [], postCat: [] },
    source: {}, lowConfidence: [], importedAt: '', ...overrides,
  } as Test
}

describe('resultForTest', () => {
  it('scores a perfect drive as all-pass with zero IWR', () => {
    const r = resultForTest(testWith())
    expect(r.unavailable).toBeUndefined()
    expect(r.indices!.iwr).toBeCloseTo(0, 9)
    expect(r.indices!.rmsse).toBeCloseTo(0, 9)
    expect(r.verdict!.overall).toBe('pass')
    expect(r.scheduleId).toBe('WLTC_3B_LMH')
    expect(r.calcVersion).toBe(1)
  })

  it('uses Vehicle A/B/C, never the Dyno Set', () => {
    const r = resultForTest(testWith())
    expect(r.inputs).toEqual({
      massKg: 1464, f0: 122.2, f1: 0.684, f2: 0.0434, kr: 1.03, source: 'parsed',
    })
  })

  it('prefers an overrides.vehicleRld and marks the source', () => {
    const r = resultForTest(testWith({
      overrides: { vehicleRld: { A: 100, B: 0.5, C: 0.04 } },
    }))
    expect(r.inputs!.f0).toBe(100)
    expect(r.inputs!.source).toBe('override')
  })

  it('refuses a trace that is not 1 Hz', () => {
    const r = resultForTest(testWith({}, 0.1))
    expect(r.unavailable).toBe('sample_rate')
    expect(r.indices).toBeNull()
    expect(r.verdict).toBeNull()
  })

  it('reports no_schedule for MIDC', () => {
    const r = resultForTest(testWith({ cycle: 'MIDC' }))
    expect(r.unavailable).toBe('no_schedule')
    expect(r.indices).toBeNull()
  })

  it('reports no_trace when there is no dilute speed channel', () => {
    expect(resultForTest(testWith({ trace: undefined })).unavailable).toBe('no_trace')
  })

  it('reports length_mismatch with both counts', () => {
    const short = testWith()
    short.trace!.dilute = short.trace!.dilute.slice(0, 900)
    const r = resultForTest(short)
    expect(r.unavailable).toBe('length_mismatch')
    expect(r.detail).toContain('901')
    expect(r.detail).toContain('1478')
  })

  it('still yields IWR and RMSSE when road load is missing', () => {
    const r = resultForTest(testWith({
      vehicleRld: { A: null, B: null, C: null },
    }))
    expect(r.unavailable).toBeUndefined()
    expect(r.indices!.er).toBeNull()
    expect(r.indices!.eer).toBeNull()
    expect(r.indices!.iwr).toBeCloseTo(0, 9)
    expect(r.inputs).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/lib/j2951Result.test.ts`

Expected: FAIL — `Failed to resolve import "./j2951Result"`.

- [ ] **Step 3: Write the orchestrator**

Create `dashboard/src/lib/j2951Result.ts`:

```ts
// Turns a Test into a stored J2951Result: picks the schedule, aligns the
// measured trace to it, validates, and computes. Every failure mode returns a
// distinct reason code rather than a number that merely looks plausible.

import type { J2951Constants } from './j2951'
import { CALC_VERSION, KR_DEFAULT, computeIndices, verdictFor } from './j2951'
import { getSchedule } from '../model/cycles'
import type { J2951Inputs, J2951Result, Test } from '../model/types'

/** Accepted deviation from a 1 s sample interval. */
const DT_TOLERANCE_S = 0.01

function unavailable(
  reason: J2951Result['unavailable'],
  extra: Partial<J2951Result> = {},
): J2951Result {
  return {
    calcVersion: CALC_VERSION,
    scheduleId: null,
    sampleRateHz: null,
    indices: null,
    verdict: null,
    inputs: null,
    unavailable: reason,
    ...extra,
  }
}

/** Median gap between consecutive samples, or null if undeterminable. */
export function medianInterval(times: number[]): number | null {
  if (times.length < 2) return null
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1])
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
}

/** The bench exports t = 1…n; the schedule starts at t = 0. Prepend the
 *  standstill sample the workbook adds, so the two align index-for-index. */
export function alignToSchedule(times: number[], speeds: number[]): number[] {
  return times[0] > 0 ? [0, ...speeds] : speeds
}

function constantsFor(test: Test): { constants: J2951Constants | null; inputs: J2951Inputs | null } {
  const override = (test.overrides as { vehicleRld?: Test['vehicleRld'] } | undefined)?.vehicleRld
  const rld = override ?? test.vehicleRld
  const mass = test.inertia
  if (!rld || rld.A == null || rld.B == null || rld.C == null || mass == null) {
    return { constants: null, inputs: null }
  }
  const inputs: J2951Inputs = {
    massKg: mass,
    f0: rld.A,
    f1: rld.B,
    f2: rld.C,
    kr: KR_DEFAULT,
    source: override ? 'override' : 'parsed',
  }
  return {
    constants: {
      dt: 1,
      massKg: inputs.massKg,
      f0: inputs.f0,
      f1: inputs.f1,
      f2: inputs.f2,
      kr: inputs.kr,
    },
    inputs,
  }
}

/** Compute the stored J2951 result for a test. Never throws. */
export function resultForTest(test: Test): J2951Result {
  const dilute = test.trace?.dilute ?? []
  const points = dilute.filter((p) => p.speed != null)
  if (points.length < 2) return unavailable('no_trace')

  const schedule = getSchedule(test.cycle)
  if (!schedule) return unavailable('no_schedule', { detail: `no reference schedule for ${test.cycle}` })

  const times = points.map((p) => p.t)
  const dt = medianInterval(times)
  if (dt == null || Math.abs(dt - 1) > DT_TOLERANCE_S) {
    return unavailable('sample_rate', {
      sampleRateHz: dt && dt > 0 ? 1 / dt : null,
      detail: `sample interval ${dt ?? '?'} s — J2951 requires 1 Hz dyno roll speed`,
    })
  }

  const actual = alignToSchedule(times, points.map((p) => p.speed as number))
  if (actual.length !== schedule.speeds.length) {
    return unavailable('length_mismatch', {
      scheduleId: schedule.id,
      sampleRateHz: 1,
      detail: `actual ${actual.length} vs target ${schedule.speeds.length} samples`,
    })
  }

  const { constants, inputs } = constantsFor(test)
  const indices = computeIndices(schedule.speeds, actual, constants)
  return {
    calcVersion: CALC_VERSION,
    scheduleId: schedule.id,
    sampleRateHz: 1,
    indices,
    verdict: verdictFor(indices),
    inputs,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npx vitest run src/lib/j2951Result.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/j2951Result.ts dashboard/src/lib/j2951Result.test.ts
git commit -m "feat: add J2951 orchestration with sample-rate and schedule guards"
```

---

## Task 7: Parse Vehicle A/B/C from the report

The page-1 vehicle table holds `Vehicle A [N] = 122.2`, `Vehicle B [N/(km/h)] = 0.684`, `Vehicle C [N/(km/h)] = 0.0434`. The existing `rightOf` helper cannot find C, because the PDF text layer splits that label into `Vehicle C [N/(km/h)` and a separate `]`. A prefix-anchored variant is needed.

**Files:**
- Modify: `dashboard/src/ingest/pdfReport.ts`
- Test: `dashboard/src/ingest/pdfReport.test.ts` (exists — append)

- [ ] **Step 1: Write the failing test**

Append to `dashboard/src/ingest/pdfReport.test.ts`. Coordinates below are taken from the real report at
`OneDrive_3_6-20-2026 (1)/OneDrive_1_6-20-2026/CITROEN_AIRCROSS_MT_9740_5099_2026-03-18_09-51-01_REPORT.pdf`, including the stray `'2'` at x=160.6 that sits between the B and C rows and must not be picked up:

```ts
import { parseReportItems } from './pdfReport'

describe('vehicle road load', () => {
  const page = {
    width: 595,
    height: 842,
    items: [
      { s: 'Vehicle A [N]', x: 108.1, y: 618.9 },
      { s: '122.2', x: 175.9, y: 618.8 },
      { s: 'Vehicle Inward Date', x: 243.5, y: 618.9 },
      { s: '16-Mar-2026', x: 311.2, y: 618.8 },
      { s: 'Vehicle B [N/(km/h)]', x: 108.1, y: 611.1 },
      { s: '0.684', x: 175.9, y: 611.5 },
      { s: '-', x: 311.2, y: 611.5 },
      { s: '2', x: 160.6, y: 606.3 },
      { s: 'Vehicle C [N/(km/h)', x: 108.1, y: 603.1 },
      { s: ']', x: 162.8, y: 603.1 },
      { s: '0.0434', x: 175.9, y: 604.1 },
      { s: 'Manual', x: 311.2, y: 604.1 },
      { s: '3 Dyno Set : A = 48.3933 (N) , B = -0.111 [N/(Km/h], C = 0.04692 [N/(Kmph)2]', x: 60, y: 400 },
    ],
  }

  it('reads Vehicle A/B/C, not the Dyno Set', () => {
    const parsed = parseReportItems([page])
    expect(parsed.vehicleRld).toEqual({ A: 122.2, B: 0.684, C: 0.0434 })
  })

  it('keeps the Dyno Set separately in rld', () => {
    const parsed = parseReportItems([page])
    expect(parsed.rld).toEqual({ A: 48.3933, B: -0.111, C: 0.04692 })
  })

  it('reports low confidence when the vehicle table is absent', () => {
    const parsed = parseReportItems([{ width: 595, height: 842, items: [] }])
    expect(parsed.vehicleRld).toEqual({ A: null, B: null, C: null })
    expect(parsed.lowConfidence).toContain('vehicleRld')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/ingest/pdfReport.test.ts`

Expected: FAIL — `vehicleRld` does not exist on the parsed report.

- [ ] **Step 3: Add the prefix helper**

In `dashboard/src/ingest/pdfReport.ts`, immediately after the existing `rightOf` function, add:

```ts
/** Like rightOf, but anchors on a label *prefix*. The PDF text layer splits
 *  'Vehicle C [N/(km/h)]' across two items, so exact matching misses it. */
function rightOfPrefix(items: TextItem[], prefix: string): string | null {
  const anchors = items.filter((i) => norm(i.s).startsWith(prefix))
  for (const a of anchors) {
    const cand = items
      .filter((i) => near(i.y, a.y, 3) && i.x > a.x + 2)
      .sort((p, q) => p.x - q.x)
      .find((i) => /^-?[\d.]+$/.test(i.s.replace(/,/g, '')))
    if (cand) return cand.s
  }
  return null
}
```

- [ ] **Step 4: Declare the field on `ParsedReport`**

In the `ParsedReport` interface, directly below the existing `rld` line, add:

```ts
  vehicleRld: { A: number | null; B: number | null; C: number | null }
```

- [ ] **Step 5: Parse it and return it**

In `parseReportItems`, immediately after the block that builds `rld` (currently around `dashboard/src/ingest/pdfReport.ts:215-217`), add:

```ts
  // Vehicle A/B/C from the page-1 vehicle table — this is what J2951 needs.
  // Distinct from the Dyno Set above; do not conflate them.
  const vehicleRld = {
    A: num(rightOfPrefix(p1, 'Vehicle A')),
    B: num(rightOfPrefix(p1, 'Vehicle B')),
    C: num(rightOfPrefix(p1, 'Vehicle C')),
  }
  if (vehicleRld.A == null || vehicleRld.B == null || vehicleRld.C == null) low.push('vehicleRld')
```

Then change the return statement to include it:

```ts
  return { results, phases, meta, rld, vehicleRld, lowConfidence: low, resultUnit, pmUnit }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd dashboard && npx vitest run src/ingest/pdfReport.test.ts`

Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/ingest/pdfReport.ts dashboard/src/ingest/pdfReport.test.ts
git commit -m "feat: parse Vehicle A/B/C road load from the report"
```

---

## Task 8: Wire computation into ingest

**Files:**
- Modify: `dashboard/src/ingest/normalize.ts`
- Test: `dashboard/src/ingest/normalize.test.ts` (does not exist yet — create it)

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/ingest/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildTest } from './normalize'
import { getSchedule } from '../model/cycles'
import type { TraceRecord } from '../model/types'

const speeds = getSchedule('WLTP')!.speeds

function traceFor(): TraceRecord {
  return {
    dilute: speeds.slice(1).map((speed, i) => ({ t: i + 1, speed })),
    preCat: [],
    postCat: [],
  }
}

describe('buildTest J2951 wiring', () => {
  it('computes and stores indices when a trace and schedule exist', () => {
    const test = buildTest('CITROEN_AIRCROSS_MT_9740_5099_2026-03-18_09-51-01', null, traceFor(), {}, '')
    // No report → cycle is guessed 'Unknown', so no schedule applies.
    expect(test.j2951!.unavailable).toBe('no_schedule')
  })

  it('carries vehicleRld through from the parsed report', () => {
    const test = buildTest('x', null, null, {}, '')
    expect(test.vehicleRld).toEqual({ A: null, B: null, C: null })
    expect(test.j2951!.unavailable).toBe('no_trace')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/ingest/normalize.test.ts`

Expected: FAIL — `test.j2951` is undefined.

- [ ] **Step 3: Wire it in**

In `dashboard/src/ingest/normalize.ts`, add to the imports at the top:

```ts
import { resultForTest } from '../lib/j2951Result'
```

In `buildTest`, change the `return { ... }` at the end into a named object followed by the J2951 pass, because `resultForTest` needs the assembled test. Replace `return {` with:

```ts
  const test: Test = {
```

and replace the closing `}` of that object literal (currently `dashboard/src/ingest/normalize.ts:118-119`, the `  }` then `}`) with:

```ts
  }
  test.j2951 = resultForTest(test)
  return test
}
```

Then add `vehicleRld` to the object literal, directly below the existing `rld:` line:

```ts
    vehicleRld: report?.vehicleRld ?? { A: null, B: null, C: null },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npx vitest run src/ingest/normalize.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Run the whole suite**

Run: `cd dashboard && npm test`

Expected: all tests pass. If `compilationWorkbook.ts` also constructs `Test` objects, TypeScript will flag the missing `vehicleRld` — add `vehicleRld: { A: null, B: null, C: null }` there too.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/ingest/normalize.ts dashboard/src/ingest/normalize.test.ts dashboard/src/ingest/compilationWorkbook.ts
git commit -m "feat: compute J2951 indices during ingest"
```

---

## Task 9: Persist road-load overrides and recompute on patch

`db.patchTest` currently drops any field not in its `allowed` set, so an override would be silently discarded.

**Files:**
- Modify: `dashboard/electron/db.ts`
- Test: `dashboard/electron/db.test.ts` (exists — append)

- [ ] **Step 1: Write the failing test**

Append to `dashboard/electron/db.test.ts`, following the existing setup idiom in that file for creating a `Database`:

Add these two cases **inside the existing `describe('Database', ...)` block**, which
already provides the `db` fixture via `beforeEach`. Note `saveTest`'s signature is
`saveTest(input, stem, combinedHash, status, parserOutcome)`, and that the existing
`sampleTest()` helper is reused here:

```ts
  it('accepts a vehicleRld override and recomputes j2951', () => {
    const input = {
      ...sampleTest(),
      inertia: 1464,
      rld: { A: 48.3933, B: -0.111, C: 0.04692 },
      vehicleRld: { A: 122.2, B: 0.684, C: 0.0434 },
    }
    const { testId: id } = db.saveTest(input, 'stem', 'h-ovr', 'accepted', 'ok')

    const patched = db.patchTest(id, {
      overrides: { vehicleRld: { A: 100, B: 0.5, C: 0.04 } },
    })!
    expect(patched.overrides.vehicleRld.A).toBe(100)
    // recomputed, not carried over from the saved value
    expect(patched.j2951.calcVersion).toBe(1)
  })

  it('accepts an inertia correction', () => {
    const { testId: id } = db.saveTest(
      { ...sampleTest(), inertia: 1464 }, 'stem', 'h-inertia', 'accepted', 'ok',
    )
    expect(db.patchTest(id, { inertia: 1500 })!.inertia).toBe(1500)
  })

  it('still drops fields outside the allowed set', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h-deny', 'accepted', 'ok')
    expect(db.patchTest(id, { odo: 999999 } as never)!.odo).toBeUndefined()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run electron/db.test.ts`

Expected: FAIL — the patched fields come back unchanged, because they are not in `allowed`.

- [ ] **Step 3: Widen the allowed set and recompute**

In `dashboard/electron/db.ts`, add to the import block at the top:

```ts
import { resultForTest } from '../src/lib/j2951Result.ts'
```

In `patchTest`, extend the `allowed` set with the three fields that affect J2951:

```ts
    const allowed = new Set([
      'project', 'cycle', 'config', 'transmission', 'lab',
      'vehicleModel', 'vinSampleId', 'vnNo',
      'catalystState', 'stt', 'startSoc', 'lowConfidence',
      'inertia', 'vehicleRld', 'overrides',
    ])
```

Then, directly after `const updated = { ...current, ...clean }`, add:

```ts
    // cycle, inertia and road load all feed the drive-trace indices.
    if (['cycle', 'inertia', 'vehicleRld', 'overrides'].some((k) => k in clean)) {
      updated.j2951 = resultForTest(updated as any)
    }
```

- [ ] **Step 4: Add `setJ2951` for the backfill**

Add this method to the `Database` class, next to `setStatus`:

```ts
  /** Write a recomputed j2951 result without logging a manual override. */
  setJ2951(id: string, j2951: Record<string, any>): boolean {
    const current = this.getTest(id)
    if (!current) return false
    const updated = { ...current, j2951 }
    return this.tx(() =>
      this.db.prepare('UPDATE tests SET data_json=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(updated), utcnow(), id).changes > 0,
    )
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd dashboard && npx vitest run electron/db.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/electron/db.ts dashboard/electron/db.test.ts
git commit -m "feat: allow road-load overrides and recompute J2951 on patch"
```

---

## Task 10: Backfill existing tests

Already-ingested tests have no `j2951`. This pass fills them in on server start and re-runs whenever `CALC_VERSION` is bumped.

**Files:**
- Create: `dashboard/electron/backfill.ts`
- Test: `dashboard/electron/backfill.test.ts`
- Modify: `dashboard/electron/index.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard/electron/backfill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { backfillJ2951 } from './backfill.ts'
import { CALC_VERSION } from '../src/lib/j2951.ts'

/** Minimal stand-in for Database — only the two methods backfill uses. */
function fakeDb(tests: Record<string, any>[]) {
  const written: Record<string, any> = {}
  return {
    written,
    listTests: () => tests,
    setJ2951: (id: string, j2951: Record<string, any>) => {
      written[id] = j2951
      return true
    },
  }
}

describe('backfillJ2951', () => {
  it('computes for tests that have no result', () => {
    const db = fakeDb([{ id: 'a', cycle: 'MIDC', trace: null }])
    expect(backfillJ2951(db as any)).toBe(1)
    expect(db.written.a.unavailable).toBe('no_trace')
    expect(db.written.a.calcVersion).toBe(CALC_VERSION)
  })

  it('skips tests already at the current version', () => {
    const db = fakeDb([{ id: 'a', cycle: 'MIDC', j2951: { calcVersion: CALC_VERSION } }])
    expect(backfillJ2951(db as any)).toBe(0)
    expect(db.written.a).toBeUndefined()
  })

  it('recomputes when the stored version is stale', () => {
    const db = fakeDb([{ id: 'a', cycle: 'MIDC', j2951: { calcVersion: CALC_VERSION - 1 } }])
    expect(backfillJ2951(db as any)).toBe(1)
  })

  it('is idempotent — a second pass writes nothing', () => {
    const rows = [{ id: 'a', cycle: 'MIDC', trace: null } as Record<string, any>]
    const db = fakeDb(rows)
    backfillJ2951(db as any)
    rows[0].j2951 = db.written.a
    expect(backfillJ2951(db as any)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run electron/backfill.test.ts`

Expected: FAIL — cannot resolve `./backfill.ts`.

- [ ] **Step 3: Write the backfill**

Create `dashboard/electron/backfill.ts`:

```ts
// Recomputes stored J2951 results whose calcVersion is missing or stale.
// Runs on server start; idempotent, so it is safe to call every time.
//
// listTests() returns data_json, which is the whole Test *including* its
// trace — only the HTTP route strips traces. So this needs no extra queries.

import { CALC_VERSION } from '../src/lib/j2951.ts'
import { resultForTest } from '../src/lib/j2951Result.ts'

interface J2951Store {
  listTests(includeNonaccepted?: boolean): Record<string, any>[]
  setJ2951(id: string, j2951: Record<string, any>): boolean
}

/** Recompute every stale or missing result. Returns how many were written. */
export function backfillJ2951(db: J2951Store): number {
  let written = 0
  for (const test of db.listTests(true)) {
    if (test.j2951?.calcVersion === CALC_VERSION) continue
    db.setJ2951(test.id, resultForTest(test as never))
    written++
  }
  return written
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npx vitest run electron/backfill.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Call it on start**

Two entry points construct a `Database`: `dashboard/electron/serve.ts` (standalone
`npm run serve`) and `dashboard/electron-main/index.ts` (the Electron app). Both need
the call.

In `dashboard/electron/serve.ts`, add to the imports:

```ts
import { backfillJ2951 } from './backfill.ts'
```

and add immediately after `const db = new Database(settings.databasePath)`, before
the `FolderWatcher` is constructed:

```ts
const backfilled = backfillJ2951(db)
if (backfilled > 0) console.log(`J2951: backfilled ${backfilled} test(s)`)
```

Then open `dashboard/electron-main/index.ts`, locate its `new Database(...)` call, and
add the same two lines after it with the import path adjusted to `../electron/backfill.ts`.

Do **not** touch `dashboard/electron/index.ts` — despite the name it is a build
scaffold containing only `export {}`, not a barrel file.

- [ ] **Step 6: Verify the server starts and backfills**

Run: `cd dashboard && npm run serve`

Expected: a `J2951: backfilled N test(s)` line on first start, and no such line on a second start. Stop the server with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add dashboard/electron/backfill.ts dashboard/electron/backfill.test.ts dashboard/electron/serve.ts dashboard/electron-main/index.ts
git commit -m "feat: backfill J2951 results on server start"
```

---

## Task 11: Engineering — Drive quality subtab

**Files:**
- Modify: `dashboard/src/views/Engineering.tsx`

- [ ] **Step 1: Register the subtab**

At `dashboard/src/views/Engineering.tsx:16`, change the `Sub` type:

```ts
type Sub = 'deterioration' | 'conformity' | 'labstt' | 'drivequality'
```

Add to the subtab array at line 30-34:

```ts
          ['drivequality', 'Drive quality (J2951)'],
```

Add the render line after the existing three at line 43:

```tsx
      {sub === 'drivequality' && <DriveQuality rows={rows} />}
```

Add to the imports at the top:

```ts
import { RagDot } from '../components/common'
import { LineChart, Line } from 'recharts'
import type { J2951Result, Test } from '../model/types'
```

Note `Panel`, `Eyebrow`, `ResponsiveContainer`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend` and `RAG_COLOR` are already imported in this file — do not duplicate them.

- [ ] **Step 2: Add the component**

Append to `dashboard/src/views/Engineering.tsx`, before the `/* ----- shared ----- */` section:

```tsx
/* ----------------------------- Drive quality (J2951) ----------------------------- */

const UNAVAILABLE_TEXT: Record<string, string> = {
  no_trace: 'No speed trace',
  no_schedule: 'No reference schedule for this cycle',
  sample_rate: 'Trace is not 1 Hz — refused',
  length_mismatch: 'Trace length does not match the schedule',
}

const n3 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(3))

function DriveQuality({ rows }: { rows: ReturnType<typeof applyFilters> }) {
  const [selected, setSelected] = useState<string | null>(null)
  const scored = useMemo(() => rows.filter((t) => t.j2951?.indices), [rows])
  const current = useMemo(
    () => scored.find((t) => t.id === selected) ?? scored[0] ?? null,
    [scored, selected],
  )

  return (
    <>
      <Panel ticks={false}>
        <div className="panel-heading">
          <div>
            <Eyebrow>SAE J2951 · chassis-dyno roll speed, 1 Hz</Eyebrow>
            <h3>Drive-trace indices</h3>
          </div>
          <span className="legend-inline">IWR ±4.0 % · RMSSE ≤ 1.3 km/h</span>
        </div>
        <div className="readiness-table-wrap">
          <table className="readiness-table">
            <thead>
              <tr>
                <th>Test</th><th>IWR %</th><th>RMSSE</th><th>DR</th>
                <th>ER</th><th>EER</th><th>ASCR</th><th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} style={{ color: 'var(--ink-faint)', textAlign: 'center', padding: 24 }}>
                  No tests match the current filters.
                </td></tr>
              )}
              {rows.map((t) => {
                const r = t.j2951
                const ix = r?.indices
                return (
                  <tr
                    key={t.id}
                    onClick={() => ix && setSelected(t.id)}
                    style={{ cursor: ix ? 'pointer' : 'default', opacity: ix ? 1 : 0.66 }}
                  >
                    <td><strong>{t.config} {t.date}</strong><span>{t.cycle} · {t.lab}</span></td>
                    {ix ? (
                      <>
                        <td className="font-mono" style={{ fontWeight: 700 }}>{ix.iwr.toFixed(2)}</td>
                        <td className="font-mono">{ix.rmsse.toFixed(3)}</td>
                        <td className="font-mono">{n3(ix.dr)}</td>
                        <td className="font-mono">{n3(ix.er)}</td>
                        <td className="font-mono">{n3(ix.eer)}</td>
                        <td className="font-mono">{n3(ix.ascr)}</td>
                        <td><J2951Badge result={r!} /></td>
                      </>
                    ) : (
                      <td colSpan={7} style={{ color: 'var(--ink-faint)' }}>
                        {UNAVAILABLE_TEXT[r?.unavailable ?? ''] ?? 'Not computed'}
                        {r?.detail ? ` — ${r.detail}` : ''}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="analysis-note">
          IWR sums only positive kinetic-energy increments, so it is highly sensitive to
          signal ripple. These indices are computed from chassis-dyno roll speed at native
          1 Hz — the regulatory reference. A trace at any other rate is refused rather than
          scored. MARGINAL means |IWR| is between 4.0 and 5.0 %.
        </div>
      </Panel>

      {current?.j2951?.indices && (
        <>
          <div style={{ height: 16 }} />
          <SpeedOverlay test={current} />
        </>
      )}
    </>
  )
}

function J2951Badge({ result }: { result: J2951Result }) {
  const v = result.verdict
  if (!v) return <span style={{ color: 'var(--ink-faint)' }}>—</span>
  const label = v.overall === 'pass' ? 'PASS' : v.overall === 'warn' ? 'MARGINAL' : 'FAIL'
  const c = RAG_COLOR[v.overall]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
      padding: '4px 10px', borderRadius: 90, color: c, background: `${c}14`,
      border: `1px solid ${c}33`, whiteSpace: 'nowrap',
    }}>
      <RagDot level={v.overall} size={7} />{label}
    </span>
  )
}

function SpeedOverlay({ test }: { test: Test }) {
  const data = useMemo(() => {
    const schedule = getSchedule(test.cycle)
    const points = (test.trace?.dilute ?? []).filter((p) => p.speed != null)
    if (!schedule || !points.length) return []
    const actual = points[0].t > 0 ? [0, ...points.map((p) => p.speed as number)] : points.map((p) => p.speed as number)
    return schedule.speeds.map((target, i) => ({ t: i, target, actual: actual[i] ?? null }))
  }, [test])

  return (
    <Panel ticks={false}>
      <div className="panel-heading">
        <div>
          <Eyebrow>{test.config} {test.date} · target vs driven</Eyebrow>
          <h3>Speed trace</h3>
        </div>
        <span className="legend-inline">
          {test.j2951?.scheduleId} · {test.j2951?.sampleRateHz} Hz · road load {test.j2951?.inputs?.source ?? 'unavailable'}
        </span>
      </div>
      <div style={{ height: 300, padding: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 18, bottom: 8, left: 6 }}>
            <CartesianGrid stroke="var(--line)" />
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={{ stroke: 'var(--line-bright)' }} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} axisLine={false} tickLine={false} width={44} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="target" name="Target" stroke="var(--ink-faint)" dot={false} strokeWidth={1} isAnimationActive={false} />
            <Line type="monotone" dataKey="actual" name="Driven" stroke="#4a154b" dot={false} strokeWidth={1.4} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}
```

Add `getSchedule` to the imports:

```ts
import { getSchedule } from '../model/cycles'
```

- [ ] **Step 3: Verify it renders**

Start the dev server and check the tab. Use the preview tooling rather than asking the user to look:

```bash
cd dashboard && npm run dev
```

Open the Engineering view, select "Drive quality (J2951)". Confirm the table lists tests, that MIDC rows read "No reference schedule for this cycle", and that clicking a scored row draws the overlay. Check the browser console for errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/views/Engineering.tsx
git commit -m "feat: add J2951 drive quality subtab to Engineering"
```

---

## Task 12: TestDetail card

**Files:**
- Modify: `dashboard/src/views/TestDetail.tsx`

- [ ] **Step 1: Render the card**

In `dashboard/src/views/TestDetail.tsx`, the main render ends with a run of
conditional panels (currently lines 96-102):

```tsx
      {t.phases.length > 1 && <ColdStartPanel test={t} massUnit={massUnit} />}

      {t.phases.length > 0 && <PhaseTable test={t} massUnit={massUnit} />}

      {t.trace && <QAPanel test={t} massUnit={massUnit} />}

      {t.trace && <TraceSection test={t} />}
```

Insert the J2951 card directly **above** `ColdStartPanel`, so drive-trace validity is
read before the emission numbers it qualifies:

```tsx
      <J2951Card test={t} />
      <div style={{ height: 16 }} />

```

- [ ] **Step 2: Add the component**

Append this component to the bottom of `dashboard/src/views/TestDetail.tsx`:

```tsx
function J2951Card({ test }: { test: Test }) {
  const r = test.j2951
  if (!r) return null
  const ix = r.indices
  return (
    <Panel ticks={false}>
      <div className="panel-heading">
        <div>
          <Eyebrow>SAE J2951 · drive-trace quality</Eyebrow>
          <h3>How well the cycle was driven</h3>
        </div>
      </div>
      {ix ? (
        <div style={{ display: 'flex', gap: 28, padding: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">IWR</div>
            <div className="font-mono" style={{ fontSize: 22, fontWeight: 700, color: RAG_COLOR[r.verdict!.iwr] }}>
              {ix.iwr > 0 ? '+' : ''}{ix.iwr.toFixed(2)} %
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>limit ±4.0 %</span>
          </div>
          <div>
            <div className="eyebrow">RMSSE</div>
            <div className="font-mono" style={{ fontSize: 22, fontWeight: 700, color: RAG_COLOR[r.verdict!.rmsse] }}>
              {ix.rmsse.toFixed(3)}
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>limit 1.3 km/h</span>
          </div>
          <div>
            <div className="eyebrow">Distance driven / target</div>
            <div className="font-mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {ix.distActualKm.toFixed(3)} / {ix.distTargetKm.toFixed(3)} km
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
              {r.scheduleId} · {r.sampleRateHz} Hz dyno roll
            </span>
          </div>
        </div>
      ) : (
        <div className="analysis-note">
          Not computed — {UNAVAILABLE_TEXT[r.unavailable ?? ''] ?? 'unknown reason'}
          {r.detail ? ` (${r.detail})` : ''}.
        </div>
      )}
    </Panel>
  )
}

const UNAVAILABLE_TEXT: Record<string, string> = {
  no_trace: 'this test has no speed trace',
  no_schedule: 'no reference schedule exists for this cycle',
  sample_rate: 'the trace is not 1 Hz, so J2951 indices would be meaningless',
  length_mismatch: 'the trace length does not match the reference schedule',
}
```

Render `<J2951Card test={test} />` alongside the existing panels. Ensure `Panel`, `Eyebrow`, `RAG_COLOR` and the `Test` type are imported — add any that are missing.

- [ ] **Step 3: Verify**

Reload the dev server, open a test, confirm the card shows and that a MIDC test shows the explanatory sentence instead of numbers.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/views/TestDetail.tsx
git commit -m "feat: show J2951 drive quality on the test detail page"
```

---

## Task 13: MasterTable columns

**Files:**
- Modify: `dashboard/src/views/MasterTable.tsx`

- [ ] **Step 1: Extend the sort key**

At `dashboard/src/views/MasterTable.tsx:12`, change:

```ts
type SortKey = 'date' | 'project' | 'cycle' | 'config' | 'iwr' | 'rmsse' | Pollutant
```

- [ ] **Step 2: Teach the sorter about the new keys**

In the `rows` memo, inside the `get` function, add before the existing `ALL_POLL` check:

```ts
      if (sort === 'iwr') return t.j2951?.indices?.iwr ?? Number.POSITIVE_INFINITY
      if (sort === 'rmsse') return t.j2951?.indices?.rmsse ?? Number.POSITIVE_INFINITY
```

Unscored tests sort to the end in ascending order rather than masquerading as zero.

- [ ] **Step 3: Add the header cells**

After the `ODO` header at line 61, add:

```tsx
                <Th onClick={() => toggle('iwr')} active={sort === 'iwr'} dir={dir} align="right">IWR %</Th>
                <Th onClick={() => toggle('rmsse')} active={sort === 'rmsse'} dir={dir} align="right">RMSSE</Th>
```

- [ ] **Step 4: Add the body cells**

Find the row-rendering block that emits the ODO cell, and add immediately after it:

```tsx
                  <td className="font-mono" style={{
                    textAlign: 'right',
                    color: t.j2951?.verdict ? RAG_COLOR[t.j2951.verdict.iwr] : 'var(--ink-faint)',
                    fontWeight: t.j2951?.verdict?.iwr === 'pass' ? 400 : 700,
                  }}>
                    {t.j2951?.indices ? t.j2951.indices.iwr.toFixed(2) : '—'}
                  </td>
                  <td className="font-mono" style={{
                    textAlign: 'right',
                    color: t.j2951?.verdict ? RAG_COLOR[t.j2951.verdict.rmsse] : 'var(--ink-faint)',
                  }}>
                    {t.j2951?.indices ? t.j2951.indices.rmsse.toFixed(2) : '—'}
                  </td>
```

Also update the `colSpan` on the spacer row at line 68 (`<td colSpan={6} />`) to `colSpan={8}` to account for the two new columns.

- [ ] **Step 5: Verify**

Reload, open the master table, sort by IWR both directions, confirm unscored tests show `—` and sink to the bottom.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/views/MasterTable.tsx
git commit -m "feat: add IWR and RMSSE columns to the master table"
```

---

## Task 14: Full verification

- [ ] **Step 1: Run the whole suite**

Run: `cd dashboard && npm test`

Expected: all tests pass, including the pre-existing ones.

- [ ] **Step 2: Typecheck**

Run: `cd dashboard && npx tsc -b --noEmit`

Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd dashboard && npm run lint`

Expected: no new errors.

- [ ] **Step 4: End-to-end check against a real report**

Start the server, point the watch folder at
`OneDrive_3_6-20-2026 (1)/OneDrive_1_6-20-2026/`, and confirm the ingested
CITROEN_AIRCROSS test shows:

- `vehicleRld` = `{ A: 122.2, B: 0.684, C: 0.0434 }`
- a computed IWR in the Engineering table
- road-load source `parsed`

The measured trace in that file is 1477 samples with a 14.96 km integrated
distance, so it should align to the 1478-point schedule and produce a real
index. If it reports `length_mismatch`, inspect the actual sample count before
changing the aligner — the guard is doing its job.

- [ ] **Step 5: Commit any fixes**

Stage **only** the files you changed, by explicit path. Never use `git add -A` or
`git add .` in this repo: the working tree carries unrelated in-progress Electron
work (`dashboard/package.json`, `dashboard/src/components/Sidebar.tsx`,
`dashboard/src/index.css`, `dashboard/build-electron/`,
`dashboard/electron-main/preload.js`, `dashboard/tsconfig.build.json`) that must
stay uncommitted.

```bash
git add <only the files you touched>
git commit -m "fix: address issues found in end-to-end verification"
```

---

## Notes for the implementer

**Do not "improve" the two energy boundary conventions in Task 4.** They look
like off-by-one bugs. They are transcribed from the reference workbook and the
fixture test will fail if you change them.

**Do not relax the sample-rate guard** to make more tests score. The whole
reason this workbook exists is that indices computed from a 10 Hz ECU signal
read +8.05 % when the same drive at 1 Hz reads +1.43 %. A refused result is
correct; a computed one from the wrong signal is not.

**`rld` and `vehicleRld` are different quantities.** For the sample vehicle
they are `48.3933 / −0.111 / 0.04692` and `122.2 / 0.684 / 0.0434`
respectively. Using the wrong one produces ER and EER that are wrong by roughly
2.5× on the F0 term and will still look plausible.
