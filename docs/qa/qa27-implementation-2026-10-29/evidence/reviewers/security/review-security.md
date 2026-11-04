# Security and storage review of QA27 (ac99396, commits 21b4ed8..HEAD) — 2026-10-30

Independent, read-only review of the QA27 fixes (QA27-01 payment-aware undo guard, QA27-02 snooze retarget, QA27-03/03b
checked differences and duplicate cap, QA27-04 export-first repair). Worktree
`/tmp/claude-0/-home-user-ALCANZA/0cc824fc-6662-5ccd-b6d7-dca2af46bc95/scratchpad/qa27/rev-security` at `ac99396`.
No application file or existing test was edited. Files I added (worktree only, untracked):

- `src/domain/review.qa27.security.test.ts` (21 cases) and `src/storage/review.qa27.storage.test.ts` (12 cases).
- `src/domain/{splitRepair,historyRevert,validation}.21b4ed8.ts`: exact copies of the audited commit's code
  (`git show 21b4ed8:…`), used as review helpers to produce "data written by 21b4ed8" and to run "21b4ed8's validator".
  `validation.ts` and `src/storage/backup.ts` are byte-identical between 21b4ed8 and HEAD (`cmp` / `git diff --quiet`).

Every expectation below was computed by hand before running; all 33 cases passed on the first run.

## (a) Cases built

Fixture "Internet": bill 420.00 of the 31st split pre-v14 on 28-Feb (b1 ends 27-Feb, b2 from 28-Feb without
`anchorDate`), balance 1 400.00 on 1-Mar, 7-day horizon; repaired on 20-Mar (in place), 31-Mar paid on 29-Mar (p1) →
980.00 available, 0 reserved. Fixture "Renta": rent of the 31st split on 28-Feb-2026, paid on the 28th through
28-Jan-2027, today 1-Mar-2027 → partitioned repair from 1-Feb-2027 (r2 ends 31-Jan, r3 from 1-Feb, anchor 31-Jan).

| Id | Case (hand-computed expectation) | Result |
|---|---|---|
| A1 | Refusal in memory, after JSON reload, after `parseBackup(backupText())`, and after `migrate` of the copy stamped `schemaVersion: 13`: deep-frozen input, `revertDependents` = exactly `[{payment p1, 31-Mar, b2, 42000}]`, `canRevert` = `dependents`, `revertEntry` = `{ok:false, revertDependents, count 1}`, JSON before == after, figures 980/0 unchanged | pass |
| A2 | Genuine v13 backup (`v13-known-intent-backup.json`): repair `salary-2` on 21-Mar, receive 240 777 on 31-Mar → refused identically in memory / reload / re-export / migrate, dependent `{inc1, 31-Mar, salary-2, 240777}` | pass |
| A3 | Partial 100 000 + final 200 000 on the same corrected date → two dependents, `count: 2` | pass |
| A4 | `RevertDependent.kind`/`amountMinor` are computed only: no `"dependents"` or `"kind":"payment"` in the exported text; history entries have only `id/at/source/changes(/revertOf)`, changes only `collection/id/before/after` | pass |
| A5 | Entry touching only transactions: relink p1 31-Mar → 30-Apr, revert → `ok`, p1 back on 31-Mar, `validateAppData` ok | pass |
| A6 | After the relink the series is moved to the 30th (31-Mar no longer exists): reverting the relink is refused and names the payment's CURRENT date (30-Apr) | pass |
| A7 | Delete p1 → revert the deletion: `ok`, validates. Delete → pay again (p2) → revert the deletion: `canRevert` `ok`, `revertEntry` ok, but `validateAppData` rejects with exactly `[{transactions[3].occurrenceDate, duplicateId}]` (History.tsx's second guard); `restoreFromTrash` itself refuses with `occurrenceAlreadySettled` | pass |
| A8 | Trash bypass: pay → trash p1 → revert the repair (`ok`, correct) → `restoreFromTrash(p1)` succeeds → p1 points at a 31-Mar that no longer exists: 560.00 available, 420.00 reserved, `schedule:b2:2026-03-28` overdue (the P1 state by another path) | pass (= gap reproduced, finding F-1) |
| A9 | Entries that touch the schedule without changing its dates (amount 420 → 450; end 31-Dec added) with payments present → revert `ok`, validates (no false positives) | pass |
| A10 | Ended series (end 28-Feb) → entry removes the end → pay 31-Mar → reverting that entry would re-impose the end → refused (`g1`, 31-Mar) | pass |
| A11 | Revert of a revert (re-do the repair) after a payment on the moved date 28-Mar → refused naming 28-Mar; the original entry reports `alreadyReverted` | pass |
| A12 | Not dependents: the payment's own entry (revert → `ok`, 42 000 reserved again) and a `planned` transaction linked to the occurrence | pass |
| C1 | Partitioned repair with 7 snoozes: only r2's coincident (28-Feb) and changing (28-Mar → 31-Mar) dates move to r3 ids with `until`/`at` intact; another schedule's same date, `dup:`, `bal:`, prefix-alike `r2x`, and a paid date (28-Jan) untouched; `validateInbox`, `validateHistory`, `validateAppData`, round trip | pass |
| C2 | `nextId` of 64 chars → 88-char snooze ids in `inbox.snoozed` and in the history change ids (26 and 88); all validate; export/import equal | pass |
| C3 | Two r2 snoozes mapping to the same r3 id → one survivor (later `until`), another schedule's snooze kept | pass (see O-6) |
| C4 | 60 identical expenses: exactly 50 stable pairs (e00 with e01…e50), fingerprint `expense\|main\|1200\|2026-09-10\|~…` exact; dismiss `dup:e00:e01` + snooze `dup:e00:e02` → active 48 / snoozed 1 / dismissed 1; adding e60 keeps it; a note on e01 changes the fingerprint → 49/1/0 | pass |
| C5 | A transaction sorting first (`a00`) shifts the window: 50 other pairs, the dismissed/snoozed pairs are no longer computed (neither active nor dismissed), their records remain in `inbox` | pass (see O-7) |
| C6 | `isValidHistoryChangeId`: 64/65 records, 300/301 inbox, the 88-char `due:` id valid only for `inboxSnoozed`; `INBOX_ID_MAX` 300 | pass |
| E1 | Copy written by 21b4ed8's `repairSplit` (on the genuine v13 data) + payment: HEAD imports it `toEqual` the written data; 21b4ed8's `canRevert` says `ok` (the P1 gap); HEAD refuses with the payment | pass |
| E2 | Partitioned repair written by 21b4ed8 with a coincident-date snooze: HEAD imports it unchanged, the snooze stays inert under the old id, the overdue reminder of the new segment is active before `until`, `driftedSplits` proposes nothing | pass (see O-5) |
| E3 | Copy written by HEAD (partitioned repair, retargeted snooze, payment on the new segment, refused revert): 21b4ed8's `validateHistory`/`validateInbox`/`validateTransaction`/`validateSchedule` return `[]`, `validateAppData` ok, re-import equal | pass |
| S1 | `LocalStorageRepository`: save → load → refusal; `margen.data.v1` text byte-identical; through `AppStore` no revision change | pass |
| S2 | `IndexedDbRepository` (fake-indexeddb): same; a later read is identical to the earlier one | pass |
| S3 | `LocalBackups.save` resolves only after commit: a second connection lists and reads the pre-repair state; the repair committed afterwards to the data store leaves the copy untouched (no `anchorDate`, empty history) | pass |
| S4 | `put` throwing `QuotaExceededError` on the `backups` store → `save` rejects, nothing stored (list still `['auto']`) | pass |
| S5 | `keepCopyBeforeReplace`: no `indexedDB` → `unavailable` (also with `null` data); with a factory → `kept` and the `beforeRestore` copy is listed with the data's `updatedAt`; factory whose `open` throws → `failed`; the three are distinct | pass |
| S6 | `recordExport` keeps `updatedAt` in the domain and through `AppStore.commit` (revision +1, no history entry, `backup` = reminder + `lastExportAt` + `lastExportDataAt`), also after reload | pass |
| S7 | Eight data operations (repair, dismiss, inbox snooze, pay, save expense, delete, settings, revert) set `updatedAt = now`; `recordVerification`, `snoozeBackupReminder`, `setBackupReminder` keep it and change only `backup` | pass |
| S8 | `performExport` with a throwing writer → `{ok:false}` (nothing to record); success → `exportedAt`/filename and the file re-imports equal | pass |
| S9 | Quota failure: the export record cannot be committed (card would not set `exportedFor`) and the repair cannot be committed either; stored data unchanged | pass |
| S10 | RT-02: import → repair → undo `stale`; repair survives reload; history `['replace','app']` | pass |
| S11 | RT-02: import → pay corrected date → undo `stale`; payment survives | pass |
| S12 | Repair → import → undo `undone`; repaired state and its history entry restored (`['app','replace']`) | pass |

Read-only checks (not unit-testable here): `History.tsx` lists `payment` dependents as «Pago registrado para el {fecha}
({importe})», shows no «Revertir» for `dependents`, and still re-validates the candidate state with
`validateAppData(JSON.parse(JSON.stringify(r.data)))` before saving. `ShortfallPlan.tsx`'s undo toast calls
`revertEntry` → `canRevert` → `revertDependents`, so it reaches the new guard (see O-8). `SplitRepairCard.tsx`: see (b).

## (b) Findings

**F-1 (P3, pre-existing, not introduced by the diff) — the payment guard can be bypassed through the trash.**
Expected (CLAUDE.md «Restaurar no deja vínculos rotos»; QA27-01 «undo refuses to leave a recorded payment without its
occurrence»): a payment cannot end up recorded for an occurrence that no longer exists. Actual (A8): pay the corrected
31-Mar → send the payment to the trash → revert the repair (allowed, and rightly so: the trashed payment settles
nothing) → «Restaurar» the payment from the trash: `restoreFromTrash` only checks that no OTHER realized transaction
settles the same `scheduleId:occurrenceDate` (`src/domain/operations.ts`, `restoreFromTrash`, the
`if (tx.status === 'realized' && tx.scheduleId && tx.occurrenceDate)` block) and never checks that the occurrence
still resolves. The restored payment stays recorded for a 31-Mar the series no longer has, the 28-Mar is reserved
again: 560.00 available with «28-mar vencido» (the audited P1 state). Visible (the overdue reminder shows), no silent
loss, three deliberate steps; same behaviour at 21b4ed8 and before. Suggested fix: in `restoreFromTrash`, when the
linked occurrence does not resolve (schedule missing, or date not in `occurrencesBetween(s, date, date)`, the same
test `settles()` uses in `historyRevert.ts`), either refuse with a new issue code (`occurrenceMissing`) or restore
without the link and report it (as `refundLinkDropped` does). Add the matching rule to `validateAppData` only if the
team wants dangling links rejected globally (today a deleted schedule intentionally keeps its realized payments).

**F-2 (P3, theoretical) — `SplitRepairCard.restore` checks `updatedAt` on a snapshot taken before an `await`.**
`src/ui/screens/settings/SplitRepairCard.tsx` lines 55–62: `current = getStore().data` → `await
keepCopyBeforeReplace(current)` → `exportedFor !== current.updatedAt` → `run(repairSplit)`. `run` repairs whatever the
store holds AFTER the await. The only writer that can land in that window is an automatic job (`autoConfirmDue` on
interval/visibility); the user is in the confirm dialog. If it lands, the repair proceeds on data newer than the
downloaded (or kept) copy; the intervening change is itself in the history. Suggested one-liner: re-read
`getStore().data?.updatedAt` after the await (or compare inside the `run` callback and return an issue), so the
promise «copy of the data exactly as they are» holds for the state actually repaired. Same pattern pre-exists in the
import flow (`Settings.tsx`).

No way was found for the card to repair without a copy: the predicate `copy !== 'kept' && exportedFor !==
current.updatedAt` blocks both `failed` and `unavailable`; `exportedFor` is set only when `useExportBackup` returned
`saved === true`, which happens only after `deliverFile` returned `shared`/`downloaded` (cancelled share → `false`,
throwing download → `false`, `performExport` failure → `false`, S8) and after `recordExport` was committed (S6: it does
not touch `updatedAt`, so the equality is sound; S7: every data operation moves `updatedAt`, only backup-reminder
metadata does not and that metadata is the only difference the downloaded file could then have). No «refuse forever»
beyond "storage cannot save at all" (S9: then the repair could not be saved either; see O-1 for the misleading toast).

## (c) Observations

- **O-1** `useExportBackup()` returns whether the export RECORD was committed, not whether the file was delivered. With a
  store that cannot save (quota/conflict) the file downloads, the toast says «No se pudo guardar», `exportedFor` stays
  unset and the card refuses. Harmless for QA27-04 (nothing could be persisted anyway, S9) but the message misleads.
- **O-2** `exportedFor` is component state: re-mounting the card or ANY later operation (even snoozing a reminder)
  requires a new download. By design; the texts say so.
- **O-3** IndexedDB present but unusable at open time (e.g. a private window whose `open` fails): `localBackups()` is
  non-null, so the up-front note «Este navegador no guarda copias locales» is not shown and the confirm text still
  promises a local copy; the refusal («No se pudo guardar la copia local…», `failed`) is correct and a downloaded copy
  unblocks it. Only the wording is off in that case.
- **O-4** The import flow (`Settings.tsx` `applyImport`) still proceeds on `unavailable` (only `failed` blocks), unlike
  the repair card. Consistent with REC-01 (immediate undo, and the stale-undo toast says there is no copy), but it is an
  asymmetry worth a sentence in STORAGE.md.
- **O-5** Data already repaired by 21b4ed8 with a coincident-date snooze is not retroactively fixed (E2): no migration
  rewrites inbox ids (per the project's rule), the snooze stays inert under the old id, the reminder reappears before
  `until`, and the card cannot re-run (the new segment fixes its own anchor). Users re-snooze once.
- **O-6** Dedupe semantics (C3): a stale snooze on a date that was not an occurrence of the old segment but IS one of
  the repaired series is retargeted (becomes live) and, with a later `until`, wins over the genuine snooze mapping to
  the same id. Reminder visibility only; defensible (such a snooze most plausibly came from an earlier repair + revert).
- **O-7** `DUPLICATE_PAIRS_PER_GROUP` (C5): a new transaction that sorts before the group's first (date, id) shifts the
  window; dismissed/snoozed pairs can stop being computed (hidden by the cap, not resurrected), their `inbox` records
  stay as harmless orphans. The first 50 pairs' ids and fingerprints are otherwise stable; `dup:` ids validate.
- **O-8** `ShortfallPlan.tsx`'s undo reaches the guard but, unlike `History.tsx`, does not re-run `validateAppData` on
  the result. Its `plan` entries only touch planned transactions and income amounts (`applyShortfallPlan`), so the A7
  double-settlement cannot arise there; still an asymmetry.
- **O-9** `History.tsx` evaluates `canRevert` for each of the 30 shown entries on every render; for entries touching
  schedules this now scans every transaction (cheap `occurrencesBetween(from = to)`). Not measured here.
- **O-10** `checkedPercentChange` throws on a non-safe operand; its callers pass `periodSummary().netSpendingMinor`, a
  `sumMinor` total that itself throws on overflow, so the new throw is unreachable — but `sumMinor` throwing on a valid
  file (500 000 × 10¹² > 2⁵³) is a pre-existing crash path in Analysis/Statistics (finance reviewer's area; not tested).
- Validation boundaries unchanged (C6, `validation.ts` byte-identical); `RevertDependent` is only a return type in
  `historyRevert.ts` (grep), never written to `AppData` (A4).

## (d) Commands run and summary output

```
git -C /home/user/ALCANZA worktree add …/qa27/rev-security ac993969352d062a688b4f4ab72f9f8d89ca7599   # + node_modules symlink
git log --oneline 21b4ed8..HEAD      # 96f64fb 150bb9e 7d7a23a 85b4a85 fcfcdfe ac99396
git diff --stat 21b4ed8..HEAD -- src/storage/migrations.ts src/domain/types.ts src/storage/backup.ts src/storage/*Repository.ts \
  src/storage/repository.ts src/storage/autoBackup.ts src/state src/domain/validation.ts src/domain/csvExport.ts vite.config.ts pwa/ \
  public/_headers src/storage/encryptedBackup.ts src/ui/backupActions.ts src/ui/useAutoBackup.ts src/domain/backupReminder.ts \
  src/domain/operations.ts src/domain/recurrence.ts src/domain/scheduleFrom.ts src/domain/history.ts     # (empty)
grep -n 'SCHEMA_VERSION =' src/domain/types.ts; git show 21b4ed8:src/domain/types.ts | grep 'SCHEMA_VERSION ='   # 14 / 14
grep -rn 'innerHTML\|dangerouslySetInnerHTML\|\beval(\|new Function(' src (non-test)   # none
grep -rn 'console\.' src (non-test)                                                   # none
git diff 21b4ed8..HEAD | grep -iE '^\+.*(api[_-]?key|secret|password|token|bearer|sk-…|AKIA…)'   # none
grep -rn 'RevertDependent\b' src (non-test)   # only src/domain/historyRevert.ts (type + return types)
cmp src/domain/validation.ts src/domain/validation.21b4ed8.ts   # identical; git diff --quiet 21b4ed8 HEAD -- src/storage/backup.ts  # identical

npx vitest run src/domain/review.qa27.security.test.ts src/storage/review.qa27.storage.test.ts
  ✓ src/domain/review.qa27.security.test.ts (21 tests)   ✓ src/storage/review.qa27.storage.test.ts (12 tests)
  Test Files  2 passed (2)   Tests  33 passed (33)

npx vitest run src/storage/csp.test.ts src/domain/csvExport.test.ts src/storage src/state/replaceUndo.test.ts \
  src/domain/qa27Undo.test.ts src/domain/qa27Snooze.test.ts src/domain/qa27Duplicates.test.ts src/domain/qaFollowUp.test.ts src/domain/qaLead.test.ts
  Test Files  16 passed (16)   Tests  210 passed (210)

npx vitest run            # whole unit suite with the review files present
  Test Files  116 passed (116)   Tests  1170 passed | 1 skipped (1171)   Duration 23.24s   (the skip is pre-existing, not in my files)

npm run typecheck         # tsc -b → exit 0 (app, tests and config, including the *.21b4ed8.ts helpers)
npm run lint:i18n         # find-literals: sin texto visible fuera de i18n en src/ui. → exit 0
```

## (e) What I could not check

- The React components themselves (`SplitRepairCard.tsx` `exportedFor` lifecycle and busy guard, `History.tsx`,
  `ShortfallPlan.tsx` rendering and toasts): reviewed by reading only; no DOM test environment and Playwright not run
  (per brief). `tests/e2e/qa27.spec.ts` was read, not run.
- `npm run build`, `npm run size`, `npm run lint` (oxlint): not run (brief: vitest / tsc / lint:i18n only).
- Real-browser IndexedDB failure modes (private windows, blocked `open`): simulated with a factory whose `open` throws
  and with a `put` that throws `QuotaExceededError` (fake-indexeddb), not with real browsers.
- Share-sheet delivery (`deliverFile`): relied on the existing `src/ui/backupDelivery.test.ts` (passes in the full run).
- The pt/fr wording of the new i18n keys: presence is enforced by the shared type (`tsc`), wording not reviewed.
- Performance of the History screen with the new per-entry settlement scan (O-9): not measured.
