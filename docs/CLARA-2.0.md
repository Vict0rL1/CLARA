# Clara 2.0 — audit, gap analysis and implementation plan

Scope: the "CLARA 2.0 — complete product expansion" brief (sections 1–33), checked against the code on
branch `claude/margen-personal-finance-app-cdvrt3` (base `main` a23b135 + the RT-01/02/03 stabilization
fixes). Project rules in `CLAUDE.md` (Spanish) stay authoritative; formulas live in `docs/FORMULAS.md`.

Status legend: ✅ exists and is tested · 🟡 partial · ❌ missing · 🔒 needs something this repository
cannot provide by itself (a server, credentials, a paid provider, a native app or OS permission).

## 1. Architecture as found (verified, not assumed)

| Area | What is really there |
|---|---|
| Frontend | React 19 + TypeScript + Vite, installable PWA, hash router (`src/ui/router.ts`), mobile first |
| Backend | **None.** Static hosting on Cloudflare Pages (`.github/workflows/deploy.yml`). No API, no database server, no accounts |
| Storage | IndexedDB behind `DataRepository` (`src/storage/indexedDbRepository.ts`; `localStorage` fallback), schema **12**, migrations 1→12 (`src/storage/migrations.ts`), conflict detection across tabs, local backups in a separate IndexedDB (`autoBackup.ts`), encrypted backups (`encryptedBackup.ts`) |
| Layers | `domain/` pure financial logic (no React, "today" injected) · `storage/` · `state/` (`AppStore`, optimistic, revisioned) · `ui/` · `i18n/` (es/en/pt/fr, shared key type) |
| Money | Integer minor units everywhere (`money.ts`: `floorDiv`, `mulDivFloor`, per-currency digits). **One currency per budget**; written foreign currencies are blocked, never converted (QA-01/05, AS-01, RT-01) |
| Tests | ~905 Vitest unit tests (domain, storage, state, independent `qa/` suite) + ~950 Playwright tests on 3 viewports with axe; CI runs all of them with `--fail-on-flaky-tests` |
| AI | Local deterministic parser (`domain/parser.ts`) is the default. A remote provider contract exists (`domain/aiProvider.ts`) for an owner-operated endpoint; the build rejects provider hosts and secret-shaped keys (`aiConfig.ts`). No endpoint is configured |

## 2. Section-by-section status

| § | Requirement | Status | Evidence | Gap / plan |
|---|---|---|---|---|
| 3 | Income, expenses, transfers, refunds, adjustments, planned vs realized | ✅ | `types.ts` (`TxKind`, `TxStatus`), `balances.ts`, `operations.ts`, `qa/`, **`ledger.property.test.ts`** | Done this session: 120 seeded sequences × 40 real operations, exact expected effect checked after every step (a planted transfer bug is caught) |
| 3 | Credit-card purchases vs payments (payment = transfer) | ✅ | `cards.ts`, CLAUDE.md rule | — |
| 3 | Savings allocations never an expense; no double reservation | ✅ | `goals.ts`, `reserves.ts`, `incomeDistribution.ts` | — |
| 3 | Account types checking/savings/cash/credit/custom | ✅ | `AccountKind` = bank, savings, cash, credit, other + **wallet, prepaid, investment** (v13), optional `institution` text | Done this session. Investment = a manually written balance, excluded from Safe-to-Spend by default; no quotes, no bank connection |
| 3 | Account color/icon | ❌ | — | Phase 6 (design system) |
| 3 | Multiple currencies per account / transaction | ❌ by design | one currency per budget | See §19 |
| 4 | Natural-language entry, multiple transactions, editable review, all-or-nothing confirm | ✅ | `parser.ts`, `review.ts`, `assistant.ts`, `Assistant.tsx` | Local parser only; transfers suggested, never saved as expense |
| 4 | Server-side AI provider adapters, schema validation, limits, cost monitoring | 🟡🔒 | `aiProvider.ts` (client contract + validation of every field), `featureGate.ts` (monthly use counter) | Needs an owner-operated server (e.g. a Cloudflare Pages Function with a secret). Not deployed: enabling a remote service needs the owner's authorization and credentials |
| 5 | Voice entry with transcript review | ✅ (browser) | Web Speech API in `Assistant.tsx`; transcript goes into the editable textarea; no audio stored | Recognition quality/availability depends on the browser; some browsers send audio to their vendor (disclosed in the UI) |
| 6 | Receipt photo, editable result, keep/delete image | 🟡 | `receipt.ts` (total, date, merchant, currency), `ui/ocr.ts` (on-device `TextDetector` when available), receipt store | Itemized lines, taxes/tips, multi-image: ❌. Cloud OCR 🔒. Never invents a total |
| 7 | Merchant → category, user rules, longest match, rule management | ✅ | `rules.ts`, `RulesSection.tsx`, dictionary in `parser.ts` | **Offer to remember a correction as a rule** (`suggestRuleFromCorrection`): done this session in the movement form (new and edit); only offered, saved on «Recordar», undoable. Assistant review and CSV import corrections: Phase 2. Aliases/priorities beyond longest-match: Phase 2 |
| 8 | Apple Pay / Wallet via Shortcuts | 🟡 | `shortcutLink.ts`, `docs/IOS-SHORTCUTS.md`: user-built Shortcut opens Clara prefilled; nothing saved without review | A web app cannot read Wallet. App Intents need a native iOS app 🔒 |
| 8 | Bank notification parsing, detection inbox with states | ❌🔒 | `inbox.ts` is computed notices (pending items), not a received-events queue | Android notification access needs a native app 🔒. A persistent "received events" queue fed by Shortcuts links is Phase 5 |
| 9 | Duplicate detection | 🟡 | `duplicates.ts` (form warning), `inbox.possibleDuplicates`, CSV `importRef` + bank reference + possible-duplicate review, idempotent ids | One engine shared by every source + idempotency keys for received events: Phase 5 |
| 10 | Safe-to-Spend: available, daily, weekly, until payday, reserved bills and goals, explanation | ✅ | `budget.ts`, `heroFigures.ts`, "¿Cómo se calculó?" | **Safety buffer** (`settings.safeToSpend.bufferMinor`, v13): done this session — subtracted from available/daily/weekly and calendar-period Safe-to-Spend, explained, shown in the composition bar, «Solo alcanza usando tu colchón» verdict. Credit limits never counted ✅; expected income never counted ✅ |
| 11 | Budgets weekly…yearly/custom, category & overall, pause, history, projection | ✅ | `plans.ts` (`BudgetPeriodType`), `periodBudgets.ts`, `Plans.tsx` | **Alerts at 50/75/90/100 %** (`plans[].alertLevels`, v13): done this session — early levels off by default, one notice per level and cycle, only the highest reached level is sent |
| 11 | Budget recommendations from history | ❌ | — | Phase 3 (deterministic suggestion; AI only for wording) |
| 12 | Recurring rules separate from occurrences; reconcile; never double count; pause; skip; month-end clamping | ✅ | `recurrence.ts`, `planItems.ts`, `reconcileSchedules.ts`, `ScheduleSheet.tsx` | **Twice monthly** (`semimonthly` + `secondDay`, v13): done this session in the schedule form (Setup and «Repetir» keep the previous list). Subscription overview + monthly total, recurring-payment suggestions, future-only edits: Phase 3 |
| 13 | Goals: target, date, contributions, virtual allocations, progress, projections | ✅ | `goals.ts`, `goalChart.ts`, `Goals.tsx` | Milestone notifications: Phase 3 |
| 14 | Statistics: income/expense/net, categories, merchants, trends, comparisons, daily average | ✅ | `statistics.ts`, `Statistics.tsx`, `insights.ts` | Filters by account/tag/merchant/status on statistics: Phase 4 |
| 15 | Forecast 7/14/30/90/custom, assumptions, scenarios, "Can I afford it?" | ✅ | `projection.ts` (400-day cap, explicit), `Projection.tsx`, `scenarios.ts`, `affordability.ts`, `shortfall.ts` | — |
| 16 | Search & combined filters, virtualization, trash/restore | ✅ | `search.ts`, `txFilters.ts`, `listView.ts`, `Trash.tsx` | — |
| 17 | Custom categories (icon, color, archive), tags (many per transaction) | ✅ | `categoryOps.ts`, `tagOps.ts`, `CategoryPicker` | — |
| 18 | Quick presets, reorder, one tap prefill | ✅ | `favorites.ts`, `templates.ts` | — |
| 19 | Multi-currency with exchange rates | ❌🔒 | Product rule: never convert silently | A user-entered rate (original amount, currency, rate, rate date) is possible without a provider; automatic rates need a provider 🔒. Needs a decision record + schema change (Phase 3) |
| 20 | Offline-first, durable local storage, migrations | ✅ | IndexedDB, service worker (app files only), recovery screens | — |
| 20 | Cloud sync, change queue, conflicts | ❌🔒 | `Account.tsx` explains it is not available | Needs a server, auth and an end-to-end encryption design (Phase 5). Never enabled without consent |
| 21 | CSV import (mapping, preview, duplicates, undo, errors), CSV/JSON/PDF export | ✅ | `bankImport.ts`, `BankImport.tsx`, `csvExport.ts`, `backup.ts`, statistics PDF | Export filters by date/account/category: Phase 4 |
| 22 | Guest mode; optional accounts (email/Google/Apple) | ✅ guest · ❌🔒 accounts | `Account.tsx` | Needs an identity provider and a server 🔒 |
| 23 | Privacy mode (3 levels), app lock, CSP, input validation, CSV formula safety, untrusted imports | ✅ | `preferences.ts`, `ui/lock`, `vite.config.ts` CSP, `validation.ts`, `safeText` | The lock uses a PIN or WebAuthn (device biometrics through the browser where supported). Protected app-switcher previews and notification controls need a native app 🔒 |
| 24 | In-app reminders; browser notifications where allowed | ✅ | `notifications.ts`, `NotificationsSection.tsx` | Push from a server 🔒 |
| 25 | Design system, light/dark, a11y, reduced motion | ✅ | tokens in `styles.css`, `VISUAL-QA.md`, layout guards | Account color/icon, statistics filters UI: later phases |
| 26 | i18n es/en/pt/fr, centralized, switchable | ✅ | `src/i18n/*`, `scripts` i18n check | — |
| 27 | Performance (10k/50k), virtualization, size budget | ✅ | `docs/PERFORMANCE.md`, `npm run size` (cap 844.6 KB) | — |
| 28 | Tests (financial, AI parser, import, recurring, UI, integrity) | ✅ | see §1 | Kept growing with every change |

## 3. Data-integrity risks and technical debt found

- **Fixed in the stabilization branch** (RT-01/02/03): foreign currencies saved as CAD; replacement Undo
  erasing edits made while a write was pending; CSV acknowledgment surviving a file change.
- Safe-to-Spend had no safety buffer, so the headline figure could reach 0 with nothing kept aside
  (§10 asks for it explicitly) → added.
- Budget alerts only at 80/100 % → configurable 50/75/90/100 with one notice per level and period (done).
- Recurrence lacked "twice a month" (common for salaries) → added with month-end clamping.
- `docs/GAP-ANALYSIS.md` (v2 kickoff) is historical; this document supersedes it for 2.0.
- No server exists: every section that needs one is marked 🔒 and is **not** shown as available in the UI
  (CLAUDE.md: never show buttons for features that do not exist).

## 4. Conflicts with existing product rules (kept)

- **No silent conversion.** §19 asks for conversion "through an appropriately configured provider"; with
  no provider the only honest option is a user-entered rate, which needs its own decision and schema.
- **AI never does arithmetic and never saves on its own.** Already true (`review.ts` + `saveConfirmedEntries`).
- **No fake integrations.** Apple Wallet monitoring, Android notification access, cloud sync and sign-in
  stay documented and disabled until a real implementation exists.

## 5. Migration and rollback strategy (schema 12 → 13)

- Additive only: new optional fields and new enum values. The 12 → 13 migration fills only
  `settings.safeToSpend.bufferMinor = 0` when absent (same figures as v12); `secondDay`, `institution`,
  `alertLevels` and the new account kinds are optional and need no migration. It never deletes or rewrites existing records
  (a malformed `settings` is kept as is so validation reports it).
- Before converting, the app keeps the original as a local copy (`margen.data.before-v13`, existing mechanism).
- Validation rejects malformed new fields; older data still validates after migration (tests).
- Rollback follows `docs/ROLLBACK.md`: a different `SCHEMA_VERSION` is never rolled back by redeploying
  an older build; fix forward. Older builds show the "newer data" screen instead of overwriting.

## 6. Phase plan (dependency order)

1. **Foundation (this session):** audit ✅; ledger property tests ✅; schema 13 with safety buffer ✅, account
   kinds ✅, twice-monthly schedules ✅, budget alert thresholds ✅ and offering to remember a category
   correction ✅ (movement form).
2. Merchant intelligence: aliases, normalization table, rule priorities, preferred account per merchant.
3. Planning: subscriptions overview and monthly total, recurring-payment suggestions from history,
   future-only schedule edits, budget recommendations, goal milestones, explicit user-rate multi-currency.
4. Analytics filters (account/tag/merchant/status), export filters, itemized receipts stored apart from
   the transaction (never one expense per item).
5. 🔒 Integrations: server-side AI adapter (owner endpoint), received-events inbox with idempotency keys
   for Shortcuts links, sync/auth design with end-to-end encryption. Each behind a feature flag and only
   with credentials provided by the owner.
6. Design refinement, security hardening, performance, final QA on real devices.

## 7. External configuration needed for 🔒 items

| Item | Needs |
|---|---|
| Remote AI parsing / receipt OCR | Owner-operated endpoint (server function) holding the provider secret; a limited-scope client token (`VITE_AI_KEY`) and `VITE_AI_ALLOWED_ORIGINS`; usage limits and monitoring on the server |
| Exchange rates | A rate provider and its terms, or user-entered rates only |
| Cloud sync and accounts | Server, database with per-user isolation, identity provider (email / Google / Apple), end-to-end encryption design, data-deletion flow |
| Apple Wallet / App Intents, Android notification access, native biometrics, push | Native iOS/Android apps and their developer accounts |

## 8. Results of this session

Commits: `7fdaa05` (this audit), `d29adee` (ledger properties), `5e7fa7e` (schema 13: buffer, twice
monthly, account kinds), `7e98892` (alert levels), `4f01bca` (remember a correction), `413fc01` (two
defects found while reviewing the buffer: «¿Qué cambió?» blind to it, and a false shortfall alarm),
`5e9a6dd` (docs), `7d03305` (two e2e tests that hard-coded schema 12/13).

Verification of `5e9a6dd` (log: `docs/qa/clara-2.0-fase1-2026-10-15/verification.txt`):

| Command | Result |
|---|---|
| `npm run check` | exit 0 · Vitest 92 files: 939 passed, 1 skipped (903 before + 36 new) |
| `npm run build` / `npm run size` | exit 0 · initial JS 827.0 KB (gzip 247.4 KB), cap 844.6 KB, not raised |
| `npm audit` | 0 vulnerabilities |
| Playwright, 3 projects, `--workers=2` | 955 passed, 4 skipped, 7 failed: 6 = two tests with the schema number hard-coded (fixed in `7d03305`, both files rerun on 3 projects: 30/30), 1 = `performance-10k` on desktop under load (708 / 614 ms) |
| `performance-10k` alone, same build, `--workers=1` | 3/3 pass: best of two 338, 303, 351 ms (efd2fa2: 328, 354, 332 ms), so no regression |

Everything not listed in §6 phase 1 remains open and is not presented as done. Not verified: physical
devices, VoiceOver/TalkBack, OS text size, device backup picker, offline install/update, interrupted
storage, the published deployment, the remote AI service.
