# Implementation lead pass — 2026-10-27 (PR #15, branch `claude/margen-personal-finance-app-cdvrt3`)

Audited baseline: `46fe617b98c93902751bcf1949b226adfed65dce` (application sources identical to `d28de42`; the previously
audited version was `819eaa9734f4cb36ab8ffa3013c52c96ecaf8475`). This pass inspected the branch as found, re-checked which
findings still reproduce, added the acceptance cases the brief asks for that were not yet covered, ran three independent
reviewers in their own worktrees, fixed what they reproduced and froze one implementation SHA for the final verification.
Nothing was pushed, merged, published or deployed; PR #15 still points at `46fe617`.

## 1. Exact tested SHA and working-tree status

- Branch state when this pass started: `e38b07b9debdbcb98fa130f2aa86747a82d0d387`, clean tree, ten commits ahead of the
  audited baseline (nine application-source commits `7e5e5d0`…`58e4b79` from the follow-up audit and the corrective pass
  of 2026-10-20, plus the documentation-only `e38b07b`). Nothing in the branch was reset or overwritten; every change of
  this pass is a new commit on top.
- Commits added by this pass (chronological): `b07a25f` (tests and fixtures only), `7e4b82a` (F-R1), `0eb5be2` (F-R2),
  `e9ee629` (F-R3), `31e165d` (S-R1), `14d50d3` (O-3/O-4), `4dc1ddf` (dependency patch, see below).
- The chain was first run at `14d50d3a462faddfa9de999d53d5d4a1bac11131` and was green on every step except
  `npm audit --audit-level=high`, which reported three advisories published after 2026-10-20 (vite 8.3.0–8.3.2, high;
  @vitest/mocker 5.0.0–5.0.2, moderate; development tooling only, the deployed build is static). Both previous passes had
  recorded «found 0 vulnerabilities» with the same lockfile. `npm audit fix` within the existing caret ranges
  (`package.json` unchanged; vite 8.3.5, vitest 5.0.5 and their transitive packages) is commit `4dc1ddf`; that chain is
  kept verbatim as superseded evidence (`evidence/final-14d50d3/`, logs only).
- **Implementation SHA frozen for the final verification: `4dc1ddf277049496bfb525a1019221725608932b`** (`git status`
  at the start of the chain: M AGENTS.md | ?? docs/qa/implementation-lead-2026-10-27/). The documentation-only commit that follows it holds this report and the
  evidence; application sources are identical between the two.
- Reviewer worktrees were created from `e38b07b` (the implementation checkout was the only writer); the lead's own
  reproduction of the reviewers' failing cases was run on `b07a25f` (same application sources as `e38b07b`).

## 2. Per-finding disposition

### 2.1 Findings of the follow-up audit (brief) and of the corrective pass

| Finding | Still reproduces on `46fe617`? | Disposition on the frozen SHA | Where |
|---|---|---|---|
| F-01 split creates data that cannot reload | Yes (`evidence/unit-finding-tests-at-46fe617.txt`; `docs/qa/followup-audit-2026-10-20/evidence/`) | **Fixed** (`7e5e5d0`): change ids follow their collection's contract; data and backups written by the faulty version load unchanged; ids 64/47/41/40/36 and inbox ids at their limit covered | `src/domain/validation.ts` |
| QA-01 residual historical drift (v13) | Yes: the genuine v13 backup imports with next income 2026-03-28 / 0 / 180000 on both versions | **Fixed as a user-confirmed review/repair path** (`36d0441`, corrected by `7e4b82a` and `0eb5be2` after the independent review): upgrading alone does not repair old drift and the card says so; the genuine `819eaa9` backup repairs to 2026-03-31 / 125000 / 55000; declining keeps the 28th; a repair never counts a paid occurrence twice; a v14 edit of a still-moved segment keeps the review alive. Not claimed: universal closure for splits that the old format cannot distinguish from an intentional change (§10). | `src/domain/splitRepair.ts`, `src/ui/screens/settings/SplitRepairCard.tsx` |
| F-02 split undo unsafe (legacy and later dependents) | Yes (`docs/qa/followup-audit-2026-10-20/evidence/unit-f02-before-46fe617.txt`) | **Fixed** (`426de6a`, refined by `31e165d`): refusal without mutation, localized, UI and operation agree; later template, goal and scenario variants covered; an expired snooze is not a dependent | `src/domain/historyRevert.ts` (split out of `history.ts` in `58e4b79`), `src/ui/screens/History.tsx` |
| F-03 analysis throws on a valid percentage | Yes (`floorDiv requiere enteros…`) | **Fixed** (`dfd241c`, refined by `e9ee629`): exact 9 900 %, no-figure state, zero previous never divides, threshold symmetric | `src/domain/analysis.ts`, `src/domain/money.ts`, `src/ui/screens/Insights.tsx` |
| F-04 dark-theme comparison text contrast | Yes (3.66:1 dark, 2.56:1 light) | **Fixed** (`cb12d02`): `--text-secondary`; computed and axe-checked in explicit dark, system dark and light at three widths (reviewer: 6.79:1 dark, 7.58:1 light) | `src/styles.css`, `src/ui/themeTokens.test.ts` |
| F-05 custom chart labels overlap | Yes (bounding boxes overlap at every width) | **Fixed** (`1e23b8e`): labels chosen by slot width; tooltip, accessible names and table keep full dates; keyboard and touch selection verified in es/en/pt/fr; month and year labels unchanged | `src/ui/components/axisLabels.ts`, `statsCharts.tsx`, `Statistics.tsx` |
| P1/P2 (audit of 2026-10-19, corrected on 2026-10-20) | Yes on `1e23b8e` | **Fixed** (`20beaf0`, `8f78494`); re-verified from scratch by the browser reviewer with new fixtures; see `docs/qa/corrective-pass-2026-10-20/REPORT.md` | `src/domain/money.ts`, `src/domain/receipt.ts` |

### 2.2 Findings of the independent reviewers of this pass (all reproduced by the lead before changing anything)

| Id | Severity | Reviewer | What | Disposition |
|---|---|---|---|---|
| F-R1 | P1 | financial | `repairSplit` put `anchorDate` on the whole legacy segment, so paid or skipped occurrences on the moved dates (28-mar, 28-abr) stopped matching their payments and came back as overdue on 31-mar / 30-abr: double reservation, «ingreso retrasado» for money already received, a skipped month reserved again (reviewer cases G1–G3; lead reproduction `evidence/unit-review-finance-before-b07a25f.txt`: 3 failed / 43 passed) | **Fixed** (`7e4b82a`): the usual dates apply from the day after the last settled occurrence (also partial), mapped to its usual date; what came before keeps its dates and payments; the segment is partitioned when the kept past is not on the usual series (new id from the caller), otherwise `anchorDate` is enough; skipped dates, linked planned expenses and snoozes follow their period; templates and scenarios follow the series; a link without an equivalent date is refused. Unit: nine cases in `src/domain/qaLead.test.ts`; UI: `tests/e2e/qa-lead.spec.ts` «F-R1» ($2,100.00 stays instead of −$1,100.00) |
| F-R2 | P2 | financial | A v14 «desde una fecha» edit of a still-moved legacy segment (the form proposes the moved 28-mar) inherited the moved date as `anchorDate`; `driftedSplits` skipped every segment with an `anchorDate`, so the drift became permanent and invisible (reviewer case C2) | **Fixed** (`0eb5be2`): a segment whose `anchorDate` equals its predecessor's `anchorOf` is inherited; the chain walk continues through inherited segments and stops at the first that anchored itself; a «Dejar como está» on an ancestor is inherited. Unit: four cases; UI: «F-R2» (genuine v13 copy, edit from the proposed 28-mar, the card stays, restore → $550.00) |
| F-R3 | P3 | financial | `floor` made the ±10 % spending alert asymmetric: −9.99 % fired and read «10 %», +9.99 % did not (reviewer case E5) | **Fixed** (`e9ee629`): one shared `checkedPercentChange` (sign × floor of the magnitude, still exact, still `null` when not representable) in Analysis, Statistics and the weekly review; FORMULAS updated |
| S-R1 | P3 | security/storage | `revertDependents` counted expired snoozes (inert per R5, no UI to clear them), so an undo stayed refused with a dependent the person could not act on (reviewer cases U-10/U-11) | **Fixed** (`31e165d`): expired snoozes are skipped when `today` is given, as in `revertedState`; without `today` nothing changes |
| O-3 | obs. | security/storage | On-demand CSV export swallowed a failed module load | **Fixed** (`14d50d3`): «No se pudo generar el archivo.» and stop |
| O-4 | obs. | security/storage | Repair card accepted a second tap while saving (spurious generic error) | **Fixed** (`14d50d3`): buttons disabled while an operation is in flight |
| O-1 | obs. | browser QA | `/estadisticas?periodo=month` on a month without movements shows only the empty state (no six-month chart) | Not changed: pre-existing behaviour outside the audited claims; recorded for a product decision |
| O-2 | obs. | browser QA | Full-page screenshots show the fixed bottom bar mid-page | No action: capture artefact of `fullPage` with `position: fixed`; the layout guards run in the final chain |
| Fin. O1–O11, Sec. O-1/O-2/O-5–O-7 | obs. | financial, security | Pre-existing or by-design notes (semimonthly legacy drift undetectable with valid data; paused segments proposed; adjacent unrelated schedules with the same name proposed; `plans.ts` percent unchecked for absurd inputs; array snapshots accepted by `validateHistory`; `ShortfallPlan` undo without the History screen's re-validation; paid planned expense still blocks an undo; transactions/distribution lines/dismissals are not dependents, same as manual delete) | Not changed in this pass; listed in §9 with the reasoning and carried to §10 where they are limits |

## 3. Root causes and relevant files

- Previous passes: see `docs/qa/followup-audit-2026-10-20/REPORT.md` §1 and `docs/qa/corrective-pass-2026-10-20/REPORT.md`
  §1. In short: history validation applied the 64-character record-id limit to inbox ids (F-01); the v13 → v14
  migration deliberately does not guess anchors (QA-01 residual); `revertEntry` restored snapshots without evaluating the
  resulting state (F-02); an unchecked `(current − previous) × 100` (F-03); `--text-muted` on a card (F-04); full dates
  with the year in six ≈50-unit slots (F-05).
- This pass (reviewer findings): the repair re-anchored the whole segment instead of partitioning after the last settled
  occurrence (F-R1, `src/domain/splitRepair.ts`); the detector keyed on «has an `anchorDate`» rather than on «anchored
  itself» (F-R2, same file); `floor` instead of truncation toward zero on a signed percentage (F-R3,
  `src/domain/money.ts`, `analysis.ts`, `statistics.ts`, `weeklyReview.ts`); `scheduleReferences` ignored `until`
  (S-R1, `src/domain/historyRevert.ts`); a missing `catch` and a missing in-flight guard (O-3/O-4,
  `src/ui/screens/Movements.tsx`, `src/ui/screens/settings/SplitRepairCard.tsx`).

## 4. Before/after reproduction evidence

- Before (original inputs and failure signatures, kept verbatim): `docs/qa/followup-audit-2026-10-20/evidence/`
  (`unit-f01-before.txt`, `unit-followup-before-46fe617.txt`, `unit-f02-before-46fe617.txt`, `unit-f04-before-46fe617.txt`,
  `e2e-f01-before.txt`, `e2e-f04-before.txt`, `e2e-followup-before.txt`) and `docs/qa/corrective-pass-2026-10-20/evidence/`
  (`unit-probe-before-1e23b8e.txt`, `size-before-1e23b8e.txt`). This pass re-ran the maintained finding tests on a fresh
  worktree of `46fe617` (`evidence/unit-finding-tests-at-46fe617.txt`: 12 failures, 6 passes; the files whose modules did
  not exist at the baseline could not load, which is recorded as such).
- QA-01 genuine fixture: `evidence/v13-known-intent-backup.json` was written by the old implementation itself with
  `evidence/v13KnownIntent.gen.test.ts.txt` run in a worktree of `819eaa9` (CAD 1 800 on 15-feb-2026, salary CAD 2 400
  anchored 31-jan, bill CAD 1 250 on 29-mar, salary amount changed by 777 minor units accepting the suggested 28-feb;
  schema 13, one history entry). Its persisting historical result (2026-03-28 / 0 / 180000 on 2026-03-21) is asserted as
  an observation in `src/domain/qaLead.test.ts`; the repair result (2026-03-31 / 125000 / 55000) is the acceptance, in the
  unit test and through the UI (import, repair, reload, export and re-import).
- Reviewer findings before the fix: `evidence/unit-review-finance-before-b07a25f.txt` (the financial reviewer's 46 cases on
  the lead's checkout at `b07a25f`: G1/G2/G3 fail exactly as reported); the security reviewer's two failing assertions are
  quoted in `evidence/reviewers/review-security.md` and encoded in `src/domain/qaLead.test.ts` (S-R1 block); the
  F-R2 and F-R3 cases are encoded as the reviewer wrote them (C2 and E5) and now assert the corrected behaviour.
- After: `evidence/final/` (the full chain at the frozen SHA, §6), the screenshots in `evidence/final/shots/` (§7), and
  the working-tree runs of the new browser tests before freezing (`evidence/e2e-fr1-celular-working-tree.txt`,
  `evidence/e2e-fr2-celular-working-tree.txt`, `evidence/e2e-lead-specs-first-run-working-tree.txt`,
  `evidence/e2e-lead-labels-rerun-working-tree.txt`).

## 5. Added regression tests and measurable results

- From the two previous passes: `src/domain/qaFollowUp.test.ts`, `src/domain/qaCorrective.test.ts`,
  `src/ui/components/axisLabels.test.ts`, `src/ui/themeTokens.test.ts` (F-04 block), `tests/e2e/qa-followup.spec.ts`,
  `tests/e2e/qa-corrective.spec.ts`.
- This pass, `src/domain/qaLead.test.ts` (29 cases): genuine v13 backup (record counts, figures before/after repair, backup
  round trip, decline, fresh v14 split); F-02 variant B with a later scenario; F-03 zero previous; F-R1 (paid
  28-feb/28-mar/28-abr → 1 600 reserved once and nothing overdue, revertible as one entry; received income never
  «retrasado»; skipped 28-abr → 30-abr skipped and a future skipped date too; paid in advance; nothing paid → in-place
  single edit; partial settlement counts; links, templates, scenarios and snoozes follow; a link without an equivalent
  date is refused; invalid or duplicate new id refused); F-R2 (the reviewer's C2 case proposes the 31 and repairs to
  31-mar / 1 250 / 550; legitimate v14 chains silent; dismissal inherited and revived; inherited segment with a received
  28-mar repairs by partition); F-R3 (helper boundaries, Analysis on both sides of the threshold, Statistics and weekly
  review agree); S-R1 (expired moved snooze not a dependent, live one is, without `today` still counted; a snooze added
  later without an entry and expired does not block the undo and is not revived).
- This pass, `tests/e2e/qa-lead.spec.ts` (nine tests × three projects): UI import of the genuine v13 backup with reload
  and export/import; decline; keyboard and touch chart selection in es/en/pt/fr; month and year labels unchanged; F-R1
  through the card with paid moved occurrences ($2,100.00 stays, nothing «vencido»); F-R2 through the schedule form
  («Desde una fecha» at the proposed 28-mar, the card stays, restore → $550.00). `tests/e2e/shots.ts` captures the
  finding screens when `QA_LEAD_SHOTS` is set (also from `qa-followup.spec.ts` and `qa-corrective.spec.ts`).
- Observation tests (known-bad signatures, not acceptance): the «persisting historical result» case in `qaLead.test.ts`;
  `docs/qa/followup-audit-2026-10-20/evidence/f02Before.observation.test.ts.txt` (run on `46fe617` only).
- Measurable, at the frozen SHA `4dc1ddf`: unit tests 1120 passed, 0 failed, 1 skipped (379 files); browser 1102 passed across the three projects in run 1 (1 desktop failure, rerun 366 passed / 0 failed on the same build); initial JS 842.4 KB against the
  unchanged 844.6 KB cap; 10k startup 308/296 ms (phone), 325/351 ms (320 px), 365/320 ms (desktop run 1), 487/439 ms (desktop rerun, two workers), 249–357 ms serial against the unchanged 500 ms budget (§6 has the per-project figures and
  the serial comparison against the audited baseline build).

## 6. Required command results

All commands ran on the frozen SHA `4dc1ddf` in `/home/user/ALCANZA`, strictly one after the other (`evidence/final/`; the assembled log is `evidence/final/verification.txt`, started 2026-10-27T07:59:41Z, finished 2026-10-27T08:47:55Z). The same chain was first run at `14d50d3` (`evidence/final-14d50d3/verification.txt`): identical outcome on every step except `npm audit` (3 advisories), see §1.

**Each commit on its own** (temporary worktree per commit, `node_modules` shared: `npx tsc -b`, `npx oxlint .`, `npx vitest run`):

| Commit | tsc · oxlint · vitest | Unit tests |
|---|---|---|
| `7e5e5d0` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1061 passed · 1 skipped (1062) |
| `36d0441` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1067 passed · 1 skipped (1068) |
| `426de6a` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1070 passed · 1 skipped (1071) |
| `dfd241c` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1073 passed · 1 skipped (1074) |
| `cb12d02` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1077 passed · 1 skipped (1078) |
| `1e23b8e` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1082 passed · 1 skipped (1083) |
| `20beaf0` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1089 passed · 1 skipped (1090) |
| `8f78494` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1094 passed · 1 skipped (1095) |
| `58e4b79` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1094 passed · 1 skipped (1095) |
| `e38b07b` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1094 passed · 1 skipped (1095) |
| `b07a25f` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1102 passed · 1 skipped (1103) |
| `7e4b82a` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1111 passed · 1 skipped (1112) |
| `0eb5be2` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1115 passed · 1 skipped (1116) |
| `e9ee629` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1118 passed · 1 skipped (1119) |
| `31e165d` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1120 passed · 1 skipped (1121) |
| `14d50d3` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1120 passed · 1 skipped (1121) |
| `4dc1ddf` | tsc exit 0 · oxlint exit 0 · vitest exit 0 | 1120 passed · 1 skipped (1121) |

**At HEAD:**

- `npm run check` (typecheck + oxlint + i18n literal check + Vitest): exit 0; Test Files 110 passed (110); Tests 1120 passed, 1 skipped (1121); `find-literals: sin texto visible fuera de i18n en src/ui.`
- `npx vitest run --reporter=json --outputFile=vitest.json`: exit 0; 1120 passed, 0 failed, 1 skipped (379 files); `success: true` (`evidence/final/vitest.json`).
- `npm run build`: exit 0; ✓ 231 modules transformed.; ✓ built in 993ms; identified build: dist id `288a5ead0c9d61bf68c45d3e3bd718fab0047329762e8e13fcc446f1298cab94` (sha256 of the sorted sha256 list of every `dist/` file, 75 files, `evidence/final/dist-sha256.txt`).
- `npm run size`: exit 0; JS inicial: 842.4 KB en 13 archivos (gzip 252.6 KB); Referencia: 767.8 KB · límite 844.6 KB · cambio +9.7 % — the 844.6 KB cap, the 767.8 KB reference and the script are unchanged.
- `npm audit --audit-level=high`: exit 0; found 0 vulnerabilities.
- Playwright, full matrix, one project at a time against ONE `vite preview --port 4173 --strictPort` of the build above, `--workers=2 --fail-on-flaky-tests --reporter=list,json` (CI settings; `retries` is 0 outside CI, so nothing was retried inside a run):

| Project | Result | Duration | 10k startup (two measurements, budget 500 ms) |
|---|---|---|---|
| `celular` | 368 passed, 0 failed, 0 flaky, 1 skipped | 552 s | 308 / 296 ms |
| `celular-pequeno` | 369 passed, 0 failed, 0 flaky, 0 skipped | 551 s | 325 / 351 ms |
| `escritorio` | 365 passed, 1 failed, 0 flaky, 3 skipped | 598 s | 365 / 320 ms (run 1) |
| `escritorio`, rerun | 366 passed, 0 failed, 0 flaky, 3 skipped | 590 s | 487 / 439 ms (run 2) |

- Desktop run 1: 365 passed, 1 failed — `tests/e2e/statistics.spec.ts:58` (empty-state statistics and private mode), a 30 s
  test timeout at its last `go('/estadisticas')` after the private-mode radio. The Playwright trace shows the page fully
  rendered in private mode (charts hidden, figures masked) by 2.3 s, then no further screencast frame and no DOM
  evaluation for the remaining 28 s (the `#page-title` expectation reported `Received: undefined`, which is what Playwright
  prints when the page returns nothing, not «hidden»), while the other worker was running the two axe audits of the
  component gallery. The same test passed on both phone projects of this chain, on the desktop project of the first chain
  at `14d50d3` (same application code) and on the serial desktop rerun above against the very same build (dist id
  `288a5ead…` before and after, `dist-id-before-rerun.txt`). It is recorded as a one-off renderer stall under two workers,
  not as a product failure; the original log, JSON and Playwright error context are kept (`e2e-escritorio.txt`,
  `e2e-escritorio.json`, `e2e-escritorio-run1-statistics-error-context.md`). This is the one rerun the previous passes
  also allowed themselves; nothing was retried inside a run.

- Screenshot runs (`QA_LEAD_SHOTS`, `--workers=1`, the three finding specs on the same preview): `celular` 24 passed (1.0m); `celular-pequeno` 24 passed (1.0m); `escritorio` 24 passed (1.2m); 84 files in `evidence/final/shots/`.
- Serial A/B of the 10k startup budget, desktop project, three alternating rounds, audited baseline build (`46fe617`, worktree `wt-base`, its own `vite build` with the same `node_modules`) versus the frozen build, each behind its own preview, nothing else running (`evidence/final/perf-10k-ab-base-vs-final.txt`):

```
perf A/B started 2026-10-27T09:00:44Z; serial, nothing else running; old = 46fe617 (wt-base), new = 4dc1ddf
46fe617

✓ built in 1.69s
--- round 1 old (http://localhost:4174)
Inicio con 10k: cifra principal a los 258 / 241 ms
  1 passed (4.0s)
--- round 1 new (http://localhost:4173)
Inicio con 10k: cifra principal a los 357 / 249 ms
  1 passed (4.0s)
--- round 2 old (http://localhost:4174)
Inicio con 10k: cifra principal a los 295 / 220 ms
  1 passed (3.9s)
--- round 2 new (http://localhost:4173)
Inicio con 10k: cifra principal a los 274 / 247 ms
  1 passed (3.8s)
--- round 3 old (http://localhost:4174)
Inicio con 10k: cifra principal a los 263 / 242 ms
  1 passed (3.6s)
--- round 3 new (http://localhost:4173)
Inicio con 10k: cifra principal a los 257 / 264 ms
  1 passed (3.6s)
finished 2026-10-27T09:01:19Z
```

## 7. Browser screenshots and raw machine-readable results

Everything under `docs/qa/implementation-lead-2026-10-27/evidence/`:

- `final/` — the chain at the frozen SHA: `verification.txt` (assembled), `sha.txt`, `status.txt`, `started.txt`/`finished.txt`, one `worktree-<sha>.txt` per commit, `check.txt`, `vitest.json` (raw Vitest JSON, every test with status and duration), `vitest-json-run.txt`, `build.txt`, `dist-sha256.txt`, `dist-id.txt`, `size.txt`, `audit.txt`, `preview-ready.txt`, `e2e-<project>.txt` (list reporter) and `e2e-<project>.json` (raw Playwright JSON: every test, status, duration, retries, errors) for the three projects, `e2e-escritorio-run1-statistics-error-context.md` (Playwright's error context of the one run-1 failure) and `e2e-escritorio-rerun.txt`/`.json`, `shots-run-<project>.txt`, `perf-10k.txt`, `perf-10k-ab-base-vs-final.txt`, `rerun-started.txt`/`rerun-finished.txt`, `dist-id-before-rerun.txt` (the rerun used the very same build).
- `final/shots/` — 84 JPEG screenshots taken by the finding specs on the same preview, named `<case>-<project>.jpg` for the three projects (412 px phone, 320 px phone, 1 280 px desktop): f01-reloaded-after-split-id47, f01-reloaded-after-split-id64, f02-history-refusal, f03-analysis-9900, f04-claro, f04-oscuro-explícito, f04-sistema-oscuro, f05-axis-en, f05-axis-es, f05-axis-fr, f05-axis-po, f05-en-axis-tooltip, f05-es-axis-tooltip, f05-fr-axis-tooltip, f05-po-axis-tooltip, fr1-repair-card-paid, fr1-repaired-home, fr2-repair-card-after-v14-split, p1-blocked-10-00-PEN, p1-blocked-10-00-RUB, p1-blocked-RUB-10-00-, p2-receipt-TOTAL-3-09, p2-receipt-TOTAL-CAD-3-09, qa01-repair-card, qa01-v13-imported-home, qa01-v13-repair-card, qa01-v13-repair-dialog, qa01-v13-repaired-home.
- `final-14d50d3/` — the first chain (superseded by the dependency patch): logs and `verification.txt` only.
- `reviewers/` — the three reviewer reports (`review-finance.md`, `review-security.md`, `review-browser.md`), their test code as text (`review.finance.test.ts.txt`, `review.security.domain.test.ts.txt`, `review.security.storage.test.ts.txt`, `review.browser.spec.ts.txt`) and the browser reviewer's run logs (`review-run-*.txt`). The browser reviewer's own screenshots (69 PNG, 21 MB) stayed in its worktree and are not committed.
- Root of `evidence/`: `v13-known-intent-backup.json` and its generator `v13KnownIntent.gen.test.ts.txt`, `unit-finding-tests-at-46fe617.txt` (baseline reproduction), `unit-review-finance-before-b07a25f.txt` (the financial reviewer's cases before the fixes), and the working-tree runs of the new browser tests before freezing (`e2e-lead-specs-first-run-working-tree.txt`, `e2e-lead-labels-rerun-working-tree.txt`, `e2e-fr1-celular-working-tree.txt`, `e2e-fr2-celular-working-tree.txt`).

## 8. Migration, recovery and backup-compatibility assessment

- `SCHEMA_VERSION` stays 14; no migration was added by any of the three passes. The v13 → v14 step still only bumps the
  version (security reviewer V-08: `migrate()` on v14 is the identity; `migrations.ts`, `types.ts`, `backup.ts`, both
  repositories and `src/state` are byte-identical to the baseline).
- F-01: data and backups written by the faulty version (history change ids of up to 88 characters under `inboxSnoozed`)
  load unchanged with the fixed validator (security reviewer V-07/V-09: nothing previously valid is now rejected, nothing
  beyond the contract is now accepted; no id shortened, no entry or snooze dropped, revision kept). The corrupt-data screen
  never deleted anything, so no recovery action is needed beyond upgrading. Rolling back below `7e5e5d0` would re-expose
  those budgets (`docs/ROLLBACK.md`).
- QA-01 residual: the genuine `819eaa9` backup migrates without record loss (unit and UI); the repair is per record,
  user-confirmed, preceded by a local copy («antes de restaurar»; a failed copy aborts the repair) and recorded in the
  history as one entry (revertible; a partition reverts to one segment); declining stores an inbox dismissal with a
  fingerprint. After F-R1 a repair never rewrites a paid or skipped occurrence; after F-R2 a later «desde una fecha» edit
  does not bury the review. Upgrading alone changes no date, and the card says so.
- F-02/S-R1: no data format change; a refused revert leaves serialized data byte-identical (reviewer U-01: six refusal
  branches); entries become revertible again once the dependents are changed or removed, or once a blocking snooze has
  expired.
- Backups exported by any of the three versions (`819eaa9`, `46fe617`, frozen SHA) import into the frozen SHA (unit:
  `qaLead.test.ts`, `qaFollowUp.test.ts`; UI: `qa-lead.spec.ts`, `qa-followup.spec.ts`; reviewer V-09/V-11).
- Write boundary unchanged: every operation of this pass goes through `useRun` → `AppStore.commit` → repository save with
  the conflict check; a refused operation never reaches `commit` (reviewer §5).

## 9. Independent reviewer findings and their resolution

Three reviewers ran in their own worktrees at `e38b07b` with their own fixtures (different names, amounts, ids and dates
from the implementation's tests), each writing a report and test code that are kept verbatim under `evidence/reviewers/`:

| Reviewer | Scope | Cases | Result | Report |
|---|---|---|---|---|
| Financial | QA-01 repair, F-03, preservation of PR #15 anchors and the budget semantics | 46 unit cases, hand-computed first | 43 pass, 3 fail = F-R1 (P1); F-R2 (P2) and F-R3 (P3) found by cases that passed «as written» | `reviewers/review-finance.md`, `review.finance.test.ts.txt` |
| Security and storage | validation boundaries (A/B against the baseline validator), undo safety, the `historyRevert` split, split-repair persistence, conflict path, secrets and CSV neutralisation | 61 unit cases (52 domain, 9 storage) | 59 pass, 2 fail = S-R1 (P3); observations O-1…O-7 | `reviewers/review-security.md`, `review.security.*.test.ts.txt` |
| Browser QA | fresh UI flows for every finding at 412/320/1280, dark/system/light, keyboard, synthetic OCR receipts | 17 tests × 3 projects, one worker, own build on port 4181 | 51/51 pass, no product defect; observations O-1/O-2 (the five test-side corrections are listed in the report) | `reviewers/review-browser.md`, `review.browser.spec.ts.txt`, `review-run-*.txt` |

Resolution: §2.2. The reviewers' failing cases were re-run by the lead on the implementation checkout before any change
(`evidence/unit-review-finance-before-b07a25f.txt`) and their invariants were re-encoded in the maintained suites in the
lead's own words and fixtures; where a reviewer's expectation described the defect rather than the invariant (financial
B1 «only `anchorDate` changes», B3 «skipped strings untouched», G3 «skippedDates equal ['2026-04-28']»), the maintained
tests assert the corrected behaviour and the reason is written next to them. The performance comparison was not delegated
to an agent: the brief requires browser suites and performance comparisons to be serial, so the lead ran the 10k budget as
part of the final chain and the serial old-versus-new comparison right after it (§6).

## 10. Remaining limitations and release recommendation

- QA-01 residual: only drifted splits that are recognisable by shape (an active segment that did not anchor itself, a
  predecessor with the same name, kind and rule ending the day before, split on one of its series dates and with different
  upcoming dates) are offered for review. A legacy split whose predecessor was deleted, renamed or re-ruled is
  indistinguishable from a new series and is not proposed; the person edits it by hand. The old format cannot tell
  accidental drift from an intentional 28th, which is why nothing is rewritten without confirmation. A legacy
  twice-monthly drift cannot be recognised with valid data (financial reviewer A3/O1). Two unrelated schedules with the
  same name, kind and rule that happen to be adjacent are proposed too (the person declines; O4).
- The repair keeps paid dates as they are; unpaid overdue moved dates move to their usual date (a snooze on such a date
  follows it when the usual date exists, otherwise it stays inert). The card previews the next three dates from today; the
  confirmation text states what stays and what moves.
- F-02: omitted historical snapshots are never invented; coherence is restored by the person changing or removing the
  dependents, after which the revert is offered again. A paid planned expense still linked blocks an undo (conservative;
  security O-5); transactions linked to a schedule, income-distribution lines and dismissals are not dependents, which
  equals what a manual delete leaves (O-6). `ShortfallPlan`'s own undo does not re-run the full re-validation the History
  screen does (pre-existing, O-2). `validateHistory` accepts arrays as snapshots (pre-existing, O-1; the History screen's
  full re-validation rejects them before anything is saved).
- F-03/F-R3: `plans.ts` still uses the unchecked `mulDivFloor` for a limit's percentage (inexact only for absurd inputs,
  pre-existing; financial O5).
- F-05: label widths are estimated (no DOM when deciding); the layout guard checks the real rendering in four languages
  and three widths. A month without movements shows only the empty state in Statistics (browser O-1, pre-existing).
- Not exercised: real OCR and cameras, physical Safari/Android, screen readers, OS text scaling, native file pickers,
  deployed builds, a real two-tab IndexedDB conflict (reasoned from unchanged repository code) and the on-device PWA
  lifecycle.
- Release recommendation: **Ready for review of PR #15 at `4dc1ddf`, to be pushed only with the user's authorization.** Every finding of the follow-up audit, of the corrective pass and of this pass's three independent reviewers is fixed with before/after evidence, each commit stands on its own, and the frozen SHA passes the repository's gates: 1 120 unit tests, three browser projects (the one desktop test that timed out once under two workers is green on the serial rerun of the same build and is documented, not hidden), 842.4 KB of initial JS against the unchanged 844.6 KB cap, the 500 ms 10k budget with margin in the serial comparison, and `npm audit` clean after the lockfile-only dependency patch. Before merging: (1) push and let CI run the same gates (CI allows one retry but still fails on flaky tests); (2) if the repository prefers to take the dependency patch separately, drop `4dc1ddf`, knowing that `npm audit --audit-level=high` fails until it is applied; (3) the product decisions in §10 (a month without movements shows only the empty state in Statistics; a paid planned expense still linked blocks an undo) are not blockers. Nothing was pushed, merged, published or deployed by this pass.
