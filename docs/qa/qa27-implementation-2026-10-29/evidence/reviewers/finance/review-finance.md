# Independent financial review — QA27 fixes (`21b4ed8..ac99396`)

Reviewer: financial/recurrence reviewer (read-only). Worktree: `/tmp/claude-0/-home-user-ALCANZA/0cc824fc-6662-5ccd-b6d7-dca2af46bc95/scratchpad/qa27/rev-finance` at `ac99396`, `node_modules` symlinked. Date: 2026-10-30.
Test file (only file added): `src/domain/review.qa27.finance.test.ts` — 44 cases, every expectation hand-computed before the first run. **40 pass; the 4 failures are the four cases I labelled `HALLAZGO`/`OBSERVACIÓN` beforehand** (they encode the documented rule; the implementation departs from it). No application file, no existing test and no docs were touched; nothing committed.

Verdict on the four audited fixes: **QA27-01 (undo guard) holds under every adversarial case I built, including the «nothing previously revertible became blocked» cases; QA27-02 (snooze retarget) holds; QA27-03 (exact percent / declared difference) holds for Analysis and Statistics but the weekly review now emits a wrong «gastaste lo mismo» observation when the difference does not fit (new P3 introduced by the fix); QA27-03b (duplicate cap) holds.** Separately, the repair's date-pairing window drops a skipped date / refuses a planned-expense link in the last period of the 400-day window (P2, pre-existing in `repairPlan`, reachable from the calendar).

---

## (a) Cases built (expected vs actual)

Notation: `figures` = `{spendable, horizon, reserved, available, overdue bills, overdue incomes}` from `computeBudget`; "blocked by P" = `canRevert → 'dependents'`, `revertDependents` equals exactly `[{kind:'payment', id, scheduleId, name=<occurrence date>, amountMinor}]`, `revertEntry` refuses with `revertDependents {count}` and `JSON.stringify(data)` is unchanged; every case also checks that `canRevert` and `revertEntry` agree (helper `agree`), and every allowed revert is validated with `validateAppData` (helper `revertOk`).

### (a) QA27-01 — undo guard (17 cases, all pass)

| # | Case | Hand-computed expectation | Result |
|---|---|---|---|
| a1–a3 | Partitioned repair (rent 31 split 28-feb, paid 28-feb/28-mar/28-apr, repaired 15-may → r2 ends 30-apr, r3 from 1-may anchor 31-jan). Pay r3:31-may **early** (20-may), **on the date** (31-may), **late** (3-jun). | spendable 210 000 in all; early: reserved 0 / available 210 000; on-date & late: reserved 160 000 (30-jun) / available 50 000; overdue []. Undo of the repair blocked by p4 (r3, 2026-05-31, 160 000). | pass |
| a4 | Same partition but 28-mar left unpaid; after the repair pay the **ended** segment's overdue 28-mar on 16-may. | Before: reserved 320 000 (28-mar overdue + 28-may), available 210 000; after payment: spendable 370 000, reserved 160 000, available 210 000, overdue []. Undo **allowed**; result validates; r2 restored without `endDate`, r3 gone, payments p0,p1,p2,p5 kept; figures identical (210 000). | pass |
| a5 | Partition with `autoConfirm` on r2 → r3 inherits it; `autoConfirmDue` on 31-may records r3:31-may (`source: scheduled`). | Undo of the repair blocked by that auto payment; the auto-confirm entry itself is revertible; available 50 000 both before (reserved 160 000) and after reverting it (reserved 320 000): movement **or** reserve, never both. | pass |
| a6 | In-place repair (Luz 31 split 28-feb, February unpaid, repaired 20-mar); pay 28-feb (exists in both series) late on 21-mar. | Undo allowed; figures after payment (21-mar, horizon 28-mar): 98 000 / reserved 0 / available 98 000; after revert: reserved 42 000 (28-mar back), available 56 000; payment still settles 28-feb. | pass |
| a7 | Same, plus 31-mar paid on 30-mar, plus two already-orphan payments (unknown schedule id; non-series date 30-mar). | Exactly one dependent: p-mar (b2, 2026-03-31, 42 000). | pass |
| a8 | Ranged income (320 000, min 100 000) repaired in place; two partial receipts on 31-mar (100 000 on 31-mar, 50 000 on 2-apr). | Blocked by [i1] then by [i1, i2] (count 2, in transaction order); each partial's own entry revertible; `planItems` 31-mar: overdue, remaining 170 000, received 150 000, partials [i1,i2]. | pass |
| a9 | Skip 31-mar, then pay it (entry touches schedules + transactions). | That entry revertible: payment removed and 31-mar skipped again; figures 25-mar: paid 98 000/42 000/56 000 (28-feb overdue) → reverted 140 000/42 000/98 000. | pass |
| a10 | Plain edit scope «todas»: gym 15th → 20th (saved 10-mar); pay 20-mar. | Edit undo blocked by g1 (gym, 2026-03-20, 5 000); payment entry revertible (95 000 available in both states: paid → reserved 0; reverted → reserved 5 000); afterwards the edit is revertible again; the reverted payment entry answers `alreadyReverted`. | pass |
| a11 | Create schedule (1-apr) → pay 1-apr → delete the schedule. | Creation undo blocked by n1; deletion keeps the payment; undo of the deletion (restores the schedule) allowed and validates. | pass |
| a12 | Extend `endDate` 10-mar → 10-jun, pay 10-apr. | Edit undo blocked by c1 (2026-04-10, 8 000). | pass |
| a13 | Relink entry only (transactions): move payment w1 from 31-mar to 30-apr (both exist). | Undo allowed and exact; figures 1-apr: relinked → 31-mar overdue reserved 42 000, available 56 000; reverted → reserved 0, available 98 000. | pass |
| a14 | Relink, then move the series start to 30-apr. | Undo of the relink blocked; dependent names the **current** occurrence (w1, 2026-04-30). | pass |
| a15 | Quarterly 30-nov split 28-feb (no anchor). | `driftedSplits`: current [28-may, 28-aug, 28-nov], proposed [30-may, 30-aug, 30-nov], from 28-feb; repaired occurrences [28-feb, 30-may, 30-aug, 30-nov, 28-feb-2027]; paying 28-feb (common) → undo ok; paying 30-may → blocked by q2. | pass |
| a16 | Yearly 29-feb-2024 split 28-feb-2025, 2025 and 2026 paid on the 28th. | `driftedSplits` from 1-mar-2026, current [28-feb-2028], proposed [29-feb-2028]; in-place repair; occurrences 2025-02-28, 2026-02-28, 2027-02-28, **2028-02-29**, 2029-02-28; prepaying 29-feb-2028 on 20-feb-2028 → blocked. | pass |
| a17 | Semimonthly 15 & 31 split 28-feb (counts 15 & 28). | Repaired counts [28-feb, 15-mar, 31-mar, 15-apr, 30-apr, 15-may, 31-may]; 15-mar (common) paid → ok; 31-mar paid → blocked by h2. | pass |

### (b) QA27-02 — snooze retarget (7 cases: 5 pass, 2 fail = finding F1)

| # | Case | Expectation | Result |
|---|---|---|---|
| b1 | Rent 31 split 30-apr (moved), paid 30-apr & 30-may, today 5-aug → partition at 1-jun. | `driftedSplits` from 1-jun, current [30-aug, 30-sep, 30-oct], proposed [31-aug, 30-sep, 31-oct]; r2 ends 31-may; old r2 [30-jun, 30-jul, 30-aug] vs r3 [30-jun, 31-jul, 31-aug]. | pass |
| b2 | Six snoozes: 30-jun (coincident), 30-may (paid, before `from`), 30-jul (changed → 31-jul), a stale `r2:31-jul` (maps to the same target, later `until`), `other:30-jun`, `dup:a:b`. | Result exactly `[r3:30-jun (until 12-aug, at1), r2:30-may, r3:31-jul (until 20-aug, at4), other:30-jun, dup:a:b]`; `inboxView` overdue before `{active [], snoozed [r2:30-jun, r2:30-jul]}` → after `{active [], snoozed [r3:30-jun, r3:31-jul]}`; identical after reload and backup round trip; undo of the repair restores the six originals and r2 without `endDate`. | pass |
| b3 | Expired snooze (until 20-jul, today 5-aug). | Carried as `r3:30-jun` with `until` intact; overdue active before and after. | pass |
| b4 | In-place repair (income s2), snoozes `s2:28-mar` (until 5-apr) and stale `s2:31-mar` (until 10-apr). | One entry `s2:31-mar` until 10-apr; inbox before `{active [s1:31-jan, s2:28-feb], snoozed [s2:28-mar]}` → after `{…, snoozed [s2:31-mar 10-apr]}`; undo restores both. | pass |
| b5 | **HALLAZGO** skipped date 28-jun-2027 (399 days ahead, today 25-may-2026). | Expected `r3.skippedDates = ['2027-06-30']`, `planItems` 30-jun-2027 `skipped`. **Actual: `['2027-06-28']`, state `pending`.** | **fail → F1** |
| b6 | **HALLAZGO** planned expense linked to r2:28-jun-2027. | Expected link → `{r3, 2027-06-30}`. **Actual: repair refused `splitLinkedGoal {date: 2027-06-28}`.** | **fail → F1** |
| b7 | Control: skipped 28-may-2027 (one period earlier). | `['2027-05-31']`. | pass |

### (c) QA27-03 — exact percentage / difference (7 cases: 5 pass, 2 fail = F2 and O1)

| # | Case | Expectation | Result |
|---|---|---|---|
| c1 | Helpers: (10999,10000)=9, (9001,10000)=−9, (10001,10000)=0, (9999,10000)==0; 99/100/−99/−100; (−1,10000)=−100, (−10000,10000)=−200, (−10050,10000)=−200, (−10100,10000)=−201; 9 999 % and 10 000 %; (90071992547410,1)=9 007 199 254 740 900 and one more → null; (MAX,MAX)=0, (0,MAX)=−100, (−MAX,MAX)=−200, (MAX,100)=MAX−100, (MAX,99)=null; `checkedSubMinor` MAX/−1 → null, −MAX/1 → null, 0/−MAX → MAX; non-integers and base ≤ 0 throw. | all as computed | pass |
| c2 | Analysis, totals near 2⁵³, **safe** difference: previous 2⁵² (4 504 movements ≤ 10¹²), current 2⁵²+2⁵¹ (6 756). | `spendingUp` 50 %, params current 6 755 399 441 055 744 / previous 4 503 599 627 370 496 / date 28-aug, `because` rows incl. difference 2 251 799 813 685 248. | pass |
| c3 | **Unsafe** difference, percent fits: previous 2⁵²+2⁵¹ (expenses), current −2⁵² (refunds). | `spendingDown` 166 %, no `difference` row, all money rows safe; Statistics (month): expenses `{null, −166}`, net `{null, null}`, income `{0, null}`. | pass |
| c4 | **HALLAZGO** weekly review with the same operands (16-sep vs 23-sep, today 27-sep). | `spendingChange {null, −166}` ✓ but observations must not say `spendingSame`. **Actual: `[spendingSame]`.** | **fail → F2** |
| c5 | Neither quotient nor difference fit: previous 1, current −MAX (9 008 refunds). | `spendingDown` without `percent`, params `{current −MAX, previous 1, date 28-aug}`, only the two amount rows. | pass |
| c6 | Negative base (net refunds) / zero base; weekly ±10 %. | weekly `{25000, null}` + `spendingMore 25000`; stats month `{25000, null}` and `{5000, null}`; no Analysis item; weekly 11000/9000/10000 → `{1000,10}/{−1000,−10}/{0,0}` with More/Less/Same. | pass |
| c7 | **OBSERVACIÓN** `periodSummary` with 9 200 odd expenses of 987 654 321 001 and refunds summing to the same exact total. | net 0. **Actual: −80** (spent accumulates to 9 086 419 753 209 120 instead of …200). | **fail → O1** |

### (d) QA27-03b — duplicate cap (6 cases, all pass)

| # | Case | Expectation | Result |
|---|---|---|---|
| d1 | 10 identical same-day → 45 pairs; 11 → 50: all pairs of t0000…t0006 (10+9+8+7+6+5+4 = 49) plus `t0007:t0008`; `t0007:t0009`… `t0009:t0010` absent. | as computed | pass |
| d2 | Stability: same ids on each run; unrelated amount added → unchanged; a **later** same-group movement becomes the 11th pair (`t0000:z`); an **earlier** one goes first (11 pairs `a:t…`, last `t0004:t0009`, `t0007:t0008` dropped). | as computed | pass |
| d3 | Three groups (expense/main ×11, income ×3, other account ×2). | 50 + 3 + 1 = 54, each within its kind/account. | pass |
| d4 | ±3-day window: 3 days pair, 4 days not; 60 on 10-sep + 60 on 20-sep → 50 pairs all from 10-sep. | as computed | pass |
| d5 | 6 partials of the same occurrence + 5 unlinked → 55 − 15 = 40 pairs, none linked-linked; two payments of the same schedule on different occurrences → 0. | as computed | pass |
| d6 | 10 000 identical same-day. | 50 pairs, first ids `dup:m0000:m0001`, `dup:m0000:m0002`; `possibleDuplicates` + `inboxView` < 1 s (measured ≈ 50 ms). | pass |

### (e) Preservation (7 cases, all pass)

| # | Case | Expectation | Result |
|---|---|---|---|
| e1 | Genuine v13 backup, repaired 21-mar (31-mar / 1 250 / 550). On 30-mar: horizon 31-mar, 1 day, daily 55 000, weekly 55 000 (1 day), bill 29-mar overdue. Receive the 31-mar salary 2 407,77 → spendable 420 777, horizon 30-apr, reserved 125 000, available 295 777; overdue incomes `[salary:31-jan, salary-2:28-feb]` throughout. | Undo of the repair blocked by `salary-mar`; the receipt's entry revertible; same figures and same refusal after reload and after backup round trip. | pass |
| e2 | Decline («Dejar como está») + backup round trip. | dismissal `{int:split:salary-2, '2026-02-28\|\|2026-01-31'}` kept; nothing proposed; figures `180 000 / 28-mar / 0 / 180 000`; `repairSplit` → `notFound`. | pass |
| e3 | Skipped 28-mar **before** `from` (paid 28-feb & 28-apr). | r2 ends 30-apr keeping `['2026-03-28']`, r3 `[]`; figures identical before/after: 530 000 / 14-jun / 160 000 / 370 000. | pass |
| e4 | Anchors through leap February: monthly 31 → 31-jan, **29-feb-2028**, 31-mar, 30-apr; semimonthly 15 & 31 → 15-feb, 29-feb, 15-mar, 31-mar. | as computed | pass |
| e5 | Safety buffer on the repaired v13: 10 000 → available 45 000, daily 4 500, weekly 31 500, reserved unchanged; 60 000 → available −5 000, daily/weekly 0. | as computed | pass |
| e6 | `recurringCosts`: 24 daily schedules of 10¹² → ok, 8 760 000 000 000 000 total, 730 000 000 000 000 monthly, 365 occurrences each; 25 → `ok:false`, total/monthly null, every item total still 365 000 000 000 000; a repaired 31-series counts 12 (1 920 000, 160 000/month). | as computed | pass |
| e7 | `projectBalance` with 9 007 × 10¹² exact balance and a 10¹² income tomorrow: `outOfRangeFrom` 30-oct, 1 day, end = start; without `stopWhenOutOfRange` → `RangeError`. | as computed | pass |

---

## (b) Findings

### F1 — P2 · `repairSplit` loses a skipped date (and refuses a planned-expense link) when the usual counterpart falls after the comparison window
- **Where:** `src/domain/splitRepair.ts`, `repairPlan` (lines 119–134). `until = max(showFrom + 400 days, each linked date)`; `current` and `proposed` are both cut at `until` and paired by index. A moved date is never later than its usual date, so the usual counterpart of the last current date inside the window can lie **after** `until`: `pairs.get(date)` is `undefined` and `remap(date)` returns the moved date unchanged.
- **Reproduction (test b5):** `legacyRent` paid 28-feb/28-mar/28-apr, `r2.skippedDates = ['2027-06-28']`, today 2026-05-25 (`from` = 1-may; `until` = 25-may-2026 + 400 = 29-jun-2027). `current` has 14 dates (…, 2027-05-28, 2027-06-28); `proposed` has 13 (…, 2027-05-31; 2027-06-30 > until). Actual after `repairSplit`: `r3.skippedDates = ['2027-06-28']` (not an occurrence of r3), `planItems` for 2027-06-30 says `pending` — the person's «omitir» is silently lost and the rent is reserved/overdue again in June 2027. FORMULAS §44: «una fecha omitida sigue omitida en la fecha de siempre de su periodo».
- **Second manifestation (test b6):** a planned expense linked to `r2:2027-06-28` → `exists` is evaluated on the unmapped date → the whole repair is refused with `splitLinkedGoal {name, date: 2027-06-28}` although 2027-06-30 exists; the person cannot repair the drift without unlinking the goal. (A snooze that far ahead is unrealistic — snoozes are only created for overdue items — so the snooze path is unaffected in practice.)
- **Reachability:** the calendar's «Omitir» (`src/ui/screens/Calendar.tsx:97`) acts on any listed occurrence and the month view navigates beyond the 400-day projection (manual plan case 9); 2027-06-28 is 399 days ahead of 2026-05-25. Control case b7 (28-may-2027) passes, so this is strictly the last-period boundary. Pre-existing from the lead pass (`repairPlan` unchanged by QA27-02); the QA27-02 snooze code inherits it through `remap`.
- **Suggested fix:** compute `proposed` over a window extended by one period and pair by index:
  `const proposed = occurrencesBetween({ ...s, anchorDate: anchor }, from, addDays(until, 31)).slice(0, current.length)` (drift from clamping is at most 3 days, so +31 days is sufficient; the preview filter `d >= showFrom` and the `slice(0, 3)` in `driftedSplits` keep working). Add b5/b6 as regression tests.

### F2 — P3 · weekly review says «gastaste lo mismo» when the difference does not fit (introduced by QA27-03)
- **Where:** `src/domain/weeklyReview.ts` lines 153–156: `if (diff !== null && diff > 0) more; else if (diff !== null && diff < 0) less; else spendingSame` — the `null` case falls into `spendingSame`.
- **Reproduction (test c4):** previous week 2⁵²+2⁵¹ of expenses (16-sep), current week 2⁵² of refunds (23-sep), today 27-sep: `spendingChange = {diffMinor: null, percent: −166}` (correct) but `observations = [{id: 'spendingSame'}]`. The screen would show «… la diferencia no cabe en una cifra exacta (166 %)» and, underneath, «Gastaste lo mismo que en el mismo periodo de la semana anterior.» — contradictory. FORMULAS §20 only promises «la diferencia no cabe… y el porcentaje, si cabe, se da igual».
- **Severity:** P3 — needs the audit-scale totals (difference > 2⁵³ − 1); Analysis and Statistics are correct for the same operands (c3).
- **Suggested fix:** `else if (spendingChange.diffMinor === 0) observations.push({ id: 'spendingSame' … })`, and for `diffMinor === null` either push nothing or a dedicated observation (`spendingChangedNoFigure`, reusing `weekly.noDifference` with the percent when it fits). Add c4 as a regression test.

---

## (c) Observations

- **O1 (P3 candidate, data not reachable in normal use) — `periodSummary` accumulates per category with plain `+=`** (`src/domain/insights.ts` 41–43). When a category's gross spent or refunded passes 2⁵³ the float rounds silently; the net can still be a safe integer and then feeds Analysis, Statistics, weekly review, hero figures and `checkedPercentChange` with a wrong operand (the exactness guards only see the already-rounded net). Test c7: 9 200 expenses of 987 654 321 001 (odd) and refunds totalling exactly the same give `netSpendingMinor = −80` (spent float 9 086 419 753 209 120 vs exact …200). Requires ≥ 9 008 movements near `MAX_AMOUNT_MINOR` in one category and period — only via an imported backup (`validateAppData` accepts it: each amount ≤ 10¹², `MAX_RECORDS` 500 000). Suggested: accumulate with BigInt (or `sumMinor`-style checks) and return `null`/declare «sin cifra» like `recurringCosts`. This is the one unchecked money accumulation left on the QA27-03 path.
- **O2 — `checkedPercentChange` returns `-0`** for a decrease below 1 % (e.g. 10 000 → 9 999: `-magnitude` with magnitude 0). Harmless in the three consumers (Statistics prints `${percent}` → «0 %» with the down arrow driven by `diffMinor`; weekly uses `Math.abs`; Analysis only acts on |percent| ≥ 10) but `Object.is`/`toEqual`-based tests will see `-0`. Cosmetic: `return magnitude === 0 ? 0 : …`.
- **O3 — other percent sites** (grep of `* 100`, `mulDivFloor(`, `floorDiv(`): `inbox.ts:224` (`debtMinor * 100 >= limitMinor * 90`), `goalMilestones.ts:28` (`savedMinor * 100 >= targetMinor * level`), `plans.ts:479` (`spentMinor * 100 >= amountMinor * l`) multiply money as floats. `x * 100` is inexact only for x > 9.007 × 10¹³; the right-hand side is ≤ 10¹⁴ (limits/targets ≤ `MAX_AMOUNT_MINOR` = 10¹²), so when inexact the comparison is already true by a wide margin (and for cards `overLimit` is evaluated first). No reachable wrong result; `mulDivFloor`/BigInt would make the intent explicit. All remaining sites (`analysis.ts:218`, `statistics.ts:106/252/253`, `heroFigures.ts:42`, `plans.ts:124/128/154`, `templates.ts:40`, `splits.ts:84`, `periods.ts`, `budget.ts`, `affordability.ts`, `periodBudgets.ts`, `projection.ts:198`) already use the BigInt helpers; `featureGate.ts:57` and `plans.ts:443` are counts, not money.
- **O4 — duplicate cap semantics (documented, worth one line in FORMULAS §24):** (i) the listed 50 pairs are the first 50 in (date, id) loop order over the whole group, so a *later* same-amount movement within the window becomes the 11th pair of the first item (test d2: `t0000:z`) and pairs previously listed drop out — ids are stable for the same data but the *set* shifts as the group grows; (ii) the cap is per group, not per window cluster: a second cluster of the same amount ten days later is never listed while the first one fills the cap (d4); (iii) the exclusion is by `scheduleId` only (two payments of different occurrences of the same schedule are never paired, d5) — broader than §24's «misma ocurrencia», conservative.
- **O5 — guard reporting details (all fine):** dependents are listed in `data.transactions` order (a8); `name` is the payment's *current* occurrence date (a14 shows 30-apr after a relink); a payment on a *paused* or *skipped-then-paid* occurrence still counts as settled (occurrencesBetween ignores both), which is consistent with planItems («paid» beats «skipped», paused generates no reserve).
- **O6 — `canRevert` checks conflicts before dependents:** an in-place repair followed by a skip/unskip of a date answers `conflict` (schedule `updatedAt` changed) rather than `dependents`; expected, noted for the screen text only.
- **O7 — QA27-01 also closes the older gap for schedule *creation* entries** (a11): paying the first occurrence of a newly created schedule now blocks undoing its creation, which F-02 alone did not cover.

---

## (d) Commands run and summary output

```
git -C /home/user/ALCANZA worktree add …/scratchpad/qa27/rev-finance ac993969352d062a688b4f4ab72f9f8d89ca7599   # HEAD is now at ac99396
ln -s /home/user/ALCANZA/node_modules …/scratchpad/qa27/rev-finance/node_modules
git log --oneline 21b4ed8..HEAD   # ac99396, fcfcdfe, 85b4a85, 7d7a23a, 150bb9e, 96f64fb
git show 96f64fb / 150bb9e / 7d7a23a / 85b4a85 / fcfcdfe / ac99396 (diffs read)
node -e "…float accumulation check…"   # spent float 9086419753209120, exact 9086419753209200, net −80 (pre-check for O1)

npx vitest run src/domain/review.qa27.finance.test.ts
  Test Files  1 failed (1)
       Tests  4 failed | 40 passed (44)      ← the 4 failures are b5, b6 (F1), c4 (F2), c7 (O1), all pre-labelled
npx vitest run src/domain/review.tmp.test.ts   # throwaway debug run (deleted afterwards): r3.skippedDates ['2027-06-28'];
                                               # weekly observations [spendingSame] at −166 %; periodSummary net −80
npx tsc -b            # exit 0 (the new test file type-checks with the project's test tsconfig)
npx oxlint src/domain/review.qa27.finance.test.ts   # no findings
npx vitest run src/domain/qa27Undo.test.ts src/domain/qa27Snooze.test.ts src/domain/qa27Percent.test.ts src/domain/qa27Duplicates.test.ts src/domain/qaLead.test.ts src/domain/qaFollowUp.test.ts
  Test Files  6 passed (6) · Tests  75 passed (75)
git status --short    # ?? src/domain/review.qa27.finance.test.ts   (only my file; nothing else changed, nothing committed)
```

Not run (per brief): Playwright, `npm run build`, `npm run size`.
