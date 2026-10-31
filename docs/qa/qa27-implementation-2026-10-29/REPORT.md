# QA27 implementation pass — 2026-10-29 (PR #15, branch `claude/margen-personal-finance-app-cdvrt3`)

Audited commit: `21b4ed8594d8a20e96a2cfc8cb85637f9bef27bc` (HOLD: one P1 and three P2). Previous audited commit:
`46fe617b98c93902751bcf1949b226adfed65dce`. This pass reproduced each finding on the audited commit, fixed them in one
commit per finding inside an isolated implementation worktree, had three independent reviewers (generic agents acting
as the financial, security/storage and browser QA reviewers: the repository defines no CLARA-specific agents under
`.claude/agents/`) devise their own cases, and froze one SHA for the final verification. Nothing was pushed, merged,
published, deployed or written to GitHub; PR #15 still points at `21b4ed8`.

## 1. Exact baseline, tested implementation SHA and final SHA

- Checkout found in this session: a fresh container at `a23b135` (the base of `main`) with the local branch stale; the
  remote branch `origin/claude/margen-personal-finance-app-cdvrt3` was at `21b4ed8` (the audited commit) and the
  branch was fast-forwarded to it with a clean tree before any work (`git merge --ff-only`). No change beyond the audited
  commit existed on the remote branch.
- Implementation worktree: `impl/qa27` created from `21b4ed8`; the main checkout stayed at `21b4ed8` untouched as the
  baseline for the performance comparison. Commits (chronological): `96f64fb` QA27-01, `150bb9e` QA27-02, `7d7a23a`
  QA27-03, `85b4a85` QA27-03b (lead finding, see §2), `fcfcdfe` QA27-04, `ac99396` (tests only: the browser spec seeds
  each case with its own clock); then, from the independent reviews of `ac99396` (§8): `368a02b` F1 (repair pairing
  window), `d3554fa` F2/O2 (weekly «lo mismo», no `-0`), `6046b93` Statistics future balance out of range (browser
  review), `b6fcb69` F-1 (trash restore guard), `229228c` F-2 (card re-reads `updatedAt`).
- **Tested implementation SHA (frozen for the final verification): `dfdcfdaa0803179983cc8168059f91de4dff24f6`** (`git status` at the start of the chain:
  M AGENTS.md | ?? docs/qa/qa27-implementation-2026-10-29/).
- **Final SHA (documentation only, made after the verification): the child of `dfdcfda` on the branch, titled «QA27
  pass: report, evidence and AGENTS.md row (documentation only)»** — this report, its evidence and the `AGENTS.md`
  row; no application, test or dependency file changes. Its hash is given in the handoff; `git log -1` shows it. The
  tested SHA is its parent.
- Two chain runs happened: the first at `229228c` (`evidence/final-229228c/`) failed exactly one browser test on the
  three projects, the follow-up pass's own F-02 case, which still asserted the pre-QA27-01 wording of the undo refusal
  («…un programado que este cambio eliminaría»); the screen behaved as required. `dfdcfda` updates that expected
  substring (tests only) and the whole chain was run again at `dfdcfda` (`evidence/final/`): that run is the one
  reported in §5–§6.

## 2. Per-finding disposition

| Id | Severity | Disposition | Where |
|---|---|---|---|
| QA27-01 undo after payment makes the paid bill pending again | P1 | **Fixed** (`96f64fb`): `revertDependents` compares settlements between the current and the candidate state; a realized payment or receipt (final, partial, early, on the date or auto-confirmed) linked to an occurrence that resolves today and would not resolve after the undo (removed id, or same id with another anchor, rule, start or end) is a dependent of kind `payment`; `canRevert` → `dependents`, `revertEntry` refuses without mutating. Covers in-place and partitioned repairs and ordinary «desde una fecha» splits (the gap existed since `46fe617`). The browser fixture keeps $980.00; the 562,75 fixture keeps 562,75. | `src/domain/historyRevert.ts`, `src/ui/screens/History.tsx`, i18n ×4 |
| QA27-02 repair loses snoozes when the date stays the same | P2 | **Fixed** (`150bb9e`): a snooze follows its occurrence (segment id and usual date) whenever the mapped date exists on that segment, with `until`/`at` intact; unmappable ones stay inert; no duplicate ids. The 28-feb-2027 reminder stays snoozed until 5-mar. | `src/domain/splitRepair.ts` |
| QA27-03 safe totals can still crash Analysis | P2 | **Fixed** (`7d7a23a`): `checkedPercentChange(current, previous)` works from the operands with BigInt (exact −200 %), `checkedSubMinor` gives the difference or `null`; Analysis omits the «difference» row when it does not fit; Statistics and the weekly review carry `diffMinor: null` and say so; 9 900 % exact, ±9.99/±10 symmetric, zero base never divides. | `src/domain/money.ts`, `analysis.ts`, `statistics.ts`, `weeklyReview.ts`, `src/ui/screens/Statistics.tsx`, `WeeklyReview.tsx`, i18n ×4 |
| QA27-03b inbox out of memory with thousands of identical same-day movements (lead finding) | P2 (pre-existing at `21b4ed8`) | **Fixed** (`85b4a85`): found while verifying QA27-03 in the browser with the audit's own fixture shape; `possibleDuplicates` produced every pair within ±3 days (12.5 million for 5 000 identical) and the tab crashed as soon as the inbox was computed. Each group (same kind, account, amount) now yields at most 50 pairs in a fixed order; below the cap nothing changes. | `src/domain/inbox.ts` |
| QA27-04 repair proceeds without its promised backup | P2 | **Fixed** (`fcfcdfe`): `kept`, `failed` and `unavailable` handled distinctly; without a kept local copy nothing is restored unless a file copy was downloaded from the card for the data exactly as they are (`updatedAt` unchanged since the download); the card says so when the browser keeps no local copies; refusal leaves schedules, transactions, history and storage intact; repeated activation cannot apply the repair twice. | `src/ui/screens/settings/SplitRepairCard.tsx`, i18n ×4 |
| Review F1 (financial): the repair pairs the last date of its 400-day window with nothing, so a skipped date in that period is lost and a linked planned expense blocks the repair | P2 (pre-existing in `repairPlan`, from the lead pass) | **Fixed** (`368a02b`): the usual-date series is enumerated 31 days past the window and cut to the same length, so every date of the window has its pair; preview, segments, payments and snoozes unchanged. | `src/domain/splitRepair.ts` |
| Review F2 (financial): the weekly review says «gastaste lo mismo» when the difference does not fit an exact figure (introduced by QA27-03) | P3 | **Fixed** (`d3554fa`): «lo mismo» only with a difference of exactly 0; with `diffMinor: null` no spending observation is added (the comparison line already states it). | `src/domain/weeklyReview.ts` |
| Review O2 (financial): `checkedPercentChange` returns `-0` for a decrease under 1 % | cosmetic | **Fixed** (`d3554fa`): returns `0`. | `src/domain/money.ts` |
| Review (browser): Statistics falls into «No se pudo abrir esta pantalla» with audit-scale amounts | P2 (pre-existing at `21b4ed8`) | **Fixed** (`6046b93`): `futureBalance` projected 91 days without `stopWhenOutOfRange`, so `projectBalance` threw «Desbordamiento al sumar importes» once the projected balance left the exact-integer range (4 520 expenses of 999 999 999 999 in the last month → ≈3.8 × 10¹⁴ per day). The three projections now stop when out of range and the chart is replaced by «El saldo futuro a 90 días no cabe en una cifra exacta con estos importes» (`reason: 'outOfRange'`, es/en/pt/fr); totals and the exact comparison of QA27-03 were already right. | `src/domain/statistics.ts`, `src/ui/screens/Statistics.tsx`, i18n ×4 |
| Review F-1 (security/storage): the QA27-01 guard can be bypassed through the trash (pay → trash the payment → undo the repair → restore the payment) | P3 (pre-existing) | **Fixed** (`b6fcb69`): `restoreFromTrash` refuses with `occurrenceMissing` (date and schedule name; es/en/pt/fr explain what to do) while the schedule exists without that date; a deleted schedule keeps its payments, which still restore; `restoreFromTrashMany` stays all-or-nothing. | `src/domain/operations.ts`, `src/domain/validation.ts`, i18n ×4 |
| Review F-2 (security/storage): the card compared the downloaded copy with an `updatedAt` read before awaiting the local copy | P3 (theoretical) | **Fixed** (`229228c`): `updatedAt` is re-read after the await, right before the repair. | `src/ui/screens/settings/SplitRepairCard.tsx` |

## 3. Root causes and relevant changed files

- QA27-01: `revertDependents` returned early unless the entry created a schedule, and then only scanned templates,
  scenarios, goals and snoozes for ids that would disappear. Settlements (`transactions` with `scheduleId` +
  `occurrenceDate`) were never compared, and a same-id change of anchor, rule, start or end was invisible to it.
  Changed: `src/domain/historyRevert.ts` (settlement comparison; `RevertDependent` gains kind `payment` and
  `amountMinor`, both computed, never persisted), `src/ui/screens/History.tsx` (the line «Pago registrado para el
  {fecha} ({importe})»), `src/i18n/{es,en,pt,fr}.ts` (`history.dependent.payment`, wording of
  `history.dependents_*`/`issue.revertDependents`), docs.
- QA27-02: the snooze remap in `repairSplit` retargeted only when `remap(date) !== date`, so a partition (new id) with a
  coincident date kept the ended segment's id. Changed: `src/domain/splitRepair.ts` (retarget when the mapped date
  exists on the segment that carries it; dedupe by id keeping the later `until`).
- QA27-03: `current − previous` was computed as a Number before the checked helper; `checkedMulDivFloor` then threw on a
  non-safe integer. Changed: `src/domain/money.ts` (`checkedPercentChange(current, previous)` with BigInt from the
  operands; `checkedSubMinor`), `src/domain/analysis.ts`, `src/domain/statistics.ts` (`Delta.diffMinor: number | null`),
  `src/domain/weeklyReview.ts` (`WeekChange.diffMinor: number | null`), `src/ui/screens/Statistics.tsx`,
  `src/ui/screens/WeeklyReview.tsx`, i18n `weekly.noDifference`, docs.
- QA27-03b: `possibleDuplicates` is quadratic in the number of same-amount movements within ±3 days. Changed:
  `src/domain/inbox.ts` (`DUPLICATE_PAIRS_PER_GROUP = 50`), docs.
- QA27-04: `SplitRepairCard` blocked only `failed`. Changed: `src/ui/screens/settings/SplitRepairCard.tsx`
  (`exportedFor` gate, note, confirmation variant), i18n `splitRepair.copyUnavailable`, `copyUnavailableNote`,
  `confirmTextNoLocalCopy`, docs.
- Review F1: `repairPlan` cut both series at `until` and paired by index; the usual date is never earlier than the moved
  date of its period, so the pair of the last date inside the window could lie after `until` and `remap` returned the
  moved date unchanged. Changed: `src/domain/splitRepair.ts` (`PAIR_SLACK_DAYS = 31`, the proposed series is cut to
  `current.length`), docs (FORMULAS §44, CLAUDE.md).
- Review F2/O2: the `else` branch of the weekly observations treated `diffMinor === null` as «lo mismo»; `-magnitude`
  with magnitude 0 is `-0`. Changed: `src/domain/weeklyReview.ts`, `src/domain/money.ts`, docs (FORMULAS §20, CLAUDE.md).
- Review (browser): `futureBalance` called `projectBalance` three times without `stopWhenOutOfRange` (the calendar is the
  only caller that used it). Changed: `src/domain/statistics.ts` (`reason: 'outOfRange'`), `src/ui/screens/Statistics.tsx`
  (the hidden-chart note picks the reason), i18n `stats.futureOutOfRange` ×4, docs (FORMULAS §35, CLAUDE.md). The other
  `projectBalance` callers (Projection, Analysis, shortfall, scenarios, affordability: 30 days) do not overflow with the
  audit fixture; they share the mechanism and are listed under §9.
- Review F-1: `restoreFromTrash` checked only that no OTHER realized movement settles the same occurrence, never that the
  occurrence still exists. Changed: `src/domain/operations.ts` (guard with `occurrencesBetween`, the same test the undo
  guard uses), `src/domain/validation.ts` (`occurrenceMissing`), i18n `issue.occurrenceMissing` ×4, docs (FORMULAS §12,
  CLAUDE.md).
- Review F-2: `SplitRepairCard.restore` kept the pre-await snapshot. Changed: `src/ui/screens/settings/SplitRepairCard.tsx`,
  docs (FORMULAS §44).

## 4. Before/after reproduction evidence

- Before (on `21b4ed8`, same application sources as the worktree's first state): `evidence/unit-qa27-before-21b4ed8.txt`
  — the reproduction file (now split into `src/domain/qa27Undo.test.ts`, `qa27Snooze.test.ts`, `qa27Percent.test.ts`)
  fails 10 of 15 cases: every QA27-01 undo returns `ok` instead of `dependents` (the browser fixture gives 980 before
  and 560 after the undo; the 562,75 fixture gives 425,50), the coincident-date snooze keeps the ended id, and both
  QA27-03 fixtures throw `checkedMulDivFloor requiere enteros…`. The five passing cases are the invariants that already
  held (no dependent work → undo allowed; already-unresolved payment ignored; changed-date snooze; in-place same-date;
  9 900 % and the threshold symmetry).
- QA27-03b before: `evidence/statistics-crash-probe.spec.ts.txt` is the probe run on the worktree AND on the main
  checkout at `21b4ed8` (its own build): 2 000 + 2 000 identical same-day movements and 10 000 spread movements render
  Statistics in ≈400 ms; 5 000 + 5 000 identical same-day movements crash the renderer («Target crashed») on both. A
  Vitest probe of `inboxView` with that fixture ends with `FATAL ERROR: Reached heap limit`; the cause is the pair
  enumeration in `possibleDuplicates`.
- QA27-04 before: by reading (`keepCopyBeforeReplace` → `unavailable` without IndexedDB; the card blocked only
  `failed`) and by the browser test written before the fix, which fails at the refusal step on the audited code path.
- Review-driven findings, before (on `ac99396`, in the implementation worktree before each fix): the regression files
  written for them fail exactly on the reported behaviour — `qa27SplitWindow.test.ts`: the skipped 28-jun-2027 stays
  `['2027-06-28']` after the repair, the linked planned expense is refused with `splitLinkedGoal {date: 2027-06-28}`,
  the far skipped date stays `2028-01-28`; `qa27Percent.test.ts`: the null-difference week lists `spendingSame`,
  `Object.is(checkedPercentChange(9999, 10000), 0)` is false; `qa27FutureBalance.test.ts`: `futureBalance` throws
  `RangeError: Desbordamiento al sumar importes` (the browser reviewer's trace shows the same error from
  `projection-*.js` inside the Statistics `useMemo`, and its 3F diagnostic lists `/estadisticas` and
  `/estadisticas?periodo=month&fecha=2026-10-22` as the only broken routes); `qa27Trash.test.ts`: the restore succeeds
  and leaves the payment pointing at a 31-mar the series no longer has (560,00 available with 420,00 paid). The
  reviewers' own files re-run on the fixed head: `evidence/reviewers/reviewer-tests-on-229228c.txt` (their F1/F2 cases
  now pass; their O1 case still fails as documented in §9; the security A8 case, which asserted the bypass state, now
  fails because the restore is refused).
- After: the unit files above pass (see §6), the browser spec `tests/e2e/qa27.spec.ts` passes on the three projects
  before freezing (`evidence/e2e-qa27-*-working-tree.txt`) and in the final chain (`evidence/final/`), with screenshots
  in `evidence/final/shots/`.

## 5. Regression tests and measurable acceptance results

- `src/domain/qa27Undo.test.ts` (10 cases): browser fixture 980 → refused, unchanged after reload and backup round trip;
  562,75 fixture; on-date payment and automatic confirmation; partial receipt; partitioned repair; ordinary split;
  undo without dependents stays possible and an unrelated later movement survives; already-unresolved payment ignored.
- `src/domain/qa27Snooze.test.ts` (4): coincident date → new id with `until`/`at` intact, inbox view still snoozed,
  reload, backup round trip and undo restore; changed date; in-place with same and changed dates; paid and unmappable
  dates stay.
- `src/domain/qa27Percent.test.ts` (3): both independent fixtures (Analysis usable with −200 % and no unsafe row;
  Statistics and weekly review with `diffMinor: null` and −200); 9 900 %, threshold symmetry, zero base.
- `src/domain/qa27Duplicates.test.ts` (2): 50 pairs per group, stable, inbox in under a second; small groups unchanged.
- `src/domain/qaLead.test.ts` helper boundaries moved to the operand signature (adds the −200 % operands and the exact
  limit one unit beyond).
- `src/domain/qa27SplitWindow.test.ts` (4, review F1): preview unchanged; the skipped 28-jun-2027 → 30-jun-2027 and the
  undo restores it; a linked planned expense in that period follows the repair; a period earlier and far beyond the window.
- `src/domain/qa27Percent.test.ts` (+3, review F2/O2): a week whose difference does not fit → −200 % and no
  more/less/same observation; exact 0 → «lo mismo»; no `-0`.
- `src/domain/qa27FutureBalance.test.ts` (2, browser review): 4 520 expenses of 999 999 999 999 → no exception,
  `outOfRange`, totals and comparison intact; 452 → the 91-point curve.
- `src/domain/qa27Trash.test.ts` (4, review F-1): pay → trash → undo the repair → restore refused with
  `occurrenceMissing` and nothing changes; redoing the repair allows the restore; a deleted schedule keeps and restores
  its payment; all-or-nothing batch; the state the guard prevents (560,00) documented.
- `tests/e2e/qa27.spec.ts` (7 tests × 3 projects): repair → pay in the calendar → History refuses with the payment line
  and no «Revertir» → $980.00 after reload; the 28-feb-2027 reminder still under «Pospuesto (1)» after the partition;
  −200 % in Analysis and Statistics standing with 10 000 movements; repair without IndexedDB refused (localStorage
  byte-identical) then allowed after the download; backups store rejecting writes → refused then allowed after the
  download; with IndexedDB the «Antes de restaurar» copy is listed and restores the pre-change state; Statistics with
  4 520 expenses of 999 999 999 999 shows the out-of-range note on both routes instead of the error screen.
- Measurable at the frozen SHA: JS inicial: 844.3 KB en 13 archivos (gzip 253.1 KB); Referencia: 767.8 KB · límite 844.6 KB · cambio +10.0 % (budget unchanged, not raised). 10 000-movement startup inside the full matrix (2 workers; two reloads, the test asserts the better one < 500 ms): celular 511 / 390 ms; celular-pequeno 443 / 354 ms; escritorio 646 / 504 ms. Serial desktop A/B, 3 alternating rounds, first/second figure: baseline 21b4ed8 mean 325 / 258 ms [340, 337, 297]/[267, 261, 245], frozen build mean 329 / 258 ms [285, 390, 311]/[233, 277, 264]; all under the 500 ms limit. Browser matrix (expected / unexpected / flaky / skipped): celular (375, 0, 0, 1); celular-pequeno (376, 0, 0, 0); escritorio (372, 1, 0, 3). The one unexpected result on escritorio is `performance-10k.spec.ts` (best of two reloads 646 / 504 ms, i.e. 504 ms against the 500 ms limit) with two workers sharing the CPU during the full project; the application code is identical to `229228c`, where the same matrix passed it at 362 ms. Recorded next to it, never in its place (`evidence/final/rerun-escritorio/`): three serial runs of that spec alone on the same frozen build and preview, 294 / 258, 306 / 272 and 376 / 264 ms (best 258, 272, 264), and a second full escritorio run with the same CI settings: 373 passed, 3 skipped, 0 unexpected, 0 flaky, the perf test at 701 / 454 ms. The serial A/B (3 rounds, nothing else running) is the isolated comparison the brief asks for: baseline `21b4ed8` best-of-two 267, 261, 245 ms against the frozen build 233, 277, 264 ms.

## 6. Verification commands and results

```
Final verification at dfdcfdaa0803179983cc8168059f91de4dff24f6

SHA dfdcfdaa0803179983cc8168059f91de4dff24f6 · git status at start: 2 entries (M AGENTS.md | ?? docs/qa/qa27-implementation-2026-10-29/)
started 2026-10-31T00:53:31Z · finished 2026-10-31T01:44:29Z

== Each commit of this pass on its own (temporary worktree: tsc -b, oxlint ., vitest run)
150bb9e: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1132 passed | 1 skipped (1133)
229228c: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1150 passed | 1 skipped (1151)
368a02b: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1141 passed | 1 skipped (1142)
6046b93: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1146 passed | 1 skipped (1147)
7d7a23a: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1135 passed | 1 skipped (1136)
85b4a85: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1137 passed | 1 skipped (1138)
96f64fb: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1128 passed | 1 skipped (1129)
ac99396: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1137 passed | 1 skipped (1138)
b6fcb69: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1150 passed | 1 skipped (1151)
d3554fa: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1144 passed | 1 skipped (1145)
dfdcfda: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1150 passed | 1 skipped (1151)
fcfcdfe: tsc exit 0 · oxlint exit 0 · vitest exit 0 · Tests  1137 passed | 1 skipped (1138)

== Steps at HEAD
check EXIT 0
build EXIT 0
size EXIT 0
audit EXIT 0
vitest --reporter=json EXIT 0
e2e celular EXIT 0 · shots celular EXIT 0
e2e celular-pequeno EXIT 0 · shots celular-pequeno EXIT 0
e2e escritorio EXIT 1 · shots escritorio EXIT 0
DONE

== npm run check (typecheck, oxlint, i18n literals, Vitest)
Test Files  117 passed (117)
Tests  1150 passed | 1 skipped (1151)
> node scripts/find-literals.mjs
find-literals: sin texto visible fuera de i18n en src/ui.
vitest.json: 394 files, 1150 passed, 0 failed, 1 skipped, success=True

== npm run build (identified build)
✓ 231 modules transformed.
✓ built in 1.04s
dist id (sha256 of the sorted sha256 list of every dist file): cd55ba978f565e65e7ae7cc0edd3ec4d3320bf2049c5415c2ac364c9f6667574 · 75 files

== npm run size
JS inicial: 844.3 KB en 13 archivos (gzip 253.1 KB)
Referencia: 767.8 KB · límite 844.6 KB · cambio +10.0 %

== npm audit --audit-level=high
found 0 vulnerabilities

== Playwright, full matrix, one project at a time, --workers=2 --fail-on-flaky-tests, --reporter=list,json, one preview of the build above
-- celular
1 skipped
375 passed (11.2m)
Inicio con 10k: cifra principal a los 511 / 390 ms
e2e-celular.json: expected=375 unexpected=0 flaky=0 skipped=1 duration=674s
-- celular-pequeno
376 passed (10.9m)
Inicio con 10k: cifra principal a los 443 / 354 ms
e2e-celular-pequeno.json: expected=376 unexpected=0 flaky=0 skipped=0 duration=654s
-- escritorio
1 failed
3 skipped
372 passed (11.9m)
1) [escritorio] › tests/e2e/performance-10k.spec.ts:25:1 › 10 000 movimientos: Inicio interactivo en < 500 ms y Movimientos con solo las filas visibles
Inicio con 10k: cifra principal a los 646 / 504 ms
50 |   console.log(`Inicio con 10k: cifra principal a los ${times.map(Math.round).join(' / ')} ms`)
e2e-escritorio.json: expected=372 unexpected=1 flaky=0 skipped=3 duration=713s

== Screenshot runs (qa27, qa-lead, qa-followup, qa-corrective; --workers=1; QA_LEAD_SHOTS)
-- celular: 31 passed (1.6m)
-- celular-pequeno: 31 passed (1.5m)
-- escritorio: 31 passed (1.6m)
111 screenshots in shots/

== Serial A/B, desktop, 10k startup: audited baseline build (21b4ed8) vs frozen build (3 rounds, alternating)
perf A/B started 2026-10-31T01:43:54Z; serial, nothing else running; old = 21b4ed8 (main checkout), new = dfdcfda

✓ built in 1.04s
--- round 1 old (http://localhost:4174)
Inicio con 10k: cifra principal a los 340 / 267 ms
  1 passed (4.1s)
--- round 1 new (http://localhost:4173)
Inicio con 10k: cifra principal a los 285 / 233 ms
  1 passed (4.2s)
--- round 2 old (http://localhost:4174)
Inicio con 10k: cifra principal a los 337 / 261 ms
  1 passed (4.2s)
--- round 2 new (http://localhost:4173)
Inicio con 10k: cifra principal a los 390 / 277 ms
  1 passed (4.1s)
--- round 3 old (http://localhost:4174)
Inicio con 10k: cifra principal a los 297 / 245 ms
  1 passed (4.0s)
--- round 3 new (http://localhost:4173)
Inicio con 10k: cifra principal a los 311 / 264 ms
  1 passed (4.3s)
finished 2026-10-31T01:44:29Z

== Escritorio re-measurement on the same frozen build (evidence/final/rerun-escritorio/, serial, nothing else running)
performance-10k.spec.ts alone, --workers=1, 3 runs: 294 / 258 ms · 306 / 272 ms · 376 / 264 ms (each 1 passed)
full escritorio project again, --workers=2 --fail-on-flaky-tests: 373 passed, 3 skipped, 0 unexpected, 0 flaky (11.8 min); perf 701 / 454 ms

== First chain run at 229228c (evidence/final-229228c/verification-229228c.txt): identical steps; every exit 0 except the
== browser matrix and the screenshot runs, each with the single F-02 assertion failure described in §1 (374/375/372 passed,
== 1 failed on each project; perf 426 / 342, 388 / 362, 585 / 362 ms; size 844.3 KB; A/B old 284/281, 313/310, 313/282 vs
== new 318/264, 303/247, 328/314 ms).
```

## 7. Migration, backup, recovery and undo analysis

- `SCHEMA_VERSION` stays 14; no migration, no data-format change; `migrations.ts`, `types.ts`, `backup.ts`, both
  repositories and `src/state` are byte-identical to `21b4ed8`. `RevertDependent.kind: 'payment'` and `amountMinor` are
  computed on demand and never stored.
- Backups written by `21b4ed8` after a repair and a payment import into the frozen SHA and the undo is refused the same
  way (unit: `qa27Undo.test.ts` round trip); backups written by the frozen SHA contain nothing new.
- Undo: a refused undo changes nothing (JSON-identical data in every unit case; storage byte-identical in the browser
  cases). What is still allowed: undoing a repair or split with no later payment on the affected occurrences; undoing
  the payment itself (its entry removes the payment, so nothing dangles); undoing with unrelated later movements. The
  person who wants to undo a repair after paying has to unlink or delete that payment first, and the History screen
  names it with its date and amount.
- Recovery copy before a repair: with IndexedDB, `LocalBackups.save` commits before the repair writes (unchanged); without
  it, the downloaded file is the copy and the card only proceeds while the data have not changed since the download,
  compared against the store right before the repair (review F-2).
- Trash: restoring a payment whose schedule still exists but no longer has that date is refused (`occurrenceMissing`),
  so the undo guard cannot be bypassed through the trash; the refused restore changes nothing, the entry stays in the
  trash, and redoing the schedule change (or reverting it from the history) makes the restore possible again. A deleted
  schedule keeps its payments and they restore as before. No migration touches existing trash entries.
- QA27-03b changes which inbox items exist for pathological groups (at most 50 pairs per group); dismissals and snoozes
  of pairs keep their ids and fingerprints because the first 50 pairs are chosen in a fixed order.

## 8. Independent reviewer findings and their resolution

Three generic agents acted as independent, read-only reviewers of `ac99396` in their own worktrees (the repository
defines no CLARA-specific agents under `.claude/agents/`); each devised its own cases with hand-computed expectations
before running anything. Their reports and test code are under `evidence/reviewers/`; the lead reproduced every
reported defect with its own regression test before changing code, and re-ran the reviewers' files on the fixed head
(`evidence/reviewers/reviewer-tests-on-229228c.txt`).

- **Financial/recurrence reviewer** (`finance/review-finance.md`; `review.qa27.finance.test.ts`, 44 cases: 40 pass, the
  4 failures were labelled as suspected defects before the first run). 17 QA27-01 cases (early/on-date/late payments,
  auto-confirmation, partial receipts, skip-then-pay, plain «todas» edits, creation/deletion, end extension, relink,
  quarterly, yearly 29-feb, semimonthly) and 7 QA27-02 cases hold; QA27-03 holds for Analysis and Statistics; the
  duplicate cap holds (6 cases incl. 10 000 identical in ≈50 ms); 7 preservation cases on the genuine v13 backup hold.
  Findings: **F1 (P2)** the repair loses a skipped date (and refuses a linked planned expense) in the last period of
  its comparison window → fixed `368a02b`; **F2 (P3)** the weekly review says «gastaste lo mismo» when the difference
  does not fit → fixed `d3554fa`; **O2** `-0` → fixed `d3554fa`; **O1** (P3 candidate) `periodSummary` accumulates each
  category in floats, so ≥ 9 008 near-maximum movements in one category and period round silently (net −80 instead
  of 0) → not fixed in this pass (§9); **O3** three `x * 100` comparisons on money (`inbox.ts`, `goalMilestones.ts`,
  `plans.ts`) are inexact only when the comparison is already true by a wide margin → left, noted; **O4** duplicate-cap
  semantics (the listed set shifts when an earlier same-amount movement arrives; per group, not per cluster) → already
  documented in FORMULAS §24; **O5–O7** confirmations (dependents in transaction order with the current date; conflicts
  checked before dependents; the guard also covers schedule creation). On `229228c` its file passes 43/44 (O1 remains).
- **Security/storage reviewer** (`security/review-security.md`; `review.qa27.security.test.ts` 21 cases and
  `review.qa27.storage.test.ts` 12 cases, all passing at `ac99396`; helper copies of the audited commit's
  `splitRepair`/`historyRevert`/`validation` to produce and validate data written by `21b4ed8`). Verified: refusal
  identical in memory, after reload, after `parseBackup` and after `migrate` of a v13-stamped copy; dependents are
  computed, never persisted; data written by `21b4ed8` import and are refused on the fixed code while `21b4ed8`'s own
  `canRevert` said `ok`; data written by the fixed code validate under `21b4ed8`'s validators; both repositories keep
  bytes identical on a refused undo; `LocalBackups.save` commits before the repair; `QuotaExceededError` stores nothing;
  `keepCopyBeforeReplace` distinguishes `unavailable`/`kept`/`failed`; `recordExport` never touches `updatedAt` while
  every data operation does; RT-02 undo semantics hold. Findings: **F-1 (P3, pre-existing)** the QA27-01 guard bypassed
  through the trash → fixed `b6fcb69`; **F-2 (P3, theoretical)** `updatedAt` snapshot taken before the await → fixed
  `229228c`. Observations left as documented limits (§9): O-1 export toast when the store itself cannot save, O-2
  `exportedFor` is component state (by design), O-3 wording when IndexedDB opens but fails, O-4 the import flow still
  proceeds on `unavailable` (REC-01 immediate undo), O-5 data already repaired by `21b4ed8` with a coincident snooze are
  not rewritten (the project's migration rule), O-6/O-7 dedupe and cap semantics, O-8 `ShortfallPlan`'s undo does not
  re-validate (its entries cannot produce the double-settlement case), O-9 History re-evaluates `canRevert` per shown
  entry (not measured), O-10 `sumMinor` throw paths beyond 2⁵³ are pre-existing. On `229228c` its files pass 32/33: the
  A8 case asserted the bypass state and now fails because the restore is refused.
- **Browser QA reviewer** (`browser/review-browser.md`; `review.qa27.spec.ts`, 15 tests with its own fixtures, names,
  amounts and clocks, run serially on celular 412 px, celular-pequeno 320 px and escritorio 1 280 px against its own
  build of `ac99396`, twice with identical results). Passing at the three widths: QA27-01 (partitioned repair paid from
  Pendientes, the History refusal line in es/en/pt/fr with the amount and no «Revertir», reload, export and import; an
  ordinary «Desde una fecha» split paid from the calendar, the payment undo and the split becoming revertible again; an
  in-place repair with an unrelated later movement that survives the undo), QA27-02 (coincident and changed snooze
  dates, «Pospuesto (1)» with the same «Hasta»), QA27-03 wherever Statistics renders (−200 % tile, Analysis «200 %
  menos» without the difference row, the weekly «la diferencia no cabe en una cifra exacta» in four languages with and
  without the percentage), QA27-03b (10 000 identical movements: main figure in 371 ms, 20 duplicate notices),
  QA27-04 (no-IndexedDB note and dialog wording, exact refusal toast, byte-identical `localStorage`, download gate per
  series, a later change requiring a new download, keyboard-only flow with focus returned to the button after Esc,
  computed contrast 7.58:1 light and 6.79:1 dark), and axe clean on every scanned screen. Finding: **R-1 (P2,
  pre-existing at `21b4ed8`, inside the QA27-03 claim)** Statistics fell into the error boundary when the 90-day
  projection left the exact range (its 3A, 3C and 3F cases on the three projects; console `RangeError: Desbordamiento
  al sumar importes` from the projection chunk inside the Statistics `useMemo`) → fixed `6046b93`; its spec re-run on
  the fixed head: 15 passed on celular and 14 passed + 1 skipped (its perf probe runs once) on celular-pequeno and escritorio, its 3A/3C/3F included (`browser/rerun-on-229228c/`). Observations left as documented (§9): O-1 a running balance beyond 2⁵³ − 1 on one
  account (> 90 trillion) sends Home to the same error boundary (pre-existing); O-2 the weekly review writes «(200%)»
  (Intl) while Statistics and Analysis write «200 %»; O-3 the error boundary's copy blames another tab or the
  connection, which misleads for an overflow; O-4 the «marcado como pagado» toast persists onto History. Not checked:
  devices, assistive technology, Firefox/WebKit, real pickers; the 3C en/pt/fr «Sin comparación» variants could not
  render at `ac99396` (strings verified by grep).
- **Unresolved disagreements:** none. Two reviewer observations were accepted as limitations rather than fixed (O1 and
  the `sumMinor` throw class, O-10), because the exact fix needs a nullable `periodSummary` through five screens and
  the data need ≥ 9 008 near-maximum movements in one category or window, reachable only by import.

## 9. Remaining risks and untested areas

- QA27-01 refuses rather than preserving settlement meaning through the undo: the person must act on the payment first.
  A future atomic design (undo that re-links payments to the restored occurrences) was not attempted: it would move
  money between occurrences without the person's confirmation.
- QA27-04's export-first path trusts a completed download request (`deliverFile` resolved) as the copy; a download the
  browser later discards cannot be detected by a web app.
- QA27-03b: more than 50 possible-duplicate pairs in one group are not listed; the cap is documented. The historical
  cause (thousands of identical same-day movements) is not a realistic manual-entry shape but is reachable by import.
- Not exercised: physical devices (iOS Safari, Android), assistive technology (VoiceOver, TalkBack), OS text scaling,
  native file pickers, real OCR and cameras, deployed builds, a real two-tab IndexedDB conflict, and the on-device PWA
  lifecycle. Playwright emulates the viewports; contrast is computed, not perceived.
- From the reviews: `periodSummary` accumulates each category in floats (O1) and `sumMinor` throws beyond 2⁵³ − 1
  (O-10; `estimateDailySpend`, `periodSummary` totals, `topMerchants`): with ≥ 9 008 near-maximum movements in one
  category, period or 30-day window (only by import; `validateAppData` accepts up to 500 000 movements of 10¹²) a
  figure can round silently or a screen can fall into the error boundary. The audit-scale fixtures (≤ 5 000 per
  month) stay below both. The other `projectBalance` callers (Projection, Analysis, shortfall, scenarios, affordability;
  30 days) do not overflow with the audit fixture but share the mechanism; `stopWhenOutOfRange` exists for them.
- The repaired Statistics screen omits the 90-day curve when any of the three projections leaves the exact range (it does
  not draw it up to the last exact day); the note says why.
- The trash guard (`occurrenceMissing`) refuses rather than unlinking: after a legitimate series change the person
  cannot restore a trashed payment until the date exists again (the message names the two ways: give the schedule the
  date back, or revert the change from the history).
- The import flow still proceeds when no local copy can be kept (`unavailable`), relying on the immediate undo (REC-01);
  the repair card no longer does. Data already repaired by `21b4ed8` with a coincident-date snooze keep the inert snooze
  under the old id (re-snooze once); no migration rewrites inbox ids.
- History re-evaluates `canRevert` (now a settlement scan) for each of the 30 shown entries on every render; not
  measured in this pass (the 10 000-movement budget covers Home only).

## 10. Release recommendation and remaining blockers

**Recommendation: lift the HOLD on PR #15 at the tested SHA (`dfdcfda`), subject to the auditor's re-audit.** The P1
(QA27-01) and the three P2 (QA27-02, QA27-03, QA27-04) are fixed and verified on the audited fixtures and on the
reviewers' independent ones; the two further P2 defects found on the way (QA27-03b inbox pair explosion, R-1 Statistics
overflow) and the P3 review findings are fixed as well; every commit of the pass passes typecheck, lint and the unit
suite on its own; the repository checks, the identified build, the size budget and the dependency audit are green at
the tested SHA; the full browser matrix (three widths, CI settings, no flaky retries) has no functional failure: its
single unexpected result is the 10 000-movement startup timing on escritorio under two-worker contention (504 ms
against 500), recorded in §5 with three serial re-measurements of the same build (258–272 ms), a second green
escritorio run (454 ms) and the serial A/B against `21b4ed8` (frozen build 233–277 ms, baseline 245–267 ms).

Remaining blockers: **none known in the audited scope.** Conditions and cautions for the release decision:

1. The repository suite passing is not the release criterion: the independent re-audit of the tested SHA (the
   auditor's own fixtures, including the reload and export/import paths it listed) is still due, and this report's
   §9 lists what this pass could not exercise (devices, assistive technology, Firefox/WebKit).
2. The initial-JS budget has 0.3 KB of headroom left (844.3 of 844.6 KB; the QA27 texts in four languages cost the
   rest). It is not raised; the next change that adds code to the initial bundle must trim elsewhere first.
3. Two reviewer observations are accepted as documented limits, not fixed: float accumulation in `periodSummary` and
   the `sumMinor`/projection overflow class beyond 2⁵³ − 1, reachable only with ≥ 9 008 near-maximum movements in one
   category, period or window (import only). They are outside the audited fixtures' scale and are listed in §9 with the
   intended fix (a nullable summary through its five screens).
4. Pushing the branch and updating PR #15 are external writes and were not done: they need the user's explicit
   authorization. The tested SHA and the documentation-only SHA are recorded in §1 so the auditor can tell them apart.
