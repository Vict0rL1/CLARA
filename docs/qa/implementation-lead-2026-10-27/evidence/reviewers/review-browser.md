# Independent browser QA review — Clara, head `e38b07b` (branch `claude/margen-personal-finance-app-cdvrt3`)

- Reviewer worktree (detached at `e38b07b`): `/tmp/claude-0/-home-user-ALCANZA/0cc824fc-6662-5ccd-b6d7-dca2af46bc95/scratchpad/rev-browser` (node_modules symlinked from the main checkout; nothing in `/home/user/ALCANZA` was touched, built or run; nothing committed or pushed).
- Build: `npx vite build` in the worktree (exit 0, ✓ built in 2.08s); served with `vite preview --port 4181 --strictPort`; preview server killed at the end.
- Spec written for this review: `tests/e2e/review.browser.spec.ts` (full code at the end). Synthetic fixtures only: account «Nómina» (id `nomina`), bill «Internet» 55.99 monthly on the 12th changed to 61.50 «desde» 12-oct, «Gimnasio»/«Agua» for F-02, July 2026 expenses (77.77 / 22.22 / June 33.33) for F-04/F-05, 1 × MAX in August + 100 × MAX in September for F-03, store «TIENDA LUNA» for receipts — all different names, amounts, ids and dates from the implementation's specs. Clock 2026-09-28 12:00 America/Toronto except QA-01 historical (2026-03-21 12:00, via `openApp(page, new Date('2026-03-21T12:00:00-04:00'))`).
- The genuine schema-13 backup was copied into the worktree as `tests/e2e/review-v13-backup.json` and imported through the UI.
- Runs: one project at a time, `--workers=1`, `--output=test-results/review`, `BASE_URL=http://localhost:4181`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`. The whole suite was never run.
- Screenshots: `test-results/review-shots/<project>/*.png` under the worktree. They are NOT inside `test-results/review` because Playwright empties the `--output` folder at the start of every project run, which would have deleted the previous project's captures (the folder is still under the worktree's `test-results/`).

## Result overview (17 tests × 3 viewports = 51 runs, all PASS, no product finding)

| # | Case | celular 412 px | celular-pequeno 320 px | escritorio 1280 px |
|---|---|---|---|---|
| 1 | F-01 · id of 64 characters | PASS | PASS | PASS |
| 1 | F-01 · id of 41 characters | PASS | PASS | PASS |
| 1 | F-01 · plain UUID | PASS | PASS | PASS |
| 2 | QA-01 historical · real v13 backup imported via UI, restore by keyboard, $550.00, local copy, export/import | PASS | PASS | PASS |
| 2/8 | QA-01 historical · «Dejar como está» by keyboard, dark theme, contrast + axe on the card | PASS | PASS | PASS |
| 3/8 | F-02 · dependents block revert (scenario + planned expense created after the split), keyboard, byte-identical storage, ordinary revert | PASS | PASS | PASS |
| 4 | F-03 · 9 900 % | PASS | PASS | PASS |
| 4 | F-03 · no previous spending | PASS | PASS | PASS |
| 5 | F-04 · explicit dark | PASS | PASS | PASS |
| 5 | F-04 · system dark | PASS | PASS | PASS |
| 5 | F-04 · light | PASS | PASS | PASS |
| 6 | F-05 · es/en/pt/fr labels, Tab + tooltip, tap (mobile only), month/year labels | PASS | PASS | PASS |
| 7 | P1 · assistant «coffee (RUB) 10» | PASS | PASS | PASS |
| 7 | P1 · assistant «coffee RUB: 10» | PASS | PASS | PASS |
| 7 | P1 · assistant «coffee (RUB) $10» | PASS | PASS | PASS |
| 7 | P1 · receipt «TOTAL RUB: 10.00» | PASS | PASS | PASS |
| 7 | P2 · receipt «PEN 2.99 TAX 0.10» + «TOTAL CAD 3.09» | PASS | PASS | PASS |

Final consistent runs: celular 17 passed (1.0 min, `test-results/review-run-celular-final.log`), celular-pequeno 17 passed (56.1 s, `test-results/review-run-celular-pequeno.log`), escritorio 17 passed (57.9 s, `test-results/review-run-escritorio.log`). The five failures of my first celular run and the one of my second were errors in my own spec (fixture and selectors), not in the product; they are listed in «Test-authoring corrections» for transparency.

## Case details (expectation → actual)

### 1. F-01 — monthly bill with a 64-char / 41-char / UUID id and a snoozed due reminder
Fixture: «Nómina» balance $2,500.00 (reference 20-sep), bill «Internet» 55.99 monthly from 12-apr (ids `k`×64, `m`×41, `7f3e2a10-5b4c-4d8e-9a1f-2c3b4d5e6f70`), income «Nómina» 1,800 monthly from 20-may, the six past occurrences (apr–sep) paid and linked (`scheduleId` + `occurrenceDate`), snooze `due:schedule:<id>:2026-10-12` until 11-oct.
- Expected before: $2,444.01 (2,500 − 55.99; only 12-oct pending before the 20-oct income). Actual: $2,444.01.
- `/plan/programado/editar/<id>` → radio «Desde una fecha» (default 2026-10-12) → amount 61.50 → «Guardar» → toast «Cambio guardado desde el…». Stored: `[5599, 2026-04-12, end 2026-10-11]` + `[6150, 2026-10-12, no end]`; the snooze moved to the new id; the history entry's `inboxSnoozed` change ids are 24 + id length (88 and 65 chars for the 64/41 ids, i.e. > 64 — the shape that broke the previous version; 60 for the UUID).
- Reload from IndexedDB: no «No pudimos leer tus datos guardados», Inicio $2,438.50 (2,500 − 61.50). PASS.
- `/ajustes/historial` → «Revertir» → confirm → «Cambio revertido»: stored back to one «Internet» [oldId, 5599, no end], snooze back on the old id; reload clean; $2,444.01. PASS.
- `/ajustes/copia` «Exportar copia» (the file contains `inboxSnoozed` change ids > 64 for the 64/41 cases) → `import-file` → dialog «¿Reemplazar tus datos con esta copia?» → «Reemplazar datos» → «Copia importada» → reload clean, $2,444.01, snooze on the old id, no horizontal scroll. PASS at the three viewports.

### 2. QA-01 historical — genuine v13 backup through the UI (clock 21-mar-2026)
Start: an empty synthetic budget (account «Temporal», 0) seeded only to reach `/ajustes/copia`; then the real file imported through `import-file` + «Reemplazar datos» → «Copia importada».
- Inicio: $1,800.00 (the 29-mar insurance is outside the horizon because the moved series pays on 28-mar). Actual: $1,800.00. PASS.
- `/ajustes/datos` → card `split-repair`: `split-repair-current` contains «28 mar», `split-repair-proposed` contains «31 mar» and «30 abr» (screenshot: «Hoy cuenta desde el 28 feb: 28 mar, 28 abr y 28 may» / «Como siempre (la serie se fija el 31 ene): 31 mar, 30 abr y 31 may»). No horizontal scroll at 320 px. PASS.
- Keyboard only: Tab until «Restaurar las fechas de siempre» → Enter opens the dialog «¿Restaurar las fechas de siempre de «Sueldo»?» (contains «31 mar») → Escape closes it and the focus is back on the opener button (asserted) → Enter again → Tab to the dialog's own «Restaurar las fechas de siempre» → Enter → toast «Fechas de siempre restauradas», card gone. Stored: `salary-2` keeps `startDate 2026-02-28`, `amountMinor 240777`, gets `anchorDate 2026-01-31`; `salary` untouched (`2026-01-31`→`2026-02-27`, no anchorDate). PASS.
- Reload: Inicio $550.00; card does not come back; history's first entry mentions «Sueldo» and offers «Revertir»; `/ajustes/copias-locales` has exactly one more «Antes de restaurar» copy than before the repair (count compared before/after, so the copy made by the import itself is not mistaken for it). PASS.
- Export → re-import: backup carries `anchorDate 2026-01-31`; after import $550.00 and no card. PASS.
- Second run (dark theme `clara.theme=dark`, `data-theme="dark"`): computed contrast on the card — notes 6.79:1 (rgb(148,163,184) on rgb(18,26,42), 14.4 px/400), item title and card title 15.88:1; axe `color-contrast` on `[data-testid="split-repair"]`: 0 violations; no horizontal scroll. Keyboard: Tab to «Dejar como está» → Enter → «Se deja como está» → card gone → reload → still gone; stored `salary-2` without `anchorDate`, `inbox.dismissed = ['int:split:salary-2']`; Inicio stays $1,800.00. PASS at the three viewports.

### 3. F-02 — corrected split + dependents created AFTER it
- Split made by this build through the UI (`gym` «Gimnasio» 45.00 → 49.00 «Desde una fecha» 2026-10-05); the history entry has exactly `[schedules gym, schedules <next>]`. Then, as if from another tab, a scenario «Si suben la cuota» (`scheduleAmount` on the new id) and a planned expense «Cuota anual» (`kind: 'expense'`, `plan.link` to the new id, occurrence 2026-11-05) were written to IndexedDB with later timestamps, and the app reloaded.
- `/ajustes/historial`: the «Gimnasio» entry shows `history-dependents` = «No se puede revertir: 2 registros seguirían apuntando a un programado que este cambio eliminaría…» + «Escenario «Si suben la cuota»» + «Gasto planificado «Cuota anual»»; no «Revertir» button in the entry. Keyboard: 60 Tab presses through the page never focus a «Revertir» button. No horizontal scroll (320 px included). PASS.
- Stored JSON before vs after another reload + reopening the history: byte-identical (`expect(s2).toBe(s1)`); schedules = `agua`, `gym`, `<next>`. PASS.
- Ordinary entry: «Agua» 32.00 → 35.00 with «A todas las fechas» → history «Programado cambiado: Agua» → «Revertir» → «Cambio revertido» → stored amount back to 3200; the «Gimnasio» entry still shows the dependents note. PASS at the three viewports.

### 4. F-03 — Analysis
- 1 expense of MAX_AMOUNT_MINOR (1e12 minor) on 3-aug and 100 of MAX spread over 1–20 sep (reference balance 0 at 15-jun): `/analisis` shows the `spendingUp` insight «…9 900 % más de gasto…»; «¿Cómo se calculó?» lists 1,000,000,000,000.00 (current) and 10,000,000,000.00 (previous); no horizontal scroll. PASS.
- No previous spending (only September): no `spendingUp`/`spendingDown` insight, the list or the empty state renders, `#main` text has no «NaN», «Infinity», «undefined» or «null»; no horizontal scroll. PASS.

### 5. F-04 — «Sin comparación» contrast (July custom period, no income ever)
Measured in the browser on `.stat__delta--neutral` (text «Sin comparación», 14 px / 600) against the first non-transparent ancestor background, plus axe `color-contrast` over `#main`, at the three viewports:
- explicit dark (`clara.theme=dark`): 6.79:1 — rgb(148,163,184) on rgb(18,26,42); axe 0 violations.
- system dark (`clara.theme=system`, no `data-theme`, `colorScheme: 'dark'`): 6.79:1; axe 0 violations.
- light (`clara.theme=light`): 7.58:1 — rgb(71,85,105) on rgb(255,255,255); axe 0 violations.
PASS.

### 6. F-05 — axis labels and tooltip (July custom period) in es/en/pt/fr
- Six `text.stats-axis` labels at each width and language, each one's left edge ≥ previous right edge + 1 px, none clipped by the SVG box (e.g. fr at 320 px: «27 janv · 27 févr · 30 mars · 30 avr · 31 mai · 1 juill»). PASS.
- Keyboard: from the focusable element before the chart, Tab reaches the first `.bars__hit` (role=button); `bars-tooltip` shows the full date of that group (e.g. «1 juill. 2026 – 31 juill. 2026 — Revenus $0.00 · Dépenses $99.99»), which is longer than the drawn axis label, plus both amounts from the group's accessible name; another Tab focuses the second group and the tooltip follows. PASS.
- Mobile (celular, celular-pequeno): tapping the third group updates the tooltip to its full date. PASS (not applicable on escritorio: no touch).
- `periodo=month&fecha=2026-07-15` and `periodo=year&fecha=2026-07-15` (Spanish): six labels, no overlap, every label ≤ 4 characters («feb … jul», «2021 … 2026»). PASS.

### 7. P1 / P2 — assistant and synthetic OCR receipts (CAD budget, synthetic data, not the demo)
- «coffee (RUB) 10» and «coffee RUB: 10»: amount field «10.00 RUB», message ««RUB» no es una moneda conocida. Escribe solo el número.», banner «1 línea está en otra moneda», «Registrar 1 movimiento» disabled. Enter in the field, Ctrl+Enter and a forced click on the disabled button: no «movimiento registrado», button still disabled, stored JSON byte-identical. Correction to «10» → enabled → registered → after reload one CAD transaction of 1000 minor and Inicio $2,490.00. PASS.
- «coffee (RUB) $10»: field «RUB 10.00 $», message «El importe tiene dos monedas distintas (RUB y $)…»; same blocked checks; corrected → CAD, $2,490.00. PASS.
- Receipt (fake `window.TextDetector` via `addInitScript`) «TIENDA LUNA / TOTAL RUB: 10.00»: «10.00 RUB», blocked as above; corrected → CAD, $2,490.00. PASS.
- Receipt «TIENDA LUNA / PEN 2.99 TAX 0.10 / TOTAL CAD 3.09»: field «3.09», no currency banner, no currency error on the line, register enabled → registered → after reload a CAD transaction of 309 minor, Inicio $2,496.91. PASS.

### 8. Keyboard, 320 px, dark theme
Covered inside cases 2, 3, 5 and 6: repair card operated only with Tab/Enter/Escape (both «Restaurar…» with its dialog and «Dejar como está»); history refusal reachable by keyboard with no «Revertir» in the tab order; `expectNoHorizontalScroll` on Inicio after re-import, Ajustes › Datos (light and dark), Historial, Análisis (both cases) and Estadísticas in four languages — all green at 320 px; dark theme on the repair card measured (6.79:1 notes, 15.88:1 titles) and axe-clean.

## Findings
No FAIL. No product defect found in the reviewed scope.

Observations (not failures, not in the audited claims):
- O-1 (low, UX): `/estadisticas?periodo=month` on a month without movements (September 2026 in my fixture) replaces the whole statistics body with «Sin movimientos en este periodo»; the six-month bar chart is not rendered at all, so the previous months are only reachable with «Periodo anterior». Pre-existing behaviour; I pointed my month/year checks at July. Worth a product decision, not a blocker.
- O-2 (info): the full-page screenshots show the fixed bottom bar in the middle of the page; that is the usual artefact of `fullPage` captures with `position: fixed` elements, not an overlap in the app (I did not run the layout-guard spec; that is for the full matrix run).

## Test-authoring corrections (my errors, kept for transparency)
1. First celular run (5 failed / 12 passed): (a) F-01 ×3 — my fixture left the six past «Internet» occurrences unpaid, so the app correctly counted 7 overdue/pending occurrences ($2,108.07 = 2,500 − 7 × 55.99); fixed by seeding the six past payments linked to their occurrences. (b) QA-01 — my keyboard helper looked for `[role="dialog"]`, but the app uses a native `<dialog>` (implicit role); fixed with `closest('dialog, [role="dialog"]')`. (c) F-05 — my guess of «the focusable element before the chart» skipped a `<summary>`; fixed by pressing Tab until a `.bars__hit` is focused (counted; must be < 12).
2. Second celular run (1 failed / 16 passed): F-05 month/year step navigated to September (no movements) → empty state, no chart (see O-1); fixed by `fecha=2026-07-15`.
3. A final full celular run was then executed (17/17) so every project has one consistent green run; contrast figures were also printed with `-g "F-04|Dejar como está"` re-runs on the two mobile projects (4 passed each).

## Commands run (worktree) and summary output
```
git -C /home/user/ALCANZA worktree add /tmp/claude-0/-home-user-ALCANZA/0cc824fc-6662-5ccd-b6d7-dca2af46bc95/scratchpad/rev-browser e38b07b
  → HEAD is now at e38b07b Reports and evidence: follow-up audit and corrective pass (docs only)
ln -s /home/user/ALCANZA/node_modules .../rev-browser/node_modules
npx vite build                                   → ✓ built in 2.08s, exit 0
node node_modules/vite/bin/vite.js preview --port 4181 --strictPort &   → curl http://localhost:4181/ = 200
cp .../lead/v13-known-intent-backup.json tests/e2e/review-v13-backup.json
npx tsc -p tsconfig.e2e.json --noEmit            → exit 0 (spec type-checks)
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium BASE_URL=http://localhost:4181 npx playwright test tests/e2e/review.browser.spec.ts --project=celular --workers=1 --output=test-results/review
  run 1 → 5 failed, 12 passed (1.3m)   [test-side errors, see above]
  run 2 → 1 failed, 16 passed (1.3m)   [test-side error, see above]
  -g "F-05" → 1 passed (6.9s)
  final full run → 17 passed (1.0m), exit 0            (test-results/review-run-celular-final.log)
... --project=celular-pequeno ...                → 17 passed (56.1s), exit 0   (test-results/review-run-celular-pequeno.log)
... --project=escritorio ...                     → 17 passed (57.9s), exit 0   (test-results/review-run-escritorio.log)
... --project=celular -g "F-04|Dejar como está"  → 4 passed (12.6s)            (contrast figures)
... --project=celular-pequeno -g "F-04|Dejar como está" → 4 passed (12.3s)     (contrast figures)
pkill -f "vite.js preview --port 4181"
```
Contrast figures printed by the spec (identical at the three viewports): F-04 dark explicit 6.79:1, system dark 6.79:1, light 7.58:1; QA-01 dark card: current/proposed notes 6.79:1, item title 15.88:1, card title 15.88:1.

## Screenshots (worktree `test-results/review-shots/`)
For each of `celular`, `celular-pequeno`, `escritorio` (69 files in total), under `/tmp/claude-0/-home-user-ALCANZA/0cc824fc-6662-5ccd-b6d7-dca2af46bc95/scratchpad/rev-browser/test-results/review-shots/<project>/`:
`f01-64-caracteres-tras-partir.png`, `f01-41-caracteres-tras-partir.png`, `f01-UUID-tras-partir.png`, `qa01-revision-claro.png`, `qa01-dialogo-claro.png`, `qa01-inicio-550.png`, `qa01-copias-locales.png`, `qa01-revision-oscuro.png`, `f02-historial-dependientes.png`, `f03-9900.png`, `f03-sin-anterior.png`, `f04-oscuro-explicito.png`, `f04-sistema-oscuro.png`, `f04-claro.png`, `f05-Español.png`, `f05-English.png`, `f05-Português.png`, `f05-Français.png`, `f05-month.png`, `f05-year.png`, `p1-coffee-RUB-10.png`, `p1-recibo-rub.png`, `p2-recibo-pen.png`.
Playwright traces/error contexts of the failed test-side attempts were overwritten by later runs (the `--output` folder is emptied per run); the logs of every run are kept in `test-results/review-run-*.log`.

## Not covered / limits
- Only the targeted spec above was run; the full matrix (layout guards, axe on every screen, performance, PWA) is for the serial full run that follows.
- OCR and camera are a fake `TextDetector` with synthetic lines; no real OCR, no physical devices, no screen reader, no system text scaling, no native file pickers.
- Contrast is computed against the first non-transparent ancestor background (opaque in every measured case, alpha 1), plus axe; semi-transparent overlays would need a different method.
- The dependents in F-02 were written to IndexedDB (as another tab/version would), not created through the Scenarios/Planned-expenses forms.

## Spec code: `tests/e2e/review.browser.spec.ts`
```ts
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MAX_AMOUNT_MINOR } from '../../src/domain/money'
import type { Transaction } from '../../src/domain/types'
import { account, baseData, bill, income, tx } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, openApp, reloadWhenSaved, seedStoredData, setLanguage, settleAnimations, storedData, waitForSaved, writeStoredData, type UiLanguage } from './helpers'
import { tinyPng } from './png'

/**
 * Revisión independiente de navegador (QA) de la cabeza e38b07b. Fixtures sintéticos propios (nombres, importes,
 * ids y fechas distintos de las pruebas de la implementación). Reloj fijo: 28-sep-2026 12:00 Toronto salvo QA-01
 * histórico (21-mar-2026). Capturas en test-results/review-shots/<proyecto>/ (Playwright vacía `--output` al
 * arrancar cada proyecto, así que no se guardan dentro).
 */
type StoredSchedule = { id: string; name: string; amountMinor: number; startDate: string; endDate?: string; anchorDate?: string }
type Stored = {
  schedules: StoredSchedule[]
  goals: unknown[]
  scenarios: unknown[]
  templates: unknown[]
  transactions: { id: string; amountMinor: number; currency: string }[]
  inbox: { snoozed: { id: string }[]; dismissed: { id: string }[] }
  history: { id: string; changes: { collection: string; id: string }[] }[]
}
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored
const at = (date: string) => `${date}T12:00:00.000Z`
const ACC = 'nomina'
const acct = (amountMinor: number, date: string) => account({ id: ACC, name: 'Nómina', anchor: { amountMinor, date, setAt: at(date) } })
const spend = (id: string, date: string, amountMinor: number, extra: Partial<Transaction> = {}) => tx({ id, date, amountMinor, accountId: ACC, kind: 'expense', status: 'realized', ...extra })

const SHOTS = join(process.cwd(), 'test-results', 'review-shots')
async function shot(page: Page, name: string, locator?: Locator) {
  const dir = join(SHOTS, test.info().project.name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.png`)
  if (locator) await locator.screenshot({ path })
  else await page.screenshot({ path, fullPage: true })
  return path
}

async function exportBackup(page: Page) {
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  return JSON.parse(readFileSync((await download.path())!, 'utf8')) as { data: Stored }
}
async function importBackup(page: Page, buffer: Buffer, name = 'copia-revision.json') {
  await go(page, '/ajustes/copia')
  await page.getByTestId('import-file').setInputFiles({ name, mimeType: 'application/json', buffer })
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada').first()).toBeVisible()
  await waitForSaved(page)
}

/** Recarga desde IndexedDB: ni «datos dañados» ni presupuesto vacío. */
async function expectLoadsClean(page: Page, label: string) {
  await page.reload()
  await page.locator('#page-title').or(page.getByText('No pudimos leer tus datos guardados')).first().waitFor()
  await expect(page.getByText('No pudimos leer tus datos guardados'), label).toHaveCount(0)
  await expect(page.locator('#page-title'), label).toBeVisible()
  await go(page, '/')
  await expect(page.getByTestId('available'), label).toBeVisible()
}

/** Pulsa Tab hasta que el foco esté en un botón cuyo texto contiene `match` (dentro de un diálogo si se pide). */
async function tabToButton(page: Page, match: string, opts: { inDialog?: boolean; max?: number } = {}) {
  const max = opts.max ?? 80
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el ? { tag: el.tagName, text: (el.getAttribute('aria-label') || el.textContent || '').trim(), inDialog: !!el.closest('dialog, [role="dialog"]') } : null
    })
    if (info && info.tag === 'BUTTON' && info.text.includes(match) && (!opts.inDialog || info.inDialog)) return i + 1
  }
  throw new Error(`No se llegó con Tab a «${match}» en ${max} pulsaciones`)
}
const focusedText = (page: Page) => page.evaluate(() => ((document.activeElement as HTMLElement | null)?.textContent ?? '').trim())

/** Contraste WCAG del texto sobre el primer fondo no transparente que lo rodea. */
async function contrastOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) throw new Error(`no hay ${sel}`)
    const rgb = (c: string) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c)
      return m ? [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]] : null
    }
    const fg = rgb(getComputedStyle(el).color)!
    let bg: number[] | null = null
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const b = rgb(getComputedStyle(n).backgroundColor)
      if (b && b[3]! > 0) {
        bg = b
        break
      }
    }
    if (!bg) bg = [255, 255, 255, 1]
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!)
    }
    const a = lum(fg)
    const b = lum(bg)
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fg: getComputedStyle(el).color, bg: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`, bgAlpha: bg[3], font: `${getComputedStyle(el).fontSize}/${getComputedStyle(el).fontWeight}` }
  }, selector)
}

/* ------------------------------------------------------------------ */
/* 1 · F-01                                                             */
/* ------------------------------------------------------------------ */

const F01_IDS: [string, string][] = [
  ['64 caracteres', 'k'.repeat(64)],
  ['41 caracteres', 'm'.repeat(41)],
  ['UUID', '7f3e2a10-5b4c-4d8e-9a1f-2c3b4d5e6f70'],
]
for (const [label, oldId] of F01_IDS) {
  test(`F-01 · «Internet» 55.99 mensual del 12 (id ${label}) con aviso del 12-oct pospuesto: 61.50 desde el 12-oct → guardar, recargar, revertir, exportar y reimportar`, async ({ page }) => {
    test.setTimeout(150_000)
    const data = baseData({
      accounts: [acct(250000, '2026-09-20')],
      schedules: [
        bill('2026-04-12', 5599, { id: oldId, name: 'Internet', frequency: 'monthly', accountId: ACC }),
        income('2026-05-20', 180000, { id: 'nomina-mensual', name: 'Nómina', frequency: 'monthly', accountId: ACC }),
      ],
      // Las seis ocurrencias pasadas (abr–sep) están pagadas y vinculadas: solo queda pendiente la del 12-oct.
      transactions: [4, 5, 6, 7, 8, 9].map((m) => spend(`pago-internet-${m}`, `2026-${String(m).padStart(2, '0')}-12`, 5599, { scheduleId: oldId, occurrenceDate: `2026-${String(m).padStart(2, '0')}-12`, categoryId: 'utilities', realizedAt: at(`2026-${String(m).padStart(2, '0')}-12`), createdAt: at(`2026-${String(m).padStart(2, '0')}-12`), updatedAt: at(`2026-${String(m).padStart(2, '0')}-12`) })),
      inbox: { snoozed: [{ id: `due:schedule:${oldId}:2026-10-12`, until: '2026-10-11', at: at('2026-09-26') }], dismissed: [] },
    })
    await seedStoredData(page, data)
    // 2 500 − 55.99 (solo la ocurrencia del 12-oct está pendiente y cae antes del ingreso del 20-oct, incluido).
    await expect(page.getByTestId('available')).toHaveText('$2,444.01')
    await go(page, `/plan/programado/editar/${oldId}`)
    await page.getByRole('radio', { name: 'Desde una fecha' }).check()
    await expect(page.getByLabel('Desde (primera fecha con los cambios)')).toHaveValue('2026-10-12')
    await page.getByLabel('Importe', { exact: true }).fill('61.50')
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByText(/^Cambio guardado desde el/).first()).toBeVisible()
    await waitForSaved(page)

    const after = await stored(page)
    const next = after.schedules.find((s) => s.name === 'Internet' && s.id !== oldId)!
    expect(next, 'tramo nuevo creado').toBeTruthy()
    expect(after.schedules.filter((s) => s.name === 'Internet').map((s) => [s.amountMinor, s.startDate, s.endDate ?? null])).toEqual([
      [5599, '2026-04-12', '2026-10-11'],
      [6150, '2026-10-12', null],
    ])
    expect(after.inbox.snoozed.map((s) => s.id)).toEqual([`due:schedule:${next.id}:2026-10-12`])
    const snoozeIdLengths = after.history.at(-1)!.changes.filter((c) => c.collection === 'inboxSnoozed').map((c) => c.id.length).sort((a, b) => a - b)
    expect(snoozeIdLengths).toEqual([24 + next.id.length, 24 + oldId.length].sort((a, b) => a - b))
    // Con 64 y 41 el id del aviso en el historial pasa de 64 (lo que antes rompía la carga); con el UUID no.
    expect(Math.max(...snoozeIdLengths) > 64).toBe(oldId.length > 40)

    await expectLoadsClean(page, `${label}: tras partir`)
    await expect(page.getByTestId('available')).toHaveText('$2,438.50')
    await shot(page, `f01-${label.replace(/\s/g, '-')}-tras-partir`)

    await go(page, '/ajustes/historial')
    const entry = page.locator('article.history-entry', { hasText: 'Internet' }).first()
    await entry.getByRole('button', { name: 'Revertir' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Revertir' }).click()
    await expect(page.getByText('Cambio revertido').first()).toBeVisible()
    await waitForSaved(page)
    const back = await stored(page)
    expect(back.schedules.filter((s) => s.name === 'Internet').map((s) => [s.id, s.amountMinor, s.endDate ?? null])).toEqual([[oldId, 5599, null]])
    expect(back.inbox.snoozed.map((s) => s.id)).toEqual([`due:schedule:${oldId}:2026-10-12`])
    await expectLoadsClean(page, `${label}: tras revertir`)
    await expect(page.getByTestId('available')).toHaveText('$2,444.01')

    const backup = await exportBackup(page)
    expect(backup.data.history.flatMap((e) => e.changes).some((c) => c.collection === 'inboxSnoozed' && c.id.length > 64)).toBe(oldId.length > 40)
    await importBackup(page, Buffer.from(JSON.stringify(backup)))
    await expectLoadsClean(page, `${label}: tras reimportar`)
    await expect(page.getByTestId('available')).toHaveText('$2,444.01')
    expect((await stored(page)).inbox.snoozed.map((s) => s.id)).toEqual([`due:schedule:${oldId}:2026-10-12`])
    await expectNoHorizontalScroll(page, `${label}: inicio tras reimportar`)
  })
}

/* ------------------------------------------------------------------ */
/* 2 · QA-01 histórico con la copia v13 real                            */
/* ------------------------------------------------------------------ */

const MARCH21 = new Date('2026-03-21T12:00:00-04:00')
const V13 = readFileSync(join(process.cwd(), 'tests/e2e/review-v13-backup.json'))

async function seedAt(page: Page, data: unknown, time: Date) {
  await openApp(page, time)
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, data)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
}

/** Presupuesto vacío de partida (para llegar a Ajustes › Copia) y la copia v13 real importada por la interfaz. */
async function importV13(page: Page) {
  await seedAt(page, baseData({ accounts: [account({ id: 'temporal', name: 'Temporal', anchor: { amountMinor: 0, date: '2026-03-01', setAt: at('2026-03-01') } })] }), MARCH21)
  await importBackup(page, V13, 'v13-known-intent-backup.json')
}

test('QA-01 histórico · copia v13 real importada por la interfaz (21-mar-2026): $1,800.00; la revisión muestra 28 mar frente a 31 mar; «Restaurar» por teclado → $550.00 tras recargar, copia local «Antes de restaurar» nueva y tras exportar/importar', async ({ page }) => {
  test.setTimeout(150_000)
  await page.addInitScript(() => localStorage.setItem('clara.theme', 'light'))
  await importV13(page)
  await expect(await available(page)).toHaveText('$1,800.00')
  await go(page, '/ajustes/copias-locales')
  const copiesBefore = await page.locator('#main').getByText('Antes de restaurar', { exact: false }).count()

  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('split-repair-current')).toContainText('28 mar')
  await expect(card.getByTestId('split-repair-proposed')).toContainText('31 mar')
  await expect(card.getByTestId('split-repair-proposed')).toContainText('30 abr')
  await expectNoHorizontalScroll(page, 'Ajustes › Datos con la revisión (claro)')
  await shot(page, 'qa01-revision-claro')

  // Solo teclado: Tab hasta «Restaurar…», Enter abre el diálogo; Esc lo cierra y devuelve el foco; Enter de nuevo y
  // Tab hasta el botón de confirmar del diálogo.
  await tabToButton(page, 'Restaurar las fechas de siempre')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '¿Restaurar las fechas de siempre de «Sueldo»?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('31 mar')
  await shot(page, 'qa01-dialogo-claro')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await focusedText(page), 'Esc devuelve el foco al botón que abrió el diálogo').toContain('Restaurar las fechas de siempre')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await tabToButton(page, 'Restaurar las fechas de siempre', { inDialog: true, max: 10 })
  await page.keyboard.press('Enter')
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
  await expect(card).toHaveCount(0)
  const st = await stored(page)
  expect(st.schedules.find((s) => s.id === 'salary-2')).toMatchObject({ startDate: '2026-02-28', anchorDate: '2026-01-31', amountMinor: 240777 })
  expect(st.schedules.find((s) => s.id === 'salary')).toMatchObject({ startDate: '2026-01-31', endDate: '2026-02-27' })
  expect(st.schedules.find((s) => s.id === 'salary')?.anchorDate).toBeUndefined()

  await page.reload()
  await expect(await available(page)).toHaveText('$550.00')
  await shot(page, 'qa01-inicio-550')
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('split-repair')).toHaveCount(0)
  await go(page, '/ajustes/historial')
  const first = page.locator('article.history-entry').first()
  await expect(first).toContainText('Sueldo')
  await expect(first.getByRole('button', { name: 'Revertir' })).toBeVisible()
  await go(page, '/ajustes/copias-locales')
  expect(await page.locator('#main').getByText('Antes de restaurar', { exact: false }).count(), 'una copia local «Antes de restaurar» nueva por la reparación').toBe(copiesBefore + 1)
  await shot(page, 'qa01-copias-locales')

  const backup = await exportBackup(page)
  expect(backup.data.schedules.find((s) => s.id === 'salary-2')?.anchorDate).toBe('2026-01-31')
  await importBackup(page, Buffer.from(JSON.stringify(backup)))
  await expect(await available(page)).toHaveText('$550.00')
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('split-repair')).toHaveCount(0)
})

test('QA-01 histórico · «Dejar como está» por teclado en tema oscuro: contraste AA en la tarjeta, sigue $1,800.00 y la tarjeta no vuelve tras recargar', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => localStorage.setItem('clara.theme', 'dark'))
  await importV13(page)
  await expect(await available(page)).toHaveText('$1,800.00')
  await go(page, '/ajustes/datos')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const card = page.getByTestId('split-repair')
  await expect(card).toBeVisible()
  await settleAnimations(page)
  for (const sel of ['[data-testid="split-repair-current"]', '[data-testid="split-repair-proposed"]', '[data-testid="split-repair"] .item__title', '#split-repair-title']) {
    const c = await contrastOf(page, sel)
    console.log(`[contraste QA-01 oscuro ${test.info().project.name}] ${sel}: ${c.ratio.toFixed(2)}:1 (${c.fg} sobre ${c.bg}, ${c.font})`)
    expect(c.ratio, `${sel}: ${c.fg} sobre ${c.bg} (alfa ${c.bgAlpha}, ${c.font})`).toBeGreaterThanOrEqual(4.5)
  }
  const axe = await new AxeBuilder({ page }).include('[data-testid="split-repair"]').withRules(['color-contrast']).analyze()
  expect(axe.violations.map((v) => v.nodes.map((n) => n.target.join(' ')).join(' | '))).toEqual([])
  await expectNoHorizontalScroll(page, 'Ajustes › Datos con la revisión (oscuro)')
  await shot(page, 'qa01-revision-oscuro')
  await tabToButton(page, 'Dejar como está')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Se deja como está').first()).toBeVisible()
  await waitForSaved(page)
  await expect(card).toHaveCount(0)
  await page.reload()
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('split-repair')).toHaveCount(0)
  const st = await stored(page)
  expect(st.schedules.find((s) => s.id === 'salary-2')?.anchorDate).toBeUndefined()
  expect(st.inbox.dismissed.map((d) => d.id)).toEqual(['int:split:salary-2'])
  await expect(await available(page)).toHaveText('$1,800.00')
})

/* ------------------------------------------------------------------ */
/* 3 · F-02                                                             */
/* ------------------------------------------------------------------ */

test('F-02 · partición hecha por esta versión + escenario y gasto planificado creados DESPUÉS apuntando al tramo nuevo: el historial lista los dependientes, sin «Revertir» (tampoco por teclado), lo guardado es idéntico tras recargar; una entrada corriente sí se revierte', async ({ page }) => {
  test.setTimeout(150_000)
  const data = baseData({
    accounts: [acct(250000, '2026-09-20')],
    schedules: [
      bill('2026-03-05', 4500, { id: 'gym', name: 'Gimnasio', frequency: 'monthly', accountId: ACC, categoryId: 'other_expense' }),
      bill('2026-02-18', 3200, { id: 'agua', name: 'Agua', frequency: 'monthly', accountId: ACC }),
    ],
  })
  await seedStoredData(page, data)
  await go(page, '/plan/programado/editar/gym')
  await page.getByRole('radio', { name: 'Desde una fecha' }).check()
  await expect(page.getByLabel('Desde (primera fecha con los cambios)')).toHaveValue('2026-10-05')
  await page.getByLabel('Importe', { exact: true }).fill('49')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText(/^Cambio guardado desde el/).first()).toBeVisible()
  await waitForSaved(page)
  const split = JSON.parse((await storedData(page))!) as Stored & Record<string, unknown>
  const next = split.schedules.find((s) => s.name === 'Gimnasio' && s.id !== 'gym')!
  expect(next).toBeTruthy()
  expect(split.history.at(-1)!.changes.map((c) => [c.collection, c.id])).toEqual([
    ['schedules', 'gym'],
    ['schedules', next.id],
  ])

  // Creados después de la partición (como desde otra pestaña): un escenario y un gasto planificado vinculados al tramo nuevo.
  const later = '2026-09-28T17:30:00.000Z'
  const withDeps = {
    ...split,
    scenarios: [{ id: 'esc-cuota', name: 'Si suben la cuota', changes: [{ type: 'scheduleAmount', scheduleId: next.id, newAmountMinor: 5500 }], baseFingerprint: 'rev', createdAt: later, updatedAt: later }],
    goals: [{ id: 'gp-cuota', name: 'Cuota anual', kind: 'expense', targetMinor: 4900, targetDate: '2026-11-05', currency: 'CAD', fundedFrom: 'budget', allocations: [], plan: { history: [], link: { scheduleId: next.id, occurrenceDate: '2026-11-05' } }, createdAt: later, updatedAt: later }],
    updatedAt: later,
  }
  await writeStoredData(page, withDeps)
  await page.reload()
  await expect(page.locator('#page-title')).toBeVisible()
  await go(page, '/ajustes/historial')
  const entry = page.locator('article.history-entry', { hasText: 'Gimnasio' }).first()
  const note = entry.getByTestId('history-dependents')
  await expect(note).toContainText('No se puede revertir: 2 registros seguirían apuntando a un programado que este cambio eliminaría')
  await expect(note).toContainText('Escenario «Si suben la cuota»')
  await expect(note).toContainText('Gasto planificado «Cuota anual»')
  await expect(entry.getByRole('button', { name: 'Revertir' })).toHaveCount(0)
  await expectNoHorizontalScroll(page, 'historial con dependientes')
  await shot(page, 'f02-historial-dependientes')

  // Solo teclado: recorriendo toda la página ningún foco cae en un «Revertir» (la entrada no lo ofrece).
  const focusedButtons: string[] = []
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el && el.tagName === 'BUTTON' ? (el.textContent ?? '').trim() : null
    })
    if (info !== null) focusedButtons.push(info)
  }
  expect(focusedButtons.filter((b) => b.includes('Revertir'))).toEqual([])
  await expect(note).toBeVisible()

  // Lo guardado no cambia por recargar ni por abrir el historial (byte a byte).
  const s1 = await storedData(page)
  await page.reload()
  await expect(page.locator('#page-title')).toBeVisible()
  await go(page, '/ajustes/historial')
  await expect(note).toBeVisible()
  const s2 = await storedData(page)
  expect(s2).toBe(s1)
  expect((JSON.parse(s2!) as Stored).schedules.map((s) => s.id).sort()).toEqual(['agua', 'gym', next.id].sort())

  // Una entrada corriente (cambiar «Agua» a todas las fechas) sigue siendo revertible.
  await go(page, '/plan/programado/editar/agua')
  await page.getByRole('radio', { name: 'A todas las fechas' }).check()
  await page.getByLabel('Importe', { exact: true }).fill('35')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await waitForSaved(page)
  await expect.poll(async () => (await stored(page)).schedules.find((s) => s.id === 'agua')?.amountMinor).toBe(3500)
  await go(page, '/ajustes/historial')
  const ordinary = page.locator('article.history-entry', { hasText: 'Agua' }).first()
  await expect(ordinary).toContainText('Programado cambiado: Agua')
  await ordinary.getByRole('button', { name: 'Revertir' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revertir' }).click()
  await expect(page.getByText('Cambio revertido').first()).toBeVisible()
  await waitForSaved(page)
  expect((await stored(page)).schedules.find((s) => s.id === 'agua')?.amountMinor).toBe(3200)
  // La partición con dependientes sigue sin ofrecerse.
  await expect(page.locator('article.history-entry', { hasText: 'Gimnasio' }).first().getByTestId('history-dependents')).toBeVisible()
})

/* ------------------------------------------------------------------ */
/* 4 · F-03                                                             */
/* ------------------------------------------------------------------ */

test('F-03 · 1 gasto de MAX_AMOUNT_MINOR el 3-ago y 100 de MAX del 1 al 20 de sep: Análisis dice 9 900 % con sus importes y la pantalla es usable', async ({ page }) => {
  const sept = Array.from({ length: 100 }, (_, i) => spend(`max-sep-${i}`, `2026-09-${String(1 + (i % 20)).padStart(2, '0')}`, MAX_AMOUNT_MINOR))
  await seedStoredData(page, baseData({ accounts: [acct(0, '2026-06-15')], transactions: [spend('max-ago', '2026-08-03', MAX_AMOUNT_MINOR), ...sept] }))
  await go(page, '/analisis')
  const title = page.locator('[data-testid="insight-title"][data-id="spendingUp"]')
  await expect(title).toHaveText(/9[\s., ]?900 % más de gasto/)
  const card = title.locator('xpath=ancestor::article[1]')
  await card.locator('details > summary').first().click()
  await expect(card).toContainText('1,000,000,000,000.00')
  await expect(card).toContainText('10,000,000,000.00')
  await expectNoHorizontalScroll(page, 'análisis con 9 900 %')
  await shot(page, 'f03-9900')
})

test('F-03 · sin gasto en agosto (solo septiembre): no hay aviso de variación, ninguna cifra inventada y la pantalla se muestra', async ({ page }) => {
  await seedStoredData(page, baseData({ accounts: [acct(0, '2026-06-15')], transactions: [spend('sep-a', '2026-09-12', 4321), spend('sep-b', '2026-09-20', 1234)] }))
  await go(page, '/analisis')
  await expect(page.locator('#page-title')).toBeVisible()
  await expect(page.getByTestId('insight-list').or(page.getByText('Nada que señalar ahora mismo')).first()).toBeVisible()
  await expect(page.locator('[data-testid="insight-title"][data-id="spendingUp"], [data-testid="insight-title"][data-id="spendingDown"]')).toHaveCount(0)
  expect(await page.locator('#main').innerText()).not.toMatch(/NaN|Infinity|undefined|null/)
  await expectNoHorizontalScroll(page, 'análisis sin mes anterior')
  await shot(page, 'f03-sin-anterior')
})

/* ------------------------------------------------------------------ */
/* 5 · F-04                                                             */
/* ------------------------------------------------------------------ */

const STATS_JULY = '/estadisticas?periodo=custom&desde=2026-07-01&hasta=2026-07-31'
const julyData = () => baseData({ accounts: [acct(300000, '2026-02-01')], transactions: [spend('jul-a', '2026-07-04', 7777), spend('jul-b', '2026-07-19', 2222), spend('jun-a', '2026-06-21', 3333)] })

async function checkNeutralDelta(page: Page, label: string) {
  await go(page, STATS_JULY)
  const neutral = page.locator('.stat__delta--neutral').first()
  await expect(neutral, label).toBeVisible()
  await expect(neutral, label).toHaveText('Sin comparación')
  await settleAnimations(page)
  const c = await contrastOf(page, '.stat__delta--neutral')
  expect(c.ratio, `${label}: ${c.fg} sobre ${c.bg} (alfa ${c.bgAlpha}, ${c.font})`).toBeGreaterThanOrEqual(4.5)
  const res = await new AxeBuilder({ page }).include('#main').withRules(['color-contrast']).analyze()
  expect(res.violations.map((v) => v.nodes.map((n) => n.target.join(' ')).join(' | ')), label).toEqual([])
  await shot(page, `f04-${label.replace(/\s/g, '-')}`, page.getByTestId('stats-tiles'))
  console.log(`[contraste F-04 ${test.info().project.name}] ${label}: ${c.ratio.toFixed(2)}:1 (${c.fg} sobre ${c.bg}, ${c.font})`)
}

test('F-04 · «Oscuro» explícito: «Sin comparación» ≥ 4,5:1 y axe sin fallos de contraste en #main', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('clara.theme', 'dark'))
  await seedStoredData(page, julyData())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await checkNeutralDelta(page, 'oscuro explicito')
})

test.describe('F-04 · «Sistema» con el sistema en oscuro', () => {
  test.use({ colorScheme: 'dark' })
  test('«Sin comparación» ≥ 4,5:1 y axe sin fallos de contraste', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('clara.theme', 'system'))
    await seedStoredData(page, julyData())
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)
    await checkNeutralDelta(page, 'sistema oscuro')
  })
})

test('F-04 · «Claro»: «Sin comparación» ≥ 4,5:1 y axe sin fallos de contraste', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('clara.theme', 'light'))
  await seedStoredData(page, julyData())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await checkNeutralDelta(page, 'claro')
})

/* ------------------------------------------------------------------ */
/* 6 · F-05                                                             */
/* ------------------------------------------------------------------ */

async function axisLayout(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.bars__svg')!
    const box = svg.getBoundingClientRect()
    const labels = Array.from(svg.querySelectorAll('text.stats-axis'))
      .map((t) => {
        const r = t.getBoundingClientRect()
        return { text: t.textContent ?? '', left: r.left, right: r.right }
      })
      .sort((a, b) => a.left - b.left)
    return { svg: { left: box.left, right: box.right }, labels }
  })
}
function expectLabelsFit(layout: Awaited<ReturnType<typeof axisLayout>>, where: string) {
  expect(layout.labels.length, where).toBe(6)
  for (let i = 1; i < layout.labels.length; i++) {
    expect(layout.labels[i]!.left, `${where}: «${layout.labels[i - 1]!.text}» y «${layout.labels[i]!.text}» se solapan`).toBeGreaterThanOrEqual(layout.labels[i - 1]!.right + 1)
  }
  for (const l of layout.labels) {
    expect(l.left, `${where}: «${l.text}» recortada por la izquierda`).toBeGreaterThanOrEqual(layout.svg.left - 0.5)
    expect(l.right, `${where}: «${l.text}» recortada por la derecha`).toBeLessThanOrEqual(layout.svg.right + 0.5)
  }
}

test('F-05 · julio personalizado en es/en/pt/fr: seis etiquetas sin solaparse ni recortarse; Tab a los grupos muestra la fecha completa y los importes en el tooltip; toque en celular; mensual y anual con etiquetas cortas', async ({ page }) => {
  test.setTimeout(180_000)
  await seedStoredData(page, julyData())
  const tip = page.getByTestId('bars-tooltip')
  for (const language of ['Español', 'English', 'Português', 'Français'] as UiLanguage[]) {
    await setLanguage(page, language)
    await go(page, STATS_JULY)
    await expect(page.locator('.bars__svg')).toBeVisible()
    await settleAnimations(page)
    const where = `${language} ${test.info().project.name}`
    const layout = await axisLayout(page)
    expectLabelsFit(layout, where)
    await shot(page, `f05-${language}`, page.locator('.bars'))

    // Teclado: desde el elemento enfocable anterior al gráfico, Tab entra en el primer grupo; otro Tab, en el segundo.
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length > 0)
      const idx = all.findIndex((el) => el.classList.contains('bars__hit'))
      all[Math.max(0, idx - 2)]!.focus()
    })
    let presses = 0
    for (; presses < 12; presses++) {
      await page.keyboard.press('Tab')
      if (await page.evaluate(() => document.activeElement?.classList.contains('bars__hit'))) break
    }
    expect(presses, `${where}: se llega al gráfico con Tab`).toBeLessThan(12)
    const hits = page.locator('.bars__hit')
    await expect(hits.first(), where).toBeFocused()
    const aria1 = (await hits.first().getAttribute('aria-label'))!
    const [date1] = aria1.split(': ')
    await expect(tip, where).toContainText(date1!)
    await expect(tip, where).toContainText(aria1.slice(date1!.length + 2))
    expect(date1!.length, `${where}: el tooltip lleva la fecha completa, más larga que la etiqueta del eje`).toBeGreaterThan(layout.labels[0]!.text.length)
    await page.keyboard.press('Tab')
    await expect(hits.nth(1), where).toBeFocused()
    const aria2 = (await hits.nth(1).getAttribute('aria-label'))!
    await expect(tip, where).toContainText(aria2.split(': ')[0]!)
    await expect(tip, where).toContainText(aria2.slice(aria2.split(': ')[0]!.length + 2))
    if (test.info().project.name !== 'escritorio') {
      await hits.nth(2).tap()
      const aria3 = (await hits.nth(2).getAttribute('aria-label'))!
      await expect(tip, `${where}: toque`).toContainText(aria3.split(': ')[0]!)
    }
    await expectNoHorizontalScroll(page, where)
  }
  await setLanguage(page, 'Español')
  for (const periodo of ['month', 'year']) {
    // Un periodo con movimientos (septiembre no tiene ninguno en este fixture y la pantalla muestra el estado vacío).
    await go(page, `/estadisticas?periodo=${periodo}&fecha=2026-07-15`)
    await expect(page.locator('.bars__svg')).toBeVisible()
    await settleAnimations(page)
    const layout = await axisLayout(page)
    expectLabelsFit(layout, `periodo ${periodo}`)
    for (const l of layout.labels) expect(l.text.length, `periodo ${periodo}: «${l.text}» es la etiqueta corta de siempre`).toBeLessThanOrEqual(4)
    await shot(page, `f05-${periodo}`, page.locator('.bars'))
  }
})

/* ------------------------------------------------------------------ */
/* 7 · P1 / P2                                                          */
/* ------------------------------------------------------------------ */

const RUB_MSG = '«RUB» no es una moneda conocida. Escribe solo el número.'
const assistantData = () => baseData({ accounts: [acct(250000, '2026-09-20')] })

async function fakeTextDetector(page: Page, lines: readonly string[]) {
  await page.addInitScript((ls) => {
    ;(window as unknown as { TextDetector: unknown }).TextDetector = class {
      async detect() {
        return ls.map((rawValue, i) => ({ rawValue, boundingBox: { x: 0, y: i * 20, width: 200, height: 16 } }))
      }
    }
  }, lines)
}

async function expectBlockedLine(page: Page, line: Locator, value: string, message: string | RegExp) {
  await expect(line.getByLabel('Importe')).toHaveValue(value)
  await expect(line.getByText(message)).toBeVisible()
  await expect(page.getByTestId('assistant-currency-blocked')).toContainText('1 línea está en otra moneda')
  const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
  await expect(register).toBeDisabled()
  const before = await storedData(page)
  await line.getByLabel('Importe').focus()
  await page.keyboard.press('Enter')
  await register.click({ force: true })
  await page.keyboard.press('Control+Enter')
  await expect(page.getByText(/movimiento registrado/)).toHaveCount(0)
  await expect(register).toBeDisabled()
  expect(await storedData(page)).toBe(before)
}

async function correctAndRegister(page: Page, line: Locator, amount: string, minor: number, expectedAvailable: string) {
  await line.getByLabel('Importe').fill(amount)
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
  await expect(register).toBeEnabled()
  await register.click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
  await reloadWhenSaved(page)
  await expect(page.getByTestId('available')).toBeVisible()
  const saved = (await stored(page)).transactions.filter((t) => t.amountMinor === minor)
  expect(saved).toHaveLength(1)
  expect(saved[0]!.currency).toBe('CAD')
  await expect(await available(page)).toHaveText(expectedAvailable)
}

for (const [text, value, message] of [
  ['coffee (RUB) 10', '10.00 RUB', RUB_MSG],
  ['coffee RUB: 10', '10.00 RUB', RUB_MSG],
  ['coffee (RUB) $10', 'RUB 10.00 $', /El importe tiene dos monedas distintas \(RUB y \$\)/],
] as const) {
  test(`P1 · asistente «${text}»: bloqueado (campo «${value}»); ni Enter, ni Ctrl+Enter ni clic forzado registran; corregido a mano se guarda en CAD y sobrevive a recargar`, async ({ page }) => {
    await seedStoredData(page, assistantData())
    await go(page, '/asistente')
    await page.getByLabel('Texto').fill(text)
    await page.getByRole('button', { name: 'Analizar' }).click()
    const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
    await expect(line).toBeVisible()
    await expectBlockedLine(page, line, value, message)
    await shot(page, `p1-${text.replace(/[^a-z0-9]+/gi, '-')}`)
    await correctAndRegister(page, line, '10', 1000, '$2,490.00')
  })
}

test('P1 · recibo (OCR sintético) «TOTAL RUB: 10.00»: propone 10.00 RUB y bloquea; corregido se registra en CAD', async ({ page }) => {
  await fakeTextDetector(page, ['TIENDA LUNA', 'TOTAL RUB: 10.00'])
  await seedStoredData(page, assistantData())
  await go(page, '/asistente')
  await page.getByTestId('photo-input').setInputFiles({ name: 'ticket.png', mimeType: 'image/png', buffer: tinyPng(8) })
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await expect(line).toBeVisible()
  await expectBlockedLine(page, line, '10.00 RUB', RUB_MSG)
  await shot(page, 'p1-recibo-rub')
  await correctAndRegister(page, line, '10', 1000, '$2,490.00')
})

test('P2 · recibo (OCR sintético) «PEN 2.99 TAX 0.10» + «TOTAL CAD 3.09»: propone 3.09 en CAD sin conflicto, se registra y persiste', async ({ page }) => {
  await fakeTextDetector(page, ['TIENDA LUNA', 'PEN 2.99 TAX 0.10', 'TOTAL CAD 3.09'])
  await seedStoredData(page, assistantData())
  await go(page, '/asistente')
  await page.getByTestId('photo-input').setInputFiles({ name: 'ticket.png', mimeType: 'image/png', buffer: tinyPng(8) })
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await expect(line.getByLabel('Importe')).toHaveValue('3.09')
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await expect(line.getByText(/No se convierte|no es una moneda conocida|dos monedas/)).toHaveCount(0)
  const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
  await expect(register).toBeEnabled()
  await shot(page, 'p2-recibo-pen')
  await register.click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
  await reloadWhenSaved(page)
  await expect(page.getByTestId('available')).toBeVisible()
  expect((await stored(page)).transactions.find((t) => t.amountMinor === 309)).toMatchObject({ currency: 'CAD' })
  await expect(await available(page)).toHaveText('$2,496.91')
})
```
