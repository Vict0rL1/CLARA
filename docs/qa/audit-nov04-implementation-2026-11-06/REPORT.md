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
- Commits of this pass, in order (typecheck, lint and the unit suite pass on each one alone except `220a67c` and
  `b743748`, R11 in §2b; §6): `220a67c`, `b743748`, `fa1b41c`, `485dc80`, `ebeda5a`, `1102e65`, `5618970`, `d4e2532`, `f58f5a9`, `bf11e0f`.
- **Tested SHA: `bf11e0f`** (the chain of §6 ran on it; `git status` at that moment is in `evidence/final/status.txt`).
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
third lazy pack (`bankImport`), with pack-aware plurals in `createTranslator`; the initial JS is now 841.0 KB. No budget
was raised.

## 2b. Independent review of the pass and what changed because of it

Two independent reviewer agents read the frozen implementation commits (§10) and reported findings with reproductions.
Every confirmed finding was fixed in follow-up commits on the branch (no finding was dismissed); the plausible ones were
verified first. Ids are the reviewers' own.

| Id | Reviewer | Severity | Finding | Disposition |
|---|---|---|---|---|
| R1 | domain | P1 | Shortfall plan: `dailySpendTotalMinor = daily × days` was an unchecked product (9 078 000 000 000 089 shown as …088 with valid data). | **Fixed**: exact BigInt product → `number \| null`, «Sin cifra exacta» on screen. Test `auditNov04Review` R1. |
| R2 | domain | P2 (regression of this pass) | Each lever row and the combined simulation used the base projection's last exact day («hasta el 3 dic» for a lever exact only through 4 Nov). | **Fixed**: `LeverEffect.lastExactDate`; rows use their own coverage, «Sin cifra exacta desde hoy» with none. Test R2. |
| R3 | domain | P2 | Calendar with zero exact days: «Sin saldo negativo hasta el {hoy}»; with a negative real balance it reassured instead of warning. | **Fixed**: `flowHeadline` in `domain/projection.ts` (none → `calendar.flow.noneExact`; a negative real balance is the shortfall figure), unit-tested (R3). The browser zero-days case does not open the Calendar: with 9 008 same-day schedules its agenda crashed the small-phone tab (pre-existing load limit, §9). |
| R4 | domain | P2 | Shortfall summary with a negative real balance: figure of an end of day never computed, or «faltan −40» when today's income lifts the close. | **Fixed**: `shortfallAt: 'startOfDay'` with the real balance and a one-row equation (`shortfall.firstStart`). Tests R4 ×3. |
| R5 | domain | P2 | Analysis overdue-bills total still `sumMinor`: 9 008 overdue bills of 10¹² (valid) kept the screen from opening. | **Fixed** in Analysis (`noFigure`, `titleNoFigure`). The same unchecked pattern in `computeBudget`, the weekly review and a plan's pending payments is outside this audit's screens and is listed in §9. |
| R6 | domain | P3 | Runs of movements of the same scheduled occurrence were compared one by one (3 000 partial payments: 4.5 M comparisons, 2 s per inbox view). | **Fixed**: runs skipped in one step (`nextOtherSchedule`); `examined` 0 for that ledger. Test R6. |
| R7 | domain | P3 | Repeated decision ids: rebuilt pairs read the raw arrays while classification used maps (last wins) → 51 active pairs in a group of cap 50. | **Fixed**: decisions read from the same maps. Test R7. |
| R8 | domain | P3 | Rebuilt pairs were appended after every other kind in «Descartados». | **Fixed**: inserted right after the scanned pairs. Test R8. |
| R9 | domain | P3 | Scenarios showed the partial note only when the base column was partial. | **Fixed**: any partial column; zero-day variant `scenario.partialNoteNone`. |
| R10 | domain | P3, pre-existing | A day is declared out of range when its events' sum does not fit even if balance + events would. | **Not changed**: conservative (never a wrong figure); changing the day arithmetic is outside this pass. §9. |
| R11 / B12 | both | P3 | The F1/F2 and F4/F5 commits (`220a67c`, `b743748`) deleted the old pack modules (staged early) and do not build alone. | **Not fixed in the published history**: a rebuilt history (same final tree, the old pack files kept until the F3 commit) was prepared, but publishing it needs a force push, which was not authorised in this session. The two commits stay as pushed and fail `tsc` alone (§6 shows it); `git bisect` must skip them. Every later commit builds and tests alone. |
| T1–T4 | domain | test quality | Dead code; a work assertion that only bounded `examined`; a loosened `toMatchObject`; a tautological scenario loop. | **Fixed**: `examined` must equal the exact number of pairs the old walk considers (real fingerprints, stale fingerprints included); `toEqual` with `examined: 0`; each row compared with its own projection. |
| B1 | browser | P2 | «Sin cifra exacta: la suma no cabe…» as a non-wrapping value pushed the Analysis explanation off-screen on phones. | **Fixed**: short value («Sin cifra exacta») and the reason as a note below. |
| B2 | browser | P2 | `expectNoHorizontalScroll` (and `layout-a11y`) measured `window.innerWidth`, which grows with the overflow under `isMobile`: overflow was invisible on both phone profiles. | **Fixed**: measure against `documentElement.clientWidth`. The corrected guard immediately failed the repo's own 200 % text test on both phones (40 px on Home). Those were real, pre-existing overflows, fixed with CSS that keeps the normal look: the upcoming-payments strip, the day totals in Movimientos, the hero action row («¿Cómo?» 16 px out at 412 px; a first fix of mine, `flex: none`, broke the French button and was corrected), the hero legend and the «Más herramientas» links («escenarios» could not break in a half column). A probe of 18 screens × 4 languages × 100 %/200 % × 3 profiles then found no overflow. Statistics and «¿Me alcanza?» with a price still overflow at 200 % (not in the repo's 200 % list; §9). |
| B3 | browser | P2 (a11y) | Importar CSV under the Spanish fallback put interface text (notice, child components) inside `lang="es"` and turned interface keys Spanish; Gallery similar. | **Fixed**: `PackLangScope` — under the fallback everything inside is Spanish (the context translator is Spanish too) and marked `lang="es"`; header and notice outside in the interface language; `packTranslator` never routes interface keys through the pack. Browser test. |
| B4 | browser | P3 | «Reintentar» on the fallback note emptied the screen (and an open dialog) for up to 15 s. | **Fixed**: a ready result stays visible while a retry runs. |
| B5 | browser | P3 | Zero exact days still showed «Ingresos estimados $0.00», a «hasta el día antes» note, «solo hoy» in Afford. | **Fixed**: «Sin cifra exacta», `scenario.partialNoteNone`, reworded `afford.partialLowestNone`. |
| B6 | browser | P3 | «(1 días)» in the coverage note. | **Fixed**: plural keys `projection.coverageFull/Until_one/_other`. |
| B7 | browser | P3 | «Sin cifra exacta» cells not linked to their note. | **Fixed**: `aria-describedby` joins the coverage and gross notes. |
| B8 | browser | P3 | The 2026-11-02 spec blocked `legal.*.json` but not `?retry=` URLs, so recovery steps did not prove anything. | **Fixed**: `.json*` patterns and a still-blocked → still-failed step. |
| B9 | browser | P3 | Races: request count asserted without retry; fake clock advanced before the request was in flight. | **Fixed**: `expect.poll` on the request count before advancing the clock. |
| B10 | browser | P3 | Duplicate test runs through a cross-file import; pack `{x}`/plural parity no longer checked; pack keys accepted everywhere by the key test; no test of the real `fetch` path. | **Fixed**: helper in `src/test/packFiles.ts`; parity test for all packs; pack keys only accepted in files that translate with a pack; `requestJson` tests (404, HTML, no-store on retry, sync throw). |
| B11 | browser | P3 | A `?retry=` request could replay an immutable cached bad response, and skipped the precache offline. | **Fixed**: retries use `cache: 'no-store'`; the service worker answers `/assets/*.json` with `ignoreSearch` and never stores a marked URL (SW unit test). |
| B13 | browser | P3 | Header comment, unused `loadPack`, `timeoutMs = 0` undocumented, a synchronously throwing request left the attempt pending. | **Fixed**. |
| B14 | browser | P3 | Comparison cells wrapped word by word (≈ 140 px rows at 412 px). | **Fixed**: the comparison table keeps cells on one line inside its scroll region. |

The first final chain (§6, on `f58f5a9`) then failed on two more points, both handled in `bf11e0f` before the chain
was run again from the start:

- **C1 · stale test expectation.** The zero-exact-days browser case still looked for the old «¿Me alcanza?» wording
  («solo hoy; después sin cifra») that B5 had replaced with «sin cifra exacta: es el saldo real de hoy». The screen
  was right; the test now expects the new text.
- **C2 · Statistics with extreme amounts on phones** (pre-existing, made visible by the corrected guard of B2). With
  the exact-range and QA27 fixtures (totals up to 2⁵³ − 1 ≈ 9.007 × 10¹⁵ minor units) Statistics scrolled sideways by 114 px at
  320 px and 22 px at 412 px: the amount in the donut rows and in the top-expenses list sat in an `auto` grid column
  with no break opportunity, and the donut's centre total was clipped by the SVG, so its visible part read as a
  different figure. Now those amounts wrap (`overflow-wrap: anywhere`, which changes nothing when they fit) and the
  centre total is measured and scaled down to fit the hole only when it is too wide (`DonutTotal`).

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

- **C2 (first final chain).** `src/styles.css` (`.donut__amount`, `.top-list__amount`: `overflow-wrap: anywhere`) and
  `src/ui/components/statsCharts.tsx` (`DonutTotal`: `getComputedTextLength` after the fonts load; a `transform`
  scale around the centre only when the text is wider than the hole; jsdom has no SVG text metrics and keeps the
  unscaled text).

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

C2 before (`f58f5a9`) and after (`bf11e0f`), each build served on its own, with the exact-range fixture (9 007
expenses of 10¹² plus the rest up to 2⁵³ − 1) on Statistics: horizontal overflow 22 px → 0 at 412 px, 114 px → 0 at
320 px, 0 → 0 at 1 280 px; the donut's centre total ($90,071,992,547,409.91) is drawn whole after (scale ≈ 0.49) and
clipped before. Screenshots `evidence/c2-statistics/{before,after}-<profile>-{donut,top}.png`, figures in
`c2-measures.txt`.

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
- `src/domain/auditNov04Review.test.ts` (10): the reviewers' reproductions R1–R8 (exact daily-spend product, per-lever
  coverage, the Calendar flow headline with zero exact days and with a negative real balance, the start-of-day
  shortfall ×3, the overdue total without a figure, same-occurrence runs skipped, repeated decision ids, the order of
  rebuilt pairs).
- `src/i18n/packAssets.test.ts`: the packs are never inlined.
- `tests/e2e/audit-nov04.spec.ts` (13 cases × 3 profiles): F1 Projection and Analysis; F2 rows under each selected
  scenario, zero exact days on five screens, the coverage note in en/pt/fr; F3 stalled Spanish download (timeout via the
  fake clock, retry with `?retry=`, content without reload, stored data byte-identical), stalled English download with the
  Spanish fallback marked `lang="es"` under `html[lang=en]` and recovery of English, rejected-request recovery for Legal
  and Gallery; the CSV import under the Spanish fallback (B3) and in the four languages; F4 Pendientes with 5 000 movements; F5 dismissed and snoozed recovery with restore / show-now.
- Changed on purpose, each one documented: `src/i18n/auditNov02Packs.test.ts` and `src/i18n/packs.test.ts` are
  re-expressed against the fetch-based loader (same behaviours; the `failedModuleUrl` unit became a `retryUrl` unit; the
  late arrival of a timed-out attempt is now **ignored** instead of cached, because that pending import was exactly what
  hung the retry); `src/domain/auditNov02Duplicates.test.ts` compares the whole scan result with `toEqual`, now including
  `examined: 0`, because `DuplicateScan` gained `examined` (T3); `src/i18n/i18n.test.ts` also accepts pack keys when checking that every key used in
  the code exists; `tests/e2e/audit-nov02.spec.ts` blocks `legal.*.json`/`gallery.*.json` instead of `.js`. No test was
  removed and no assertion was weakened.

## 6. Verification commands and results (tested SHA `bf11e0f`)

Development runs before the chain (kept apart from the final figures), phone profile:

- Run 1 (`e2e1`): **5 failures** in the new spec — one wrong expected value written in the test (`$1,120.00`, not
  `$7,600.00`), one assertion aimed at a table Scenarios does not draw without a saved scenario, and three F3 cases —
  plus the six P3 cases of the 2026-11-02 spec, all caused by a real defect introduced by this pass (Vite inlined the
  JSON packs as `data:` URIs; fixed, §3).
- Run 2 (`e2e2`): 21 passed, **1 failed** (the zero-exact-days case: the first render of 9 008 schedules exceeded the
  5 s wait while another spec ran in parallel); passed alone in 9.3 s (`e2e3`); the wait for that heavy fixture's first
  render is now 20 s. The import-screen specs: 28/28.
- Run 3 (`e2e4`, after the review fixes, both phone profiles, audit + layout + import specs, with the corrected scroll
  guard): 64 passed and **2 failed per profile** — the zero-exact-days case (opening the Calendar with 9 008 same-day
  schedules: the 320 px tab crashed, the 412 px one timed out) and `layout-a11y`'s 200 % text test (40 px of real
  overflow on Home, invisible to the old guard). Both were handled as described in §2b (R3, B2); the overflow probe
  that followed (18 screens × 4 languages × 100 %/200 % × 3 profiles) found none.

### First final chain — `f58f5a9` (initial result, kept as it ran)

2026-11-06 19:50–20:31 UTC, same script, same settings; outputs in `evidence/final-chain1-f58f5a9/`. Per commit: 7 of
9 exit 0 (`220a67c` and `b743748` fail `tsc` alone, R11). `npm run check` exit 0; unit suite 1 236 passed, 1 skipped,
0 failed; focused regressions 163 passed; build exit 0; initial JS 841.0 KB (budget 844.6 KB, unchanged);
`npm audit` 0 vulnerabilities; performance budgets inside the suite passed.

| Project | Passed | Failed (initial) | Flaky | Skipped | Exit |
|---|---|---|---|---|---|
| celular | 402 | **3** | 0 | 1 | 1 |
| celular-pequeno | 403 | **3** | 0 | 0 | 1 |
| escritorio | 402 | **1** | 0 | 3 | 1 |

The failures were `audit-nov04.spec.ts:163` on all three profiles (C1) and `exact-range.spec.ts:40` and
`qa27.spec.ts:266` on both phone profiles (C2), described in §2b. None was rerun into a pass: both were fixed in a new
commit (`bf11e0f`, pushed as a fast-forward). Before the second chain, a targeted run of the three failing specs with
`exact-range`, `statistics`, `layout-guards` and `layout-a11y` on the three profiles gave 135 passed, 0 failed. That
first targeted run also caught a third overflow on the 320 px profile (the top-expenses list with the exact-range
fixture, 33 px). It was fixed in the same commit before the 135-pass run.

### Final chain — `bf11e0f` (tested SHA)

| Step | Result |
|---|---|
| Each commit of the pass alone (`tsc -b`, `oxlint`, `vitest run` in a temporary worktree; the first nine in the first chain, `bf11e0f` in this one) | `220a67c` **FAIL** · `b743748` **FAIL** · `fa1b41c` ok · `485dc80` ok · `ebeda5a` ok · `1102e65` ok · `5618970` ok · `d4e2532` ok · `f58f5a9` ok · `bf11e0f` ok — 8 / 10 exit 0; the failing ones are R11 (§2b): `tsc` cannot find the deleted pack modules (`worktree-<sha>.txt`) |
| `npm run check` (typecheck + oxlint + i18n literal check + Vitest) | exit 0 |
| `vitest run --reporter=json` (`vitest.json`) | 131 test files · **1236 passed**, 1 skipped, 0 failed of 1237 |
| Focused regressions (the four new unit files, `packAssets`, the pack suites, the 2026-11-02 suites, `qa27Duplicates`, `inbox`, `duplicates`, `qaV2`, `projection`, `analysis`, `scenarios`, `shortfall`, `affordability`, `qa27FutureBalance`, `exactRange`) | 163 passed · exit 0 |
| `npm run build` | exit 0 · dist identified by the sha256 of its file list (`dist-sha256.txt`), id `969672e145b1694e…` |
| `npm run size` (budget unchanged: baseline × 1.1 = 844.6 KB) | 841.0 KB en 13 archivos (gzip 252.4 KB) · 767.8 KB · límite 844.6 KB · cambio +9.5 % · exit 0 |
| `npm audit --audit-level=high` | found 0 vulnerabilities · exit 0 |

Browser matrix (`--workers=2 --fail-on-flaky-tests`, one project at a time, the same preview):

| Project | Passed | Failed (initial) | Flaky (passed on retry) | Skipped | Duration | Exit |
|---|---|---|---|---|---|---|
| celular | 405 | 0 | 0 | 1 | 9.7 min | 0 |
| celular-pequeno | 406 | 0 | 0 | 0 | 9.2 min | 0 |
| escritorio | 403 | 0 | 0 | 3 | 9.9 min | 0 |

Screenshot runs of `audit-nov04.spec.ts` (`--workers=1`, same preview): celular exit 0 · celular-pequeno exit 0 · escritorio exit 0.

Performance budgets inside the suite (from the list reporter):

```
Inicio con 10k: cifra principal a los 294 / 278 ms
Historial con libro grande: primera entrada a los 307 / 47 ms desde Inicio; 15 entradas con dependientes a la vista
  ✓  179 [celular-pequeno] › tests/e2e/performance-history.spec.ts:57:1 › Historial con 10 000 movimientos, 100 programados, 1 000 pagos vinculados y 30 cambios de programados: desde Inicio, la primera entrada en < 300 ms (2.3s)
Inicio con 10k: cifra principal a los 269 / 195 ms
Historial con libro grande: primera entrada a los 304 / 38 ms desde Inicio; 15 entradas con dependientes a la vista
  ✓  179 [celular] › tests/e2e/performance-history.spec.ts:57:1 › Historial con 10 000 movimientos, 100 programados, 1 000 pagos vinculados y 30 cambios de programados: desde Inicio, la primera entrada en < 300 ms (2.7s)
Inicio con 10k: cifra principal a los 431 / 382 ms
Historial con libro grande: primera entrada a los 312 / 53 ms desde Inicio; 15 entradas con dependientes a la vista
  ✓  179 [escritorio] › tests/e2e/performance-history.spec.ts:57:1 › Historial con 10 000 movimientos, 100 programados, 1 000 pagos vinculados y 30 cambios de programados: desde Inicio, la primera entrada en < 300 ms (3.0s)
```

Chain started 2026-11-06T20:47:18Z, finished 2026-11-06T21:20:56Z; `dist` identified by the sha256 of its file list (`dist-sha256.txt`),
id `969672e145b1694e…`.

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
- **Pending payments beyond the exact range elsewhere (R5, partly).** `computeBudget` (Home's available money), the
  weekly review's upcoming-payments total and a plan's pending payments still sum scheduled amounts with `sumMinor`:
  9 008 payments of 10¹² due today (which validate, since schedules are outside the exact-range bound) throw there, and
  Home falls to its error boundary. The Analysis instance is fixed in this pass; the others change the main available
  figure and two other screens, outside this audit's findings, and are left for a dedicated pass. The zero-exact-days
  reproduction therefore uses incomes.
- **200 % text on two screens outside the repo's 200 % list** (demo data, probed on `f58f5a9` and on `bf11e0f`;
  `evidence/c2-statistics/200-measures.txt`). «¿Me alcanza?» after typing a price (the before/after comparison table)
  scrolls sideways at 200 % on phones: 133 px at 412 px and 226 px at 320 px, unchanged by this pass. Statistics no
  longer does at 412 px after C2 (96 px → 0) and does less at 320 px (187 px → 75 px): what remains are the donut rows
  (percentage column and bar), which need a different row layout at that size. Both were already like this before this
  pass and were invisible to the old guard; a layout change of two components is left for a dedicated pass. Every screen
  in `layout-a11y`'s 200 % list and 18 screens probed in four languages are clean.
- **Calendar with thousands of schedules on one day.** Opening the Calendar with 9 008 schedules due the same day (the
  zero-exact-days fixture) renders every item in the day agenda and crashed the 320 px tab in the browser run; the 412 px
  tab rendered it slowly. Pre-existing, outside the findings; the flow headline's logic is unit-tested instead (R3).
- **Out-of-range granularity (R10). A day is declared without a figure when the sum of that day's events does not fit,
  even if balance + events would (e.g. 9 007 × 10¹² balance and 9 008 bills of 10¹²). Conservative — never a wrong
  figure — and unchanged.
- **Spanish fallback details.** Under the fallback, dates inside the Spanish content keep the interface language's
  format (Ajustes › Formato), toasts raised from the import flow are in Spanish without a `lang` mark (the toast area is
  shared), and the Gallery's sheet and dialog render in a portal outside the marked container. Legal, the user-facing
  page, contains only pack text and is marked precisely.
- **Service worker and stalls.** With the service worker active the packs are served from the precache, so a stalled
  network cannot stall a pack; the stalled-download cases block the service worker on purpose.
- **CSV import texts** are now a lazy pack: the first visit per session fetches ≈ 3 KB before the form appears (served
  from the precache in production); the header is always drawn and never a key.
- Unverified: physical devices and screen readers, native pickers, the Cloudflare deployment. The audit's attachments
  (fixtures, probes, report) were never available, so their exact contents are not reproduced here beyond the brief's
  figures.

## 10. Agents and release recommendation

Which agents actually worked, and on what:

| Agent | Responsibility | What it did | Result |
|---|---|---|---|
| Implementation lead (this session) | Implementation, reproductions, verification, report | Rebuilt the five reproductions on `main`, implemented F1–F5, wrote the regressions, ran both final chains, fixed the confirmed review findings and the two failures of the first chain (C1, C2), wrote this report. | — |
| Domain / financial reviewer (subagent, first launch) | Independent review of the F1/F2 and F4/F5 commits | Stopped by a usage limit before reading anything. | No output; relaunched. |
| Browser / packs reviewer (subagent, first launch) | Independent review of F3 and the browser tests | Stopped by a usage limit before reading anything. | No output; relaunched. |
| Domain / financial reviewer (subagent, relaunched) | Same scope, frozen commits, read-only, probes deleted afterwards | 76 tool calls in ≈ 19 min: diffs, consumers, adversarial probes (600 seeds × 4 predicates against the old scan, zero-day and lever fixtures). | 1 P1, 4 P2, 6 P3 and 4 test-quality findings (R1–R11, T1–T4); F4 equivalence found exact. All confirmed findings fixed (§2b) except R10 (conservative, documented) and R11 (a clean history needs a force push, not authorised in this session). |
| Browser / packs reviewer (subagent, relaunched) | Same scope, read-only, one scratch build, no Playwright | 116 tool calls in ≈ 21 min: loader lifecycle, scratch build and `sw.js`, text-width measurements with the repo's fonts, test brittleness. | 3 P2 and 11 P3 findings (B1–B14); all fixed (§2b) except B12, which is R11. Its B2 finding exposed pre-existing 200 % overflows, fixed in the same pass, and the Statistics overflow with extreme amounts that the first final chain caught (C2). |

No agent wrote to the repository: the reviewers worked on the frozen commits and reported; every change was made, tested
and committed by the implementation lead.


Release recommendation: **ready for the next audit; merge only with the two caveats below.** All five findings
are fixed and verified on the tested SHA `bf11e0f`. The unit suite has 1 236 passed and 0 failed. The browser matrix on
the three profiles had 1 214 passed, 0 failed and 0 flaky, in the single, unrerun run of the second final chain; the
first chain's failures are kept in §6. The initial JS is 841.0 KB, under the unchanged 844.6 KB budget.

Caveats:

1. **R11.** Two commits of the history (`220a67c`, `b743748`) do not build alone. A squash merge keeps them out of
   `main`; a merge commit keeps them, and `git bisect` must then skip them.
2. **Pre-existing limits (§9).** These stay outside the five findings and belong in a follow-up pass:
   - pending-payment sums in `computeBudget`, the weekly review and plans with extreme scheduled amounts;
   - 200 % text on «¿Me alcanza?», and on Statistics at 320 px;
   - the Calendar with thousands of schedules on one day;
   - the shortfall levers' cost with hundreds of incomes.
