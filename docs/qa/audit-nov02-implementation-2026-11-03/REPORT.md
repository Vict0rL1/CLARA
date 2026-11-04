# Implementation of the 2026-11-02 independent audit — 2026-11-03 (PR #15, branch `claude/margen-personal-finance-app-cdvrt3`)

Audited commit: `420c70076e7405cefce8ac524c654f0049d6898b` (the head of PR #15 at the time of the audit). This pass
reproduced each of the four findings on the audited commit, fixed them in one commit per finding on the branch,
re-encoded the audit's reproductions as permanent regressions (unit and browser, three screen profiles), and ran the
repository's own verification chain on the tested commit. The implementation evidence is under `evidence/` and is
separate from the independent audit's evidence, which this pass did not receive (see §0).

## 0. What arrived and what did not

The brief named an audit report, evidence, three synthetic fixtures (`goal-undo-fixture.json`,
`duplicate-cap-fixture.json`, `projection-overflow-fixture.json`) and archived reproduction tests
(`audit-nov02-goal-undo.test.ts.txt`, a duplicate-cap probe, an overflow diagnostic). **None of those files reached this
session**: no upload directory, no repository branch, no issue, no artifact held them. Every reproduction below was
rebuilt from the brief's own step-by-step descriptions and numbers; where the brief gave a figure (980 → 560,
22 exact days, `outOfRangeFrom: 2026-11-24`, 50 historical pairs, `legal.es-*.js` blocked) the rebuilt reproduction
matches it exactly. The independent audit's counts quoted in the brief (1 165 unit tests passed, 1 120 browser tests
passed with 22 timeouts during a recorded computer sleep, 20/3 domain probes, 9 failed correctness assertions) are the
audit's numbers, not re-measured here, and are not restated as this pass's results.

## 1. Baseline, tested SHA and final SHA

- Checkout found: `/home/user/ALCANZA` on the branch at `420c700`, clean, equal to the remote; nothing had changed after
  the audited version.
- Commits of this pass, in order, each one self-contained (typecheck, lint and the unit suite pass on each one alone,
  §6): `648b002` P1 · `dbe8064` P2 · `3a0a0d3` P3 · `9af6cdc` P4 · `8073aca` browser tests (P1–P4, three profiles).
- **Tested SHA: `8073aca`** (the chain of §6 ran on it with `git status` showing only the three uncommitted
  documentation files `AGENTS.md`, `CLAUDE.md`, `docs/FORMULAS.md`, which do not affect any check).
- **Final SHA: the documentation-only commit that follows `8073aca`** (this report, its evidence, the three documentation
  files and the changelog). `git log -1` on the branch shows it; the tested SHA is its parent.

## 2. Per-finding disposition

| Id | Severity | Disposition | Where |
|---|---|---|---|
| P1 · unsafe undo of a repair with a funded planned expense | P1 (financial) | **Fixed** (`648b002`). `revertDependents` now evaluates every schedule reference twice: as it is today against today's schedules, and as it would be after the undo against the reverted schedules. A reference that resolves today and would not resolve afterwards is a dependent: a removed schedule (F-02, unchanged), or — new — an occurrence-level reference (planned-expense link, active snooze) whose date would no longer be an occurrence under the **same** schedule id after a change of anchor, rule, start or end. The refusal mutates nothing; History names the planned expense and the linked date («Gasto planificado «Internet», vinculado al pago del 31 mar…»). The reproduction keeps CAD 980 available before and after the refusal, after reload and after a backup round trip. | `src/domain/historyRevert.ts`, `src/ui/screens/History.tsx`, i18n ×4 |
| P2 · duplicate detection starvation | P2 (regression from QA27-03b) | **Fixed** (`dbe8064`). The per-group cap of 50 now counts only unreviewed pairs: `scanDuplicates` walks each group in the same fixed order, lists already-reviewed pairs (dismissed with the same fingerprint, or snoozed into the future) without letting them consume the cap, and stops at 50 new pairs; when a group holds more unreviewed pairs than the cap the view says so (`InboxView.moreDuplicates`) and Pendientes shows a continuation note. Ids, fingerprints, exclusions and the 5 000 + 5 000 bound are unchanged. The historical-50 reproduction now offers the new same-day pair. | `src/domain/inbox.ts`, `src/ui/screens/Inbox.tsx`, i18n ×4 |
| P3 · failed lazy language-pack recovery | P3 (reliability/presentation) | **Fixed** (`3a0a0d3`). The loader keeps three distinct states (loading, ready — with the requested language or with Spanish as a declared fallback —, failed); a failure or an empty module is never cached; in-flight loads are shared; a load that does not answer within 15 s becomes failed; the retry is only on user action or on re-opening the screen. Because Chromium and Firefox remember a failed module fetch for the page's lifetime (probe in §4), the retry imports the chunk URL reported by the browser with a cache-busting query; when the browser does not report the URL (Safari) the screen also offers «Recargar la app». `PackNotice` renders the states in Legal and Gallery; no internal key is ever drawn. | `src/i18n/packs.ts`, `src/ui/components/PackNotice.tsx`, `src/ui/screens/Legal.tsx`, `src/ui/screens/Gallery.tsx`, i18n ×4 |
| P4 · projection exact-range handling | documented limitation, reproduced | **Fixed** (`9af6cdc`). `projectBalance` never throws any more and no longer has the `stopWhenOutOfRange` option: for every caller it stops at the first day whose balance is not an exact integer and reports `outOfRangeFrom` (plus `horizonDays`). Every consumer declares what it cannot claim: Projection shows «Sin cifra desde el {date}» (and keeps an exact shortfall found earlier), Analysis adds the `projectionOutOfRange` item with the last exact day and the first day without a figure, the shortfall plan never says «sin faltante» or «lo evita» on a partial projection (`LeverEffect.resolves` requires the full horizon), Scenarios leaves the end balance without a figure and marks «no hasta el {day before}», and «¿Me alcanza?» keeps the verdict based on today's available money and states up to which day not seeing a future shortfall holds. Nothing is rounded, clamped or invented; ordinary budgets keep their results. | `src/domain/projection.ts`, `analysis.ts`, `shortfall.ts`, `scenarios.ts`, `affordability.ts`, `statistics.ts`, `exactRange.ts`, `src/ui/screens/{Projection,ShortfallPlan,Scenarios,Afford,Insights,Calendar}.tsx`, i18n ×4 |

## 3. Root causes and changed files

- **P1.** `revertDependents` only looked for references whose *schedule id* would disappear. A planned-expense link
  (`goal.plan.link = { scheduleId, occurrenceDate }`) and a snooze (`due:schedule:<id>:<date>`) point at a concrete
  occurrence; after an in-place repair (same id, `anchorDate` set) the undo restores the old anchor and the linked date
  stops being an occurrence, while `scheduleCoverage` (reserves) no longer finds the bill the planned expense covered.
  The bill is reserved again and the set-aside money stays reserved: 1 400 − 420 − 420 = 560. `validateAppData` checks
  the link's shape, not its resolution, so the state persisted and round-tripped. The fix compares references
  now-vs-now and after-vs-after (`scheduleReferences` gains a stable `key` and the `occurrenceDate`; `resolves()` checks
  existence and, when a date is present, series membership — skipped dates are ignored on purpose, as for payments: a
  skipped occurrence is not reserved, so no double count arises). Entries that touch goals, snoozes, templates or
  scenarios are now also evaluated (previously only schedules/transactions), so an undo that would *restore* a dangling
  link is refused too. Changed: `src/domain/historyRevert.ts` (`RevertDependent.occurrenceDate`, `scheduleReferences`,
  `resolves`, `REFERENCE_COLLECTIONS`, the payment scan unchanged and still bounded), `src/ui/screens/History.tsx`
  (`history.dependent.goalLinked`), `src/i18n/{es,en,pt,fr}.ts`, `src/domain/qaFollowUp.test.ts` (its F-02
  expectation now includes the snooze's `occurrenceDate`; a stronger assertion, not a weaker one).
- **P2.** `possibleDuplicates` produced the first 50 pairs of each group and `inboxView` filtered dismissed/snoozed ones
  afterwards. The cap had been added by QA27-03b to stop a quadratic blow-up (12.5 million pairs); applying it before the
  review state meant 50 reviewed pairs permanently filled the group. Changed: `src/domain/inbox.ts` (`scanDuplicates`
  with a `ReviewedPredicate`, `DuplicateScan.truncated`, `computeInboxDetailed`, `InboxView.moreDuplicates`;
  `possibleDuplicates` keeps its old meaning for callers without review state; notes normalised once per movement),
  `src/ui/screens/Inbox.tsx` (continuation note `inbox-more-duplicates`), `src/i18n/{es,en,pt,fr}.ts`.
- **P3.** `loadPack` caught any failure and cached `{}` (for Spanish) or the Spanish fallback as the pack; `usePackT`
  then built a translator whose unknown keys fell through `translate()` to the key itself. Also, a plain `import()`
  retry would not have helped: the browser's module map remembers the failed fetch (§4, probe). Changed:
  `src/i18n/packs.ts` (`createPackLoader` with injectable loaders and fresh-import for tests, `failedModuleUrl`,
  `PACK_LOAD_TIMEOUT_MS`, `usePack` with `PackState`), `src/ui/components/PackNotice.tsx` (new), `Legal.tsx`,
  `Gallery.tsx` (header and notice are drawn in every state), `src/i18n/{es,en,pt,fr}.ts` (`packs.*`).
- **P4.** `projectBalance` threw `RangeError('Desbordamiento al sumar importes')` unless the caller passed
  `stopWhenOutOfRange`; only Calendar and Statistics did. Changed: `src/domain/projection.ts` (option removed, result
  always carries `outOfRangeFrom` and `horizonDays`, `ScenarioComparison.outOfRangeFrom`), `analysis.ts`
  (`projectionOutOfRange` item, `because` ids `exactUntil`/`outOfRangeFrom`), `shortfall.ts`
  (`LeverEffect.outOfRangeFrom`, `resolves` only with a complete projection), `scenarios.ts`
  (`ScenarioResult.outOfRangeFrom`), `affordability.ts` (`AffordResult.projectionOutOfRangeFrom`), `statistics.ts` and
  `src/ui/screens/Calendar.tsx` (option dropped), the five screens, `src/i18n/{es,en,pt,fr}.ts`,
  `src/domain/qaV2.test.ts` (the QA V2 contract moves from «throws without the option» to «stops and reports»: the
  detection is still asserted, the delivery changes by design; recorded here as a deliberate contract change).

## 4. Before/after evidence (implementation evidence, synthetic data)

All «before» values were measured on `420c700` (unit probes under `evidence/before/*.json`, browser observation
against a preview of a `420c700` build in `evidence/before/before-browser-420c700-celular.log` with the archived spec
`before-nov02.spec.ts.txt` and screenshots under `evidence/before/screenshots/`). All «after» values come from the
permanent regressions on the tested SHA.

| Finding | Before (`420c700`) | After (`8073aca`) |
|---|---|---|
| P1 · 1 400 balance, monthly 420 bill repaired in place (28-mar → 31-mar), planned expense linked to `b2 / 2026-03-31` with 420 set aside | Available 98 000 minor; `canRevert` = `ok`; revert accepted; available **56 000**; goal link still `b2 / 2026-03-31`, `b2.anchorDate` gone; `validateAppData` ok; backup round trip ok with 56 000 (`p1-before-420c700.json`). Browser: History offers «Revertir», Home shows **$560.00** after the revert and after reload (`before-p1-*.jpg`) | `canRevert` = `dependents` with `[{ kind: 'goal', id: 'g1', name: 'Internet de marzo', scheduleId: 'b2', occurrenceDate: '2026-03-31' }]`; `revertEntry` refuses with `revertDependents` (count 1); the serialized data is byte-identical before and after the refusal; available stays **98 000** after reload and after export/import. Browser: History shows the refusal naming the planned expense and «31 mar», no «Revertir», Home **$980.00** after reload (three profiles) |
| P1 · same class under the same id | — | End-date, start-date and rule (monthly → semimonthly) edits with a link to a date that exists only after the edit are refused; an amount edit is still revertible; an active snooze of the corrected date blocks until it expires (R5); a template line by id does not block an in-place repair |
| P2 · 50 historical same-day pairs of 4.25 «Café», four days apart, all dismissed; two new 4.25 «Café» today | Both stored; active duplicates after the new pair: **none** (`p2-before-420c700.json`); browser: Pendientes shows no «Posibles duplicados» group (`before-p2-*.jpg`) | Active: `['dup:new1:new2']`, `moreDuplicates: false`, 50 dismissed still listed and recoverable; «Son distintos» closes it; after reload nothing pending and «Descartados (51)». 50 snoozed pairs do not starve either; when they expire they count again and the view declares that more exist |
| P2 · completeness | — | For three seeded random ledgers (48 movements, two accounts, mixed notes) the inbox offers exactly the set an independent O(n²) pair calculation expects, and after dismissing one of every three exactly the rest; for 12 identical same-day movements (66 pairs) the first view shows 50 and declares more, and reviewing in batches reaches each of the 66 pairs exactly once; the 5 000 + 5 000 same-day case stays at 50 per group, same first pairs, under one second before and after dismissing a batch |
| P3 · `legal.es-*.js` blocked, service worker blocked, Privacy opened | Page shows `legal.privacy.1.text` and the other keys; navigating away and back with the network restored still shows keys (`before-p3-privacy-keys-celular.jpg`) | Readable failure state («No se pudo cargar este texto», «Reintentar», «Recargar la app»), no key in the page; with the network back, re-opening the screen or «Reintentar» restores the real text without reload and the data figure is unchanged; English with its file blocked shows the Spanish text with the note «This text could not be loaded in your language; it is shown in Spanish.» and «Retry» returns English; both files blocked → failure state in English and «Reload the app» recovers; Gallery blocked → header plus failure state, «Reintentar» draws the gallery; es/en/pt/fr content verified with the network |
| P3 · browser module map (probe) | A second `import()` of the failed chunk URL rejects **without a network request** in Chromium; the same file with `?retry=1` is fetched and loads (`chromium-module-map-probe-result.json`) | The retry imports the reported chunk URL with a cache-busting query (`failedModuleUrl`), covered by unit tests with fake loaders |
| P4 · 400 valid daily schedules of 10¹² minor units, today 2026-11-02 | `validateAppData` ok; `projectBalance` (Projection), `analysisItems` (Analysis), `analyzeShortfall`, `scenarios.compare` and `simulatePurchase` all throw «Desbordamiento al sumar importes» (`p4-before-420c700.json`); browser: Projection and Analysis show «No se pudo abrir esta pantalla» (`before-p4-*.jpg`) | 22 exact days, `outOfRangeFrom = 2026-11-24`, `horizonDays = 30`, each day a safe integer, no throw anywhere; Analysis keeps the exact day-1 shortfall and adds `projectionOutOfRange` (until 23-nov, from 24-nov); shortfall plan: exact shortfall on day 1 with no lever «resolving»; with 400 daily *incomes* (positive overflow, never negative) status `none` but `resolves: false` everywhere; Scenarios and Afford carry 24-nov; the 40-schedule variant fills all 30 days with `outOfRangeFrom: null`; ordinary budgets unchanged. Browser: the five screens show their explanatory state in es/en/pt/fr and Home, Movements, the movement form and the backup screen still open |

## 5. Regression tests added or changed

| File | Cases | What they pin |
|---|---|---|
| `src/domain/auditNov02GoalUndo.test.ts` | 8 | The reproduction (980 stays, refusal names the goal, reload and round trip), safe undo without the link (dates return to the 28th and 560 is then the honest figure of two separate items), id-only template reference does not block, end/start/rule edits, amount edit still revertible, active vs expired snooze |
| `src/domain/auditNov02Duplicates.test.ts` | 7 | The reproduction, snooze starvation and expiry, edits that change the fingerprint or end the pair, exclusions (transfers, adjustments, splits, partial settlements), the 5 000 + 5 000 bound with a dismissed batch, completeness against an independent expected-pair calculation (random ledgers and the 66-pair group) |
| `src/i18n/auditNov02Packs.test.ts` | 7 | Failed Spanish not cached and recovered on retry, fallback to Spanish with a later successful retry, both failing, empty/blank modules rejected, shared in-flight load and timeout, URL-based retry, `failedModuleUrl` parsing, real modules through `loadPack` |
| `src/domain/auditNov02Projection.test.ts` | 7 | The 22-day/24-nov reproduction, Analysis item, shortfall plan (low and positive variants, `resolves`), Scenarios, Afford, ordinary budget unchanged, 40-schedule variant |
| `src/domain/qaV2.test.ts` | 1 changed | QA V2 projection contract: never throws, stops and reports, `horizonDays` |
| `src/domain/qaFollowUp.test.ts` | 1 changed | F-02 expectation includes the snooze's `occurrenceDate` |
| `tests/e2e/audit-nov02.spec.ts` | 11 × 3 profiles | P1 end to end through the real screens (repair, planned-expense form, History, reload); P2 the historical-dismissal reproduction and the «more than the cap» continuation; P3 six cases with `page.route` fault injection and `serviceWorkers: 'block'`; P4 the five screens plus the three other languages |

The archived observation of the broken state (`evidence/before/before-nov02.spec.ts.txt`) deliberately asserts the
defective behaviour and is **not** part of the suite; the permanent specs assert only the safe behaviour.

## 6. Verification commands and results (tested SHA `8073aca`)

Run sequentially on `8073aca3bf4148dd4f254d911e2284fac2a114cb` from 2026-11-03T08:13:14Z to 2026-11-03T08:47:28Z UTC (nothing else building or testing meanwhile; raw outputs
under `evidence/final/`). CI on GitHub for the same commit: `check`, `e2e (celular)`, `e2e (celular-pequeno)`,
`e2e (escritorio)` and `deploy-preview / Cloudflare Pages` all succeeded (preview `https://6df584e3.clara-d3m.pages.dev`,
@smoke on celular passed), as recorded by the PR's check runs.

| Step | Result |
|---|---|
| Each commit of the pass alone (`tsc -b`, `oxlint`, `vitest run` in a temporary worktree) | `648b002` ok · `dbe8064` ok · `3a0a0d3` ok · `9af6cdc` ok · `8073aca` ok — 5 / 5 exit 0 |
| `npm run check` (typecheck + oxlint + i18n literal check + Vitest) | exit 0 |
| `vitest run --reporter=json` (`vitest.json`) | 126 files · **1195 passed**, 1 skipped, 0 failed of 1196 |
| Focused regressions (the four new files, `packs.test`, `qa27Undo`, `qaFollowUp`, `qaLead`, `historyRevertScan`, `qa27Duplicates`, `inbox`, `qaV2`, `projection`, `scenarios`, `shortfall`, `qa27FutureBalance`, `exactRange`) | 186 passed · exit 0 |
| `npm run build` | exit 0 · dist identified by the sha256 of its file list (`dist-sha256.txt`), id `0024f918ef87cb61…` |
| `npm run size` (budget unchanged: baseline × 1.1 = 844.6 KB) | 844.4 KB en 13 archivos (gzip 253.2 KB) · 767.8 KB · límite 844.6 KB · cambio +10.0 % · exit 0 |
| `npm audit --audit-level=high` | found 0 vulnerabilities · exit 0 |
| Playwright `--project=celular --workers=2 --fail-on-flaky-tests` (full suite, one project at a time, one identified preview on port 4173) | **392 passed**, 0 failed, 0 flaky, 1 skipped · 9.1 min · exit 0 |
| Playwright `--project=celular-pequeno --workers=2 --fail-on-flaky-tests` (full suite, one project at a time, one identified preview on port 4173) | **393 passed**, 0 failed, 0 flaky, 0 skipped · 8.8 min · exit 0 |
| Playwright `--project=escritorio --workers=2 --fail-on-flaky-tests` (full suite, one project at a time, one identified preview on port 4173) | **390 passed**, 0 failed, 0 flaky, 3 skipped · 9.7 min · exit 0 |
| Screenshots run (`tests/e2e/audit-nov02.spec.ts` on the same preview with `QA_LEAD_SHOTS`, workers=1) | celular exit 0 · celular-pequeno exit 0 · escritorio exit 0 |

Timing budgets observed in the full runs (from the list reporter; limits unchanged):

```
Inicio con 10k: cifra principal a los 232 / 229 ms
Historial con libro grande: primera entrada a los 307 / 26 ms desde Inicio; 15 entradas con dependientes a la vista
  ✓  166 [celular-pequeno] › tests/e2e/performance-history.spec.ts:57:1 › Historial con 10 000 movimientos, 100 programados, 1 000 pagos vinculados y 30 cambios de programados: desde Inicio, la primera entrada en < 300 ms (2.2s)
Inicio con 10k: cifra principal a los 260 / 237 ms
Historial con libro grande: primera entrada a los 309 / 41 ms desde Inicio; 15 entradas con dependientes a la vista
  ✓  166 [celular] › tests/e2e/performance-history.spec.ts:57:1 › Historial con 10 000 movimientos, 100 programados, 1 000 pagos vinculados y 30 cambios de programados: desde Inicio, la primera entrada en < 300 ms (2.3s)
Inicio con 10k: cifra principal a los 369 / 237 ms
Historial con libro grande: primera entrada a los 324 / 61 ms desde Inicio; 15 entradas con dependientes a la vista
  ✓  166 [escritorio] › tests/e2e/performance-history.spec.ts:57:1 › Historial con 10 000 movimientos, 100 programados, 1 000 pagos vinculados y 30 cambios de programados: desde Inicio, la primera entrada en < 300 ms (2.9s)
```

Reruns: none were needed in this chain; the development runs of the new spec before the chain (three profiles, 11 cases
each) are not counted here. Original failures during development (recorded in the session, not in the suite): the first
two runs of the new spec failed on test-side mistakes (an option matched twice, a singular label, the Scenarios note hidden
behind the empty state) and on the browser's module-map cache for P3, which led to the URL-based retry (§3).

## 7. Migration, backup, recovery and undo analysis

- No schema change (14). `migrations.ts`, `types.ts` and both repositories are byte-identical to `420c700`. Nothing new
  is persisted: `RevertDependent.occurrenceDate`, `InboxView.moreDuplicates`, `ProjectionResult.horizonDays` and the
  pack states are computed.
- Data saved by `420c700` in the broken P1 state (link to a date the schedule no longer has) still loads and validates;
  it is not rewritten. The undo guard prevents creating that state from now on; an existing one shows the planned expense
  as linked and the figures as they are. Editing the planned expense (removing the link) is the manual way out, as
  before.
- Backups: unchanged format; the P1 round trip is asserted in the unit test.
- Undo (`history`): P1 adds refusals, never new mutations. P2, P3 and P4 do not touch history or storage.

## 8. What the pass preserved and re-ran

The full unit suite and the full browser matrix ran on the tested SHA (§6), including the earlier audits' regressions:
unsupported-currency punctuation and currency conflicts (`qaCorrective`, `qaV2`, `retest`), PEN merchandise with a tax
amount, monthly/leap-day/semimonthly/day-based recurrence (`recurrence`, `clara2`, `qaPr15Anchor`), the genuine v13
backup import and explicit repair with «keep existing dates» and paid-occurrence protection (`qaLead`, `qa27Undo`,
`qa27SplitWindow`), exact comparison arithmetic (`qa27Percent`, `percentExact`), chart labels and keyboard/touch
selection (`axisLabels`, `qa-lead.spec`), backup protection and honest wording without local copies (`qa27Trash`,
`import-copy.spec`, `qa27.spec`). The roadmap items of `docs/STABILIZATION-2026-10-13.md` remain roadmap items; none is
claimed here.

## 9. Remaining limitations and unresolved points

- **Initial JavaScript budget: 844.4 KB of 844.6 KB.** The new visible texts (about 3 KB of Spanish in the initial
  bundle) consumed most of the margin left by the QA27 pass; the cap was not raised. The next visible-text change will
  have to move more rarely-visited texts to the lazy packs first (`AGENTS.md` says so).
- **P3 on Safari/WebKit:** WebKit's import error does not include the chunk URL, so «Reintentar» can only repeat the
  plain `import()`, which WebKit may also remember as failed; «Recargar la app» is the reliable path there. Verified only
  in Chromium (Playwright); not on a physical iPhone.
- **P3 with the service worker:** the production service worker precaches the pack chunks, so the failure state only
  appears before the first precache or when the worker is blocked; a `?retry=N` request bypasses the precache (network)
  and is cached on success. Automated checks ran with `serviceWorkers: 'block'`, as the audit's fault injection did;
  offline install/update behaviour of a real PWA was not exercised.
- **P1 scope:** the guard covers planned-expense links and active snoozes (the two occurrence-level references the data
  model holds) plus payments (QA27-01). A planned expense already left dangling by an earlier build is not repaired
  automatically (§7).
- **P2:** the number of reviewed pairs is bounded by the person's own actions, so the scan stays bounded; a group with
  thousands of distinct-note movements on the same day is still walked pair by pair (cheap comparisons of pre-normalised
  notes), as before this pass.
- **P4:** partial projections are declared, not avoided: with hundreds of near-maximum daily schedules the exact horizon
  can be as short as the audit's 22 days, and the screens say so. The 30-day affordability verdict is based on today's
  available money (exact) and only its future-shortfall claim is limited to the exact days.
- Not exercised in this pass, therefore **unverified**: physical iOS/Android devices, VoiceOver/TalkBack, native file
  pickers, OS text scaling, real camera/OCR, the deployed build, and browser/PWA behaviour outside Playwright's
  Chromium.

## 10. Release recommendation

The financial undo defect (P1) is fixed, covered by unit and browser regressions on the three profiles, and verified on
the tested SHA; the duplicate starvation (P2), the pack recovery (P3) and the projection exact-range handling (P4) are
fixed and covered likewise; the full suite is green on the tested SHA (§6). The brief's own condition applies: release
readiness is **not** declared here until the independent auditor retests P1 on the tested SHA. Recommendation: lift
the HOLD on `8073aca` (or its documentation-only child) subject to that independent retest, with the four unverified
areas of §9 stated as such in the release notes.
