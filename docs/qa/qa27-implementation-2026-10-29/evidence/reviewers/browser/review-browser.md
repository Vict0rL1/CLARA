# QA27 · Independent browser review of `ac993969` (QA27-01 … QA27-04)

Reviewer: independent browser QA, read-only on application code and existing tests. Worktree `…/scratchpad/qa27/rev-browser` at `ac99396` (detached), `node_modules` symlinked, `npx vite build`, served with `vite preview --port 4181`. The only file added is `tests/e2e/review.qa27.spec.ts` (untracked, 15 tests, own synthetic fixtures: other names, ids, amounts and dates than `qa27.spec.ts`). Commits reviewed: `96f64fb` (QA27-01), `150bb9e` (QA27-02), `7d7a23a` (QA27-03), `85b4a85` (QA27-03b), `fcfcdfe` (QA27-04), `ac99396` (lead spec clock). Chromium `/opt/pw-browsers/chromium`, Playwright projects `celular` (Pixel 7, 412 px), `celular-pequeno` (320 px), `escritorio` (1 280 px), `--workers=1`, projects run one after the other, never the whole suite.

## 1. Result overview per project

Final serial run (after the preview restart); the previous serial run (`*-run1` logs) gave exactly the same per-test results.

| Project | Passed | Failed | Skipped | Wall time |
|---|---|---|---|---|
| celular (412 px) | 12 | 3 | 0 | 1.4 min |
| celular-pequeno (320 px) | 11 | 3 | 1 (perf probe runs once, on celular) | 1.3 min |
| escritorio (1 280 px) | 11 | 3 | 1 (idem) | 1.4 min |

The three failures are the same in every project — 3A, 3C and 3F — and all come from one product defect (**R-1**, Statistics falls into the error boundary when the 90-day projection leaves the exact integer range). Everything else passes at the three widths: the QA27-01 history refusal (partitioned repair, ordinary «Desde una fecha» split, payment undo, unrelated-movement undo), the QA27-02 snoozes (same date and changed date), the QA27-03 weekly/Analysis/Statistics texts in the orientations where Statistics renders, the QA27-03b 10 000-movement load, the QA27-04 no-IndexedDB card (refusal, download gate, keyboard, focus, contrast light/dark), and the axe sweep (no violations on any scanned screen at any width).

## 2. Cases built (expected → actual)

All amounts CAD, number locale es-MX, time zone America/Toronto, clock installed per case. `X = 999 999 999 999` (one minor unit under `MAX_AMOUNT_MINOR = 10¹²`); `MAX = 2⁵³ − 1 = 9 007 199 254 740 991`.

### Flow 1 · repair/split, pay through the UI, history (QA27-01)

**1A · partitioned repair, payment from Pendientes, es/en/pt/fr, reload, export/import — PASS ×3.** Fixture: «Luz» 76.50 monthly on the 31st; `luz-old` 31-ene-2026 → ends 27-feb; `luz-new` from 28-feb (no `anchorDate`); paid 31-ene (old), 28-feb and 28-mar (moved date → the repair must partition); balance 2 500.00 on 1-abr; horizon 7 days; clock 20-abr-2026.
Expected: card shows «Hoy cuenta desde…: 28 abr…» and «Como siempre…: 30 abr…»; after «Restaurar las fechas de siempre», `luz-new.endDate = 2026-03-31` and a tail segment `startDate 2026-04-01, anchorDate 2026-01-31`; at 3-may the 30-abr is overdue in `/pendientes` → «Registrar pago» → dialog «Marcar como pagado» with $76.50 → «Confirmar pago» → payment linked to `<tail>:2026-04-30`; available $2,423.50 (2 500 − 76.50; nothing else inside 7 days); History: the repair entry carries `history-dependents` with the full es text («No se puede revertir: 1 registro seguiría apuntando a un programado, o a una fecha de pago, que este cambio eliminaría o cambiaría. Cámbialo o bórralo primero.» and «Pago registrado para el 30 abr ($76.50): seguiría registrado pero ya no liquidaría ninguna fecha, y esa fecha volvería a contar») and **no button at all**; in English/Português/Français the texts are «Cannot revert: 1 record would still point to a scheduled payment, or to a payment date…» / «Recorded payment for», «Não é possível reverter: 1 registro continuaria apontando…» / «Pagamento registrado para», «Impossible d'annuler : 1 enregistrement pointerait encore…» / «Paiement enregistré pour le», with the amount, no `history.*` keys, no `NaN`, no horizontal scroll; reload keeps $2,423.50 and the refusal; «Exportar copia» downloads a `margen-backup` JSON in which the payment is still linked; importing that same file («¿Reemplazar tus datos con esta copia?» → «Reemplazar datos» → «Copia importada») keeps $2,423.50, the linked payment, the tail with `anchorDate`, and the refusal; Pendientes has no «Luz» item afterwards.
Actual: exactly as expected in the three projects. axe (WCAG 2.0/2.1 A+AA) on History with the dependent payment: no violations ×3.

**1B · ordinary «Desde una fecha» split, payment from the calendar, payment undo — PASS ×3.** Fixture: «Gimnasio» 42.00 monthly on the 18th since 18-jul-2026, paid jul–oct; balance 900.00 on 19-oct; horizon 7 days; clock 20-oct-2026.
Expected: `/plan/programado/editar/gym` → radio «Desde una fecha» → the field «Desde (primera fecha con los cambios)» is prefilled `2026-11-18`; amount 45 → «Guardar» → «Cambio guardado desde el 18 nov…»; stored: `gym.endDate = 2026-11-17` (amount 4 200 kept), new segment `startDate 2026-11-18, amountMinor 4 500, anchorDate 2026-07-18`; at 10-nov the calendar offers «Marcar pagado: Gimnasio» → $45.00 → «Confirmar pago» → payment `<new>:2026-11-18`; available $855.00; History: the split entry shows «Pago registrado para el 18 nov ($45.00)…» and no button; exactly one entry offers «Revertir» (the payment, text contains $45.00) → «¿Revertir este cambio?» → «Revertir» → «Cambio revertido»; the payment is gone, the new segment intact, available $900.00; the split entry («Pago o ingreso programado creado: Gimnasio») now offers «Revertir» and has no dependents.
Actual: as expected ×3.

**1C · in-place repair, unrelated later movement, undo — PASS ×3.** Fixture: «Agua» 38.99 on the 31st, split at 28-feb by an old version, only the 28-feb paid (coincides with the usual series) → in-place repair; balance 1 500.00 on 1-mar; horizon 7; clock 20-mar-2026.
Expected: repair sets `agua-new.anchorDate = 2026-01-31` and keeps 2 schedules; «+ › Gasto» 12.34 «Restaurantes y café» → «Movimiento guardado»; available $1,487.66 (the 31-mar lies outside the 7-day horizon); History: «Programado cambiado: Agua» has no dependents and offers «Revertir» → «Cambio revertido»; `anchorDate` gone, the 12.34 movement survives, available unchanged, the card is back in Ajustes › Datos.
Actual: as expected ×3.

### Flow 2 · snooze then repair (QA27-02)

**2A · coincident date, partitioned repair — PASS ×3.** Fixture: «Hipoteca» 1 200.00 on the 30th since 30-nov-2025; `hip-old` ends 27-feb-2026; `hip-new` from 28-feb-2026, paid on every moved 28th through 28-ene-2027; balance 20 000 on 1-feb-2027; clock 2-mar-2027 (the 28-feb-2027 is overdue and unpaid).
Expected: «Posponer 7 días» → «Pospuesto 7 días. Volverá si sigue pendiente.»; stored `{ id: 'due:schedule:hip-new:2027-02-28', until: '2027-03-09' }`; «Pospuesto (1)» → «Hasta el 9 mar…»; repair partitions (`hip-new.endDate = 2027-01-30`, tail from 2027-01-31 with `anchorDate 2025-11-30`) and the snooze becomes `due:schedule:<tail>:2027-02-28` with the same `until` and `at`; `/pendientes` shows no active «Hipoteca», «Pospuesto (1)» lists «Hipoteca» 28 feb · Hasta el 9 mar; same after reload.
Actual: as expected ×3.

**2B · date that changes, in-place repair — PASS ×3.** Fixture: «Seguro auto» 95.00 on the 30th since 30-dic-2025; `seg-old` ends 27-feb; `seg-new` from 28-feb with the 28-feb paid; balance 5 000 on 1-mar; clock 2-abr-2026 (the moved 28-mar is overdue).
Expected: snooze `due:schedule:seg-new:2026-03-28` until 2026-04-09; the in-place repair (`anchorDate 2025-12-30`, still 2 schedules) moves it to `due:schedule:seg-new:2026-03-30` with the same `until`/`at`; Pendientes: no active item, «Pospuesto (1)» shows «Seguro auto» 30 mar · Hasta el 9 abr.
Actual: as expected ×3.

### Flow 3 · very large totals (QA27-03)

**3A · safe difference — FAIL ×3 (product defect R-1 in the Statistics step; Analysis and weekly OK).** Fixture: Sep-10 1 130 expenses of X, Oct-14 1 130, Oct-21 2 260; balance 0 on 1-ago; clock 22-oct-2026 (Thursday).
Hand-computed: Sep = 1 129 999 999 998 870; Oct = 3 389 999 999 996 610; difference 2 259 999 999 997 740 (fits), percent 200 → Statistics expenses «+200 %»; Analysis «Este mes llevas un 200 % más de gasto…» with the «Diferencia» row; weekly (12–15 oct vs 19–22 oct) 1.13 × 10¹⁵ vs 2.26 × 10¹⁵ → «$11,299,999,999,988.70 más (100%)».
Actual: Analysis ✓, weekly ✓ (captures `3a-analysis-plus-200`, `3a-weekly-plus-100`); Statistics ✗ → heading «No se pudo abrir esta pantalla» (capture `3a-stats-safe`), console `RangeError: Desbordamiento al sumar importes` from the projection chunk.

**3B · unsafe difference, percentage fits — PASS ×3.** Fixture: Sep-10 4 520 expenses, Oct-10 4 520 refunds (4 519 999 999 995 480 vs −4 519 999 999 995 480; difference −9 039 999 999 990 960 does not fit; percent from the operands −200).
Expected: Statistics expenses «-200 %» (+ sr-only «frente al periodo anterior»); Analysis «…200 % menos de gasto…» with «Este mes hasta hoy» and **without** «Diferencia»; no keys/NaN/horizontal scroll on Statistics, weekly and Analysis. Actual ✓ ×3. axe on Statistics: no violations ×3.

**3C · unsafe difference, no positive base — FAIL ×3 (R-1).** Fixture mirrored: Sep-10 4 520 refunds, Oct-10 4 520 expenses.
Hand-computed: expenses tile → difference 9 039 999 999 990 960 does not fit and the base is ≤ 0 → «Sin comparación» (en «No comparison», pt «Sem comparação», fr «Pas de comparaison»); net tile → Oct −4.52 × 10¹⁵ vs Sep +4.52 × 10¹⁵ → «-200 %».
Actual: Statistics → error boundary in the three projects (capture `3c-stats-no-comparison-es` shows the error screen); the four-language loop could not run.

**3D · weekly, unsafe difference with percentage — PASS ×3.** Fixture: Oct-14 4 520 expenses, Oct-21 4 520 refunds. Expected `week-spending-change` = «Semana anterior: $45,199,999,999,954.80 · la diferencia no cabe en una cifra exacta (200%)», en «the difference does not fit an exact figure», pt «a diferença não cabe em um valor exato», fr «la différence ne tient pas dans un chiffre exact», each with the percentage; no keys/NaN/horizontal scroll on the three screens in the four languages. Actual ✓ ×3 (Statistics renders here because the refunds inside the 30-day window net the spend estimate to 0).

**3E · weekly, unsafe difference, no positive base — PASS ×3.** Mirrored week: «la diferencia no cabe en una cifra exacta» with no percentage. Actual ✓.

**3F · diagnostic reach — FAIL ×3 (R-1).** With the 3C data, visit `/`, `/movimientos`, `/analisis`, `/revision`, `/plan/calendario`, `/plan/proyeccion`, `/estadisticas`, `/estadisticas?periodo=month&fecha=2026-10-22` and expect no screen to show the error heading. Actual: exactly the two Statistics routes do; the other six render.

### Flow 4 · repair without IndexedDB (QA27-04)

**4A · refusal, download gate, second series after a change — PASS ×3.** `page.addInitScript` sets `window.indexedDB = undefined`; data seeded through `localStorage['margen.data.v1']`. Fixture: «Sueldo neto» income 2 750 on the 31st split at 28-feb (`sal-old`/`sal-new`) and «Internet casa» 64.99 on the 30th split at 28-feb (`int-old`/`int-new`), no payments, balance 1 234.56 on 1-mar, clock 12-mar-2026.
Expected: available $1,039.59 (1 234.56 − 3 × 64.99: the 30-ene and 28-feb bills are overdue and unpaid, the 28-mar falls before the next income); the card shows the exact note «Este navegador no guarda copias locales. Antes de restaurar, descarga una copia con «Descargar copia antes»: sin una copia de los datos tal como están ahora, no se restaura.» and both series; confirming without a download: the dialog says «En este navegador no hay copias locales: tu respaldo es la copia que descargaste desde esta tarjeta.» (and not «Antes se guarda una copia local»), the toast is exactly «No se restauró: antes hace falta una copia de estos datos. En este navegador no se pudo guardar una copia local; descarga una con «Descargar copia antes» y vuelve a intentarlo.», `localStorage` byte-identical, both series still listed; «Descargar copia antes» → `.json` whose `data.updatedAt` equals the stored one and whose `sal-new` has no `anchorDate`; then restoring works (`sal-new.anchorDate = 2026-01-31`, `int-new` untouched, only Internet casa left on the card); restoring Internet casa right away with the same download is refused (the data changed) and storage stays identical; download again, add a 10.00 expense through «+ › Gasto» (available $1,029.59), come back → refused again, identical storage; download → restored, card gone; after reload both `anchorDate`s set, the 10.00 movement present, $1,029.59.
Actual: as expected ×3. axe on the card (light): no violations ×3.

**4B · light theme, keyboard only, focus return, contrast — PASS ×3.** Note contrast 7.58:1 (rgb(71,85,105) on rgb(255,255,255), 14.4 px / 400). Tab reaches «Restaurar las fechas de siempre» of the first series; Enter opens the dialog with focus inside; Escape closes it and focus is back on that same button; Tab to «Descargar copia antes» + Enter downloads a `.json`; Shift+Tab back, Enter, Tab to the dialog's confirm, Enter → «Fechas de siempre restauradas», `anchorDate` set, row gone. Actual ✓ ×3.

**4C · dark theme — PASS ×3.** Note contrast 6.79:1 (rgb(148,163,184) on rgb(18,26,42)); axe no violations; no horizontal scroll. Actual ✓ ×3.

### Flow 6 · performance probe (QA27-03b), once, on celular

**6 — PASS.** 5 000 identical expenses of 123 456 789 000 on 12-sep + 5 000 identical refunds on 12-oct, balance 0 on 1-ago, clock 22-oct. Main figure visible 371 ms after `reload()` (previous runs: 279, 359, 345 ms); no `crash` event; `/pendientes` renders with 20 possible-duplicate notices (≤ 100 given the cap of 50 pairs per group), no key leaks.

## 3. Findings

### R-1 · P2 · product defect (pre-existing at `21b4ed8`, inside the QA27-03 claim) — Statistics falls into the error boundary when the 90-day projection leaves the exact range

- **Reproduction** (any width, es): seed an account with balance 0 (reference 2026-08-01) and 4 520 realized expenses of 999 999 999 999 dated 2026-10-10 (optionally 4 520 refunds on 2026-09-10, as in the audit's fixture but mirrored), clock 2026-10-22, open Análisis › Estadísticas (default period or `?periodo=month&fecha=2026-10-22`). The spec's 3C/3F do exactly this through IndexedDB; the same data imported from a backup behaves the same (the backup path is what the audit used).
- **Expected**: the screen renders; expenses tile «Sin comparación», net tile «-200 %»; the future-balance card says there is no exact figure (the calendar already does this with `outOfRange`).
- **Actual**: «No se pudo abrir esta pantalla · Puede que la app se haya actualizado en otra pestaña o que no haya conexión. Tus datos no cambiaron. Recarga para continuar.» with a «Recargar» button that cannot help; console `RangeError: Desbordamiento al sumar importes` (projection chunk ← Statistics `useMemo`). Reproduced in the three projects, in two consecutive serial runs. Also reached by the safe-difference fixture 3A (1 130 + 2 260 expenses in October).
- **Root cause** (code inspection, no change made): `src/domain/statistics.ts` `futureBalance` calls `projectBalance(data, today, { days: 91, dailySpendMinor, scenario })` **without** `stopWhenOutOfRange`; `src/domain/projection.ts:117` throws `RangeError` when a day's balance stops being a safe integer unless that option is set. `estimateDailySpend(30)` gives floor(3 389 999 999 996 610 / 30) ≈ 1.13 × 10¹⁴ per day in 3A and ≈ 1.51 × 10¹⁴ in 3C; × 91 days ≈ 1.03 × 10¹⁶ / 1.37 × 10¹⁶ > 9 007 199 254 740 991. Trigger: net (expenses − refunds) spending of roughly more than $29.7 trillion inside the last 30 days with a zero balance (lower with a negative balance). Refunds inside the window mask it, which is why the lead's QA27-03 fixture and my 3B/3D/3E pass.
- **Reach**: only the Statistics routes (3F); Home, Movimientos, Análisis, Revisión, Calendario and Proyección render with the same data.
- **Regression?** No: `git diff 21b4ed8..HEAD` touches neither `projection.ts` nor this part of `statistics.ts`. But the QA27-03 statement «Estadísticas sigue en pie» holds only for the orientation of the audit's fixture.
- **Evidence**: `test-results/review-shots/<project>/3c-stats-no-comparison-es.png`, `3a-stats-safe.png`, `3f-error-screen--estadisticas.png`, `3f-error-screen--estadisticas-periodo-month-fecha-.png`; `test-results/review-perf-<project>.log` (3F line); traces under `test-results/review-<project>/`.
- **Suggestion for the implementer** (not applied): use `stopWhenOutOfRange` in `futureBalance` (or check the estimate) and let the band say «sin cifra» when `outOfRangeFrom` is set.

No defect found in QA27-01, QA27-02, QA27-03b or QA27-04 with my fixtures.

## 4. Observations (not QA27 defects)

- **O-1 (P3, pre-existing, out of scope)**: an account whose running balance itself leaves the exact range (my first 3A attempt: 9 040 × 999 999 999 999 = 9 039 999 999 990 960 of expenses on one account) makes **Home** fall into the same error boundary (console `Error: Desbordamiento al sumar importes` from the balances chunk). CLAUDE.md says an aggregate that does not fit must be declared, not crash. Needs > $90 trillion on one account.
- **O-2 (cosmetic)**: the weekly review formats the percentage with Intl («(200%)», no space; a narrow no-break space in fr) while Statistics and Analysis write «-200 %» / «200 % menos» with a space. Same figure, different typography.
- **O-3 (copy)**: the error boundary blames an update in another tab or a lost connection; for an arithmetic overflow the message misleads and «Recargar» does not help (R-1, O-1).
- **O-4 (cosmetic)**: the «Luz» marcado como pagado toast is still on screen when History opens (toasts persist across navigation).
- **O-5**: with 10 000 identical movements the inbox lists 20 possible-duplicate notices (the cap allows up to 50 pairs per group); nothing wrong, recorded for the record.

## 5. Test-side corrections (my mistakes, fixed in the spec)

1. 3A's first fixture summed 9 040 × X ≈ 9.04 × 10¹⁵ of expenses on one account (> 2⁵³ − 1) → Home error boundary (O-1); halved to 1 130 / 1 130 / 2 260.
2. The Statistics delta assertions used `toHaveText` and failed on the sr-only suffix «frente al periodo anterior»; now `toContainText`.
3. I expected the weekly percentage as «(200 %)»; the product writes «(200%)»; the regex now accepts an optional space (also the «(100%)» case).
4. 4A's expected available was $1,169.57; the fixture has no payments, so the 30-ene and 28-feb bills are overdue and count → $1,039.59 and $1,029.59 after the 10.00 expense (hand-recomputed).
5. Evidence ordering (not a weakening): 3A checks Analysis and the weekly review before Statistics and asserts the absence of the error heading explicitly, 3C asserts it first; 3F (diagnostic reach) added; the Statistics axe scan moved into 3B because the 3C screen never renders.

Run history: `celular` attempt 1 (5 failed: 3A, 3B, 3C, 3D, 4A → corrections 1–4), attempt 2 (3 failed: 3A, 3C, 3F), attempt 3 (same), then serial run 1 on the three projects, then the confirmation serial run after the preview restart (identical results). All attempt logs are kept (`test-results/review-run-celular-attempt{1,2,3}.log`, `*-run1.log`).

## 6. Commands run (summary output)

```
git -C /home/user/ALCANZA worktree add …/qa27/rev-browser ac993969352d062a688b4f4ab72f9f8d89ca7599   # HEAD is now at ac99396
ln -s /home/user/ALCANZA/node_modules …/qa27/rev-browser/node_modules
git log --oneline 21b4ed8..HEAD   # ac99396 fcfcdfe 85b4a85 7d7a23a 150bb9e 96f64fb
npx vite build                    # ✓ built in 2.11s (dist/)
node node_modules/vite/bin/vite.js preview --port 4181 --strictPort &   # Local: http://localhost:4181/ (restarted once after the session cut; killed at the end)
npx tsc --noEmit -p tsconfig.e2e.json   # clean, after each spec edit
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium BASE_URL=http://localhost:4181 npx playwright test tests/e2e/review.qa27.spec.ts --project=<P> --workers=1 --output=test-results/review-<P> --reporter=list | tee test-results/review-run-<P>.log
  celular attempt 1: 9 passed, 5 failed (1.5m)     attempt 2: 12 passed, 3 failed (1.5m)     attempt 3: 12 passed, 3 failed (1.5m)
  serial run 1:  celular 12 passed / 3 failed (1.6m) · celular-pequeno 11 passed / 3 failed / 1 skipped (1.4m) · escritorio 11 passed / 3 failed / 1 skipped (1.5m)
  confirmation:  celular 12 / 3 (1.4m) · celular-pequeno 11 / 3 / 1 skipped (1.3m) · escritorio 11 / 3 / 1 skipped (1.4m)   — failures: 3A, 3C, 3F in every project
  review-perf-celular.log: «Inicio con 10 000 movimientos: cifra visible a los 371 ms», «Pendientes: 20 avisos de posible duplicado», «3F pantallas rotas: /estadisticas, /estadisticas?periodo=month&fecha=2026-10-22; errores de consola: RangeError: Desbordamiento al sumar importes»
  review-axe-<P>.log: historial con pago dependiente (es) · estadísticas con diferencia que no cabe, -200 % (es) · tarjeta sin IndexedDB (claro) · (oscuro) → «sin violaciones» in the three projects
  review-contrast-<P>.log: claro 7.58:1 · oscuro 6.79:1
pkill -f 'vite.js preview --port 4181'; ss -ltn | grep 4181   # port free at the end
```

## 7. Screenshots

`…/rev-browser/test-results/review-shots/<project>/` (final run; `review-shots-run1/` keeps the previous serial run), PNG at CSS scale. celular has 31, celular-pequeno and escritorio 29 each (no perf captures): `1a-history-refusal-{es,english,português,français}`, `1a-after-import-inbox-clean`, `1b-split-form`, `1b-history-split-refusal`, `1b-after-payment-undo`, `1c-repair-revertible`, `2a-snoozed-same-date-after-repair`, `2b-snoozed-date-changed-after-repair`, `3a-analysis-plus-200`, `3a-weekly-plus-100`, `3a-stats-safe` (error screen), `3b-stats-unsafe-percent`, `3b-analysis-minus-200`, `3c-stats-no-comparison-es` (error screen), `3d-weekly-no-difference-{es,english,português,français}`, `3f-error-screen--estadisticas`, `3f-error-screen--estadisticas-periodo-month-fecha-`, `4a-card-no-local-copy`, `4a-dialog-no-local-copy`, `4a-refused`, `4a-both-repaired`, `4b-keyboard-dialog`, `4c-dark-note`, and on celular `6-home-10000`, `6-inbox-10000`. Playwright traces of the failures: `test-results/review-<project>/…/trace.zip`.

## 8. Limits — what was not checked

- No physical devices, no assistive technology (no screen reader; axe and computed contrast only), no real OCR, no real file picker (`setInputFiles` and `waitForEvent('download')`), no Firefox/WebKit.
- 3C's en/pt/fr loop («No comparison», «Sem comparação», «Pas de comparaison») could not run because the screen does not render (R-1); the strings exist in the four dictionaries (grep) but were not seen in the browser. Statistics' axe scan therefore covers the 3B variant (renders, «-200 %»), not the crashed 3C screen.
- The en/pt/fr history refusal was checked with the number locale still es-MX («$76.50»).
- The existing suites and the lead's `qa27.spec.ts` were read, not run (per the brief). The performance probe ran once, on celular; absolute times are of this machine.
- Nothing was built or run against `21b4ed8`; the «pre-existing» classification of R-1/O-1 rests on `git diff` of the touched files.

## 9. Spec (`tests/e2e/review.qa27.spec.ts`, final version, 803 lines)

```ts
import AxeBuilder from '@axe-core/playwright'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { AppData, Transaction } from '../../src/domain/types'
import { account, baseData, bill, tx } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, openAddSheet, openApp, pickCategory, setLanguage, settleAnimations, storedData, waitForSaved, writeStoredData, type UiLanguage } from './helpers'

/**
 * Revisión INDEPENDIENTE en el navegador de los arreglos QA27-01…04 (ac99396), con datos propios (otros nombres,
 * importes, ids y fechas que `qa27.spec.ts`). Solo lectura sobre la implementación: nada de aquí cambia la app.
 */

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

type StoredSchedule = { id: string; name: string; startDate: string; endDate?: string; anchorDate?: string; amountMinor: number }
type StoredTx = { id: string; scheduleId?: string; occurrenceDate?: string; amountMinor: number; status: string }
type Stored = { schedules: StoredSchedule[]; transactions: StoredTx[]; inbox: { snoozed: { id: string; until: string; at: string }[] }; history: { id: string; source?: string }[]; updatedAt: string }

const clock = (iso: string) => new Date(`${iso}T12:00:00-04:00`)
const anchor = (amountMinor: number, date: string) => ({ amountMinor, date, setAt: `${date}T12:00:00.000Z` })
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored
const localRaw = (page: Page) => page.evaluate(() => localStorage.getItem('margen.data.v1'))
const storedLocal = async (page: Page) => JSON.parse((await localRaw(page)) ?? '{}') as Stored
const paid = (scheduleId: string, date: string, amountMinor: number, id: string, categoryId = 'utilities'): Transaction =>
  tx({ id, kind: 'expense', amountMinor, date, categoryId, scheduleId, occurrenceDate: date })

/** Siembra con el reloj del caso (el ayudante genérico lo deja en el 28-sep-2026). */
async function seedAt(page: Page, data: AppData, iso: string) {
  await openApp(page, clock(iso))
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, data)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
}

async function snap(page: Page, name: string, focus?: Locator) {
  const dir = `test-results/review-shots/${test.info().project.name}`
  mkdirSync(dir, { recursive: true })
  if (focus && (await focus.count()) > 0) await focus.first().evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: `${dir}/${name}.png`, scale: 'css' })
}

/** Ninguna clave de traducción, `NaN` ni `undefined` a la vista. */
const KEY_LEAK = /\b(?:history|splitRepair|weekly|stats|insights|inbox|markPaid|scheduleForm|localBackup|calendar|common|settings\.backup)\.[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\b/
async function expectCleanText(page: Page, label: string) {
  const text = await page.locator('body').innerText()
  expect(text, `${label}: NaN visible`).not.toMatch(/\bNaN\b/)
  expect(text, `${label}: «undefined» visible`).not.toMatch(/\bundefined\b/)
  expect(KEY_LEAK.exec(text)?.[0] ?? null, `${label}: clave de traducción sin resolver`).toBeNull()
}

async function axeScan(page: Page, label: string) {
  await settleAnimations(page)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)
  mkdirSync('test-results', { recursive: true })
  appendFileSync(`test-results/review-axe-${test.info().project.name}.log`, `[${label}] ${summary.length ? summary.join(' ;; ') : 'sin violaciones'}\n`)
  expect.soft(summary, `axe · ${label}`).toEqual([])
}

/** Contraste calculado como en `qa-followup.spec.ts` (`textContrast`). */
async function textContrast(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) throw new Error(`no hay ${sel}`)
    const parse = (c: string) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c)
      return m ? { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4] } : null
    }
    const fg = parse(getComputedStyle(el).color)!
    let node: HTMLElement | null = el
    let bg = null as ReturnType<typeof parse>
    while (node && (!bg || bg.a === 0)) {
      bg = parse(getComputedStyle(node).backgroundColor)
      node = node.parentElement
    }
    const lum = (c: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const [a, b] = [lum(fg), lum(bg!)]
    return { fg: getComputedStyle(el).color, bg: `rgb(${bg!.r}, ${bg!.g}, ${bg!.b})`, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fontSize: getComputedStyle(el).fontSize, fontWeight: getComputedStyle(el).fontWeight }
  }, selector)
}

/** Qué tiene el foco (texto, tarjeta/fila con data-testid más cercana, si está dentro de un diálogo abierto). */
const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return { tag: el?.tagName ?? '', text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim(), testid: el?.closest('[data-testid]')?.getAttribute('data-testid') ?? '', inDialog: !!el?.closest('dialog[open]') }
  })
type Active = Awaited<ReturnType<typeof active>>
async function tabTo(page: Page, match: (a: Active) => boolean, max = 80): Promise<Active> {
  for (let i = 0; i < max; i++) {
    const a = await active(page)
    if (match(a)) return a
    await page.keyboard.press('Tab')
  }
  throw new Error('no se alcanzó el control con Tab')
}

async function restoreUsualDates(page: Page, name: string) {
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card).toBeVisible()
  await card.locator('li', { hasText: name }).getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await page.getByRole('dialog', { name: `¿Restaurar las fechas de siempre de «${name}»?` }).getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
}

const LANGS: UiLanguage[] = ['English', 'Português', 'Français']

/* ------------------------------------------------------------------ */
/* Flujo 1 · reparar o partir, pagar, historial                        */
/* ------------------------------------------------------------------ */

/** «Luz» del 31 partida el 28-feb por una versión anterior, con el 28-mar (fecha movida) pagado: la reparación parte la serie. */
const luz = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(250000, '2026-04-01') })],
    schedules: [
      bill('2026-01-31', 7650, { id: 'luz-old', name: 'Luz', frequency: 'monthly', endDate: '2026-02-27' }),
      bill('2026-02-28', 7650, { id: 'luz-new', name: 'Luz', frequency: 'monthly' }),
    ],
    transactions: [paid('luz-old', '2026-01-31', 7650, 'pl-1'), paid('luz-new', '2026-02-28', 7650, 'pl-2'), paid('luz-new', '2026-03-28', 7650, 'pl-3')],
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}

test('1A · reparación partida («Luz»), pago desde Pendientes: el historial lo explica en es/en/pt/fr sin «Revertir», y recarga, exportar e importar lo conservan', async ({ page }) => {
  test.setTimeout(150_000)
  await seedAt(page, luz(), '2026-04-20')
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card.getByTestId('split-repair-current')).toContainText('28 abr')
  await expect(card.getByTestId('split-repair-proposed')).toContainText('30 abr')
  await restoreUsualDates(page, 'Luz')
  let s = await stored(page)
  expect(s.schedules.find((x) => x.id === 'luz-new')).toMatchObject({ endDate: '2026-03-31' })
  const tail = s.schedules.find((x) => x.name === 'Luz' && !['luz-old', 'luz-new'].includes(x.id))
  expect(tail).toMatchObject({ startDate: '2026-04-01', anchorDate: '2026-01-31' })

  // Trece días después: el 30-abr corregido está vencido y se paga desde Pendientes («Registrar pago»).
  await page.clock.setSystemTime(clock('2026-05-03'))
  await page.reload()
  await go(page, '/pendientes')
  const item = page.locator('article', { hasText: '«Luz»' })
  await expect(item).toContainText('30 abr')
  await item.getByRole('button', { name: 'Registrar pago' }).click()
  const dialog = page.getByRole('dialog', { name: 'Marcar como pagado' })
  await expect(dialog).toContainText('$76.50')
  await dialog.getByRole('button', { name: 'Confirmar pago' }).click()
  await expect(page.getByText('«Luz» marcado como pagado').first()).toBeVisible()
  await waitForSaved(page)
  s = await stored(page)
  const payment = s.transactions.find((t) => t.scheduleId === tail!.id && t.occurrenceDate === '2026-04-30')
  expect(payment).toMatchObject({ amountMinor: 7650, status: 'realized' })
  await expect(await available(page)).toHaveText('$2,423.50')

  // Historial: la reparación explica el pago y no ofrece «Revertir».
  await go(page, '/ajustes/historial')
  const entry = page.locator('article.history-entry', { hasText: 'Luz' }).filter({ has: page.getByTestId('history-dependents') })
  await expect(entry).toHaveCount(1)
  const note = entry.getByTestId('history-dependents')
  await expect(note).toContainText('No se puede revertir: 1 registro seguiría apuntando a un programado, o a una fecha de pago, que este cambio eliminaría o cambiaría. Cámbialo o bórralo primero.')
  await expect(note).toContainText('Pago registrado para el 30 abr ($76.50): seguiría registrado pero ya no liquidaría ninguna fecha, y esa fecha volvería a contar')
  await expect(entry.getByRole('button')).toHaveCount(0)
  await expectCleanText(page, 'historial es')
  await expectNoHorizontalScroll(page, 'historial con un pago dependiente (es)')
  await snap(page, '1a-history-refusal-es', entry)
  await axeScan(page, 'historial con pago dependiente (es)')

  // Mismo historial en inglés, portugués y francés: textos reales, no claves; sin «Revertir».
  const expected: Record<UiLanguage, [string, string, RegExp]> = {
    Español: ['No se puede revertir', 'Pago registrado para el', /Revertir/],
    English: ['Cannot revert: 1 record would still point to a scheduled payment, or to a payment date', 'Recorded payment for', /Revert/],
    Português: ['Não é possível reverter: 1 registro continuaria apontando', 'Pagamento registrado para', /Reverter/],
    Français: ["Impossible d'annuler : 1 enregistrement pointerait encore", 'Paiement enregistré pour le', /Annuler/],
  }
  for (const lang of LANGS) {
    await setLanguage(page, lang)
    await go(page, '/ajustes/historial')
    const e = page.locator('article.history-entry', { hasText: 'Luz' }).filter({ has: page.getByTestId('history-dependents') })
    await expect(e, lang).toHaveCount(1)
    const n = e.getByTestId('history-dependents')
    await expect(n, lang).toContainText(expected[lang][0])
    await expect(n, lang).toContainText(expected[lang][1])
    await expect(n, lang).toContainText(/76[.,]50/)
    await expect(e.getByRole('button', { name: expected[lang][2] }), lang).toHaveCount(0)
    await expect(e.getByRole('button'), lang).toHaveCount(0)
    await expectCleanText(page, `historial ${lang}`)
    await expectNoHorizontalScroll(page, `historial ${lang}`)
    await snap(page, `1a-history-refusal-${lang.toLowerCase()}`, e)
  }
  await setLanguage(page, 'Español')

  // Recargar conserva cifras, pago y rechazo.
  await page.reload()
  await expect(await available(page)).toHaveText('$2,423.50')
  await go(page, '/ajustes/historial')
  await expect(page.locator('article.history-entry', { hasText: 'Luz' }).filter({ has: page.getByTestId('history-dependents') })).toHaveCount(1)

  // Exportar e importar la misma copia: el pago sigue vinculado y la reparación sigue sin poder revertirse.
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  const text = readFileSync((await download.path())!, 'utf8')
  const file = JSON.parse(text)
  expect(file.format).toBe('margen-backup')
  expect(file.data.transactions.find((t: StoredTx) => t.id === payment!.id)).toMatchObject({ scheduleId: tail!.id, occurrenceDate: '2026-04-30' })
  await page.getByTestId('import-file').setInputFiles({ name: 'luz-revision.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  const replace = page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' })
  await expect(replace).toBeVisible()
  await replace.getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada').first()).toBeVisible()
  await waitForSaved(page)
  await expect(await available(page)).toHaveText('$2,423.50')
  s = await stored(page)
  expect(s.transactions.find((t) => t.id === payment!.id)).toMatchObject({ scheduleId: tail!.id, occurrenceDate: '2026-04-30', status: 'realized' })
  expect(s.schedules.find((x) => x.id === tail!.id)).toMatchObject({ startDate: '2026-04-01', anchorDate: '2026-01-31' })
  await go(page, '/ajustes/historial')
  const after = page.locator('article.history-entry', { hasText: 'Luz' }).filter({ has: page.getByTestId('history-dependents') })
  await expect(after).toHaveCount(1)
  await expect(after.getByTestId('history-dependents')).toContainText('Pago registrado para el 30 abr ($76.50)')
  await expect(after.getByRole('button')).toHaveCount(0)
  await page.reload()
  await go(page, '/pendientes')
  await expect(page.locator('article', { hasText: '«Luz»' })).toHaveCount(0)
  await snap(page, '1a-after-import-inbox-clean')
})

/** «Gimnasio» del 18, al día; se parte «desde una fecha» (18-nov) con otro importe y se paga el 18-nov desde el calendario. */
const gym = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(90000, '2026-10-19') })],
    schedules: [bill('2026-07-18', 4200, { id: 'gym', name: 'Gimnasio', frequency: 'monthly' })],
    transactions: ['2026-07-18', '2026-08-18', '2026-09-18', '2026-10-18'].map((date, i) => paid('gym', date, 4200, `pg-${i}`)),
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}

test('1B · partir «Desde una fecha» («Gimnasio» a 45 desde el 18-nov) y pagar el tramo nuevo desde el calendario: la partición no se revierte; el pago sí, y entonces la partición vuelve a poder revertirse', async ({ page }) => {
  test.setTimeout(120_000)
  await seedAt(page, gym(), '2026-10-20')
  await expect(await available(page)).toHaveText('$900.00')
  await go(page, '/plan/programado/editar/gym')
  await expect(page.getByRole('heading', { name: 'Editar programación' })).toBeVisible()
  await page.getByLabel('Desde una fecha').check()
  const from = page.getByLabel('Desde (primera fecha con los cambios)')
  await expect(from).toHaveValue('2026-11-18')
  await page.getByLabel('Importe', { exact: true }).fill('45')
  await snap(page, '1b-split-form')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText(/Cambio guardado desde el 18 nov/).first()).toBeVisible()
  await waitForSaved(page)
  let s = await stored(page)
  expect(s.schedules.find((x) => x.id === 'gym')).toMatchObject({ endDate: '2026-11-17', amountMinor: 4200 })
  const next = s.schedules.find((x) => x.name === 'Gimnasio' && x.id !== 'gym')
  expect(next).toMatchObject({ startDate: '2026-11-18', amountMinor: 4500, anchorDate: '2026-07-18' })

  // El 10-nov el 18-nov está a la vista y se paga desde el calendario.
  await page.clock.setSystemTime(clock('2026-11-10'))
  await page.reload()
  await expect(await available(page)).toHaveText('$900.00')
  await go(page, '/plan/calendario')
  await page.getByRole('button', { name: /Marcar pagado.*Gimnasio/ }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Marcar como pagado' })
  await expect(dialog).toContainText('$45.00')
  await dialog.getByRole('button', { name: 'Confirmar pago' }).click()
  await expect(page.getByText('«Gimnasio» marcado como pagado').first()).toBeVisible()
  await waitForSaved(page)
  s = await stored(page)
  const payment = s.transactions.find((t) => t.scheduleId === next!.id && t.occurrenceDate === '2026-11-18')
  expect(payment).toMatchObject({ amountMinor: 4500, status: 'realized' })
  await expect(await available(page)).toHaveText('$855.00')

  await go(page, '/ajustes/historial')
  const split = page.locator('article.history-entry', { hasText: 'Gimnasio' }).filter({ has: page.getByTestId('history-dependents') })
  await expect(split).toHaveCount(1)
  await expect(split.getByTestId('history-dependents')).toContainText('Pago registrado para el 18 nov ($45.00)')
  await expect(split.getByRole('button')).toHaveCount(0)
  await snap(page, '1b-history-split-refusal', split)

  // El pago en sí se revierte sin problema.
  const revertible = page.locator('article.history-entry').filter({ has: page.getByRole('button', { name: 'Revertir' }) })
  await expect(revertible).toHaveCount(1)
  await expect(revertible).toContainText('$45.00')
  await revertible.getByRole('button', { name: 'Revertir' }).click()
  await page.getByRole('dialog', { name: '¿Revertir este cambio?' }).getByRole('button', { name: 'Revertir' }).click()
  await expect(page.getByText('Cambio revertido').first()).toBeVisible()
  await waitForSaved(page)
  s = await stored(page)
  expect(s.transactions.find((t) => t.id === payment!.id)).toBeUndefined()
  expect(s.schedules.find((x) => x.id === next!.id)).toMatchObject({ startDate: '2026-11-18', amountMinor: 4500 })
  await expect(await available(page)).toHaveText('$900.00')
  // Sin el pago, la partición vuelve a ofrecer «Revertir» (el rechazo era por el pago, no por la partición).
  await go(page, '/ajustes/historial')
  const splitAgain = page.locator('article.history-entry', { hasText: 'Pago o ingreso programado creado: Gimnasio' })
  await expect(splitAgain).toHaveCount(1)
  await expect(splitAgain.getByTestId('history-dependents')).toHaveCount(0)
  await expect(splitAgain.getByRole('button', { name: 'Revertir' })).toHaveCount(1)
  await snap(page, '1b-after-payment-undo', splitAgain)
})

/** «Agua» del 31 partida el 28-feb; solo el 28-feb (que coincide con la serie de siempre) está pagado: reparación en el sitio. */
const agua = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(150000, '2026-03-01') })],
    schedules: [
      bill('2026-01-31', 3899, { id: 'agua-old', name: 'Agua', frequency: 'monthly', endDate: '2026-02-27' }),
      bill('2026-02-28', 3899, { id: 'agua-new', name: 'Agua', frequency: 'monthly' }),
    ],
    transactions: [paid('agua-old', '2026-01-31', 3899, 'pa-1'), paid('agua-new', '2026-02-28', 3899, 'pa-2')],
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}

test('1C · reparación en el sitio («Agua») seguida de un gasto sin relación: la reparación sigue pudiendo revertirse y al revertirla el gasto se conserva', async ({ page }) => {
  await seedAt(page, agua(), '2026-03-20')
  await restoreUsualDates(page, 'Agua')
  expect((await stored(page)).schedules.find((x) => x.id === 'agua-new')).toMatchObject({ anchorDate: '2026-01-31', startDate: '2026-02-28' })
  expect((await stored(page)).schedules).toHaveLength(2)

  // Un gasto posterior sin vínculo con la serie.
  await go(page, '/')
  await openAddSheet(page)
  await page.getByRole('dialog', { name: '¿Qué quieres registrar?' }).getByRole('link', { name: /^Gasto/ }).click()
  await page.getByLabel('Importe', { exact: true }).fill('12.34')
  await pickCategory(page, page.getByLabel('Categoría', { exact: true }), 'Restaurantes y café')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await waitForSaved(page)
  await expect(await available(page)).toHaveText('$1,487.66')

  await go(page, '/ajustes/historial')
  const repair = page.locator('article.history-entry', { hasText: 'Programado cambiado: Agua' })
  await expect(repair).toHaveCount(1)
  await expect(repair.getByTestId('history-dependents')).toHaveCount(0)
  await snap(page, '1c-repair-revertible', repair)
  await repair.getByRole('button', { name: 'Revertir' }).click()
  await page.getByRole('dialog', { name: '¿Revertir este cambio?' }).getByRole('button', { name: 'Revertir' }).click()
  await expect(page.getByText('Cambio revertido').first()).toBeVisible()
  await waitForSaved(page)
  const s = await stored(page)
  expect(s.schedules.find((x) => x.id === 'agua-new')?.anchorDate).toBeUndefined()
  expect(s.transactions.filter((t) => t.amountMinor === 1234 && !t.scheduleId)).toHaveLength(1)
  await expect(await available(page)).toHaveText('$1,487.66')
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('split-repair')).toContainText('Agua')
})

/* ------------------------------------------------------------------ */
/* Flujo 2 · aplazamientos y reparación                                */
/* ------------------------------------------------------------------ */

/** «Hipoteca» del 30 partida el 28-feb-2026; pagada en fechas movidas hasta el 28-ene-2027; el 28-feb-2027 vencido. */
const hipoteca = (): AppData => {
  const rent = bill('2025-11-30', 120000, { id: 'hip-old', name: 'Hipoteca', frequency: 'monthly', categoryId: 'housing', endDate: '2026-02-27' })
  const movedDates = ['2026-02-28', '2026-03-28', '2026-04-28', '2026-05-28', '2026-06-28', '2026-07-28', '2026-08-28', '2026-09-28', '2026-10-28', '2026-11-28', '2026-12-28', '2027-01-28']
  return baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(2000000, '2027-02-01') })],
    schedules: [rent, { ...rent, id: 'hip-new', startDate: '2026-02-28', endDate: undefined }],
    transactions: [
      ...['2025-11-30', '2025-12-30', '2026-01-30'].map((d, i) => paid('hip-old', d, 120000, `ph-old-${i}`, 'housing')),
      ...movedDates.map((d, i) => paid('hip-new', d, 120000, `ph-${i}`, 'housing')),
    ],
  })
}

test('2A · aplazar 7 días el 28-feb-2027 vencido desde Pendientes; la reparación partida lo lleva al tramo nuevo con la misma fecha y sigue en «Pospuesto (1)» hasta el 9-mar', async ({ page }) => {
  await seedAt(page, hipoteca(), '2027-03-02')
  await go(page, '/pendientes')
  const item = page.locator('article', { hasText: '«Hipoteca»' })
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('28 feb')
  await item.getByRole('button', { name: 'Posponer 7 días' }).click()
  await expect(page.getByText('Pospuesto 7 días. Volverá si sigue pendiente.').first()).toBeVisible()
  await waitForSaved(page)
  let s = await stored(page)
  expect(s.inbox.snoozed).toEqual([{ id: 'due:schedule:hip-new:2027-02-28', until: '2027-03-09', at: expect.any(String) }])
  const at = s.inbox.snoozed[0]!.at
  await expect(item).toHaveCount(0)
  const snoozed = page.locator('details', { hasText: /Pospuesto \(1\)/ })
  await expect(snoozed).toBeVisible()
  await snoozed.locator('summary').click()
  await expect(snoozed).toContainText('Hasta el 9 mar')

  await restoreUsualDates(page, 'Hipoteca')
  s = await stored(page)
  const tail = s.schedules.find((x) => x.name === 'Hipoteca' && !['hip-old', 'hip-new'].includes(x.id))
  expect(s.schedules.find((x) => x.id === 'hip-new')).toMatchObject({ endDate: '2027-01-30' })
  expect(tail).toMatchObject({ startDate: '2027-01-31', anchorDate: '2025-11-30' })
  expect(s.inbox.snoozed).toEqual([{ id: `due:schedule:${tail!.id}:2027-02-28`, until: '2027-03-09', at }])

  await go(page, '/pendientes')
  await expect(page.locator('article', { hasText: '«Hipoteca»' })).toHaveCount(0)
  const after = page.locator('details', { hasText: /Pospuesto \(1\)/ })
  await expect(after).toBeVisible()
  await after.locator('summary').click()
  await expect(after).toContainText('«Hipoteca»')
  await expect(after).toContainText('28 feb')
  await expect(after).toContainText('Hasta el 9 mar')
  await snap(page, '2a-snoozed-same-date-after-repair', after)
  await page.reload()
  await go(page, '/pendientes')
  await expect(page.locator('article', { hasText: '«Hipoteca»' })).toHaveCount(0)
  await expect(page.locator('details', { hasText: /Pospuesto \(1\)/ })).toBeVisible()
})

/** «Seguro auto» del 30 partido el 28-feb-2026; solo el 28-feb pagado (coincide): reparación en el sitio; el 28-mar movido vencido. */
const seguro = (): AppData => {
  const s = bill('2025-12-30', 9500, { id: 'seg-old', name: 'Seguro auto', frequency: 'monthly', endDate: '2026-02-27' })
  return baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(500000, '2026-03-01') })],
    schedules: [s, { ...s, id: 'seg-new', startDate: '2026-02-28', endDate: undefined }],
    transactions: [paid('seg-old', '2025-12-30', 9500, 'ps-0'), paid('seg-old', '2026-01-30', 9500, 'ps-1'), paid('seg-new', '2026-02-28', 9500, 'ps-2')],
  })
}

test('2B · aplazar el 28-mar movido; la reparación en el sitio lo lleva al 30-mar con el mismo «hasta» y sigue pospuesto', async ({ page }) => {
  await seedAt(page, seguro(), '2026-04-02')
  await go(page, '/pendientes')
  const item = page.locator('article', { hasText: '«Seguro auto»' })
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('28 mar')
  await item.getByRole('button', { name: 'Posponer 7 días' }).click()
  await expect(page.getByText('Pospuesto 7 días. Volverá si sigue pendiente.').first()).toBeVisible()
  await waitForSaved(page)
  let s = await stored(page)
  expect(s.inbox.snoozed).toEqual([{ id: 'due:schedule:seg-new:2026-03-28', until: '2026-04-09', at: expect.any(String) }])
  const at = s.inbox.snoozed[0]!.at

  await restoreUsualDates(page, 'Seguro auto')
  s = await stored(page)
  expect(s.schedules).toHaveLength(2)
  expect(s.schedules.find((x) => x.id === 'seg-new')).toMatchObject({ anchorDate: '2025-12-30', startDate: '2026-02-28' })
  expect(s.inbox.snoozed).toEqual([{ id: 'due:schedule:seg-new:2026-03-30', until: '2026-04-09', at }])

  await go(page, '/pendientes')
  await expect(page.locator('article', { hasText: '«Seguro auto»' })).toHaveCount(0)
  const after = page.locator('details', { hasText: /Pospuesto \(1\)/ })
  await expect(after).toBeVisible()
  await after.locator('summary').click()
  await expect(after).toContainText('«Seguro auto»')
  await expect(after).toContainText('30 mar')
  await expect(after).toContainText('Hasta el 9 abr')
  await snap(page, '2b-snoozed-date-changed-after-repair', after)
})

/* ------------------------------------------------------------------ */
/* Flujo 3 · totales enormes                                           */
/* ------------------------------------------------------------------ */

const X = 999_999_999_999
const N = 4520
const many = (prefix: string, date: string, kind: 'expense' | 'refund', count: number) => Array.from({ length: count }, (_, i) => tx({ id: `${prefix}${i}`, date, amountMinor: X, kind, status: 'realized', categoryId: 'groceries' }))
const bigData = (transactions: Transaction[]): AppData =>
  baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(0, '2026-08-01') })], transactions })
const STATS = '/estadisticas?periodo=month&fecha=2026-10-22'
const expensesDelta = (page: Page) => page.getByTestId('stats-expenses').locator('xpath=..').locator('.stat__delta')
const netDelta = (page: Page) => page.getByTestId('stats-net').locator('xpath=..').locator('.stat__delta')

async function bigScreensHold(page: Page, label: string) {
  for (const route of [STATS, '/revision', '/analisis']) {
    await go(page, route)
    await expectCleanText(page, `${label} ${route}`)
    await expectNoHorizontalScroll(page, `${label} ${route}`)
  }
}

test('3A · diferencia que cabe: septiembre 1 130 gastos, octubre 1 130 + 2 260: Estadísticas +200 %, Análisis +200 % con fila «Diferencia», semana +100 %', async ({ page }) => {
  test.setTimeout(90_000)
  // La suma de TODOS los gastos de la cuenta debe caber en un entero exacto (1 130 + 1 130 + 2 260 = 4 520 × X ≈ 4,5 × 10¹⁵).
  await seedAt(page, bigData([...many('s', '2026-09-10', 'expense', 1130), ...many('p', '2026-10-14', 'expense', 1130), ...many('c', '2026-10-21', 'expense', 2260)]), '2026-10-22')
  await go(page, '/analisis')
  const insight = page.locator('article.insight', { hasText: /200 % más de gasto/ })
  await expect(insight).toHaveCount(1)
  await expect(insight).toContainText('Diferencia')
  await snap(page, '3a-analysis-plus-200', insight)
  await go(page, '/revision')
  await expect(page.getByTestId('week-spending-change')).toContainText(/más \(100\s?%\)/)
  await snap(page, '3a-weekly-plus-100', page.getByTestId('week-spending-change'))
  // Estadísticas al final: con este gasto reciente la pantalla cae en el límite de la proyección (ver 3C/3F).
  await go(page, STATS)
  await snap(page, '3a-stats-safe')
  await expect(page.getByRole('heading', { name: 'No se pudo abrir esta pantalla' }), 'Estadísticas no debe caer en la pantalla de error con estos totales').toHaveCount(0)
  await expect(expensesDelta(page)).toContainText('+200 %')
  await bigScreensHold(page, 'diferencia que cabe')
})

test('3B · diferencia que no cabe con porcentaje exacto: septiembre 4 520 gastos, octubre 4 520 devoluciones: Estadísticas «-200 %», Análisis «200 % menos» sin fila «Diferencia»', async ({ page }) => {
  test.setTimeout(90_000)
  await seedAt(page, bigData([...many('e', '2026-09-10', 'expense', N), ...many('r', '2026-10-10', 'refund', N)]), '2026-10-22')
  await go(page, STATS)
  await expect(expensesDelta(page)).toContainText('-200 %')
  await snap(page, '3b-stats-unsafe-percent')
  await axeScan(page, 'estadísticas con diferencia que no cabe, -200 % (es)')
  await go(page, '/analisis')
  const insight = page.locator('article.insight', { hasText: /200 % menos de gasto/ })
  await expect(insight).toHaveCount(1)
  await expect(insight).toContainText('Este mes hasta hoy')
  await expect(insight).not.toContainText('Diferencia')
  await snap(page, '3b-analysis-minus-200', insight)
  await bigScreensHold(page, 'diferencia que no cabe (porcentaje)')
})

test('3C · diferencia que no cabe y sin base positiva: septiembre 4 520 devoluciones, octubre 4 520 gastos: «Sin comparación» en gastos (es/en/pt/fr), neto «-200 %», nada se rompe', async ({ page }) => {
  test.setTimeout(150_000)
  await seedAt(page, bigData([...many('r', '2026-09-10', 'refund', N), ...many('e', '2026-10-10', 'expense', N)]), '2026-10-22')
  const noComparison: Record<UiLanguage, string> = { Español: 'Sin comparación', English: 'No comparison', Português: 'Sem comparação', Français: 'Pas de comparaison' }
  await go(page, STATS)
  await snap(page, '3c-stats-no-comparison-es')
  await expect(page.getByRole('heading', { name: 'No se pudo abrir esta pantalla' }), 'Estadísticas no debe caer en la pantalla de error con estos totales').toHaveCount(0)
  await expect(expensesDelta(page)).toContainText('Sin comparación')
  await expect(netDelta(page)).toContainText('-200 %')
  await axeScan(page, 'estadísticas con diferencia que no cabe (es)')
  await bigScreensHold(page, 'sin comparación es')
  for (const lang of LANGS) {
    await setLanguage(page, lang)
    await go(page, STATS)
    await expect(expensesDelta(page), lang).toContainText(noComparison[lang])
    await expect(netDelta(page), lang).toContainText('-200 %')
    await snap(page, `3c-stats-no-comparison-${lang.toLowerCase()}`)
    await bigScreensHold(page, `sin comparación ${lang}`)
  }
})

test('3D · semana: 4 520 gastos la semana pasada y 4 520 devoluciones esta: «la diferencia no cabe en una cifra exacta (200 %)» en es/en/pt/fr', async ({ page }) => {
  test.setTimeout(120_000)
  await seedAt(page, bigData([...many('p', '2026-10-14', 'expense', N), ...many('c', '2026-10-21', 'refund', N)]), '2026-10-22')
  const noDifference: Record<UiLanguage, string> = {
    Español: 'la diferencia no cabe en una cifra exacta',
    English: 'the difference does not fit an exact figure',
    Português: 'a diferença não cabe em um valor exato',
    Français: 'la différence ne tient pas dans un chiffre exact',
  }
  await go(page, '/revision')
  const change = page.getByTestId('week-spending-change')
  await expect(change).toContainText(/la diferencia no cabe en una cifra exacta \(200\s?%\)/)
  await snap(page, '3d-weekly-no-difference-es', change)
  await bigScreensHold(page, 'semana sin diferencia es')
  for (const lang of LANGS) {
    await setLanguage(page, lang)
    await go(page, '/revision')
    await expect(page.getByTestId('week-spending-change'), lang).toContainText(noDifference[lang])
    await expect(page.getByTestId('week-spending-change'), lang).toContainText(/200\s?%/)
    await snap(page, `3d-weekly-no-difference-${lang.toLowerCase()}`, page.getByTestId('week-spending-change'))
    await bigScreensHold(page, `semana sin diferencia ${lang}`)
  }
})

test('3F · diagnóstico: con 4 520 devoluciones el 10-sep y 4 520 gastos el 10-oct, ninguna pantalla debe caer en «No se pudo abrir esta pantalla»', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().split('\n')[0]!)
  })
  await seedAt(page, bigData([...many('r', '2026-09-10', 'refund', N), ...many('e', '2026-10-10', 'expense', N)]), '2026-10-22')
  const broken: string[] = []
  for (const route of ['/', '/movimientos', '/analisis', '/revision', '/plan/calendario', '/plan/proyeccion', '/estadisticas', STATS]) {
    await go(page, route)
    const failed = (await page.getByRole('heading', { name: 'No se pudo abrir esta pantalla' }).count()) > 0
    if (failed) {
      broken.push(route)
      await snap(page, `3f-error-screen-${route.replace(/[^a-z]+/gi, '-')}`)
    }
  }
  appendFileSync(`test-results/review-perf-${test.info().project.name}.log`, `3F pantallas rotas: ${broken.join(', ') || 'ninguna'}; errores de consola: ${[...new Set(errors)].join(' | ') || 'ninguno'}\n`)
  expect(broken, `pantallas con «No se pudo abrir esta pantalla» (consola: ${[...new Set(errors)].join(' | ')})`).toEqual([])
})

test('3E · semana: devoluciones la semana pasada y gastos esta: «la diferencia no cabe» sin porcentaje (base no positiva)', async ({ page }) => {
  test.setTimeout(90_000)
  await seedAt(page, bigData([...many('p', '2026-10-14', 'refund', N), ...many('c', '2026-10-21', 'expense', N)]), '2026-10-22')
  await go(page, '/revision')
  const change = page.getByTestId('week-spending-change')
  await expect(change).toContainText('la diferencia no cabe en una cifra exacta')
  await expect(change).not.toContainText('%')
  await bigScreensHold(page, 'semana sin diferencia ni porcentaje')
})

/* ------------------------------------------------------------------ */
/* Flujo 4 · reparar sin IndexedDB                                     */
/* ------------------------------------------------------------------ */

/** Dos particiones antiguas sin pagos: «Sueldo neto» (ingreso del 31) e «Internet casa» (pago del 30), las dos movidas al 28. */
const twoDrifts = (): AppData =>
  baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(123456, '2026-03-01') })],
    schedules: [
      { ...bill('2026-01-31', 275000, { id: 'sal-old', name: 'Sueldo neto', frequency: 'monthly', endDate: '2026-02-27' }), kind: 'income', categoryId: 'salary' },
      { ...bill('2026-02-28', 275000, { id: 'sal-new', name: 'Sueldo neto', frequency: 'monthly' }), kind: 'income', categoryId: 'salary' },
      bill('2026-01-30', 6499, { id: 'int-old', name: 'Internet casa', frequency: 'monthly', endDate: '2026-02-27' }),
      bill('2026-02-28', 6499, { id: 'int-new', name: 'Internet casa', frequency: 'monthly' }),
    ],
  })

const REFUSAL = 'No se restauró: antes hace falta una copia de estos datos. En este navegador no se pudo guardar una copia local; descarga una con «Descargar copia antes» y vuelve a intentarlo.'
const NOTE = 'Este navegador no guarda copias locales. Antes de restaurar, descarga una copia con «Descargar copia antes»: sin una copia de los datos tal como están ahora, no se restaura.'

async function openWithoutIndexedDb(page: Page, data: AppData, iso = '2026-03-12') {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
  })
  await openApp(page, clock(iso))
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await page.evaluate((d) => localStorage.setItem('margen.data.v1', JSON.stringify(d)), data)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
}

const restoreButton = (page: Page, id: string) => page.getByTestId(`split-repair-${id}`).getByRole('button', { name: 'Restaurar las fechas de siempre' })
const confirmRestore = (page: Page, name: string) => page.getByRole('dialog', { name: `¿Restaurar las fechas de siempre de «${name}»?` }).getByRole('button', { name: 'Restaurar las fechas de siempre' })

test('4A · sin IndexedDB: aviso en la tarjeta, rechazo exacto con localStorage idéntico, descarga desde la tarjeta y reparación; tras cambiar algo, hace falta otra descarga para la segunda serie', async ({ page }) => {
  test.setTimeout(120_000)
  await openWithoutIndexedDb(page, twoDrifts())
  // 1 234,56 − 3 × 64,99 (30-ene y 28-feb vencidos sin pagar, y el 28-mar antes del próximo ingreso).
  await expect(await available(page)).toHaveText('$1,039.59')
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('split-repair-no-local-copy')).toHaveText(NOTE)
  await expect(card.getByTestId('split-repair-sal-new')).toBeVisible()
  await expect(card.getByTestId('split-repair-int-new')).toBeVisible()
  await expectNoHorizontalScroll(page, 'tarjeta sin copias locales')
  await snap(page, '4a-card-no-local-copy', card)
  await axeScan(page, 'tarjeta de reparación sin IndexedDB (claro)')

  // 1) Sin descarga: la confirmación lo advierte y restaurar se rechaza con el texto exacto; nada cambia.
  const before = await localRaw(page)
  await restoreButton(page, 'sal-new').click()
  const dialog = page.getByRole('dialog', { name: '¿Restaurar las fechas de siempre de «Sueldo neto»?' })
  await expect(dialog).toContainText('En este navegador no hay copias locales: tu respaldo es la copia que descargaste desde esta tarjeta.')
  await expect(dialog).not.toContainText('Antes se guarda una copia local')
  await snap(page, '4a-dialog-no-local-copy')
  await confirmRestore(page, 'Sueldo neto').click()
  await expect(page.locator('.toast__message', { hasText: 'No se restauró' })).toHaveText(REFUSAL)
  await snap(page, '4a-refused', card)
  expect(await localRaw(page)).toBe(before)
  await expect(card.getByTestId('split-repair-sal-new')).toBeVisible()
  await expect(card.getByTestId('split-repair-int-new')).toBeVisible()

  // 2) Descargar desde la tarjeta: la copia es de los datos tal como están; después la reparación se aplica.
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByTestId('split-repair-sal-new').getByRole('button', { name: 'Descargar copia antes' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  const copy = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(copy.data.schedules.find((s: StoredSchedule) => s.id === 'sal-new').anchorDate).toBeUndefined()
  expect(copy.data.updatedAt).toBe((await storedLocal(page)).updatedAt)
  await waitForSaved(page)
  await restoreButton(page, 'sal-new').click()
  await confirmRestore(page, 'Sueldo neto').click()
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
  let s = await storedLocal(page)
  expect(s.schedules.find((x) => x.id === 'sal-new')).toMatchObject({ anchorDate: '2026-01-31' })
  expect(s.schedules.find((x) => x.id === 'int-new')?.anchorDate).toBeUndefined()
  await expect(card.getByTestId('split-repair-sal-new')).toHaveCount(0)
  await expect(card.getByTestId('split-repair-int-new')).toBeVisible()

  // 3) La misma descarga ya no vale para la segunda serie: los datos cambiaron con la primera reparación.
  const afterFirst = await localRaw(page)
  await restoreButton(page, 'int-new').click()
  await confirmRestore(page, 'Internet casa').click()
  await expect(page.locator('.toast__message', { hasText: 'No se restauró' })).toHaveText(REFUSAL)
  expect(await localRaw(page)).toBe(afterFirst)
  expect((await storedLocal(page)).schedules.find((x) => x.id === 'int-new')?.anchorDate).toBeUndefined()

  // 4) Descargar, cambiar algo (un gasto) y volver: hace falta otra descarga; con ella, se repara.
  await Promise.all([page.waitForEvent('download'), card.getByTestId('split-repair-int-new').getByRole('button', { name: 'Descargar copia antes' }).click()])
  await waitForSaved(page)
  await go(page, '/')
  await openAddSheet(page)
  await page.getByRole('dialog', { name: '¿Qué quieres registrar?' }).getByRole('link', { name: /^Gasto/ }).click()
  await page.getByLabel('Importe', { exact: true }).fill('10')
  await pickCategory(page, page.getByLabel('Categoría', { exact: true }), 'Restaurantes y café')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await waitForSaved(page)
  await expect(await available(page)).toHaveText('$1,029.59')
  await go(page, '/ajustes/datos')
  const stale = await localRaw(page)
  await restoreButton(page, 'int-new').click()
  await confirmRestore(page, 'Internet casa').click()
  await expect(page.locator('.toast__message', { hasText: 'No se restauró' })).toHaveText(REFUSAL)
  expect(await localRaw(page)).toBe(stale)
  await Promise.all([page.waitForEvent('download'), page.getByTestId('split-repair-int-new').getByRole('button', { name: 'Descargar copia antes' }).click()])
  await waitForSaved(page)
  await restoreButton(page, 'int-new').click()
  await confirmRestore(page, 'Internet casa').click()
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
  await expect(page.getByTestId('split-repair')).toHaveCount(0)
  await page.reload()
  s = await storedLocal(page)
  expect(s.schedules.find((x) => x.id === 'int-new')).toMatchObject({ anchorDate: '2026-01-30' })
  expect(s.schedules.find((x) => x.id === 'sal-new')).toMatchObject({ anchorDate: '2026-01-31' })
  expect(s.transactions.filter((t) => t.amountMinor === 1000)).toHaveLength(1)
  await expect(await available(page)).toHaveText('$1,029.59')
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('split-repair')).toHaveCount(0)
  await snap(page, '4a-both-repaired')
})

test('4B · sin IndexedDB, tema claro: solo teclado (Tab/Enter/Esc), el foco vuelve al botón al cerrar con Esc, y el aviso cumple AA', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => localStorage.setItem('clara.theme', 'light'))
  await openWithoutIndexedDb(page, twoDrifts())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('split-repair-no-local-copy')).toBeVisible()
  await settleAnimations(page)
  const c = await textContrast(page, '[data-testid="split-repair-no-local-copy"]')
  expect(c.ratio, `claro: ${c.fg} sobre ${c.bg} (${c.fontSize}/${c.fontWeight})`).toBeGreaterThanOrEqual(4.5)
  appendFileSync(`test-results/review-contrast-${test.info().project.name}.log`, `claro: ${JSON.stringify(c)}\n`)

  // Tab hasta «Restaurar…» de la primera serie, Enter abre el diálogo, Esc lo cierra y el foco vuelve al botón.
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  const isRestore = (a: Active) => a.tag === 'BUTTON' && a.text === 'Restaurar las fechas de siempre' && a.testid === 'split-repair-sal-new' && !a.inDialog
  await tabTo(page, isRestore)
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '¿Restaurar las fechas de siempre de «Sueldo neto»?' })
  await expect(dialog).toBeVisible()
  expect((await active(page)).inDialog, 'el foco entra en el diálogo').toBe(true)
  await snap(page, '4b-keyboard-dialog')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await active(page), 'el foco vuelve al botón que abrió el diálogo').toMatchObject({ tag: 'BUTTON', text: 'Restaurar las fechas de siempre', testid: 'split-repair-sal-new', inDialog: false })

  // Tab hasta «Descargar copia antes» y Enter descarga.
  const [download] = await Promise.all([page.waitForEvent('download'), tabTo(page, (a) => a.tag === 'BUTTON' && a.text === 'Descargar copia antes' && a.testid === 'split-repair-sal-new').then(() => page.keyboard.press('Enter'))])
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  await waitForSaved(page)
  // Shift+Tab de vuelta a «Restaurar…», Enter, Tab hasta el botón de confirmar del diálogo, Enter.
  for (let i = 0; i < 6 && !isRestore(await active(page)); i++) await page.keyboard.press('Shift+Tab')
  expect(isRestore(await active(page))).toBe(true)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await tabTo(page, (a) => a.inDialog && a.tag === 'BUTTON' && a.text === 'Restaurar las fechas de siempre', 8)
  await page.keyboard.press('Enter')
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
  expect((await storedLocal(page)).schedules.find((x) => x.id === 'sal-new')).toMatchObject({ anchorDate: '2026-01-31' })
  await expect(page.getByTestId('split-repair-sal-new')).toHaveCount(0)
})

test('4C · sin IndexedDB, tema oscuro: el aviso «no guarda copias locales» cumple AA y axe no encuentra fallos', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('clara.theme', 'dark'))
  await openWithoutIndexedDb(page, twoDrifts())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('split-repair-no-local-copy')).toHaveText(NOTE)
  await settleAnimations(page)
  const c = await textContrast(page, '[data-testid="split-repair-no-local-copy"]')
  expect(c.ratio, `oscuro: ${c.fg} sobre ${c.bg} (${c.fontSize}/${c.fontWeight})`).toBeGreaterThanOrEqual(4.5)
  appendFileSync(`test-results/review-contrast-${test.info().project.name}.log`, `oscuro: ${JSON.stringify(c)}\n`)
  await snap(page, '4c-dark-note', page.getByTestId('split-repair'))
  await axeScan(page, 'tarjeta de reparación sin IndexedDB (oscuro)')
  await expectNoHorizontalScroll(page, 'tarjeta sin copias locales (oscuro)')
})

/* ------------------------------------------------------------------ */
/* Flujo 6 · sonda de rendimiento (una sola vez)                       */
/* ------------------------------------------------------------------ */

test('6 · 5 000 gastos idénticos el 12-sep y 5 000 devoluciones idénticas el 12-oct: Inicio muestra la cifra en < 5 s sin que la pestaña se caiga, y Pendientes se dibuja', async ({ page }) => {
  test.skip(test.info().project.name !== 'celular', 'sonda de rendimiento: una sola vez, en «celular»')
  test.setTimeout(120_000)
  let crashed = false
  page.on('crash', () => {
    crashed = true
  })
  const A = 123_456_789_000
  const same = (prefix: string, date: string, kind: 'expense' | 'refund') => Array.from({ length: 5000 }, (_, i) => tx({ id: `${prefix}${i}`, date, amountMinor: A, kind, status: 'realized', categoryId: 'groceries' }))
  const data = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(0, '2026-08-01') })], transactions: [...same('g', '2026-09-12', 'expense'), ...same('d', '2026-10-12', 'refund')] })
  await openApp(page, clock('2026-10-22'))
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, data)
  const t0 = Date.now()
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible({ timeout: 5_000 })
  const elapsed = Date.now() - t0
  appendFileSync(`test-results/review-perf-${test.info().project.name}.log`, `Inicio con 10 000 movimientos: cifra visible a los ${elapsed} ms\n`)
  expect(elapsed, 'la cifra principal aparece en menos de 5 s').toBeLessThanOrEqual(5_000)
  expect(crashed).toBe(false)
  await snap(page, '6-home-10000')
  await go(page, '/pendientes')
  await expect(page.getByTestId('inbox-count')).toBeVisible()
  const dups = page.locator('article', { hasText: '¿Duplicado?' })
  const count = await dups.count()
  appendFileSync(`test-results/review-perf-${test.info().project.name}.log`, `Pendientes: ${count} avisos de posible duplicado\n`)
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(100)
  expect(crashed).toBe(false)
  await expectCleanText(page, 'pendientes con 10 000 movimientos')
  await snap(page, '6-inbox-10000')
})

```
