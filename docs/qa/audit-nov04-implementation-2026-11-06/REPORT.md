# Implementation of the 2026-11-04 independent audit — 2026-11-06 (branch `claude/margen-personal-finance-app-cdvrt3`)

Audited candidate: `f8d6da07ff209a2a3a64998ce03fba302dda88c8` (head of the merged PR #15; `main` at
`953abaf169c0de1a8c583167fd8f2999633de4b0`, whose tree is identical for every file this pass touches). This pass
reproduced each of the five findings on `main` before changing anything, fixed them, re-encoded the reproductions as
permanent desired-behaviour regressions (unit and browser, three screen profiles), and ran the repository's own
verification chain on the tested commit. Implementation evidence is under `evidence/`; it is separate from the
independent audit's evidence, which did not reach this session (§0).

## 0. What arrived and what did not

The brief named `REPORT.md`, three fixtures (`nov04-gross-income-fixture.json`, `nov04-analysis-gross-fixture.json`,
`nov04-scenario-dates-fixture.json`), two reproduction fixtures (`reproductions/duplicate-scan-tail-fixture.json`,
`reproductions/duplicate-reviewed-recovery-fixture.json`) and archived `.txt` probes. **None of those files reached this
session**: no upload directory, no branch, no issue and no artifact held them (checked again at the start of this pass).
Every reproduction below was rebuilt from the brief's own descriptions and numbers, and each rebuilt fixture matches the
figures the brief gives (exact 100 000-minor daily balance; a −1 shortfall on 27 November; minimum exact through
3 December with expected/extra exact through 25 November and unavailable from 26 November; 5 000 same-date,
same-amount movements with exactly 50 matching-note pairs among the first 100; a dismissed/snoozed pair with 12 matching
movements eight days earlier). The "archived .txt probes" could therefore not be restored to their intended paths; the
rebuilt diagnostics (`evidence/before/`) play that role and were deleted after they served, so no intentionally failing
test remains in routine discovery.

The independent audit's own counts quoted in the brief (1 195 unit passed / 1 skipped; browser matrix 1 156 passed,
4 skipped, **19 failed on the first run** with all 19 passing in a serial rerun; twelve diagnostics confirming defects
across three profiles) are the audit's numbers and are not restated here as this pass's measurements. In particular, the
audit's original browser run was **not clean**: it had 19 initial failures that only passed when rerun serially. This
pass's own browser runs are reported in §6 with initial failures and reruns kept apart.

## 1. Baseline, tested SHA and final SHA

- Checkout found: `/home/user/ALCANZA` on `main` at `953abaf`, clean. The designated branch was restarted from `main`
  (its previous history is the merged PR #15), as the branch instructions require after a merge.
- Commits of this pass, in order, each one self-contained (typecheck, lint and the unit suite pass on each one alone,
  §6): {{COMMITS_LIST}}.
- **Tested SHA: `{{TESTED_SHA}}`** (the chain of §6 ran on it; `git status` at that moment is in `evidence/final/status.txt`).
- **Final SHA: the documentation-only commit that follows the tested SHA** (this report, its evidence, the changelog and
  the documentation files). `git log -1` on the branch shows it; the tested SHA is its parent.

## 2. Per-finding disposition

| Id | Severity (audit) | Disposition | Where |
|---|---|---|---|
| F1 · gross-total overflow in Projection and Analysis | defect, three profiles | **Fixed.** `grossInflows`/`grossOutflows` (checked, BigInt) replace the throwing `sumMinor`; `ScenarioComparison.incomeMinor` is `number \| null`; Analysis explanations carry `Because.kind: 'noFigure'` rows; the shortfall plan computes `contributorsTotalMinor` and `incomesUntilFirstMinor` in the domain (checked) instead of float sums in the screen. Daily balances, the lowest balance, the end balance and the shortfall date stay exact (−1 on 27 Nov); nothing is clamped, rounded, zeroed or discarded; symmetric for expenses. Wording in es/en/pt/fr. | `src/domain/projection.ts`, `analysis.ts`, `shortfall.ts`, `src/ui/screens/{Projection,Insights,ShortfallPlan}.tsx`, i18n ×4 |
| F2 · per-scenario coverage dates | defect | **Fixed.** `ProjectionResult.lastExactDate`/`exactDays` and the same two fields on `ScenarioComparison`, `ScenarioResult` and `AffordResult.projectionLastExactDate`. Each comparison row states its own coverage (min through 3 Dec, expected/extra through 25 Nov), a coverage note under the table (`aria-describedby`) summarises exact days per scenario, switching the selected scenario changes only the alerts above the table, and zero exact days (`lastExactDate: null`) is said explicitly everywhere instead of falling back to "today"/"yesterday". Projection, Analysis, Shortfall, Scenarios and Afford inspected; the "today" fallbacks in Projection and Analysis and the "day before `outOfRangeFrom`" claims in Shortfall, Scenarios and Afford were confirmed and fixed. | `src/domain/{projection,analysis,scenarios,affordability}.ts`, `src/ui/screens/{Projection,Insights,ShortfallPlan,Scenarios,Afford}.tsx`, i18n ×4 |
| F3 · stalled language download not recoverable | defect | **Fixed.** Packs are JSON files fetched with an abortable attempt per pack and language: a timeout aborts the request and retires the attempt, the next attempt requests a fresh URL (`retryUrl`), a late completion of an old attempt never enters the cache nor retires the newer attempt, concurrent loads share one attempt, languages stay isolated, only successes are cached, the Spanish fallback and the reload fallback remain. Fallback content is marked `lang="es"` (Legal sections, Gallery content and title, CSV import). Found while verifying: Vite inlined the sub-4 KB JSON packs as `data:` URIs, which `connect-src 'self'` blocks — `packAssetsInlineLimit` keeps the packs as real files (config test). | `src/i18n/packs.ts`, `src/i18n/packs/*.json`, `packs/packKeys.ts`, `src/ui/screens/{Legal,Gallery,BankImport}.tsx`, `src/ui/components/common.tsx`, `vite.config.ts` |
| F4 · quadratic duplicate scan | performance regression | **Fixed.** Candidates come from a per-group note index (same note, blank note, merged by position) so only matching pairs are examined; `DuplicateScan.examined` makes the bound testable without a stopwatch. Same pairs, order, ids, window, schedule exclusion, type/account separation, refund behaviour and review progress (checked against the old quadratic walk on 40 seeded ledgers); the 435-pair progress oracle is kept. Benchmark on the reproduction, same process and input: 4 110 ms → 7.7 ms. | `src/domain/inbox.ts` |
| F5 · reviewed duplicate pairs disappear beyond the cap | pre-existing defect | **Fixed.** `inboxView` rebuilds dismissed/snoozed duplicate pairs the scan did not reach from the saved decision (`duplicatePairFromDecision`: both movements exist, still pair under the same rules, same fingerprint for a dismissal, snooze not expired); decisions are never deleted; expired snoozes, modified and deleted movements are handled; no unrelated pair has to be reviewed first. | `src/domain/inbox.ts` |

Adjacent change forced by the size gate: the initial JS grew to 847.7 KB with the new texts and code (limit 844.6 KB).
Following `AGENTS.md`, the CSV import screen's texts (103 keys, ≈ 8.7 KB in the Spanish dictionary alone) moved to a
third lazy pack (`bankImport`), with pack-aware plurals in `createTranslator`; the initial JS is now {{SIZE_KB}} KB. No budget
was raised.

## 3. Root causes and changed files

- **F1.** `compareScenarios` summed every positive event of the exact days with `sumMinor`, which throws past 2⁵³ − 1, and
  `analysis.ts` did the same for the inflow/outflow rows of the shortfall explanation; the shortfall screen also summed
  contributors and incomes with plain `+` (inexact past 2⁵³). Daily balances are checked per day (`checkedSumMinor`), so
  +10¹² and −10¹² every day keep the balance at 100 000 while 30 days of inflows reach 1.2 × 10¹⁶. Changed:
  `src/domain/projection.ts` (`grossInflows`, `grossOutflows`, `ScenarioComparison.incomeMinor: number | null`),
  `src/domain/analysis.ts` (`Because.kind` gains `noFigure`; `flowBecause` uses the checked helpers),
  `src/domain/shortfall.ts` (`contributorsTotalMinor`, `incomesUntilFirstMinor`), `src/ui/screens/Projection.tsx`
  (`projection.noFigureCell`, `scenario-gross` note), `src/ui/screens/Insights.tsx` (`becauseValue` renders
  `insights.because.noFigure`), `src/ui/screens/ShortfallPlan.tsx` (domain sums; `shortfall.noFigure`),
  `src/i18n/{es,en,pt,fr}.ts`.
- **F2.** `Projection.tsx` derived `lastExact` from the *selected* projection (`days[last]?.date ?? today`) and used it for
  every comparison row; `analysis.ts`, `ShortfallPlan.tsx`, `Scenarios.tsx` and `Afford.tsx` derived "until" as
  `outOfRangeFrom − 1 day` or `today`, which with zero exact days claims "no shortfall until yesterday/today". Changed:
  `src/domain/projection.ts` (`lastExactDate`, `exactDays` on `ProjectionResult` and `ScenarioComparison`),
  `src/domain/scenarios.ts` (`ScenarioResult.lastExactDate`), `src/domain/affordability.ts`
  (`projectionLastExactDate`), `src/domain/analysis.ts` (`until: ''`, `days: 0`, no `exactUntil` row with zero days),
  the five screens (`projection.partialNone*`, `projection.partialShortfallNone`, `projection.coverage*`,
  `insights.projectionOutOfRange.titleNone`, `shortfall.partialNone*`, `shortfall.partialNoteNone`,
  `afford.partialNone*`, `afford.partialLowestNone`), `src/i18n/{es,en,pt,fr}.ts`.
- **F3.** The loader kept the raw `import()` promise in its in-flight map and only wrapped the *wait* in a timeout: the
  timed-out attempt stayed "in flight", so a retry reused the pending import and requested nothing; independently of
  that, browsers dedupe a pending dynamic import by URL, so even a second `import()` would not have hit the network.
  The fix gives every attempt an identity and an `AbortController` (`createPackLoader` in `src/i18n/packs.ts`): the
  timeout aborts the request and retires the attempt synchronously, the next attempt uses `retryUrl` (same address with
  `?retry=<n>`), and a late settlement of an old attempt is ignored (`settled` guard) and never removes the newer entry.
  Packs became JSON (`src/i18n/packs/{legal,gallery,bankImport}.{es,en,pt,fr}.json`, generated from the previous TS
  modules), loaded with `fetch` under `connect-src 'self'` and precached by the service worker like any other asset;
  `packs/packKeys.ts` keeps the compile-time guarantee that the four languages share exactly the same keys. The
  `?url` import of a `.ts` module was probed and rejected (Vite emits the raw TypeScript as a `data:video/mp2t` URI), and
  Vite's 4 KB inlining of small assets was caught by the first browser run (packs failed to load in the built app) and
  disabled for the packs (`packAssetsInlineLimit` in `vite.config.ts`, tested). `PageHeader` accepts `titleLang`; Legal
  wraps its sections (`data-testid="pack-content"`), Gallery wraps its content, BankImport its root, with `lang="es"`
  only under the Spanish fallback.
- **F4.** The nested loop examined every (i, j) within the date window before comparing notes: with unique notes nothing
  ever matched, the per-group cap was never reached and 5 000 same-day movements cost 12 497 500 comparisons. The scan
  now builds, per group, a map note → positions and a blank-note position list; for a noted movement the candidates are
  the later same-note and blank positions merged in order (two sorted lists, binary search for the first position after
  `i`), for a blank-note movement every later position (all match). The date-window break, the schedule exclusion, the
  reviewed predicate and the cap are unchanged. `DuplicateScan.examined` counts examined candidates.
- **F5.** Reviewed pairs were listed only when the ordered walk crossed them; once a group holds more unreviewed pairs than
  the cap the walk stops before later pairs, so a dismissed or snoozed pair at the end of the group vanished from the
  recovery lists. `reviewedDuplicatesBeyondScan` in `inboxView` reconstructs such pairs from `inbox.dismissed`/`snoozed`
  ids (`dup:<a>:<b>`, split at every `:` because movement ids may contain one), validates them with the scan's own rule
  (`isDuplicatePair`) and the decision's fingerprint/expiry, lists them in (date, id) order, and never touches the saved
  decisions.

## 4. Before/after evidence (implementation evidence, synthetic data)

Before (on `main` = `953abaf`, `evidence/before/`):

- `unit-diagnostics-953abaf.txt`: eight desired-behaviour diagnostics, all failing: F1 `compareScenarios` and
  `analysisItems` throw `Desbordamiento al sumar importes`; F2 `lastExactDate` undefined; F3 the retry after a timeout
  issues no new request (1 call instead of 2); F4 the 5 000-movement scan takes **4 078 ms** and exposes no work bound;
  F5 the dismissed and the snoozed pair are absent from the view.
- `browser-diagnostics-953abaf.txt` and `screenshots/`: Projection and Analysis show «No se pudo abrir esta pantalla»
  with the gross fixtures (`before-f1-projection`, `before-f1-analysis`); with the minimum scenario selected the
  expected row says «No hasta el 3 dic; después sin cifra» although it is only exact through 25 Nov
  (`before-f2-projection-min-selected`); after a stalled download and the timeout, «Reintentar» issues no new request
  (`before-f3-timeout`, one request recorded).
- `benchmark-duplicates-before-after.txt`: old and new `scanDuplicates` in the same vitest process on the same inputs
  (median of five runs): the reproduction 4 110.4 ms → 7.7 ms (examined 50, 50 pairs, not truncated); 5 000 blank-note
  movements 1.9 ms → 2.1 ms (examined 51, 50 pairs, truncated); 10 000 movements spread over 10 months × 50 amounts × 7
  notes 11.2 ms → 8.8 ms (2 500 pairs); same pairs and order in all three.

After (tested SHA, `evidence/final/`): the three new unit files and the browser spec `tests/e2e/audit-nov04.spec.ts`
pass on the three profiles; screenshots at 320 px, 412 px (Pixel 7) and 1 280 px are under
`evidence/final/screenshots/` (`nov04-f1-projection`, `nov04-f1-analysis`, `nov04-f2-projection-min`,
`nov04-f2-projection-expected`, `nov04-f2-zero-days-projection`, `nov04-f2-zero-days-afford`,
`nov04-f3-stalled-timeout`, `nov04-f3-stalled-recovered`, `nov04-f3-fallback-lang`, `nov04-f4-inbox-5000`,
`nov04-f5-dismissed-recoverable`, `nov04-f5-snoozed-recoverable`).

## 5. Regression tests added or changed

- `src/domain/auditNov04Projection.test.ts` (9): the three rebuilt fixtures validate; F1 gross totals `null` with exact
  balances in Projection, Analysis (`because` rows) and the shortfall plan; the exact boundary (a gross sum of exactly
  2⁵³ − 1 fits, one more does not; the daily estimate and simulated outflows count as outflows); a normal budget keeps
  its figures; F2 coverage per row (min 30 days / expected and extra 22), independence from the selected scenario, zero
  exact days in Projection, Analysis, Scenarios, Afford and Shortfall, a normal budget's full coverage.
- `src/domain/auditNov04Duplicates.test.ts` (10): the 5 000-movement reproduction (50 pairs, `examined` = 50), the
  blank-note bound (51; 300 reviewed + 51), equivalence with the old quadratic walk on 40 seeded ledgers (notes equal,
  blank and different; window; same occurrence; accounts; kinds; with and without reviewed pairs), the 435-pair progress
  oracle (30 identical movements, nine batches, every id once), window and exclusions; F5 the crowded-group
  reproduction (dismissed and snoozed, after a JSON round trip), snooze expiry, modified and deleted movements, restore
  and show-now, ids containing `:` and broken decisions.
- `src/i18n/auditNov04Packs.test.ts` (5): timeout aborts and retires the attempt and the retry requests a fresh URL; a
  late old attempt never caches nor retires the new one and a third wait shares the new attempt; fallback after a
  stalled requested language and recovery of that language; HTTP error and invalid JSON recovery with fresh URLs; pack
  and language isolation.
- `src/i18n/packAssets.test.ts`: the packs are never inlined.
- `tests/e2e/audit-nov04.spec.ts` (11 cases × 3 profiles): F1 Projection and Analysis; F2 rows under each selected
  scenario, zero exact days on five screens, the coverage note in en/pt/fr; F3 stalled Spanish download (timeout via the
  fake clock, retry with `?retry=`, content without reload, stored data byte-identical), stalled English download with the
  Spanish fallback marked `lang="es"` under `html[lang=en]` and recovery of English, rejected-request recovery for Legal
  and Gallery; F4 Pendientes with 5 000 movements; F5 dismissed and snoozed recovery with restore / show-now.
- Changed on purpose, each one documented: `src/i18n/auditNov02Packs.test.ts` and `src/i18n/packs.test.ts` are
  re-expressed against the fetch-based loader (same behaviours; the `failedModuleUrl` unit became a `retryUrl` unit; the
  late arrival of a timed-out attempt is now **ignored** instead of cached, because that pending import was exactly what
  hung the retry); `src/domain/auditNov02Duplicates.test.ts` compares the scan result with `toMatchObject` because
  `DuplicateScan` gained `examined`; `src/i18n/i18n.test.ts` also accepts pack keys when checking that every key used in
  the code exists; `tests/e2e/audit-nov02.spec.ts` blocks `legal.*.json`/`gallery.*.json` instead of `.js`. No test was
  removed and no assertion was weakened.

## 6. Verification commands and results (tested SHA `{{TESTED_SHA}}`)

Development runs before the chain (kept apart from the final figures): the first browser run of the new spec on the
phone profile (`evidence/final/../..`, scratch log `e2e1`) had **5 failures** — one wrong expected value in the test
(`$1,120.00`, not `$7,600.00`), one assertion aimed at a table that Scenarios does not draw without a saved scenario, and
three F3 cases plus the six P3 cases of the previous spec failing for a real defect introduced by this pass (Vite inlined
the JSON packs as `data:` URIs; fixed, §3). The second run passed {{DEV_RUN2}}.

{{CHAIN_TABLE}}

Browser matrix (`--workers=2 --fail-on-flaky-tests`, one project at a time, the same preview):

{{E2E_TABLE}}

{{PERF}}

Chain started {{STARTED}}, finished {{FINISHED}}; `dist` identified by the sha256 of its file list (`dist-sha256.txt`),
id `{{DIST_ID}}…`.

## 7. Migration, backup, recovery and undo analysis

- No data-format change: `SCHEMA_VERSION` stays 14; no migration; backups, the exact-range bound, storage conflicts and
  the undo guards are untouched. `inbox.dismissed`/`inbox.snoozed` are only read (F5); nothing is deleted or rewritten.
- The language packs are static assets: they carry no user data, are precached by the service worker (they appear in the
  generated `sw.js` list like any other asset) and are requested with `credentials: 'same-origin'` under the unchanged
  CSP. A retry URL (`?retry=<n>`) is the same file on Cloudflare Pages (query ignored) and on `vite preview`.
- F1/F2 change result types (`incomeMinor: number | null`, `lastExactDate`, `exactDays`, `noFigure`); every consumer in
  `src/ui` was updated and `tsc -b` guarantees there is no other.

## 8. What the pass preserved and re-ran

Dependency-safe undo of schedule repairs and the CAD 980 planned-expense case (`auditNov02GoalUndo`, P1 browser case),
progress through reviewed duplicate batches (`auditNov02Duplicates`, P2 browser cases, the 435-pair oracle), rejected
language-pack recovery (`auditNov02Packs`, P3 browser cases, now with JSON files), partial projection support
(`auditNov02Projection`, P4 browser cases), storage protection, backup compatibility and integer minor-unit arithmetic
(`qaV2`, `exactRange`, `qa27*`, the storage suites) all ran in the chain of §6 unchanged in intent.

## 9. Remaining limitations and unresolved points

- **Shortfall levers with hundreds of income occurrences.** `analyzeShortfall` proposes an `incomeDate` lever for every
  income occurrence after the first negative day and evaluates each with a full projection; with the gross fixture
  (400 daily incomes) and a 30-day horizon that is ≈ 2 400 projections of 800 schedules, which exhausted the test
  worker's memory. The unit test uses a 24-day horizon (no income after the shortfall) and the browser spec does not open
  `/alcanza/faltante` with that fixture. Not a correctness issue and outside the five findings; changing which levers
  are proposed is product behaviour, so it is left as documented.
- **Pending payments beyond the exact range in the budget.** `computeBudget` still sums pending payments with
  `sumMinor`: 9 008 payments of 10¹² due today (which validate, since schedules are outside the exact-range bound) throw
  and Home falls to the error boundary. The zero-exact-days reproduction therefore uses incomes. Outside this audit's
  findings; noted for a future pass.
- **`lang` granularity in Gallery and CSV import.** The fallback marking wraps the pack-driven content; a handful of
  UI-language strings inside it (the sample search placeholder, a back/close label) are pronounced as Spanish by a
  screen reader under the fallback. Legal, the user-facing page, is marked precisely.
- **Service worker and stalls.** With the service worker active the packs are served from the precache, so a stalled
  network cannot stall a pack; the stalled-download cases block the service worker on purpose.
- **CSV import texts** are now a lazy pack: the first visit per session fetches ≈ 3 KB before the form appears (served
  from the precache in production); the header is always drawn and never a key.
- Unverified: physical devices and screen readers, native pickers, the Cloudflare deployment. The audit's attachments
  (fixtures, probes, report) were never available, so their exact contents are not reproduced here beyond the brief's
  figures.

## 10. Agents and release recommendation

{{AGENTS}}

Release recommendation: {{RECOMMENDATION}}
