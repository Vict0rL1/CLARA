# Independent financial review — 7e5e5d0..e38b07b (QA-01 historical repair, F-03, preservation)

- Worktree: `/tmp/claude-0/-home-user-ALCANZA/0cc824fc-6662-5ccd-b6d7-dca2af46bc95/scratchpad/rev-finance` at `e38b07b` (detached), `node_modules` symlinked. Nothing touched in `/home/user/ALCANZA`; no commits, no push, no Playwright, no build.
- Test file (new, 46 cases, all expectations hand-computed before running): `/tmp/claude-0/-home-user-ALCANZA/0cc824fc-6662-5ccd-b6d7-dca2af46bc95/scratchpad/rev-finance/src/domain/review.finance.test.ts`. It typechecks (`tsc -p tsconfig.test.json --noEmit` → 0). **43 pass, 3 fail; the 3 failures are the P1 finding below (section G, written as the invariant the code should satisfy).**
- Synthetic data only. The author's suites (`qaFollowUp`, `qaPr15Anchor`, `qaPr15Undo`, `qaV2`, `qaCorrective`, `percentExact`) run green in the worktree (95/95), so the baseline is sane.

## (a) Cases built

Legend: "legacy split" = what 819eaa9 (schema 13) wrote: old segment `endDate = from − 1`, new segment `startDate = from`, **no `anchorDate`**, other fields copied. `figures(d, today)` = `[horizon.endDate, reservedTotalMinor, availableMinor]` from `computeBudget`.

### A · `driftedSplits` must NOT fire

| Id | Inputs | Hand expectation | Actual | Result |
|---|---|---|---|---|
| A1 | Monthly 31 (01-31) → legacy split 02-28 **changing to quarterly** | `sameRule` false → `[]` | `[]` | PASS |
| A2 | Custom every 10 days (01-01) → legacy split 01-31 (series date) changing to every 14 | `[]` | `[]` | PASS |
| A3 | Semimonthly «1 y 20» legacy split on 10-20 with the same `secondDay` 20 → invalid data (`|20−20| < 7`); with the legacy default `secondDay` 5 (what 819eaa9 wrote if not fixed by hand) → dates 10-20, 11-05, 11-20, 12-05, 12-20; low-day split 11-01 | invalid → `semimonthlyDays`; different rule → `[]`; identical dates → `[]` | as expected | PASS |
| A4 | New segment with `endDate` 03-14 (today 03-15); `endDate` = today | `[]` both (no future dates when `endDate` = today) | `[]`, `[]` | PASS |
| A5 | No predecessor; predecessor ending 02-26 (not adjacent); predecessor named «Sueldo 2»; predecessor of kind `expense` | `[]` each | `[]` each | PASS |
| A6 | Weekly Mondays (01-05) legacy split 03-02; custom-10 split 01-31; monthly 15 split 03-15 | current = proposed → `[]` | `[]` | PASS |
| A7 | Yearly 29-feb-2028, legacy split 2029-02-28; today 2029-03-01 and 2031-03-01 | 2029: first differing date (2032-02-29) beyond 400 days → `[]`; 2031: `[['2032-02-28'],['2032-02-29']]` | as expected | PASS |

### B · `driftedSplits` MUST fire (dates by hand)

| Id | Inputs | Hand expectation | Actual | Result |
|---|---|---|---|---|
| B1 | Chain of three legacy splits: 31 → 02-28 → 04-28 → 06-28; today 07-10 | only `s4` proposed: `anchor` 01-31, `current` 07-28/08-28/09-28, `proposed` 07-31/08-31/09-30; repair sets only `anchorDate` + `updatedAt`, s1..s3 identical, validates, second repair → `notFound`; occurrences of repaired s4 from 06-28: **06-30**, 07-31, … (my first hand-calc said 06-28 — wrong: 06-28 is not a 31-series date; corrected, and this is the seed of finding F-R1) | as expected; after repair `overdueIncomes` contains `schedule:s4:2026-06-30` | PASS (after correcting my own calc) |
| B2 | Monthly 30 / monthly 29 (non-leap) / monthly 31 split on 2028-02-29 (leap) / quarterly 30-nov split 02-28 | 30: 03-28.. vs 03-30, 04-30, 05-30; 29: vs 03-29, 04-29, 05-29; leap: 03-29.. vs 03-31, 04-30, 05-31; quarterly: 05-28, 08-28, 11-28 vs 05-30, 08-30, 11-30 | as expected | PASS ×4 |
| B3 | New segment `skippedDates` ['03-28','04-30'], today 03-15, CAD 1 800 | current 04-28, 05-28, 06-28; proposed 03-31, 05-31, 06-30; repair keeps `skippedDates`; horizon 04-28 before → 03-31 after | as expected | PASS |
| B4 | New segment `endDate` 12-31 | flagged; repair keeps `endDate`; last dates 10-31, 11-30, 12-31 | as expected | PASS |
| B5 | Split made ahead of time (today 02-20 < startDate 02-28) | compared from 02-28: 02-28, 03-28, 04-28 vs 02-28, 03-31, 04-30 | as expected | PASS |
| B6 | Drifted segment `paused: true` | proposed (1 entry) | 1 | PASS (observation O3) |
| B7 | Two **unrelated** «Renta» monthly schedules adjacent by coincidence (old ends 02-27 from 2025-06-30; new starts 02-28) | proposed with anchor 2025-06-30 → 03-30 | as expected | PASS (observation O4: false-positive shape) |

### C · repair opportunity after routine edits

| Id | Inputs | Hand expectation | Actual | Result |
|---|---|---|---|---|
| C1 | Plain amount edit of the drifted segment (`saveSchedule`, scope «todas») | still detectable | detectable | PASS |
| C2 | v14 `saveScheduleFrom` of the still-drifted segment at `defaultSplitDate` (= drifted 03-28), amount only, today 03-15 | **intent**: chain still proposed the 31; **code**: new segment gets `anchorDate` 02-28 → nothing detectable, `figures` on 03-21 stay `[03-28, 0, 180000]` | code behaviour confirmed | PASS as written → finding F-R2 (P2) |
| C3 | Dismiss, then amount edit | fingerprint unchanged → stays dismissed | `[]` | PASS |

### D · Known-intent fixture (CAD 180000 on 02-15; salary 240000 anchored 01-31; bill 125000 once 03-29; legacy split 02-28 amount 240777)

| Id | Inputs | Hand expectation | Actual | Result |
|---|---|---|---|---|
| D1 | today 03-21 | before `[03-28, days 7, 0, 180000, daily 25714, weekly 180000/7d]`; after `[03-31, 10, 125000, 55000, 5500, 38500/7d]`; spendable 180000 both; only reserved item `schedule:bill:2026-03-29` | identical | PASS |
| D2 | today 03-28 | before `[04-28, 31, 125000, 55000, 1774]` (03-28 income = due today, not counted); after `[03-31, 3, 125000, 55000, 18333]` | identical | PASS |
| D2 | today 03-29 | before `[04-28, 30, 125000, 55000, 1833]`; after `[03-31, 2, 125000, 55000, 27500]` | identical | PASS |
| D2 | today 03-31 | before `[04-28, 28, 125000, 55000, 1964]` (bill overdue, still reserved); after `[04-30, 30, 125000, 55000, 1833]` (03-31 income due today) | identical | PASS |
| D2 | today 04-01 | before `[04-28, 27, 125000, 55000, 2037]`; after `[04-30, 29, 125000, 55000, 1896]` | identical | PASS |
| D2b | state details | 03-28 before: `incomeDueToday` = s2:03-28; 03-31 after: s2:03-31; 03-29 before `overdueIncomes` = s1:01-31, s2:02-28, s2:03-28; 04-01 both: `overdueBills` = bill | identical | PASS |
| D3 | bill date 03-21 / 03-28 / 03-31 / 04-01, today 03-21 | before/after: `[03-28,125000,55000]`/`[03-31,125000,55000]`; same; `[03-28,0,180000]`/`[03-31,125000,55000]`; `[03-28,0,180000]`/`[03-31,0,180000]` | identical | PASS ×4 |
| D4 | + goal allocation 30000 + buffer 10000, after repair | goals 30000, buffer 10000, available 15000 | identical | PASS |

### E · F-03 and the other percentage sites

| Id | Inputs | Hand expectation | Actual | Result |
|---|---|---|---|---|
| E1 | `checkedMulDivFloor(±90071992547409, 100, 1)` / `(±90071992547410, 100, 1)`; `(−1,1,3)`, `(−3,1,3)`, `(1,1,3)` | ±9007199254740900; `null` (9007199254741000 > 2^53−1); −1, −1, 0 | identical | PASS |
| E2 | `analysisItems`: previous 1 minor (08-10), current Σ = 90 × 10^12 + 71 992 547 410 = 90 071 992 547 410 (09-10), today 09-28 | `spendingUp`, `percent` 9007199254740900 exactly; +1 minor → `percent` absent, `current` 90071992547411 | identical | PASS |
| E3 | previous 100 × MAX, current 0 / 1 minor | `spendingDown` 100 / 100 (floor of −99.99…) | identical | PASS |
| E4 | previous 0; previous net refund (−3000); previous 10000 → current −5000 | none; none; `spendingDown` 150, difference −15000 | identical | PASS |
| E5 | 10000 → 11000 / 10999 / 9000 / **9001** / 9100 | 10 fires / none / 10 fires / **10 fires (floor(−9.99) = −10)** / none | identical | PASS as written → finding F-R3 (P3) |
| E6 | `mulDivFloor(360287970189641, 100, 4)` (plans.ts path) | q = 9007199254741025 (odd, > 2^53) → inexact Number; `checkedMulDivFloor` → `null` | `Number.isSafeInteger` false; `null` | PASS → observation O5 |

### F · Preservation (≥ 5 cases not in the existing tests)

| Id | Inputs | Hand expectation | Actual | Result |
|---|---|---|---|---|
| F1 | Bill ON the income day (03-31) and on the would-be drifted day (03-28); v14 amount-only split on 02-28 and on 03-31 itself, today 03-20 | `[03-31, 90000, 10000]` before and after every split; `anchorDate` 01-31 when splitting on 03-31 | identical | PASS |
| F2 | Split 02-28 then split the new segment on 04-30 (clamped series date); re-save with the form's scope-«todas» draft (`anchorDate` kept, `endDate` 12-31); explicit `startDate` move to 05-05 (form drops `anchorDate`); quarterly 2025-10-31 split 04-30 then 10-31 | n2: `anchorDate` 01-31, 04-30, 05-31, 06-30, 07-31, 08-31; re-save: 05-31…12-31; move: 05-05, 06-05, 07-05 and `anchorDate` undefined; quarterly: 2026-10-31, 2027-01-31, 04-30, 07-31 with `anchorDate` 2025-10-31; nothing proposed for repair | identical (my first draft wrongly carried `anchorDate` into the move — test bug, fixed) | PASS |
| F3 | Monthly 31 → quarterly from 03-31; monthly from 03-30 (off-series); semimonthly «1 y 20» → `secondDay` 5 from 10-20 | re-anchored (no `anchorDate`): 03-31, 06-30, 09-30, 12-31; 03-30, 04-30, 05-30, 06-30; 10-20, 11-05, 11-20…; none proposed later | identical | PASS |
| F4 | Salary 10^12 minor (10 000 000 000 CAD) due today 03-31 / overdue 04-01 / on horizon day 03-31 from 03-20; bill 40000 on 04-05; balance 100000 | `[04-30, 1 due today, 40000, 60000]`; `[04-30, overdue 01-31/02-28/03-31, 60000]`; `[03-31, 0, 100000]` | identical | PASS |
| F5 | main 100000; savings (not in budget); card (credit, −50000, in budget); realized transfer main→savings 20000, refund 5000, card payment transfer 30000; planned transfer main→savings 10000 (03-20); income 04-01; today 03-10 | balances main 55000, card −20000; spendable 35000; horizon 04-01; reserved 10000; available 25000 | identical | PASS |

### G · `repairSplit` and PAST drifted occurrences (written as the invariant → FAIL = defect)

| Id | Inputs | Expected (invariant) | Actual | Result |
|---|---|---|---|---|
| G1 | Rent 150000 monthly 31; legacy split 02-28 at 160000; realized payments linked to r1:01-31, r2:02-28, r2:03-28, r2:04-28; balance 1 000 000 on 01-01; `fallbackHorizonDays` 30; today 05-15 | before: `[370000 spendable, 06-14, 160000, 210000, 0 overdue]` ✓ (passes); after repair: no overdue bills, reserved 160000 (05-31), available 210000 | after repair: `overdueBills` = r2:03-31, r2:04-30; reserved **480000**; available **−110000**; daily 0; transactions p2 (03-28) and p3 (04-28) left linked to dates that no longer exist | **FAIL** |
| G2 | Salary legacy split 02-28; received 02-28, 03-28, 04-28; today 05-15 | `overdueIncomes` = only s1:01-31 (unchanged) | s1:01-31, **s2:03-31, s2:04-30** («ingreso retrasado» for money already received) | **FAIL** |
| G3 | Same as G1 with `skippedDates` ['04-28'] (April rent omitted on purpose) | no overdue bills after repair | r2:03-31 and **r2:04-30 (the omitted month) reserved again** | **FAIL** |
| G4 | Detection/preview window | `current`/`proposed` start from today: the card never mentions past occurrences | confirmed | PASS (documents why G1–G3 are invisible to the person) |

## (b) Findings

### F-R1 — P1 · `repairSplit` re-dates PAST occurrences too: paid or skipped drifted occurrences come back as overdue → double count (breaks «reserva O movimiento, nunca ambos»)

- **Repro**: section G of the test file (`G1`, `G2`, `G3` fail on `e38b07b`). Minimal: rent on the 31st split by amount on 02-28 with 819eaa9; the person marked 02-28, 03-28 and 04-28 as paid; on 05-15 the card proposes «31-may, 30-jun, 31-jul» (future only) and after «Restaurar las fechas de siempre» the series is 02-28, 03-31, 04-30, 05-31… → 03-31 and 04-30 have no linked payment (the payments are linked to 03-28/04-28, dates that no longer exist) → both become **overdue, reserved** bills.
- **Expected**: `reservedTotalMinor` 160000, `availableMinor` 210000, no overdue bills (the three months were paid; their transactions already lowered the balance to 370000).
- **Actual**: `reservedTotalMinor` 480000, `availableMinor` −110000, `overdueBills` = [`schedule:r2:2026-03-31`, `schedule:r2:2026-04-30`], `dailyMinor` 0; the inbox would offer to pay March and April again (a second realized expense each if the person obeys). For an income (G2) the received months come back as «ingreso retrasado» with «Marcar como recibido» → a second income if obeyed. A skipped drifted date (G3) is resurrected and reserved.
- **Cause**: `src/domain/splitRepair.ts` lines 68–71 (`preview` compares only from `max(today, startDate)` for 400 days) and 96–101 (`repairSplit` sets `anchorDate` on the whole segment with no guard and no relinking). `saveScheduleFrom` protects the same situation with `splitSettledAfter` (`scheduleFrom.ts` 117–118) and keeps the past in the ended segment; the repair has no equivalent. Documentation (`docs/FORMULAS.md` §44, CLAUDE.md) says the repair «solo pone `anchorDate`», which is true, but the audit fixture (split 02-28, today 03-15) has no paid drifted occurrence, so the double count was never exercised. Any legacy split older than a month in real data will have them (today is 2026-10-27).
- **Suggested fix (for the implementer, not applied)**: repair by partition, like `saveScheduleFrom`: keep B's past untouched (`endDate` = yesterday) and create a new segment from today with `anchorDate` = root anchor and B's values (forward links, snoozes and planned-expense links handled as in `saveScheduleFrom`); or, at minimum, refuse (`issues`) when any realized transaction or `skippedDates` entry of B points to a date that the repaired series does not contain, naming them, and say in the card that past dates would change (G4).

### F-R2 — P2 · a routine v14 «desde una fecha» edit of a still-drifted legacy segment makes the drift permanent and undetectable

- **Repro**: `C2`. Legacy fixture (31 → 02-28), today 03-15. The form proposes `defaultSplitDate` = **03-28** (the drifted next occurrence). `saveScheduleFrom` keeps the anchor of the drifted segment: new segment `anchorDate` 02-28, `startDate` 03-28 → 03-28, 04-28, 05-28, 06-28 forever. `driftedSplits` then returns `[]` (line 77 skips any schedule with `anchorDate`; the drifted predecessor is ended and skipped at line 78). On 03-21 the figures stay `[03-28, 0, 180000]` instead of `[03-31, 125000, 55000]`.
- **Expected (audit intent)**: the chain 31 → 02-28 → 03-28 still comes from the 31; the card should still propose it, or the split should have inherited the root anchor.
- **Cause**: `splitRepair.ts` line 77 (`s.anchorDate !== undefined → continue`) combined with `rootAnchor` only following predecessors of segments *without* `anchorDate`. The doc's claim «lo que la versión corregida parte nunca aparece (lleva `anchorDate` **o no se desplaza**)» is false in this case: the v14 segment inherits a drifted anchor. Any amount change (a raise, a rent increase) that a person makes before visiting Ajustes › Datos closes the repair window silently.
- **Suggested direction**: either let `rootAnchor` walk through segments whose `anchorDate` equals their predecessor's `anchorOf` (same chain) and flag when the root anchor differs, or show the repair card (or block/warn) in the schedule form when splitting a drifted segment.

### F-R3 — P3 · the ±10 % threshold is asymmetric: a 9.99 % decrease fires and reads «10 %», a 9.99 % increase does not fire

- **Repro**: `E5`. 10000 → 9001 gives `checkedMulDivFloor(−999, 100, 10000)` = floor(−9.99) = −10 → `|−10| ≥ 10` → `spendingDown` with `percent: 10`. 10000 → 10999 gives 9 → nothing.
- **Expected**: either truncation toward zero for the magnitude (so −9.99 % reads 9 % and does not fire), or a documented statement that decreases are rounded away from zero. The same formula is in `statistics.ts` `delta()` and `weeklyReview.ts` (also `checkedMulDivFloor(diff, 100, previous)`), so all three agree with each other (consistent), but the user-facing claim «aviso desde ±10 %» (FORMULAS §38) is not met on the negative side. Pre-existing semantics (floorDiv had the same floor), but F-03 rewrote this line and its test («100 → 108 no avisa») only covers the increase side.
- **Cause**: `src/domain/analysis.ts` line ~190 (`checkedMulDivFloor(current − previous, 100, previous)` + `Math.abs`).

## (c) Observations (not defects)

- O1 **Semimonthly can never be proposed by `driftedSplits` with valid data** (A3): with the same `secondDay`, a legacy split on the high day is invalid (`|secondDay − day| < 7`) and on the low day gives identical dates; the legacy drift that really happened («1 y 20» saved with the default 5 and 20) has a different rule and is undetectable — consistent with the declared limit, but worth stating in §44 so nobody expects the card for semimonthly.
- O2 Yearly 29-feb drift is only proposed once the differing leap date enters the 400-day window (A7) — by spec («próximas ocurrencias… 400 días»).
- O3 A paused drifted segment is proposed and repairable (B6) — reasonable (occurrences resume on unpause), just not documented.
- O4 False-positive shape (B7): two unrelated schedules with the same name/kind/rule adjacent by coincidence are proposed; «Dejar como está» covers it. Name comparison is case-sensitive and exact (`a.name === s.name`).
- O5 Outside this diff, pre-existing: `plans.ts` `percent` uses the unchecked `mulDivFloor` (an odd quotient above 2^53 comes back inexact; needs ≈ 360 billion CAD spent against a 4-cent limit, so theoretical) and `fraction: spent / limit` is a float (used for a bar, not money). `categoryBreakdown` and `heroFigures` are bounded ≤ 100 and safe.
- O6 After a repair, `skippedDates` entries on drifted dates stay as harmless stale strings (B3); the real problem with skipped dates is G3.
- O7 In a chain repair (B1) the intermediate ended segments keep their drifted dates: correct, they are history, and payments linked to them keep matching.
- O8 `repairSplit` returns `touch(data)` (only `updatedAt`); history/revision bookkeeping is the store's job (`SplitRepairCard` → `run`), as with any operation. Not verified at the store level (out of my scope).
- O9 The known-intent fixture (task 2) is fully consistent with CLAUDE.md «Disponible» and FORMULAS §6 for every evaluation date and bill date tried (D1–D4), including the income-day inclusion of payments and the exclusion of the income day from `days`.
- O10 The other diff parts (`historyRevert.ts` extraction, `validation.ts` history ids, `money.ts`/`receipt.ts` currency-mark punctuation) do not change money arithmetic or dates; I did not review them beyond reading the diff.
- O11 Two of my own mistakes, both in the test, both corrected before the final run: B1 expected 06-28 as an occurrence of the repaired segment (it is 06-30; this is what led to finding F-R1), and F2's «explicit move» draft wrongly carried `anchorDate` (the real form drops it; `saveSchedule` correctly accepts whatever the draft states).

## (d) Commands run and summary output

```
git -C /home/user/ALCANZA worktree add <scratch>/rev-finance e38b07b          # HEAD is now at e38b07b
ln -s /home/user/ALCANZA/node_modules <scratch>/rev-finance/node_modules
git log --oneline 46fe617..e38b07b                                          # 10 commits, 7e5e5d0 … e38b07b
git diff --stat 46fe617..e38b07b -- src/domain                              # 16 files, +802/−123
git show 819eaa9:src/domain/scheduleFrom.ts / operations.ts                 # legacy split (no anchorDate; secondDay default from startDate)

npx vitest run src/domain/review.finance.test.ts
  run 1: 42 tests, 2 failed (B1 my hand-calc; F2 my draft) → corrected, section G added
  run 2 (final): 46 tests | 43 passed | 3 failed  (G1, G2, G3 = finding F-R1)
    G1 actual: overdueBills [schedule:r2:2026-03-31, schedule:r2:2026-04-30]
    G2 actual: overdueIncomes [schedule:s1:2026-01-31, schedule:s2:2026-03-31, schedule:s2:2026-04-30]
    G3 actual: overdueBills [schedule:r2:2026-03-31, schedule:r2:2026-04-30]
npx vitest run src/domain/review.probe.test.ts (temporary, deleted afterwards)
  AFTER {"spendable":370000,"reserved":480000,"available":-110000,"daily":0,
         "items":[["schedule:r2:2026-03-31","overdue",160000],["schedule:r2:2026-04-30","overdue",160000],["schedule:r2:2026-05-31","pending",160000]]}
  ORPHANS [["p1","2026-02-28"],["p2","2026-03-28"],["p3","2026-04-28"]]
npx vitest run src/domain/qaFollowUp.test.ts src/domain/qaPr15Anchor.test.ts src/domain/qaPr15Undo.test.ts src/domain/qaV2.test.ts src/domain/qaCorrective.test.ts src/domain/percentExact.test.ts
  Test Files 6 passed (6) · Tests 95 passed (95)
npx tsc -p tsconfig.test.json --noEmit                                       # exit 0 (23 s), review.finance.test.ts included
```

Not done (by instruction): Playwright, `npm run build`, store-level (`AppStore`) verification of the repair's local backup/history entry.
