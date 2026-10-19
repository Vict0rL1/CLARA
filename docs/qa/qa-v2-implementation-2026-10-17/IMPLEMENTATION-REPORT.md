# QA V2 + PR #15 independent audit — implementation report

Branch `claude/margen-personal-finance-app-cdvrt3` · 2026-10-17 · audited head `819eaa9` (QA V2 candidate `43b4d74`,
base `main` = `a23b135`).

**Verified SHA: `23c202157ab1879f0eb021e45237d275fa8a061a`** (`23c2021`, tree `4912bda8…`; every command in §6 ran at
that commit). This report and the logs it cites are committed on top of it as a docs-only commit (no product code).
**Nothing was pushed, merged, published or deployed, and PR #15 was not updated**: the commits in §1 exist only in the
working clone until the user authorizes a push.

## 1. Commits (local, in order)

| SHA | Finding(s) | Files |
|---|---|---|
| `6280373` | QA V2: CUR-01, CUR-02, CUR-03, FIN-01, STAT-01, SCH-01 (first version), CI | 64 |
| `4679bb9` | PR #15 QA-02 — safety buffer blocks a currency change | 8 |
| `a720d19` | PR #15 QA-01 — a split keeps the series anchor (schema 14 `anchorDate`); supersedes SCH-01's second-day swap | 23 |
| `f99a93d` | PR #15 QA-05 — history records templates, scenarios and snoozes (atomic split undo) | 12 |
| `23c2021` | Browser acceptance QA-01/02/03/05, QA-04 criteria, evidence, AGENTS.md | 5 |
| `40eb75e` | This report (first version), the verification logs of §6 and the re-captured SCH-01 screenshots (docs only) | 22 |
| `e785381` … `a91d1bd` | Self-review follow-ups R1–R7, one commit each (§8) | — |
| `053f023` | §8 docs (CLAUDE.md, FORMULAS), evidence of the reproductions, this addendum | — |
| `3c9205d` | The re-verification logs of §8.2 (docs only) | — |
| `19597ea` … `4a0ee9b` | Second review of the follow-ups S1–S4 and the acceptance gaps (§8.3) | — |
| (next) | §8.3 docs and evidence; then the re-verification logs of §8.4 (docs only) | — |

Each of `4679bb9`, `a720d19` and `f99a93d` was checked on its own in a temporary worktree (`tsc -b`, `oxlint`, full
Vitest run; `evidence/final-verify/worktree-*.txt`). That check is why the four commits were re-created once before
the final verification: the first cut of the QA-01 commit carried a duplicated i18n key at that intermediate commit
(its final tree was already identical, tree `4912bda8…`); the re-created commits differ only in that line.

## 2. What was and was not available

The QA V2 brief named a local branch (`codex/qa-v2-2026-10-15`), a patch, reports, probes and an `evidence/` folder;
the PR #15 brief named `QA-REPORT.md`, `independent-regression-probes.test.ts` and `independent.config.mjs` plus a
`/Users/...` checkout, `.claude/agents/` and `.claude/CLARA-TEAM.md`. None of these exist in this environment (the
`docs/QA-REPORT.md` in the tree is the older Fase 12 report). So no agent roles were delegated and no results from
those artifacts are quoted: every finding was reproduced here, from its description, through the public domain
operations or the browser, before any code changed (`evidence/repro-*.json`, `evidence/unit-*-before-819eaa9.json`,
`evidence/e2e-qa-v2-before-819eaa9.txt`). Synthetic data only.

## 3. Findings — status, root cause, fix, evidence

Severities are the auditors'. «Before» = the audited head `819eaa9`; «after» = the final SHA.

### QA V2 (candidate `43b4d74`)

| ID | Status | Root cause (reproduced) | Fix | Failing before → passing after |
|---|---|---|---|---|
| CUR-01 (P1) | Fixed | The assistant read only the mark adjacent to the amount: «coffee USD $10» registered 10 CAD and lost USD (`repro-before-819eaa9.json` → `cur01`: `foreignCurrency: null`; the same on `main`, `repro-main-a23b135.json`). | One reader in `money.ts`: all marks around the amount (up to two per side) and the explicit ones elsewhere in the line are collected and reconciled (`reconcileMarks`): a specific code constrains a generic symbol (USD $10 → USD, $10 CAD → CAD), repeats are harmless. The assistant keeps the written currency in the field (`withCurrencyMarks`) and blocks the line; nothing is converted. | `unit-contracts-before-819eaa9.json` (CUR-01 block: 6 failed) → `unit-contracts-after.json` 30/30; `e2e-qa-v2-before-819eaa9.txt` 21 failed / 3 passed → §6; `screenshots/before|after/cur01-assistant.jpg`. |
| CUR-02 (P1, also on `main`) | Fixed | Prefix and suffix marks were read separately and the last one won: «USD 10 CAD» was accepted as CAD 10 in manual amount fields, shortcuts and CSV (`repro-before-819eaa9.json` → `cur02`, `cur02csv`, `cur02assistant`). | Two incompatible marks are a `currencyConflict` in every consumer: amount fields (error names both), assistant (field keeps both marks, line blocked), CSV import (row error, never imported), shortcuts (amount left empty), receipts. Compatible or redundant marks still work (`10`, `CAD 10`, `10 CAD`, `$10`, `CAD $10 CAD`). | Same files; `screenshots/*/cur02-form.jpg`, `cur02-assistant-conflict.jpg`, `after/cur02-csv.jpg`. |
| CUR-03 | Fixed | Receipt totals read a currency code only when it was not a dictionary word: «TOTAL PEN 10.00» proposed 10.00 CAD (`cur03`). | Total/subtotal/tax/tip/tender lines take an adjacent code as the currency even when it is a word or an unsupported ISO code; item lines do not («PEN 2.99» stays a pen). Synthetic OCR text only. | Same files; `screenshots/*/cur03-receipt.jpg`. |
| FIN-01 | Fixed | 25 daily schedules of 10^12 minor units overflowed the recurring summary (products beyond 2^53 − 1) and Home crashed on `availableMinor * 100` (`fin01`; `before/fin01-home.jpg`). | `recurringCosts` computes with BigInt and returns `ok: false, reason: 'outOfRange'` (no total, no monthly figure, never clamped); the Calendar says so and its projection stops at the last exact day (`stopWhenOutOfRange` → `outOfRangeFrom`). Every «amount × k» before a division now goes through `mulDivFloor`/`mulDivCeil`/`checkedMulDivFloor` (heroFigures, analysis, weeklyReview, statistics, goalChart, cards). Stored data never changes. | Same files; `screenshots/*/fin01-calendar.jpg`, `after/fin01-calendar-beyond.jpg`; `evidence/calendar-month-timing.txt` (see §7). |
| STAT-01 | Fixed | Statistics' `go()` rebuilt the route without `desde`/`hasta`, so a custom range was lost on every filter, and the component was keyed by the full query. | The custom dates live in the route (`pathFor` carries `desde`/`hasta`); editing a date updates the URL quietly (`replaceRouteQuietly`); filters, reload, back/forward and a copied address keep the range. | `e2e-qa-v2-before-819eaa9.txt` → §6; `screenshots/*/stat01-filter.jpg`. |
| SCH-01 | Fixed (superseded) | Splitting a twice-monthly series from its second day left «30 and 30». | `6280373` swapped the second day onto the other nominal day and explained month-end drift; the PR #15 audit (QA-01) showed the root cause is the re-anchoring itself, so `a720d19` removed that mechanism and keeps the series anchor instead (below). | `unit-contracts-*`, `secondDay.test.ts`; `screenshots/*/sch01-split.jpg`, `after/sch01-month-end.jpg` (re-captured at the final SHA). |
| CI | Done | — | `npm audit --audit-level=high` gate; Vitest JSON (`test-results/vitest.json`) and Playwright JUnit + HTML artifacts uploaded on success and failure; `workers=2` and `--fail-on-flaky-tests` unchanged; CUR-01 is a `@smoke` case (`tests/config/smoke.test.ts` pins it). | `.github/workflows/ci.yml`, `playwright.config.ts`, `vite.config.ts`, `tests/config/*.test.ts`. |

### PR #15 independent audit (head `819eaa9`)

| ID | Status | Root cause (reproduced) | Fix | Failing before → passing after |
|---|---|---|---|---|
| QA-01 (P1, release blocker) | Fixed | `saveScheduleFrom` used the chosen date (`draft.startDate`) as the new recurrence anchor. Monthly Jan 31 split at Feb 28 → Mar 28, Apr 28; the audit's fixture (CAD 1 000 twice-monthly anchored Feb 15, CAD 900 one-time bill Mar 30, today Mar 20) moved the next income from Mar 31 to Mar 28, released the reservation and showed «Puedes gastar» 100 000 instead of 10 000 minor; twice-monthly 1 + 20 split at Oct 20 could not be saved («20 and 20»). `unit-pr15-before-819eaa9.json`: 9 QA-01 cases failed. | The change boundary (`startDate`) is separated from the recurrence anchor: `Schedule.anchorDate` (v14, optional, written only by a split that keeps the rule) fixes the day of month/phase; `startDate` is the lower bound. `nthOccurrence`/`scanOccurrences` step from `anchorOf(rule)`; `saveScheduleFrom` keeps the anchor when frequency/interval/second day are unchanged and the boundary is a series date (`sameRule`, `isSeriesDate`, `splitKeepsAnchor`), otherwise it re-anchors and the form says which happens. Validation, default second day and hints use the anchor. | `unit-pr15-after.json` 15/15 (`qaPr15Anchor.test.ts`: 28-feb → 31-mar/30-abr/31-may; available 10 000 / reserved 90 000; 29/30/31 across leap and non-leap; monthly/quarterly/yearly; both twice-monthly slots; skips, end dates, forward links, settled guards; reload and backup round trip). Browser: `qa-pr15.spec.ts` QA-01 (fixture through the form, second fixed clock on Mar 20, reload, export/import) and `qa-v2.spec.ts` SCH-01. |
| QA-02 (P2) | Fixed | `monetaryRecords` ignored `settings.safeToSpend.bufferMinor`: with only a buffer of 10 000 minor, CAD → JPY was allowed and relabelled CAD 100 as JPY 10 000; the same through a currency-changing history undo. 2 cases failed before. | `monetaryRecords` (the single guard used by the operation, Settings and history revert) counts a non-zero buffer as `safeToSpendBuffer`; Settings explains the reason and how to clear it (es/en/pt/fr); a zero buffer with nothing else still allows the change. | `qaPr15Currency.test.ts`; browser: `qa-pr15.spec.ts` QA-02 (refused, reload, exported backup unchanged, then allowed after clearing the buffer in «Colchón de seguridad»). |
| QA-03 (P2) | Fixed in `6280373` (STAT-01) | Same root cause as STAT-01 (`go()` omitted the dates). | As STAT-01. | Acceptance per the audit's criteria added in `23c2021`: `qa-pr15.spec.ts` QA-03 (seeded July totals `$223.45`/`$123.45`/`$100.00` after an account filter, «Quitar filtros», back/forward, reload and opening the copied address; the forecast says «El saldo futuro es de todas las cuentas del presupuesto»); runs on desktop, 412 px and 320 px. |
| QA-04 (P2, inherited from `main`) | Fixed in `6280373` (CUR-02) | `parseMoney('USD 10 CAD', 'CAD', 'es-MX')` was ok (`repro-before-819eaa9.json` and `repro-main-a23b135.json`). | As CUR-02 (manual fields, CSV, shortcuts, assistant, receipts). | `qaV2.test.ts` CUR-02 contradictions now include «EUR 10 CAD»; `qa-v2.spec.ts` CUR-01/02/03 cover assistant, form, CSV, shortcut and receipt in the browser. |
| QA-05 (P2) | Fixed | A split rewrites templates, scenarios and inbox snoozes, but history only diffed the financial collections: reverting deleted the new schedule and left `template.target`, `scenario.changes[].scheduleId` and `due:schedule:<id>:…` pointing at it. 3 cases failed before. | `HistoryCollection` adds `templates`, `scenarios` and `inboxSnoozed` (a view over `inbox.snoozed`) with the same before/after snapshots and conflict detection: revert restores everything atomically; a later edit to an affected template refuses with `revertConflict` and changes nothing; unrelated later changes survive; older entries without these collections stay revertible. | `qaPr15Undo.test.ts` (split → persist → reload → revert; conflict; unrelated changes; export/import); browser: `qa-pr15.spec.ts` QA-05 (history entry lists «Plantilla cambiada», «Escenario cambiado», «Aplazamiento»; «Revertir» puts every reference back). |

## 4. Migration and backup compatibility

- `SCHEMA_VERSION` 13 → 14 (`src/domain/types.ts`); migration `13: raw => ({ ...raw, schemaVersion: 14 })` is additive
  (no field to fill, nothing removed); `migrations.test.ts` covers v13 → v14 and the chain from older versions. The
  pre-migration copy `margen.data.before-v14` is kept (`tests/e2e/migration-main.spec.ts` with real schema 8 data
  from `main`, `backup-reminder.spec.ts` with v4 data; both now read the key from `SCHEMA_VERSION`).
- `anchorDate` is validated (valid calendar date, `≤ startDate`, never with `once`; issue `anchorAfterStart`) and
  whitelisted in `storage/backup.ts` (`SCHEDULE_KEYS`): without that line a restored backup silently dropped the
  anchor — caught by the QA-01 unit test's export/import round trip, fixed in `a720d19`.
- History entries may now name `templates`, `scenarios` and `inboxSnoozed`; `HISTORY_COLLECTIONS` and the backup
  validator accept them; entries written before v14 lack them and still revert (their diffs simply do not include those
  collections, which is the pre-fix behaviour for old entries only).
- Older builds refuse v14 data as «a newer version» instead of computing wrong dates (`docs/ROLLBACK.md`); data saved by
  13 opens in 14 unchanged. No stored amount, date or id is rewritten by any of the fixes.

## 5. Test additions

| File | Covers |
|---|---|
| `src/domain/qaV2.test.ts` | CUR-01/02/03, FIN-01, STAT-01 contracts, SCH-01 (anchor version), «EUR 10 CAD» |
| `src/ui/secondDay.test.ts` | second-day helpers use the series anchor |
| `src/domain/qaPr15Anchor.test.ts`, `qaPr15Currency.test.ts`, `qaPr15Undo.test.ts` | QA-01, QA-02, QA-05 through public operations |
| `src/storage/migrations.test.ts` | v13 → v14 |
| `tests/config/smoke.test.ts`, `tests/config/playwright-config.test.ts` | CUR-01 `@smoke`, CI reporters |
| `tests/e2e/qa-v2.spec.ts` | CUR-01 (`@smoke`), CUR-01/02, CUR-02, CUR-03 (×2), FIN-01, STAT-01, SCH-01 — three viewports |
| `tests/e2e/qa-pr15.spec.ts` | QA-01, QA-02, QA-03, QA-05 — three viewports |
| `tests/e2e/migration-main.spec.ts`, `backup-reminder.spec.ts` | pre-migration key from `SCHEMA_VERSION` |

No existing assertion was removed or weakened; the SCH-01 unit/e2e tests of `6280373` were rewritten in `a720d19`
because the behaviour they pinned (second-day swap, drift notice) was the mechanism the audit identified as the defect.

## 6. Verification at the final SHA

Run at `23c2021` on 2026-10-18, 02:02–02:34 UTC, in this cloud container (preinstalled Chromium via
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`), strictly sequential with nothing else running. Logs:
`evidence/final-verify/` (`verification.txt` is the summary; `e2e-*.txt` list every test).

| Step | Result |
|---|---|
| Per-commit worktree checks of `4679bb9`, `a720d19`, `f99a93d` (`tsc -b`, `oxlint`, `vitest run`) | all exit 0 · 1018 / 1025 / 1028 passed, 1 skipped each |
| `npm run check` (typecheck, oxlint, i18n literal check, Vitest) | exit 0 · 104 files, 1028 passed, 1 skipped (1029) |
| `npm run build` | exit 0 · 227 modules · build id `98be79c16e9775b421af52662f41ee5017da1cec74d7bbca95c5280eee3eb9e9` (sha256 of the sorted per-file sha256 list of `dist/`, 70 files: `dist-sha256.txt`) |
| `npm run size` | exit 0 · initial JS 842.0 KB in 11 files (gzip 252.0 KB) · limit 844.6 KB unchanged (+9.7 % over the 767.8 KB reference) |
| `npm audit --audit-level=high` | exit 0 · 0 vulnerabilities |
| Playwright `celular` (Pixel 7, 412 px) — `--workers=2 --fail-on-flaky-tests`, dedicated `--output`, one preview of the build above | exit 0 · 343 passed, 1 skipped, 0 failed, 0 flaky (9.3 min) |
| Playwright `celular-pequeno` (320 px) | exit 0 · 344 passed, 0 skipped, 0 failed, 0 flaky (8.6 min) |
| Playwright `escritorio` (1280 × 800) | exit 0 · 341 passed, 3 skipped, 0 failed, 0 flaky (9.4 min) |
| 10 000-movement main figure (`performance-10k.spec.ts`, budget < 500 ms on the better of two loads, as the test is written) | celular 358 / 409 ms · celular-pequeno 340 / 328 ms · escritorio 518 / 391 ms. The desktop first load was over budget and the second under; the test passed on its own rule and the result is kept as is. Additional evidence (not a replacement): the test alone, `--workers=1`, same build — 314 / 273, 274 / 262, 317 / 274 ms, 3 passed (`perf-10k-solo.txt`). |
| SCH-01 «after» screenshots (`celular`, `QA_V2_SHOTS`) | 1 passed · `screenshots/after/sch01-split.jpg`, `sch01-month-end.jpg` re-captured at this SHA |

Skips (all pre-existing conditions, none added or changed here): unit — `src/test/synthetic.test.ts` (1 of 2);
browser — `stabilization.spec.ts` «13 · texto al 200 % en 320 px» runs only on `celular-pequeno` (skipped on the
other two projects) and the two touch-swipe tests (`history-tools.spec.ts:39`, `stabilization.spec.ts:421`) run only
on touch projects (skipped on `escritorio`). No test was retried: `--fail-on-flaky-tests` would have failed the run.
Firefox/WebKit did not run (§7).

## 7. Known limitations

- **Not covered here**: physical phones and tablets, screen readers, OS-level 200 % zoom and native date/number
  pickers (the browser tests emulate viewports, text scaling and a fixed clock), PWA update/offline lifecycle on real
  devices, storage interruption mid-write, deployment, the remote AI provider (never enabled), and real OCR (receipt
  tests use synthetic text). Only Chromium ran: the Firefox/WebKit projects sit behind `PLAYWRIGHT_ALL_BROWSERS=1` and
  need those browsers installed.
- **Calendar with extreme data** (FIN-01): with 25 daily schedules of 10^12 the Calendar month navigation takes
  1–5 s per month (`evidence/calendar-month-timing.txt`); it is correct and recovers, but slow. The FIN-01 browser
  test has its own 120 s timeout for that reason; no product limit was raised.
- **Bundle headroom**: initial JS 842.0 KB of the 844.6 KB limit (`npm run size`); the limit was not changed. The
  QA V2 commit added 7.5 KB (shared currency reader, exact-range helpers, calendar/statistics UI: 844.1 KB); the
  PR #15 commits net −2.1 KB (the SCH-01 swap/drift code removed by `a720d19` outweighs the guard, anchor and history
  additions).
- **QA-01 semantics**: a split that changes the rule (frequency, interval, second day) or starts on a date that is not
  in the series re-anchors on the chosen date by design, and the form says so («las fechas de la serie siguen siendo
  las de siempre» vs «la serie nueva se cuenta desde esta fecha»). Only amount/name/category/account-style edits keep
  the anchor.
- **QA-05 history**: entries recorded before this change do not carry templates/scenarios/snoozes, so reverting one of
  those older splits still leaves their references as before (stated in the `HistoryCollection` doc in
  `src/domain/types.ts` and in `docs/STORAGE.md`; entries written from v14 on are complete).
- **QA-03/QA-04** were already fixed by the QA V2 commit; the audit's extra criteria are covered by new tests rather
  than new product code.
- **Performance budget**: the 10k-movement main-figure budget (< 500 ms) is measured in the browser tests on this
  container's CPU; see §6 for the measured times and whether a narrow rerun was needed.
- The local QA artifacts named by the two briefs were not available (§2); all reproductions here are repository-based.

## 8. Self-review follow-ups (R1–R7), after the verification in §6

An adversarial review of the whole diff `819eaa9..23c2021` (single pass, inline) reported seven findings. Each was
treated as evidence, not proof: reproduced first (unit probe, failing test or browser run against the unchanged
`23c2021` build), then fixed with the smallest change, then re-verified (§8.2). Evidence: `evidence/final-verify/review/`.

### 8.1 Findings

| ID | Claim | Reproduced? | Fix | Commit |
|---|---|---|---|---|
| R1 | The idempotent branch of `saveScheduleFrom` (same id saved twice) passed the raw draft and dropped `anchorDate` — QA-01 reintroduced by a retry. | Yes: `review/unit-r1-r5-before.txt` (`anchorDate` undefined on the second save). | The branch computes `splitAnchor` like the first save. Test in `qaPr15Anchor.test.ts`. | `e785381` |
| R2 | Statistics kept the custom range in state and in the URL; chips, «Hoy» and back/forward made screen and address disagree. | Partly. The screen is re-mounted on every address change (`App.tsx` keys it by path **and** query), so the screen/address split the review described cannot happen today. What was real: non-custom addresses dragged the custom dates along (`review/e2e-r2-r7-before-23c2021-build.txt`: the month URL kept `desde=2026-07-01`), «Hoy» in a custom range dropped the range, and the typed range was lost between chips. | `pathFor` carries `desde`/`hasta` only when the target period is custom; «Hoy» in a custom range moves it to a range of the same length ending today; the typed dates are render-adjusted state keyed by the address so the alignment no longer depends on the re-mount. «Personalizado» after another chip opens the default custom range (documented). e2e `qa-pr15.spec.ts` «R2». | `706bf38` |
| R3 | `simBeyond` compared with the base projection; a simulated run that stops earlier rendered nothing. | Confirmed by reading; not constructible cheaply in the browser (needs ~150 daily 10¹² schedules and a November view). | First as `ui/calendarSim.ts`; after the second review (§8.3) folded into the domain rule: `dayBalance` gained the `outOfRange` state and serves the selected day and the simulation alike (`dayBalance.test.ts`). | `e788ee4` |
| R4 | The second adjacent mark let a currency NAME before a symbol block ordinary lines («Cafe Euro $12»). | Yes: `review/r4-baseline-819eaa9.txt` (CAD 12.00 on 819eaa9) vs the pre-fix state (`currencyConflict` EUR/$). | `TextMark.kind`; in free text the second mark of a side counts only when one of the two was written as a code. Amount fields unchanged (their two marks must round-trip). `review/r4-after.txt`. | `cb19294` |
| R5 | Tracking `inbox.snoozed` turned an unrelated snooze (which prunes expired ones) into a revert «conflict», and filled the history with snooze entries. | Yes: `review/unit-r1-r5-before.txt` (entry created for a snooze-only commit; conflict after pruning). | Snooze-only commits record nothing; expired + gone snoozes are not conflicts and are not resurrected; manual removal of a valid snooze still conflicts. | `868ddbe` |
| R6 | `categoryBreakdown` and `planProgress` still used `Math.floor((amount * 100) / total)`. | Yes: 396 000 000 000 297 / 400 000 000 000 300 → 98 (float) vs 99 (exact); `percentExact.test.ts`. | `mulDivFloor(amount, 100, total)` in both. | `edc5742` |
| R7 | With the recurring total out of range the note pointed to a list that was not rendered. | Yes: `review/e2e-r2-r7-before-23c2021-build.txt` (the new FIN-01 assertion timed out on the missing list). | The list renders whenever there are payments; «Sin cifra exacta» for the total and the monthly average. | `a91d1bd` |

Not changed on purpose: «$12 Euro Market» stays a conflict («$» against the name «euro» next to the amount); before
QA V2 it was silently registered in EUR (`review/r4-baseline-819eaa9.txt`).

### 8.2 Re-verification at the final SHA

Run at `053f023` (`053f023aeeb31006b927d230d095ae2e56c9e1ac`) on 2026-10-19, 01:08–01:41 UTC, same container and
settings as §6, strictly sequential. Logs: `evidence/final-verify-review/` (`verification.txt` is the summary).

| Step | Result |
|---|---|
| Each follow-up commit standalone (`e785381`, `706bf38`, `e788ee4`, `cb19294`, `868ddbe`, `edc5742`, `a91d1bd`): `tsc -b`, `oxlint`, `vitest run` | all exit 0 · 1029 / 1029 / 1032 / 1033 / 1036 / 1038 / 1038 passed, 1 skipped each |
| `npm run check` | exit 0 · 106 files, **1038 passed, 1 skipped** (1039) |
| `npm run build` | exit 0 · 228 modules · build id `a2b421165ee7793086a797f02dae79e1c2b79a5b4e97edda8644a6552ef1e27d` (70 files) |
| `npm run size` | exit 0 · initial JS **842.7 KB** in 11 files (gzip 252.1 KB) · limit 844.6 KB unchanged (+0.7 KB vs §6: the simulation helper, the text-mark kind and the always-rendered list) |
| `npm audit --audit-level=high` | exit 0 · 0 vulnerabilities |
| Playwright `celular` — `--workers=2 --fail-on-flaky-tests` | exit 0 · 344 passed, 1 skipped, 0 failed, 0 flaky (8.7 min) |
| Playwright `celular-pequeno` | exit 0 · 345 passed, 0 skipped (8.4 min) |
| Playwright `escritorio` | exit 0 · 342 passed, 3 skipped (8.5 min) |
| 10 000-movement main figure (best of two loads, as the test is written) | celular 376 / 314 ms · celular-pequeno 247 / 207 ms · escritorio 324 / 268 ms — all under 500 ms on both loads |
| SCH-01 «after» screenshots | 1 passed; byte-identical to the §6 captures (nothing to commit) |

The skips are the same pre-existing conditions as in §6. One more browser test than in §6 (the R2 test, three
viewports); the FIN-01 test gained the R7 assertions. Firefox/WebKit did not run (§7).

### 8.3 Second review (of the follow-ups) and the acceptance gaps

The same adversarial review was run on `23c2021..3c9205d` (the R1–R7 commits). It reported five items; each was
reproduced before any change (unit test or browser run), fixed, and re-verified in §8.4.

| ID | Claim | Reproduced? | Outcome | Commit |
|---|---|---|---|---|
| S1 | A snooze-only history entry recorded by a v14 build before R5 is offered as revertible, but the revert records nothing, so the entry comes back as a conflict; and the post-revert prune drops every expired snooze, not just the entry's. | Yes: `review/unit-r5b-before.txt`. | `canRevert` → `notRevertible` for snooze-only entries; the prune is scoped to the ids the entry touched. Tests in `qaPr15Undo.test.ts`. | `19597ea` |
| S2 | The R2 alignment ran only in the custom period, so it held only thanks to the per-query re-mount. | By reading (the R2 e2e passes either way today). | Alignment unconditional (state keyed by the address's dates, empty included). | `5d86c04` |
| S3 | `ui/calendarSim.ts` duplicated the projected / out-of-range / beyond rule that `dayBalance` plus an inline check already applied to the base projection. | Reuse finding, no failure. | `dayBalance` gained `outOfRange`; the Calendar uses it for the selected day and the simulation; helper removed; `dayBalance.test.ts`. FIN-01 now expects `data-state="outOfRange"`. | `9a650eb` |
| S4 (test) | The extended QA-03 test asserted the wrong history entry after `goBack()`. | Yes (my test, before any product change). | Expectation corrected (back lands on the last combination, $0.00). | `4a0ee9b` |
| — | Checked and dropped by the review: `mulDivFloor` on negatives (inputs are clamped/filtered), remaining `× 100` sites are counts, the R4 gating on both sides, `noShortfall` citing the base projection, R1 re-save with a changed date (unreachable from the form). | — | No change. | — |

Acceptance criteria of the audit that the tests had not exercised, now covered in the same commit as S4:
QA-01 «forward links» (a planned expense linked to Mar 31 moves to the new tramo; on 819eaa9 the split was refused
with `splitLinkedGoal`: `review/unit-r-links-before-819eaa9.txt`) and QA-03 «each filter/combination» (tag,
merchant, account + tag + merchant, clearing, back/forward, three viewports).

### 8.4 Re-verification at the final SHA

«S_VERIFICATION»
