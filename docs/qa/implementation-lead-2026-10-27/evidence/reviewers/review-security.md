# Security & storage review — CLARA, e38b07b vs baseline 46fe617

Reviewer worktree: `/tmp/claude-0/-home-user-ALCANZA/0cc824fc-6662-5ccd-b6d7-dca2af46bc95/scratchpad/rev-security` (detached at `e38b07b`; `/home/user/ALCANZA` untouched, nothing committed or pushed).
Files added (worktree only): `src/domain/review.security.test.ts` (52 cases), `src/storage/review.security.test.ts` (9 cases), `src/domain/validation.46fe617.ts` (verbatim `git show 46fe617:src/domain/validation.ts`, used only to run the faulty validator against the same fixtures for a real before/after).
Synthetic data only. No Playwright, no `npm run build`.

**Verdict:** no P1/P2. One P3 finding (over-blocking in F-02's dependents check), plus P3 observations. The F-01 recovery claim, the no-migration claim (`SCHEMA_VERSION` 14), the F-02 "refusal never mutates" claim, the historyRevert split, the split-repair idempotency and the conflict-path reasoning all hold.

## (a) Cases built

Legend: PASS = behaviour matches the documented contract; FAIL = finding; OBS = behaves as intended but worth noting.

### 1. Validation boundaries (`validateHistory`, `isValidHistoryChangeId`, `validateInbox`, `parseBackup`)

| # | Input | Expected | Actual | Result |
|---|---|---|---|---|
| V-01 | For each of the 12 `HISTORY_COLLECTIONS`, change id = `5`, `null`, `undefined`, `{}`, `[]`, `true`, `''` | `history[0].changes[0]` → `invalidValue`; `isValidHistoryChangeId` false | as expected (84 assertions) | PASS |
| V-02 | collection = `'foo'`, `'inbox'`, `'dismissed'`, `''`, `undefined`, `null` | rejected `invalidValue` | as expected | PASS |
| V-03 | `settings` change with id `'settings'`, 64 chars, 65 chars | valid, valid, invalid | as expected | PASS |
| V-04 | snapshots `before`/`after` = `'x'`, `1`, `true`, `undefined`, and key absent | rejected | as expected (checked both sides) | PASS |
| V-05 | snapshot = `[]` / `[1,2]` | — (undocumented) | **accepted** by both the new and the 46fe617 validator (`typeof [] === 'object'`). Through `parseBackup` the array is kept verbatim in `history`. `revertEntry` applies it (domain layer does not validate) but History.tsx's full `validateAppData` then rejects (`isObj` excludes arrays) so nothing is saved. | OBS (pre-existing, not a regression) |
| V-06 | `validateInbox`: snoozed/dismissed id 300 / 301; non-string ids; fingerprint 500 / 501 / empty / number | 300 ok, 301 `invalidId`; 500 ok, 501 `invalidValue`, `''` ok | as expected | PASS |
| V-07 | A/B per collection, id lengths 1, 64, 65, 300, 301, new validator vs `validation.46fe617.ts` | only `inboxSnoozed` at 65 and 300 flips from rejected to accepted; everything else identical | as expected (60 assertions). Nothing previously valid is now rejected; nothing beyond the documented contract is now accepted | PASS |
| V-08 | `SCHEMA_VERSION`, `migrate()` on a v14 payload, `git diff 46fe617..e38b07b -- src/storage/migrations.ts src/domain/types.ts src/storage/backup.ts src/storage/*Repository.ts src/state` | 14; identity; empty diff | 14; `migrate(raw)` deep-equals `raw`; diff empty | PASS |
| V-09 | **Hand-written** backup file (`format: 'margen-backup'`, `formatVersion: 1`, `exportedAt`, `appVersion: '0.0.0-faulty'`, `data`) exactly as 46fe617 wrote it: split of a 64-char schedule id with its snooze renamed; history entry with `inboxSnoozed` change ids of **88** and 60 chars; `inbox.snoozed` holding the 60-char id; `revision: 7` | 46fe617 validator rejects `history[0].changes[3]` (the 88 one; 60 fitted in 64); new validator accepts; `parseBackup` ok and `data` deep-equal (no id shortened, no entry/snooze dropped, `revision`/`historyStartedAt` kept); same via `backupText`; `validateAppData` on the stored object ok | all as expected | PASS |
| V-10 | history entry with an unknown extra key and an `after` snapshot with extra fields | — | kept verbatim after import (history is not `pick`ed, by design "no se validan a fondo") | OBS (pre-existing) |
| V-11 | `int:split:<64-char id>` dismissal (id 74 chars, fingerprint 32 chars) export → import | round-trips, within inbox limits | as expected | PASS |

### 2. Undo safety (`historyRevert.ts`, `history.ts`, `History.tsx`)

| # | Input | Expected | Actual | Result |
|---|---|---|---|---|
| U-01 | Refusal never mutates: input `deepFreeze`d and serialized before/after for **notFound, notRevertible (replace cut / empty changes / snooze-only entry), alreadyReverted, conflict, dependents, currencyMismatch** | `ok:false` with the matching code, JSON identical, no TypeError from the frozen object | as expected, 6 branches | PASS |
| U-02 | Screen vs operation agreement: for every `canRevert` status the `revertEntry` code (`ok`↔ok, `conflict`↔`revertConflict`, `dependents`↔`revertDependents`, `alreadyReverted`, `notRevertible`) with the same `today` | agree | agree. Note `History.tsx` additionally runs `validateAppData` and shows `issueMessage` if that fails — strictly safer than `canRevert` | PASS |
| U-03 | Currency guard inside `revertEntry`: currency CAD→USD recorded with no amounts, then a USD transaction added, revert the currency entry | `canRevert` = ok (settings unchanged since), `revertEntry` = `currencyMismatch`, input untouched; with no amounts the revert restores CAD | as expected | PASS |
| U-04 | Dangling-reference hunt beyond the four tracked kinds: entry creates schedule `s1`; later a realized tx (`scheduleId: s1`), an income-distribution line (`scheduleId: s1`) and a dismissed `due:schedule:s1:…` are added; revert the creation | — | revert allowed (`dependents` = []); result leaves `tx:pay→s1`, `distribution:dist→s1`, `dismissed:due:schedule:s1:…` unresolved. **Identical** to what `deleteSchedule` (manual delete) leaves, and `validateAppData` accepts it (ids are validated by format only). Dismissed entries are inert (only matched against computed items). | OBS — consistent with manual delete; FORMULAS §26 lists exactly the four kinds, so this is within contract |
| U-05 | A **paid** planned expense (`plan.paidAt` set) still linked to the schedule | — | blocks the revert (`dependents`). Manual `deleteSchedule` would silently unlink it. Conservative over-block, UX only | OBS (P3-) |
| U-06 | Crafted (imported) entry with two changes on the same schedule id (`A→null`, `null→B`) | never applied half-way | `conflict` (first change's `after: null` ≠ current B); nothing mutated | PASS |
| U-07 | split → revert → revert-the-revert → revert again (two reverts in a row + revert of a revert) | each step validates; `[schedules, templates, scenarios, snoozed]` equals the split state after step 2 and the original after step 3; `canRevert` statuses `alreadyReverted`/`ok` as documented; no dangling refs at any step | as expected | PASS |
| U-08 | `before` snapshot re-creates a schedule edited later: split E1, edit `next` (E2), revert E2, then revert E1 | E1 = `conflict` while edited; `ok` after E2 is reverted; final state has only `old`, nothing dangling | as expected | PASS |
| U-09 | Entry that **deleted** a schedule (and unlinked its planned expense via `deleteSchedule`) → revert | schedule and goal link both return; no dangling | as expected (`revertDependents` returns [] early because no `before === null` schedule change; correct: re-creating cannot dangle) | PASS |
| U-10 | Legacy entry (schedules only) where the split's snooze **has expired** (`until` 2026-09-20 < today 2026-09-28) | per R5 an expired snooze is inert: dependents should be template + scenario (2) | **template + scenario + snooze (3)**; `revertEntry` → `revertDependents` count 3 | **FAIL → Finding F-R1** |
| U-11 | Non-legacy: create schedule (entry E), later snooze its due item (no entry, R5), snooze expires; revert E | `ok` (nothing of the user's would be overwritten; inbox already ignores the snooze) | `dependents` → blocked by `due:schedule:s1:2026-09-01` | **FAIL → Finding F-R1** |
| U-12 | `replace` cut: `canRevert`, `stateBefore` | `notRevertible`, `null` | as expected | PASS |
| U-13 | i18n keys `history.dependents_one/_other`, `history.dependent.{template,scenario,goal,snooze}`, `issue.revertDependents`, `splitRepair.*` in es/en/pt/fr | present | present in all four (grep); `npm run lint:i18n` clean | PASS |

### 3. historyRevert split (58e4b79)

| # | Check | Result |
|---|---|---|
| H-01 | grep of every importer of `canRevert/revertEntry/revertConflicts/revertDependents/stateBefore/currentValue`: `History.tsx`, `ShortfallPlan.tsx`, `whatChanged.ts`, and tests `history/clara2/currencyChange/qaPr15Currency/qaPr15Undo/stabilization/qaFollowUp` all import from `./historyRevert`; nothing imports a missing export from `./history` | PASS |
| H-02 | `history.ts` keeps only what the store/record path needs (`recordHistory`, `diffForHistory`, `setValue(s)`, `applyEntries`, `historyOfRecord`, `sameValue`, `currentValue`); `store.ts` imports only `recordHistory` | PASS |
| H-03 | `npx tsc -b` in the worktree (with my files present) → exit 0; 6 neighbouring existing test files (history, qaFollowUp, qaPr15Undo, backup, migrations, csvExport) → 96/96 | PASS |
| H-04 | `Movements.tsx` CSV on-demand import: `exportCsv` is `async`, awaits `import('../../domain/csvExport')`, then builds the CSV from values captured at click time and calls `downloadText` (DOM only, no `setState` after the await → no unmount warning). Double click → two identical downloads, same as the previous synchronous code. **No `catch`**: if the chunk fails to load (offline before the SW cached it, or after a deploy that removed the old hashed chunk) the rejection is swallowed by `void exportCsv()` and the user gets no toast | OBS (P3) — see O-3 |
| H-05 | `ExportSection.tsx` still imports `csvExport` statically; it is reachable only through the lazy `Settings` chunk, so the size claim is unaffected | PASS (by reading) |

### 4. Split repair persistence (`splitRepair.ts`, `SplitRepairCard.tsx`)

| # | Input | Expected | Actual | Result |
|---|---|---|---|---|
| S-01 | `repairSplit` twice; on a schedule that no longer qualifies (`salary-old`, unsplit series); on an unknown id — input frozen | second/other calls → `notFound`, nothing mutated | as expected | PASS |
| S-02 | `repairSplit` result: only `anchorDate` + `updatedAt` differ on the new segment; predecessor is the same object; one history change `[schedules, salary-new]`; `canRevert` ok | as expected | PASS |
| S-03 | `dismissSplitRepair` twice | second → `notFound` | as expected. UI consequence: a fast double click on «Dejar como está» (no guard) shows a spurious `save.error.generic` toast although the first click succeeded; no data effect | OBS (P3) — see O-4 |
| S-04 | Fingerprint `startDate|anchorDate|anchor`: after dismissal (a) change the predecessor's `startDate` (root anchor 31→30) | re-proposed with anchor 2026-01-30, proposed 2026-03-30 | as expected (fingerprint changes with `anchor`) | PASS |
| S-05 | after dismissal (b) add `skippedDates` / change amount on the new segment | still hidden | hidden — the proposal's dates change but the decision ("keep counting from the 28th") does not; acceptable | OBS |
| S-06 | after dismissal, split the new segment again with the fixed version (28-apr) | new segment inherits `anchorDate` 2026-02-28, nothing proposed | as expected | PASS |
| S-07 | `keepCopyBeforeReplace` order: `await keepCopyBeforeReplace(getStore().data)` runs **before** `run(repairSplit)`; `LocalBackups.save` awaits `done(tx)` so the copy is committed before the repair; `'failed'` aborts with `localBackup.failed`. `'unavailable'` (no IndexedDB) does **not** abort — same policy as the import/restore path in `Settings.tsx:210-215` | consistent with the existing restore flow | PASS (by reading) |

### 5. Conflict safeguards / replaceUndo (by reading)

- `repairSplit`, `dismissSplitRepair`, `revertEntry` (History and ShortfallPlan) are all invoked through `useRun` → `AppStore.commit` → `commitTracked` → `repo.save`; both repositories compare the stored revision/text with their `baseline` before writing and return `conflict` without writing. A refused operation (`ok:false`) never reaches `commit`. No direct repository access was added. `replaceUndo.ts`, `store.ts` and both repositories are byte-identical to 46fe617. PASS.

### 6. Security in the diff

- No secrets/keys/tokens added; no `innerHTML`/`dangerouslySetInnerHTML`/`eval` anywhere in `src` (grep). PASS
- CSV: `safeText` unchanged; the on-demand `transactionsToCsv` still routes note/merchant/category/account through it — test C-01: `=HYPERLINK(...)`, `+cmd`, `-cat`, `@acc` come out apostrophe-prefixed; date/amount untouched. PASS
- Backup envelope (`validateEnvelope`, `encryptedBackup.ts`) not in the diff; `parseBackup` metadata checks unchanged. PASS
- i18n literal check (`npm run lint:i18n`): "sin texto visible fuera de i18n en src/ui". PASS

## (b) Findings

### F-R1 — P3 — `revertDependents` blocks a revert because of an *expired* (inert) snooze the entry did not touch; the user has no UI path to clear it

- **Where:** `src/domain/historyRevert.ts` lines 63–75 (`scheduleReferences` iterates `data.inbox.snoozed` without looking at `until`) and 88–92 (`revertDependents` prunes expired snoozes only through `revertedState`, i.e. only those in `entry.changes`).
- **Expected (R5, FORMULAS §26, `revertConflicts.expiredSnoozeGone`):** an expired snooze is inert — `inboxView` ignores it (`until > today`) and the next `snoozeInboxItem` deletes it — so it should not count as a record that "would still point" to the removed schedule.
- **Actual:** it is listed as `Aviso aplazado del {date}` and `revertEntry` refuses with `revertDependents`. Since `due:` items are `canDismiss: false` and an expired snooze is no longer in `view.snoozed`, there is no button to remove it; the only way out is to snooze an unrelated item (which triggers the cleanup) — undocumented. Data safety is not affected (refusal mutates nothing), hence P3.
- **Reproduction (exact failing tests, `src/domain/review.security.test.ts`):**

```ts
// legacy entry, split snooze expired (until 2026-09-20, today 2026-09-28)
const d = seedSplit('2026-09-20'); const after = split(d)
const legacy: HistoryEntry = { id: 'h-legacy', at: NOW, source: 'app', changes: [
  { collection: 'schedules', id: 'old', before: d.schedules[0]!, after: after.schedules.find((s) => s.id === 'old')! },
  { collection: 'schedules', id: 'next', before: null, after: after.schedules.find((s) => s.id === 'next')! } ] }
const stored = deepFreeze(persisted({ ...after, history: [legacy] }))
expect(revertDependents(stored, legacy, ctx.today).map((x) => x.kind)).toEqual(['template', 'scenario'])
// AssertionError: expected [ 'template', 'scenario', 'snooze' ] to deeply equal [ 'template', 'scenario' ]

// non-legacy: create schedule, snooze later (no entry, R5), snooze expires, revert the creation
const created = saveSchedule(d, amountOnly(bill('2026-09-01', 5000, { id: 's1', name: 'Gym', frequency: 'monthly' }), '2026-09-01', 5000, 's1'), ctx)
const tracked = recordHistory(d, created.data, NOW); const e = tracked.history.at(-1)!
const snoozed = { ...tracked, inbox: { snoozed: [{ id: 'due:schedule:s1:2026-09-01', until: '2026-09-20', at: EARLIER }], dismissed: [] } }
expect(canRevert(snoozed, e, ctx.today)).toBe('ok')
// AssertionError: expected 'dependents' to be 'ok'
```

- **Suggested fix:** pass `today` into `scheduleReferences` and skip `s.until <= today` snoozes when `today` is given (mirrors `revertedState`'s own pruning rule). The `revertDependents(stored, legacy)` call without `today` may keep counting them (consistent with "sin `today` no se aplica").

## (c) Observations (no action strictly required)

- **O-1 (pre-existing):** `validateHistory` accepts arrays as snapshots and never inspects snapshot contents; `validateAppData` passes `history` through without `pick`. A crafted backup therefore carries arbitrary history payload. Revert from the History screen is protected by the full `validateAppData` re-check; the UI rendering (`historyText.ts`) dereferences snapshot fields directly (`tx.amountMinor`, `.transaction.amountMinor`), so a malformed snapshot can throw inside the History screen (caught by the `App.tsx` error boundary). Same in 46fe617; not a regression.
- **O-2 (pre-existing):** `ShortfallPlan.tsx:120` undoes its own `plan` entry via `revertEntry` **without** the `validateAppData` re-check that History.tsx performs, although FORMULAS §26 says the result is always re-validated. It can only target the entry it just created, so exposure is minimal; still a documented-contract gap.
- **O-3 (new code, P3):** `Movements.tsx` `exportCsv` has no error handling for a failed dynamic import (`void exportCsv()`); a failed chunk load is silent. A `try/catch` with the generic error toast would close it.
- **O-4 (new code, P3):** `SplitRepairCard.tsx`: «Dejar como está» and the restore flow are not guarded against a second click while the first is in flight; the second `run` returns `notFound` and shows `save.error.generic` even though the first succeeded. Also, the "antes de restaurar" copy is taken before `run(repairSplit)`; if the repair is then refused (`notFound`) the extra local copy stays (pruned at 10). No data risk.
- **O-5:** `revertDependents` blocks on a planned expense that is already **paid** (`plan.paidAt`) but still linked; manual delete would unlink it silently. Conservative; UX only.
- **O-6:** FORMULAS §26 and the code agree that transactions with `scheduleId`, income-distribution lines and dismissed entries are *not* dependents; this equals what `deleteSchedule` leaves behind, so the revert is no laxer than a manual delete (U-04).
- **O-7:** The dismissal fingerprint does not cover `skippedDates`/`endDate` of the new segment, so a changed *preview* can be hidden by an old dismissal; the underlying decision (anchor) is unchanged, so this is acceptable (S-05).

## (d) Commands run and summary output

```
git -C /home/user/ALCANZA worktree add <scratch>/rev-security e38b07b        # HEAD e38b07b
ln -s /home/user/ALCANZA/node_modules <scratch>/rev-security/node_modules
git log --oneline 46fe617..e38b07b                                          # 10 commits (7e5e5d0 … e38b07b)
git diff --stat 46fe617..e38b07b -- src/domain src/storage src/state src/ui/screens/History.tsx ...   # 24 files, +986/-127
git diff --stat 46fe617..e38b07b -- src/storage/migrations.ts src/domain/types.ts src/storage/backup.ts src/storage/*Repository.ts src/state   # empty
git show 46fe617:src/domain/validation.ts > src/domain/validation.46fe617.ts
npx vitest run src/domain/review.security.test.ts src/storage/review.security.test.ts
  → Test Files 1 failed | 1 passed; Tests 2 failed | 59 passed (61)  — the 2 failures are F-R1 (intentional contract assertions)
npx vitest run src/domain/history.test.ts src/domain/qaFollowUp.test.ts src/domain/qaPr15Undo.test.ts src/storage/backup.test.ts src/storage/migrations.test.ts src/domain/csvExport.test.ts
  → Test Files 6 passed; Tests 96 passed
npx tsc -b                                                                  # exit 0 (with the three added files present)
npm run lint:i18n                                                           # "find-literals: sin texto visible fuera de i18n en src/ui."
npx oxlint src/domain/review.security.test.ts src/storage/review.security.test.ts   # no output (clean)
grep -rn "dangerouslySetInnerHTML|innerHTML|eval(|new Function" src         # none
```

## What I could not check

- No browser run (Playwright/build excluded): the double-click/unmount behaviour of `Movements.tsx` and the `SplitRepairCard` double-click toast are reasoned from the code, not observed.
- Real IndexedDB conflict between two tabs was not exercised (repositories unchanged since baseline; reasoning by reading only).
- `ShortfallPlan`'s revert path was not executed end-to-end.
- Encrypted-backup envelope (`validateEnvelope`) was not re-tested because it is outside the diff.
- The `npm run size` budget claim was not measured (excluded by the brief).
