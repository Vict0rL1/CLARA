# AGENTS.md — how to run and test Clara (for Codex and other coding agents)

Clara is a **local-only prototype** of a personal-finance PWA (React 19 + TypeScript + Vite). There is no
backend, no user accounts, no bank connection and no AI inside the product. All data lives in the browser
(IndexedDB, falling back to `localStorage`). The UI is in Spanish by default (also English, Portuguese and
French). The project rules — architecture layers, money as integer minor units, i18n, accessibility — are in
`CLAUDE.md` (Spanish); follow them when changing code.

`main` contains everything: stages 1–4 of the Clara program and the release-stabilization fixes of
2026-10-13 (`docs/STABILIZATION-2026-10-13.md`). The follow-up fixes RT-01/02/03 from the independent
retest of 2026-10-15 are described in the same document (section «Comprobación independiente…»).

## 1. Setup

```bash
node --version          # needs ^22.12.0 or >=24
npm ci
npx playwright install chromium   # only for the browser tests (skip if a Chromium is preinstalled)
```

No `.env` is needed. Never add real credentials: everything that starts with `VITE_` ends up in the public
bundle (see `docs/RELEASE.md`).

## 2. Run the app

```bash
npm run dev                         # http://localhost:5173 (hot reload)
npm run build && npm run preview    # production build at http://localhost:4173
```

On the welcome screen, **«Explorar con datos de demostración»** loads a synthetic budget in CAD (dates are
relative to today, everything is marked as demo). «Ajustes › Demostración y borrado» clears it.

## 3. Automated checks (run all of these before declaring a change done)

```bash
npm run check        # typecheck + oxlint + i18n literal check + Vitest (≈1 130 unit tests, incl. qa/, the QA V2, the PR #15 audit, the self-review contracts, the follow-up audit and the lead pass)
npm run build        # production build
npm run size         # initial JS budget: must stay ≤ 844.6 KB (currently ≈ 844 KB: ~0.5 KB of headroom after QA V2) — do not raise it
npm audit --audit-level=high   # dependency audit (CI fails on a high/critical vulnerability)
npm run test:e2e     # Playwright: 3 projects (celular 412 px, celular-pequeno 320 px, escritorio) + axe
```

Useful variants:

```bash
npx playwright test --project=celular-pequeno --workers=2         # one viewport, like CI
npx playwright test tests/e2e/stabilization.spec.ts               # the stabilization regressions only
npx playwright test tests/e2e/retest.spec.ts                      # the 2026-10-15 retest regressions (RT-01/02/03)
npx playwright test tests/e2e/qa-v2.spec.ts                       # the QA V2 acceptance (CUR-01/02/03, FIN-01, STAT-01, SCH-01)
npx playwright test tests/e2e/qa-pr15.spec.ts                     # the PR #15 audit acceptance (QA-01/02/03/05; QA-04 is CUR-02 above)
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm run test:e2e   # use a preinstalled Chromium
BASE_URL=http://localhost:4174 npx playwright test <spec>         # run specs against another running build
```

Notes for reliable runs:

- The e2e suite builds the app and serves it on port 4173 itself; keep that port free and run one suite at a
  time. Tests use a fixed clock (2026-09-28 12:00, Toronto) and the demo data.
- CI runs each viewport with `--workers=2` and `--fail-on-flaky-tests`. On a heavily loaded machine two
  timing budgets can fail without any code change: «10 000 movimientos: Inicio interactivo en < 500 ms» and
  the 5 s page-title wait in `go()`. Re-run them alone before blaming the code; never raise those limits.
- Wait for persisted state, not time: after a UI save use `waitForSaved` / `reloadWhenSaved`
  (`tests/e2e/helpers.ts`) before reloading — reloading during an IndexedDB write aborts it.

## 4. Where things are

| Path | What |
|---|---|
| `src/domain/` | Pure financial logic (no React, no storage, "today" passed in). All formulas: `docs/FORMULAS.md` |
| `src/storage/` | IndexedDB / localStorage repository, backups, migrations (schema 14) |
| `src/state/` | In-memory store, undo of import/restore (`replaceUndo.ts`) |
| `src/ui/` | Screens and components; all text comes from `src/i18n/{es,en,pt,fr}.ts` |
| `tests/e2e/` | Playwright specs; `stabilization.spec.ts` = one test per audit finding |
| `src/domain/stabilization.test.ts` | Unit regressions per audit finding |
| `src/domain/retest.test.ts`, `src/state/replaceUndo.test.ts` | Unit regressions for RT-01/RT-03 and RT-02 (delayed IndexedDB writes) |
| `src/domain/qaV2.test.ts`, `src/ui/secondDay.test.ts`, `tests/e2e/qa-v2.spec.ts` | QA V2 contracts (CUR-01/02/03, FIN-01, STAT-01, SCH-01); the CUR-01 browser test is also `@smoke` |
| `src/domain/qaPr15{Anchor,Currency,Undo}.test.ts`, `tests/e2e/qa-pr15.spec.ts` | PR #15 audit contracts: QA-01 series anchor (schema 14, forward links), QA-02 buffer guard, QA-05 split undo (snooze rules R5/S1); browser acceptance incl. QA-03 filters and the R2 address rule |
| `src/domain/percentExact.test.ts`, `src/domain/dayBalance.test.ts` | Self-review contracts: exact integer percentages (R6); one rule for what a calendar day says, base or simulated (`outOfRange`, R3/S3) |
| `src/domain/qaCorrective.test.ts`, `tests/e2e/qa-corrective.spec.ts` | Corrective pass (independent audit 2026-10-19): P1 unsupported currency through bounded punctuation («coffee (RUB) 10», «TOTAL RUB: 10.00») blocks the line in the assistant, receipts, fields, CSV and shortcuts; P2 receipt keyword span classification («PEN 2.99 TAX 0.10» is an item). Report: `docs/qa/corrective-pass-2026-10-20/REPORT.md` |
| `src/domain/qaFollowUp.test.ts`, `src/ui/components/axisLabels.test.ts`, `src/ui/themeTokens.test.ts` (F-04), `tests/e2e/qa-followup.spec.ts` | Follow-up audit (head 46fe617): F-01 history ids per collection and recovery of data written by the faulty version; QA-01 historical split review/repair (`domain/splitRepair.ts`); F-02 dependency-safe undo; F-03 exact Analysis percentage; F-04 computed contrast of «Sin comparación»; F-05 axis labels by slot width. Report: `docs/qa/followup-audit-2026-10-20/REPORT.md` |
| `src/domain/qaLead.test.ts`, `src/test/v13-known-intent-backup.json`, `tests/e2e/qa-lead.spec.ts`, `tests/e2e/shots.ts` | Implementation lead pass (2026-10-27): the genuine schema-13 backup written by `819eaa9` (import, repair to 31-mar / 1 250 / 550, decline, round trip), F-02 later scenario, F-03 zero previous, keyboard/touch chart selection in es/en/pt/fr; the independent reviewers' findings re-encoded: F-R1 a repair never counts a paid occurrence twice (partition after the last settled one; skipped dates and links follow their period), F-R2 inherited anchors keep the review alive, F-R3 symmetric ±10 % threshold (`checkedPercentChange`), S-R1 expired snoozes are not undo dependents. Report: `docs/qa/implementation-lead-2026-10-27/REPORT.md` (reviewer reports and test code under `evidence/reviewers/`) |
| `docs/qa/qa-v2-implementation-2026-10-17/` | QA V2 implementation report, before/after evidence (JSON, logs) and screenshots |
| `docs/STABILIZATION-2026-10-13.md` | What was fixed, before/after evidence, known limits, later roadmap |
| `docs/screenshots/stabilization-2026-10-13/` | Before (audited `e7c9d87`) / after screenshots |

## 5. Manual test plan for the 2026-10-13 fixes

Start each case from a fresh demo (welcome screen → «Explorar con datos de demostración»). Amounts are CAD.

| Id | Steps | Expected |
|---|---|---|
| AS-01 | «+» → Asistente → type `café USD 10` → «Analizar» | Amount stays «10.00 USD», error «El importe está en USD; este presupuesto usa CAD. No se convierte.», «Registrar» disabled. Change it to `10` → registers in CAD |
| FIN-01 | New expense 42.80 dated on the account's reference-balance day, tick «Ya estaba incluido en el saldo» → Plan › Calendario → «Vincular: Recibo de luz» | Net worth in Ajustes › Cuentas is identical before and after linking, also after reload |
| FIN-02/03 | Create a limit with «Arrastrar lo no gastado»; after it renews with carry, edit it below the carried amount | Form warns the carry will be removed; saving keeps a valid limit; later renewals stay valid |
| REC-01 | Ajustes › Copia: export, import it back, then register an expense, then press «Deshacer» on the import toast | «No se deshizo: guardaste cambios después…»; the new expense survives a reload; «Antes de restaurar» exists in local copies |
| REC-02 | Import a backup whose top-level `exportedAt` is `"not-a-date"` (also via «Verificar») | File error «La fecha de exportación del archivo no es válida», no crash, nothing saved |
| 6 | Save an expense, reload, open `#/ajustes/historial` («Historial de cambios») → «Revertir» | Revert is offered and «Disponible» returns to the previous value |
| 7 | Rules «uber» → Transporte and «uber eats» → Restaurantes; assistant `uber eats 25` / `uber 12` / `renta 650`; tick «Vincular» on the rent | Categories dining / transport; review says «Saldo de tus cuentas: −$650.00 · Disponible: sin cambio…»; the announced available equals the one after registering |
| 8 | Add a large refund (more than the month's spending) → Análisis › Estadísticas | Expense bar drops below the zero line with a note; tooltip and table show the same negative figure |
| 9 | Plan › Calendario → go 14 months ahead → pick a day after the 400-day limit | «Sin saldo proyectado para este día…», no amount; month note says how far the projection goes |
| 10 | Import a CSV twice where two rows share the first 80 characters of the description; import a 5,003-row CSV | The second distinct row is «posible duplicado» (never silently skipped); big file states exactly which rows are left out and requires ticking the acknowledgement |
| 11 | Build with `VITE_AI_ENDPOINT=https://api.openai.com./v1 VITE_AI_KEY=x VITE_AI_ALLOWED_ORIGINS=...` | Build fails (`providerHost`); credentials in the URL or a missing allowlist also fail |
| 12 | Dark theme → Análisis › Estadísticas | Donut total and subtitle are clearly readable (≥ 4.5:1) |
| 13 | Phone at 320 px with 200 % text (browser zoom/text size), es/en/pt/fr: Ajustes › Cuentas, Plan › Metas, Ajustes › Datos, Plan › Calendario | No horizontal scrolling; bottom bar may use two rows; nothing hidden behind it |
| 14 | On a touch device, swipe a movement row quickly left | Row opens; «Eliminar» responds to the tap |
| 15 | A goal with more than 50 history entries | «Mostrando 50 de N…» and «Mostrar más» until the oldest |
| RT-01 | Assistant (CAD budget): `coffee 10€`, `coffee GBP 10`, `coffee EUR ten`, `coffee ten USD`, `café diez euros` | Each line keeps its currency in the amount field (`€10.00`, `10.00 GBP`…), says «No se convierte» and «Registrar» stays disabled; `coffee 10` / `tea 4 CAD` register in CAD |
| RT-02 | Export a backup, set `autoConfirm: true` on «Recibo de luz» in the JSON, import it, then «Deshacer» (also via Copias locales › Restaurar) | The bill is recorded automatically; Undo answers «No se deshizo…» and the bill survives a reload |
| RT-03 | Import: choose a 5,003-row CSV, tick «Entiendo que 3 filas…», then «Elegir otro archivo» with 6,000 rows (or the same name with other content, or untick the header option) | The new «Entiendo que N filas…» is unticked and Import stays disabled until ticked again |

**Not covered by automated tests (please test on real devices):** physical phones (iOS Safari, Android
Chrome), the OS text size at 200 %, a screen reader (VoiceOver / TalkBack), offline install and update of the
PWA, and backup export/import through the device's file picker.
