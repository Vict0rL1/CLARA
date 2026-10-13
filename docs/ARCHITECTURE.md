# Arquitectura de Clara (estado al inicio de Clara v2, 2026-10-07)

Una página. Qué existe hoy, antes de la paridad con Lukas.

## Stack

| Pieza | Hoy | Nota |
|---|---|---|
| Plataforma | **Web / PWA** (React 19, TypeScript 6, Vite 8) | Sin React Native ni Flutter. *Service worker* propio generado al compilar (`pwa/sw.template.js`), CSP estricta, uso sin conexión. |
| Dependencias de producto | Solo `react` y `react-dom` | Sin librerías de gráficos, i18n, estado ni persistencia: todo es propio. |
| Estado | `AppStore` (`src/state/store.ts`) con `useSyncExternalStore` | Datos inmutables; `commit()` aplica resultados de `domain/operations.ts`, registra historial y guarda. |
| Persistencia | **IndexedDB** (`src/storage/indexedDbRepository.ts`), `localStorage` de respaldo | Transacción atómica datos+revisión, conflicto entre pestañas, migración verificada desde `localStorage`. Equivale a Dexie sin dependencia. |
| Formato de datos | `AppData` versionado, `SCHEMA_VERSION = 12`, migraciones en `src/storage/migrations.ts` | Copias de seguridad JSON (`backup.ts`) validadas por completo antes de aplicar. |
| i18n | Propia y tipada: `src/i18n/es.ts` (base), `en.ts`, `pt.ts` y `fr.ts` (el tipo exige todas las claves) | Claves con espacio de nombres (`home.balance…`), plurales `_one/_other` vía `Intl.PluralRules`, fechas/números vía `Intl`. Pseudo-locale (`pseudo.ts`) y detector de literales (`scripts/find-literals.mjs`). |
| Tema | `clara.theme` en el dispositivo: sistema (por defecto), claro, oscuro | Tokens en `src/styles.css` (`--bg`, `--primary`, `--series-*`…). Paleta clara cálida; **no** son los tokens de §4. |
| Gráficos | SVG en línea (`src/ui/components/charts.tsx`) | Barra de composición y proyección con tabla alternativa. |
| Pruebas | Vitest (35 archivos, 366 pruebas) + Playwright (31 archivos, 288 pruebas en 390 px, 320 px y escritorio, con axe) | `npm run check` = typecheck + oxlint + vitest. |
| CI | No hay flujo de CI en el repositorio | Las comprobaciones se ejecutan a mano antes de cada commit. |

## Capas (no se mezclan)

```
src/domain/    lógica financiera pura (sin React, sin almacenamiento, sin reloj implícito: OpContext {today, now})
src/storage/   DataRepository (IndexedDB / localStorage / memoria), backup, migrations, drafts
src/state/     AppStore + hooks (useData, useRun, useToday)
src/ui/        pantallas (29) y componentes (9 archivos); formato (format.ts), preferencias de presentación
src/i18n/      diccionarios y traductor
src/demo/      datos de demostración (isDemo: true)
src/test/      fixtures y datos sintéticos (1k/10k/50k)
```

## Modelo de datos actual (`src/domain/types.ts`)

`AppData { settings, accounts, transactions, schedules, goals, categories (personalizadas), categoryLimits (vacío desde v10; ahora `plans`), categoryRules, trash, purgedImportRefs, favorites, reconciliations, backup, periodBudgets, scenarios, inbox, incomeDistributions, templates, history, historyStartedAt, revision }`

- Dinero en **enteros** (unidades menores); una moneda por presupuesto.
- `Transaction.kind: expense | income | transfer | refund | adjustment`; `status: realized | planned`; divisiones por categoría (`splits`); vínculo con ocurrencias programadas.
- Categorías fijas en código (14 gasto + 6 ingreso) y personalizadas en datos (`CustomCategory`, con archivado). Sin grupos, iconos ni colores.
- `Schedule` (frecuencia once/weekly/biweekly/monthly/yearly), `Goal` (apartados virtuales con `allocations`, gastos planificados), `CategoryLimit` (mensual, una categoría), `Favorite`, `PeriodBudget`, escenarios, bandeja, distribuciones de ingreso, plantillas, historial reversible.

## Navegación (hash router propio, `src/ui/router.ts`)

Pestañas: Inicio · Movimientos · **+ Agregar** · Plan · Ajustes. Rutas: `/`, `/movimientos[/nuevo|editar/:id|importar|papelera|favoritos|plantillas|distribuir/:id]`, `/alcanza[/escenarios|faltante]`, `/plan[/calendario|metas|proyeccion|programado|periodos]`, `/conciliar`, `/revision`, `/cambios`, `/pendientes`, `/buscar`, `/ajustes[/historial]`.

## Fórmulas vigentes (`docs/FORMULAS.md`)

- Saldo = saldo de referencia + movimientos realizados posteriores.
- **Disponible = saldo del presupuesto − pagos reservados hasta el próximo ingreso − apartados de metas.** Periodo = hasta el día anterior al próximo ingreso programado (sin ingreso, horizonte elegido). Por día = disponible ÷ días.
- Proyección de 30/60/90 días, escenarios sobre copia, «¿Qué cambió?» exacto al céntimo, plan ante faltante.

## Qué no existe hoy

Onboarding con selección de categorías; periodos de presupuesto (semana/quincena/mes/…); arrastre de saldo entre periodos; *safe to spend* por día/semana/periodo; grupos, iconos y colores de categorías; etiquetas; límites multicategoría con cierre y recurrencia; aportes a metas con sugerencia diaria; estadísticas con comparación, top 5 y banda de proyección; parser de texto/voz/foto; notificaciones; copias automáticas locales; bloqueo biométrico/PIN; exportar CSV/PDF; cuenta, sincronización y Pro; `pt`/`fr`; componentes `BottomSheet`, `CoachMark`, `FAB`, `Skeleton`, `SearchBar`, `TimePickerRow`, `CategoryChip`.
