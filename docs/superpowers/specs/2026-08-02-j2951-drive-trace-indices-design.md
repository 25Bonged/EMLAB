# SAE J2951 Drive-Trace Indices — Engineering Integration Design

**Date:** 2026-08-02
**Status:** Approved for planning

## Goal

Compute the six SAE J2951 drive-trace indices — IWR, RMSSE, DR, ER, EER, ASCR —
for every ingested emission test, and surface them in the dashboard so a
badly-driven run is visible before anyone reads its emission numbers.

The reference is `J2951_DriveTrace_Analyser_ANYVEHICLE.xlsx`, sheet
`Calculator_ANY_VEHICLE`. Its formulas were transcribed and validated against
its own preloaded example (CC24 bench run 2026-07-01); all six indices reproduce
to six decimal places:

| index | reference impl | workbook   |
| ----- | -------------- | ---------- |
| IWR % | −2.985232      | −2.985232  |
| RMSSE | 0.956651       | 0.956651   |
| DR    | 0.992534       | 0.992534   |
| ER    | 0.971739       | 0.971739   |
| EER   | 1.021400       | 1.021400   |
| ASCR  | 0.966069       | 0.966069   |

That agreement is what makes this integration a transcription job rather than a
derivation, and it becomes the regression fixture.

## Why indices are computed at ingest and stored, not computed in the view

The obvious design is a pure function called from a `useMemo` in the view, which
is how everything in `src/lib/engineering.ts` already works. It does not work
here, and the reason is `electron/server.ts:29`:

```ts
return c.json(summary ? rows.map((test) => ({ ...test, trace: null, phases: [] })) : rows)
```

The list route strips traces. The client holds speed traces only for tests it
has explicitly opened via `loadDetail(id)` → `/api/tests/:id`. A fleet-wide
table or a MasterTable column would therefore need either ~30 detail round-trips
on load, or `?summary=false`, which ships 1,477 points × 3 channels × every test
on every page load. Both are unacceptable for surfaces that must render
immediately.

Storing the six numbers on the test sidesteps this: they live in `data_json`,
which survives the `trace: null` stripping, so every surface reads them from the
summary payload already being fetched. Zero extra network.

The design keeps the part of the pure-function approach that matters — the math
lives in a dependency-free module that is unit-tested in isolation. Only its
*invocation* moves to ingest time.

## Architecture

```
ingest (buildTest)
  ├── pdfReport.ts    → vehicleRld {A,B,C} + inertia        [NEW parse]
  ├── xlsmTrace.ts    → dilute[].speed  (dyno roll, 1 Hz)   [exists]
  ├── model/cycles.ts → getSchedule(cycle) → target trace   [NEW]
  └── lib/j2951.ts    → computeJ2951(target, actual, opts)  [NEW, pure]
        ↓
      Test.j2951  ──persisted in data_json──→  every view, no trace needed

electron/backfill.ts  → on server start, recompute tests whose
                        j2951.calcVersion is stale or missing
```

## Data model

Two additions to `Test`:

```ts
/** Vehicle A/B/C from the page-1 vehicle table. Distinct from `rld`,
 *  which holds the Dyno Set from the remarks line. */
vehicleRld: { A: number | null; B: number | null; C: number | null }
j2951?: J2951Result | null
```

```ts
export interface J2951Indices {
  iwr: number            // %
  rmsse: number          // km/h
  dr: number
  er: number | null      // null when vehicle road load is unavailable
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

export type J2951Unavailable =
  | 'no_trace'
  | 'no_schedule'
  | 'sample_rate'
  | 'length_mismatch'

export interface J2951Result {
  calcVersion: number
  scheduleId: string | null      // 'WLTC_3B_LMH'
  sampleRateHz: number | null
  indices: J2951Indices | null
  verdict: { iwr: RagLevel; rmsse: RagLevel; overall: RagLevel } | null
  inputs: J2951Inputs | null
  unavailable?: J2951Unavailable
  detail?: string                // human-readable, e.g. "actual 1476 vs target 1478"
}
```

Storing `inputs` alongside the result is deliberate: an index is not auditable
without the mass and road-load coefficients that produced it.

### On the existing `rld` field

`Test.rld` is populated at `src/ingest/pdfReport.ts:216` by a regex that matches
the report's *Dyno Set* remarks line — for the sample report,
`A = 48.3933, B = −0.111, C = 0.04692`. J2951's road-load power term needs the
**Vehicle A/B/C** values from the page-1 vehicle table — `122.2, 0.684, 0.0434`
for the same vehicle — which no parser currently reads.

These are different quantities. `rld` is not renamed (out of scope), but
`vehicleRld` sits beside it with a comment, and the J2951 code reads only
`vehicleRld`. Anything else silently produces ER and EER that are wrong by a
factor of roughly 2.5 on the F0 term.

## The math

Speeds in km/h, `dt` in seconds, mass in kg, `kr = 1.03` (AIS-175 Annex B2 §3.1).

```
dKE⁺ᵢ  = max(0, ½(vᵢ/3.6)² − ½(vᵢ₋₁/3.6)²)        [J/kg]
IW     = Σ dKE⁺
IWR    = 100 · (IW_actual − IW_target) / IW_target

RMSSE  = √( Σ(v_actual,ᵢ − v_target,ᵢ)² / N )

dist   = Σv · dt / 3600
DR     = dist_actual / dist_target

P⁺ᵢ    = max(0, ((F0·vᵢ + F1·vᵢ² + F2·vᵢ³) + kr·m·aᵢ·vᵢ) / 3600)   [kW]
  where aᵢ = ((vᵢ₊₁ − vᵢ₋₁) / (2·dt)) / 3.6                        [m/s²]
E      = ΣP⁺ · dt / 3600
ER     = E_actual / E_target
EER    = DR / ER

ASCR   = Σ|Δv|_actual / Σ|Δv|_target
```

Two boundary conventions are inherited verbatim from the workbook, because
changing them changes the answer:

- **First sample:** `a₀` uses `(v₁ − v₀)/(2·dt)` — the workbook's `H30` formula
  substitutes `v₀` for the nonexistent `v₋₁` while still dividing by `2·dt`.
- **Last sample:** contributes no power term at all (no `vᵢ₊₁` exists), so the
  energy sum runs to `N−2`.

Both are reproduced in the reference implementation and covered by the fixture
test.

## Target schedule

`src/model/cycles.ts` holds a registry of 1 Hz target speed traces. One entry
ships:

- **`WLTC_3B_LMH`** — WLTC Class 3b, Low + Medium + High, 1,478 points
  (t = 0…1477), theoretical distance 15.0123 km. Extracted verbatim from column
  B of `Calculator_ANY_VEHICLE`. Stored as a comma-separated string (~6.2 KB),
  parsed to a `Float64Array` once on first use.

This matches the library's WLTP tests, whose reports read `Duration [s] = 1477`.

MIDC and NEDC get no schedule. Their tests resolve to
`unavailable: 'no_schedule'` and the UI states that explicitly. Producing an
index against a guessed schedule would be worse than producing none.

## Alignment

The schedule is 1,478 points starting at t = 0. `Dilute_Results_Trace` is 1,477
rows starting at t = 1. The workbook reconciled these by prepending a
`t = 0, v = 0` sample to the measured trace.

The implementation does the same, explicitly: if the actual trace starts at
t = 1, prepend `(0, 0)`. After that, lengths must match exactly. A mismatch
yields `unavailable: 'length_mismatch'` with both counts in `detail` — never a
silent truncation, which would quietly change every index.

## Guards

Each produces a distinct reason code rather than a plausible-looking number.

| condition                     | code               | effect                                    |
| ----------------------------- | ------------------ | ----------------------------------------- |
| no dilute trace / no speed    | `no_trace`         | all indices null                          |
| cycle has no schedule         | `no_schedule`      | all indices null                          |
| median sample interval ∉ 1 ± 0.01 s | `sample_rate` | all indices null — refuse outright     |
| length mismatch after align   | `length_mismatch`  | all indices null                          |
| `vehicleRld` or mass missing  | —                  | IWR/RMSSE/DR/ASCR computed; ER/EER `null` |

The sample-rate guard is the one that matters most. It encodes the finding in
the workbook's `README_and_CORRECTION`: IWR is a one-sided sum of positive
kinetic-energy increments, so high-frequency ripple adds work that never
cancels. The same runs moved from +8.05 % at 10 Hz to +1.43 % at 1 Hz — a
factor of 5.6. Computing this index from an ECU wheel-speed channel produces a
number that measures sensor noise. The dashboard's trace is chassis-dyno roll
speed at native 1 Hz, which is the correct regulatory reference, and the guard
makes it impossible to feed it anything else without the refusal being visible.

## Pass bands

From the calculator sheet: IWR within ±4.0 %, RMSSE ≤ 1.3 km/h.

The workbook labels the XUV's −4.038 % run MARGINAL but never states the
marginal threshold. This design infers:

| IWR            | `RagLevel` | shown as |
| -------------- | ---------- | -------- |
| \|IWR\| ≤ 4.0  | `pass`     | PASS     |
| \|IWR\| ≤ 5.0  | `warn`     | MARGINAL |
| \|IWR\| > 5.0  | `fail`     | FAIL     |

The verdict reuses the existing `RagLevel` union from `src/model/types.ts`
(`pass | warn | fail | na`) so the existing `RagDot` and `RAG_COLOR` render it
without new plumbing. "MARGINAL" is display text for `warn`, not a fourth level.

RMSSE is two-state: ≤ 1.3 `pass`, above `fail`. `overall` is the worse of the
two. When indices are unavailable the verdict is `null`, and the UI renders the
reason code — `na` is not used, to keep "no result" distinct from "computed, no
limit".
**This banding is an inference, not a cited spec**, and is isolated in one
exported constant so it can be corrected in a single edit.

## Overrides and recomputation

Manual road-load correction rides on the existing `Test.overrides` bag as
`overrides.vehicleRld`, which is already typed, already persisted, and already
the established path for correcting a parsed value.

`j2951` is derived output and is **not** an override. It is recomputed whenever:

1. a test is ingested,
2. `PATCH /api/tests/:id` changes `vehicleRld`, `inertia`, or `cycle`, or
3. `electron/backfill.ts` finds `j2951.calcVersion` missing or stale at server
   start.

Backfill reads speed from the `trace_points` table, so it does not need the
source files. It is idempotent and version-guarded, so a formula correction
propagates to the whole library by bumping `CALC_VERSION`.

## UI surfaces

**Engineering → new "Drive quality (J2951)" subtab.** Joins the existing
`deterioration | conformity | labstt` row.

- Fleet table: one row per test — IWR, RMSSE, DR, ER, EER, ASCR, verdict pill.
  Tests with an `unavailable` code show the reason in place of numbers rather
  than being hidden, so a coverage gap is visible.
- Selected-run detail: target-vs-actual speed overlay, and cumulative inertial
  work (target vs actual) — the second chart is what makes an IWR number legible,
  since it shows *where* in the cycle the work diverged.
- A provenance line stating speed source and sample rate on every result.

**TestDetail → J2951 card.** IWR and RMSSE with verdict badge, so drive-trace
validity is visible while reading a single test's emission results.

**MasterTable → two sortable columns.** IWR and RMSSE, so an invalid run is
obvious when scanning the whole library.

## Testing

- **Golden fixture.** The 1,478-point target/actual pair from
  `Calculator_ANY_VEHICLE` is committed as a JSON fixture. One test asserts all
  six indices to six decimal places against the workbook values in the table at
  the top of this document. This is the test that proves the transcription.
- **Boundary conventions.** Explicit tests for the first-sample acceleration and
  last-sample energy exclusion described above.
- **Each guard** gets a test asserting the correct reason code and that partial
  results survive where they should — specifically, that missing `vehicleRld`
  still yields IWR, RMSSE, DR and ASCR.
- **Sample-rate refusal.** A 10 Hz input is asserted to be refused. This test
  exists to prevent regressing the exact error the workbook was written to
  correct.
- **Parser.** A test that Vehicle A/B/C parses to `122.2 / 0.684 / 0.0434` from
  the sample report, and that it is not confused with the Dyno Set values
  `48.3933 / −0.111 / 0.04692` on the same page.
- **Backfill.** Idempotence, and that a `CALC_VERSION` bump triggers recompute.

## Out of scope

- MIDC and NEDC schedules — no verified source available.
- Renaming `Test.rld` to `dynoRld`, despite it being misleading.
- Computing indices from ECU wheel-speed logs, at any sample rate.
- Phase-level (Low/Medium/High) index decomposition.
