import { describe, expect, it } from 'vitest'
import { computeBudget } from '../domain/budget'
import { createInitialData, deleteTransaction, restoreFromTrash, saveTransaction } from '../domain/operations'
import { projectBalance } from '../domain/projection'
import { backupStatus } from '../domain/backupReminder'
import { createDemoData } from '../demo/demoData'
import { baseData, bill, ctx, NOW, TODAY, tx, TZ } from '../test/fixtures'
import { backupFileName, backupText as fileText, createBackup, parseBackup, performExport, validateAppData } from './backup'
import { recordHistory } from '../domain/history'
import { SCHEMA_VERSION } from '../domain/types'
import { LocalStorageRepository, MemoryRepository, PRE_MIGRATION_KEY_PREFIX, STORAGE_KEY } from './localStorageRepository'

const backupText = (data = baseData({ transactions: [tx({ id: 't1' })] })) => JSON.stringify(createBackup(data, new Date(NOW), '0.1.0'))

describe('copias de seguridad', () => {
  it('exportar e importar conserva los datos', () => {
    const data = baseData({ transactions: [tx({ id: 't1', note: 'Café' })] })
    const r = parseBackup(backupText(data))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toEqual(data)
      expect(r.exportedAt).toBe(NOW)
    }
  })

  it('rechaza archivos que no son JSON o no son copias de la app', () => {
    expect(parseBackup('esto no es json')).toMatchObject({ ok: false, issues: [{ code: 'invalidJson' }] })
    expect(parseBackup('{"hola":1}')).toMatchObject({ ok: false, issues: [{ code: 'notABackup' }] })
    expect(parseBackup('[]')).toMatchObject({ ok: false, issues: [{ code: 'notABackup' }] })
  })

  it('rechaza versiones más nuevas que la app', () => {
    const file = JSON.parse(backupText())
    file.data.schemaVersion = 99
    expect(parseBackup(JSON.stringify(file))).toMatchObject({ ok: false, issues: [{ code: 'schemaTooNew' }] })
  })

  it('rechaza importes con decimales, negativos o de otra moneda', () => {
    const cases: [string, unknown, string][] = [
      ['amountMinor', 12.5, 'invalidAmount'],
      ['amountMinor', -300, 'amountNotPositive'],
      ['amountMinor', '1000', 'invalidAmount'],
      ['currency', 'USD', 'currencyMismatch'],
      ['accountId', 'no-existe', 'unknownAccount'],
      ['date', '2026-02-30', 'invalidDate'],
      ['kind', 'creditCardPayment', 'invalidValue'],
    ]
    for (const [field, value, code] of cases) {
      const file = JSON.parse(backupText())
      file.data.transactions[0][field] = value
      const r = parseBackup(JSON.stringify(file))
      expect(r.ok, `${field}=${String(value)}`).toBe(false)
      if (!r.ok) expect(r.issues.map((i) => i.code)).toContain(code)
    }
  })

  it('rechaza ids duplicados y ocurrencias liquidadas dos veces', () => {
    const dupIds = baseData({ transactions: [tx({ id: 'same' }), tx({ id: 'same' })] })
    expect(validateAppData(dupIds)).toMatchObject({ ok: false })
    const doublePaid = baseData({
      transactions: [
        tx({ id: 'a', scheduleId: 'rent', occurrenceDate: '2026-09-01', date: '2026-09-01' }),
        tx({ id: 'b', scheduleId: 'rent', occurrenceDate: '2026-09-01', date: '2026-09-01' }),
      ],
    })
    expect(validateAppData(doublePaid)).toMatchObject({ ok: false })
  })

  it('no cambia nada si la importación falla y descarta campos desconocidos', () => {
    const file = JSON.parse(backupText())
    file.data.transactions[0].campoRaro = 'x'
    file.data.__proto__ = { hacked: true }
    const r = parseBackup(JSON.stringify(file))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect('campoRaro' in r.data.transactions[0]!).toBe(false)
      expect(({} as Record<string, unknown>).hacked).toBeUndefined()
    }
  })

  it('exige al menos una cuenta', () => {
    const file = JSON.parse(backupText(baseData({ accounts: [] })))
    expect(parseBackup(JSON.stringify(file))).toMatchObject({ ok: false })
  })
})

describe('guardado y recuperación', () => {
  it('guardar repetidamente y recargar devuelve exactamente lo mismo', async () => {
    const repo = new MemoryRepository()
    let data = baseData()
    const draft = { id: 'fixed-id', kind: 'expense' as const, status: 'realized' as const, amountMinor: 1234, date: TODAY, accountId: 'main', categoryId: 'dining' }
    for (let i = 0; i < 5; i++) {
      const r = saveTransaction(data, draft, ctx)
      if (!r.ok) throw new Error('rechazado')
      data = r.data
      await repo.save(data)
    }
    expect(data.transactions).toHaveLength(1)
    const loaded = await repo.load()
    expect(loaded).toEqual({ status: 'ok', data })
  })

  it('eliminar y deshacer restaura el mismo registro y su vínculo de devolución', () => {
    const purchase = tx({ id: 'buy', amountMinor: 5000 })
    const refund = tx({ id: 'ref', kind: 'refund', categoryId: 'groceries', amountMinor: 1000, refundOfId: 'buy' })
    const data = baseData({ transactions: [purchase, refund] })
    const del = deleteTransaction(data, 'buy', ctx)
    if (!del.ok) throw new Error('rechazado')
    expect(del.data.transactions.find((t) => t.id === 'ref')?.refundOfId).toBeUndefined()
    expect(validateAppData(del.data).ok).toBe(true)
    const undo = restoreFromTrash(del.data, 'buy', ctx)
    if (!undo.ok) throw new Error('rechazado')
    expect(undo.data.transactions.find((t) => t.id === 'ref')?.refundOfId).toBe('buy')
    const undoAgain = restoreFromTrash(undo.data, 'buy', ctx)
    expect(undoAgain.ok && undoAgain.data.transactions.length).toBe(2)
  })
})

describe('datos iniciales y demostración', () => {
  it('la configuración inicial crea cuenta, ingreso, pagos y reserva válidos', () => {
    const r = createInitialData(
      {
        currency: 'CAD',
        timeZone: TZ,
        numberLocale: 'es-MX',
        language: 'es',
        accountName: 'Mi banco',
        balanceMinor: 120000,
        balanceDate: TODAY,
        income: { name: 'Sueldo', amountMinor: 80000, date: '2026-10-09', frequency: 'biweekly', isEstimate: false },
        fallbackHorizonDays: null,
        bills: [{ name: 'Renta', amountMinor: 60000, date: '2026-10-01', frequency: 'monthly' }],
        reserve: { amountMinor: 20000, fundedFrom: 'budget', name: 'Reserva de emergencia' },
        periodType: 'untilIncome',
      },
      ctx,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(validateAppData(r.data).ok).toBe(true)
    expect(r.data.settings.onboardingDone).toBe(true)
    const b = computeBudget(r.data, TODAY)
    expect(b.availableMinor).toBe(120000 - 60000 - 20000)
    expect(b.horizon?.days).toBe(11)
    // Sin indicar periodo, las instalaciones nuevas son mensuales (§7.1) y el periodo cuenta hoy.
    const monthly = createInitialData({ currency: 'CAD', timeZone: TZ, numberLocale: 'es-MX', language: 'es', accountName: 'Mi banco', balanceMinor: 120000, balanceDate: TODAY, income: null, fallbackHorizonDays: null, bills: [], reserve: null }, ctx)
    expect(monthly.ok && monthly.data.settings.budgetPeriod.type).toBe('month')
    expect(monthly.ok && computeBudget(monthly.data, TODAY).period).toMatchObject({ start: '2026-09-01', end: '2026-09-30', daysLeft: 3 })
  })

  it('los datos de demostración existen en inglés con los mismos importes', () => {
    const now = new Date('2026-09-28T12:00:00-04:00')
    const en = createDemoData({ now, timeZone: TZ, language: 'en' })
    expect(validateAppData(en).ok).toBe(true)
    expect(en.settings.language).toBe('en')
    expect(en.accounts[0]!.name).toBe('Chequing account')
    expect(computeBudget(en, '2026-09-28').availableMinor).toBe(computeBudget(createDemoData({ now, timeZone: TZ }), '2026-09-28').availableMinor)
  })

  it('los datos de demostración son válidos y muestran un posible faltante', () => {
    for (const hour of ['04:30', '12:00', '23:59']) {
      const now = new Date(`2026-09-28T${hour}:00-04:00`)
      const demo = createDemoData({ now, timeZone: TZ })
      const v = validateAppData(demo)
      expect(v.ok, JSON.stringify(!v.ok && v.issues)).toBe(true)
      expect(demo.isDemo).toBe(true)
      const b = computeBudget(demo, '2026-09-28')
      expect(b.status).toBe('ok')
      expect(b.horizon?.days).toBe(6)
      expect(b.overdueBills).toHaveLength(1)
      expect(b.availableMinor).toBeGreaterThan(0)
      const p = projectBalance(demo, '2026-09-28', { dailySpendMinor: 1400 })
      expect(p.firstNegativeDate).not.toBeNull()
    }
  })
})

describe('migraciones', () => {
  it('una copia de la versión 1 se migra a la actual (categorías y límites vacíos)', () => {
    const v1 = JSON.parse(JSON.stringify(baseData())) as Record<string, unknown>
    v1.schemaVersion = 1
    delete v1.categories
    const r = validateAppData(v1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.schemaVersion).toBe(SCHEMA_VERSION)
      expect(r.data.categoryRules).toEqual([])
      expect(r.data.categories).toEqual([])
      expect(r.data.categoryLimits).toEqual([])
    }
  })

  it('una copia v4 real (sin papelera, favoritos, conciliaciones ni registro de copias) se migra sin perder nada', () => {
    const v4: Record<string, unknown> = JSON.parse(
      JSON.stringify(
        baseData({
          transactions: [tx({ id: 'keep', amountMinor: 1234, categoryId: 'dining', importRef: 'main|2026-09-28|-1234|cafe|1' })],
          schedules: [bill('2026-10-01', 5000, { id: 'phone' })],
        }),
      ),
    )
    v4.schemaVersion = 4
    for (const key of ['trash', 'purgedImportRefs', 'favorites', 'reconciliations', 'backup']) delete v4[key]
    const r = validateAppData(v4)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data).toMatchObject({ schemaVersion: SCHEMA_VERSION, templates: [], history: [], inbox: { snoozed: [], dismissed: [] }, incomeDistributions: [], periodBudgets: [], scenarios: [], trash: [], purgedImportRefs: [], favorites: [], reconciliations: [], backup: { reminder: 'weekly' } })
    expect(r.data.transactions).toEqual((v4.transactions as unknown[]))
    expect(r.data.schedules).toEqual((v4.schedules as unknown[]))
    expect(backupStatus(r.data, TODAY).neverExported).toBe(true)
  })

  it('una copia v5 se migra a v6 sin perder nada: metas antiguas intactas y revisión semanal activada', () => {
    const v5: Record<string, unknown> = JSON.parse(
      JSON.stringify(
        baseData({
          transactions: [tx({ id: 'keep', amountMinor: 1234 })],
          goals: [{ id: 'g', name: 'Viaje', kind: 'goal', targetMinor: 50000, currency: 'CAD', fundedFrom: 'budget', allocations: [{ id: 'a', amountMinor: 1000, date: TODAY, createdAt: NOW }], createdAt: NOW, updatedAt: NOW }],
        }),
      ),
    )
    v5.schemaVersion = 5
    delete v5.periodBudgets
    delete v5.scenarios
    delete (v5.settings as Record<string, unknown>).weeklyReview
    const r = validateAppData(v5)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data).toMatchObject({ schemaVersion: SCHEMA_VERSION, periodBudgets: [], scenarios: [], settings: { weeklyReview: true } })
    expect(r.data.goals).toEqual(v5.goals)
    expect(r.data.transactions).toEqual(v5.transactions)
  })

  it('migrar a v6 respeta la preferencia existente y nunca borra datos mal formados: se rechazan', () => {
    const off: Record<string, unknown> = JSON.parse(JSON.stringify(baseData({ settings: { ...baseData().settings, weeklyReview: false } })))
    off.schemaVersion = 5
    delete off.periodBudgets
    delete off.scenarios
    const r = validateAppData(off)
    expect(r.ok && r.data.settings.weeklyReview).toBe(false)
    const bad: Record<string, unknown> = JSON.parse(JSON.stringify(baseData()))
    bad.schemaVersion = 5
    bad.periodBudgets = 'no es una lista'
    expect(validateAppData(bad).ok).toBe(false)
  })

  it('una copia v4 dentro de un archivo de respaldo también se importa', () => {
    const v4: Record<string, unknown> = JSON.parse(JSON.stringify(baseData()))
    v4.schemaVersion = 4
    delete v4.trash
    delete v4.backup
    const file = JSON.stringify({ format: 'margen-backup', formatVersion: 1, exportedAt: NOW, app: 'Margen', appVersion: '0.1.0', data: v4 })
    expect(parseBackup(file)).toMatchObject({ ok: true, exportedAt: NOW })
  })

  it('al cargar datos antiguos del navegador se guarda una copia intacta antes de migrar', async () => {
    const store = new Map<string, string>()
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    const original = (globalThis as { localStorage?: unknown }).localStorage
    ;(globalThis as { localStorage?: unknown }).localStorage = fake
    try {
      const v4: Record<string, unknown> = JSON.parse(JSON.stringify(baseData()))
      v4.schemaVersion = 4
      delete v4.trash
      const raw = JSON.stringify(v4)
      store.set(STORAGE_KEY, raw)
      const repo = new LocalStorageRepository()
      const loaded = await repo.load()
      expect(loaded.status).toBe('ok')
      // Los datos originales no se sobrescriben al cargar; la copia previa conserva el texto exacto.
      expect(store.get(STORAGE_KEY)).toBe(raw)
      expect(JSON.parse(store.get(`${PRE_MIGRATION_KEY_PREFIX}${SCHEMA_VERSION}`)!)).toEqual({ fromVersion: 4, raw })
      // Datos y recuperación la lee por el repositorio (la misma copia, tal cual).
      expect(JSON.parse((await repo.preMigrationCopy())!)).toEqual({ fromVersion: 4, raw })
      // Datos de una versión futura: se informan como no legibles y no se tocan.
      const future = JSON.stringify({ ...v4, schemaVersion: 99 })
      store.set(STORAGE_KEY, future)
      expect((await repo.load()).status).toBe('corrupt')
      expect(store.get(STORAGE_KEY)).toBe(future)
    } finally {
      ;(globalThis as { localStorage?: unknown }).localStorage = original
    }
  })

  it('una versión futura se rechaza sin tocar nada; una migración que falla también', () => {
    const future = { ...JSON.parse(JSON.stringify(baseData())), schemaVersion: 99 }
    expect(validateAppData(future)).toMatchObject({ ok: false, issues: [{ code: 'schemaTooNew' }] })
    // Una v4 con papelera mal formada no se "arregla" borrando: se rechaza.
    const broken = { ...JSON.parse(JSON.stringify(baseData())), schemaVersion: 4, trash: 'no es una lista' }
    expect(validateAppData(broken).ok).toBe(false)
  })

  it('la papelera, los favoritos y las conciliaciones de una copia se validan', () => {
    const good = baseData({
      trash: [{ id: 'gone', deletedAt: NOW, transaction: tx({ id: 'gone' }), unlinkedRefundIds: [] }],
      favorites: [{ id: 'fav', name: 'Café', kind: 'expense', accountId: 'main', categoryId: 'dining', order: 0, createdAt: NOW, updatedAt: NOW }],
    })
    expect(validateAppData(JSON.parse(JSON.stringify(good))).ok).toBe(true)
    const badTrash = { ...JSON.parse(JSON.stringify(good)), trash: [{ id: 'gone', deletedAt: NOW, transaction: { ...tx({ id: 'gone' }), amountMinor: 1.5 }, unlinkedRefundIds: [] }] }
    expect(validateAppData(badTrash)).toMatchObject({ ok: false, issues: [{ path: 'trash[0].transaction.amountMinor' }] })
    const clash = { ...JSON.parse(JSON.stringify(good)), transactions: [tx({ id: 'gone' })] }
    expect(validateAppData(clash)).toMatchObject({ ok: false, issues: [{ path: 'trash[0].id', code: 'duplicateId' }] })
    const badFav = { ...JSON.parse(JSON.stringify(good)), favorites: [{ ...good.favorites[0], amountMinor: -5 }] }
    expect(validateAppData(badFav).ok).toBe(false)
    const badRec = {
      ...JSON.parse(JSON.stringify(good)),
      reconciliations: [{ id: 'r', accountId: 'main', date: TODAY, observedMinor: 100, computedMinor: 50, differenceMinor: 10, resolution: 'unresolved', fingerprint: 'x', createdAt: NOW, updatedAt: NOW }],
    }
    expect(validateAppData(badRec)).toMatchObject({ ok: false, issues: [{ path: 'reconciliations[0].differenceMinor' }] })
  })

  it('conserva datos de tarjeta y categorías al exportar e importar', () => {
    const data = baseData({
      accounts: [
        baseData().accounts[0]!,
        { ...baseData().accounts[0]!, id: 'visa', kind: 'credit', card: { limitMinor: 50000, aprBps: 1999, dueDay: 15 } },
      ],
      categories: [{ id: 'c_pets', name: 'Mascotas', kind: 'expense', archived: false, createdAt: NOW, updatedAt: NOW }],
      categoryLimits: [{ categoryId: 'c_pets', monthlyLimitMinor: 5000 }],
    })
    const r = parseBackup(JSON.stringify(createBackup(data, new Date(NOW), '0.2.0')))
    expect(r.ok && r.data).toEqual(data)
  })

  it('rechaza datos de tarjeta en cuentas que no son tarjeta', () => {
    const data = baseData({ accounts: [{ ...baseData().accounts[0]!, card: { limitMinor: 1 } }] })
    expect(validateAppData(data).ok).toBe(false)
  })
})

describe('migración v7 → v8', () => {
  it('añade plantillas e historial vacíos y fija desde cuándo hay historial; no cambia nada más', () => {
    const v7: Record<string, unknown> = JSON.parse(JSON.stringify(baseData({ transactions: [tx({ id: 't1' })] })))
    v7.schemaVersion = 7
    delete v7.templates
    delete v7.history
    delete v7.historyStartedAt
    v7.updatedAt = '2026-09-27T10:00:00.000Z'
    const r = validateAppData(v7)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toMatchObject({ schemaVersion: SCHEMA_VERSION, templates: [], history: [], historyStartedAt: '2026-09-27T10:00:00.000Z' })
    expect(r.data.transactions).toEqual(baseData({ transactions: [tx({ id: 't1' })] }).transactions)
  })

  it('un historial o una plantilla mal formados se rechazan (no se borran)', () => {
    const bad = JSON.parse(JSON.stringify(baseData()))
    bad.history = [{ id: 'h', at: 'ayer', source: 'app', changes: [] }]
    expect(validateAppData(bad)).toMatchObject({ ok: false, issues: [{ path: 'history[0].at' }] })
    const badTpl = JSON.parse(JSON.stringify(baseData()))
    badTpl.templates = [{ id: 't', name: 'X', kind: 'split', lines: [{ categoryId: 'dining', amount: { mode: 'percent', bps: 12000 } }], createdAt: NOW, updatedAt: NOW }]
    expect(validateAppData(badTpl).ok).toBe(false)
  })
})

describe('migración v8 → v9 (Clara v2)', () => {
  function v8Backup(): Record<string, unknown> {
    const data = baseData({
      categories: [{ id: 'c_pets', name: 'Mascotas', kind: 'expense', archived: false, createdAt: NOW, updatedAt: NOW }],
      categoryLimits: [{ categoryId: 'c_pets', monthlyLimitMinor: 5000 }],
      transactions: [tx({ id: 't1' })],
    })
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(data))
    raw.schemaVersion = 8
    for (const k of ['categoryPrefs', 'categoryGroups', 'tags', 'plans', 'profile']) delete raw[k]
    const settings = raw.settings as Record<string, unknown>
    for (const k of ['budgetPeriod', 'carryOverBalance', 'safeToSpend', 'notifications', 'biometricLock', 'onboardingDone', 'toursSeen', 'proStatus', 'aiUsage']) delete settings[k]
    const cat = (raw.categories as Record<string, unknown>[])[0]!
    for (const k of ['groupId', 'icon', 'color', 'sortOrder']) delete cat[k]
    return raw
  }

  it('rellena ajustes, colecciones y aspecto de categorías; los datos existentes conservan su fórmula', () => {
    const r = validateAppData(v8Backup())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      categoryPrefs: {},
      categoryGroups: [],
      tags: [],
      profile: { id: 'guest', isGuest: true },
      settings: { budgetPeriod: { type: 'untilIncome' }, carryOverBalance: true, onboardingDone: true, toursSeen: [] },
    })
    // Lo que ya existía no cambia: movimientos y la categoría personalizada. El límite mensual
    // llega a v10 convertido en un plan recurrente (ver la migración v9 → v10).
    expect(r.data.categoryLimits).toEqual([])
    expect(r.data.plans).toMatchObject([{ id: 'limit_c_pets', categoryIds: ['c_pets'], amountMinor: 5000, periodType: 'month', recurring: true, status: 'active', name: '' }])
    expect(r.data.transactions).toEqual(baseData({ transactions: [tx({ id: 't1' })] }).transactions)
    expect(r.data.categories[0]).toMatchObject({ id: 'c_pets', name: 'Mascotas', groupId: 'other', icon: 'tag', sortOrder: 1000 })
    expect(typeof r.data.categories[0]!.color).toBe('string')
  })

  it('una copia v8 con una categoría personalizada mal formada se rechaza (no se borra)', () => {
    const raw = v8Backup()
    ;(raw.categories as Record<string, unknown>[])[0]!.kind = 'other'
    expect(validateAppData(raw).ok).toBe(false)
  })

  it('v9 → v10: los límites bien formados pasan a planes mensuales; los mal formados se conservan y se señalan', () => {
    const data = baseData({ categoryLimits: [{ categoryId: 'dining', monthlyLimitMinor: 20000 }, { categoryId: 'transport', monthlyLimitMinor: 0 }] })
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(data))
    raw.schemaVersion = 9
    const r = validateAppData(raw)
    // El límite 0 no es válido: se conserva en categoryLimits y la validación lo rechaza (no se borra).
    expect(r.ok).toBe(false)
    const good = JSON.parse(JSON.stringify(baseData({ categoryLimits: [{ categoryId: 'dining', monthlyLimitMinor: 20000 }], plans: [] })))
    good.schemaVersion = 9
    const ok = validateAppData(good)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.data.schemaVersion).toBe(SCHEMA_VERSION)
    expect(ok.data.categoryLimits).toEqual([])
    expect(ok.data.plans).toMatchObject([{ id: 'limit_dining', kind: 'limit', categoryIds: ['dining'], amountMinor: 20000, currency: 'CAD', periodType: 'month', recurring: true, alertAt80: true, alertAt100: true, createdAt: good.updatedAt }])
    expect(ok.data.plans[0]!.startDate).toBeUndefined()
    // Una copia v10 con un plan igual no lo duplica ni toca categoryLimits ya vacíos.
    const again = validateAppData(JSON.parse(JSON.stringify(ok.data)))
    expect(again.ok && again.data.plans).toHaveLength(1)
  })

  it('un plan o una etiqueta mal formados en v9 se rechazan', () => {
    const bad = JSON.parse(JSON.stringify(baseData()))
    bad.plans = [{ id: 'p', name: 'Comer fuera', kind: 'limit', categoryIds: ['dining'], amountMinor: -1, currency: 'CAD', periodType: 'month', recurring: true, status: 'active', alertAt80: true, alertAt100: true, createdAt: NOW, updatedAt: NOW }]
    expect(validateAppData(bad)).toMatchObject({ ok: false, issues: [{ path: expect.stringMatching(/^plans\[0\]/) }] })
    const badTag = JSON.parse(JSON.stringify(baseData()))
    badTag.tags = [{ id: 'g', name: '', createdAt: NOW, updatedAt: NOW }]
    expect(validateAppData(badTag).ok).toBe(false)
  })
})

describe('copia sin fotos de recibos', () => {
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(4000)
  function withReceipts() {
    const d0 = baseData()
    const a = saveTransaction(d0, { ...tx({ id: 'r1', date: TODAY }), receiptUri: photo }, ctx)
    if (!a.ok) throw new Error('a')
    const d1 = recordHistory(d0, a.data, NOW)
    const b = saveTransaction(d1, { ...tx({ id: 'r2', date: TODAY }), receiptUri: photo }, ctx)
    if (!b.ok) throw new Error('b')
    const d2 = recordHistory(d1, b.data, NOW)
    const c = deleteTransaction(d2, 'r2', ctx)
    if (!c.ok) throw new Error('c')
    return recordHistory(d2, c.data, NOW)
  }

  it('no deja ninguna foto en movimientos, papelera ni historial, y lo dice en el archivo', () => {
    const data = withReceipts()
    const full = fileText(data, new Date(NOW), '0.1.0')
    // Las fotos están en el movimiento, en la papelera y en varias entradas del historial.
    expect(full.split(photo).length - 1).toBeGreaterThanOrEqual(4)
    const light = fileText(data, new Date(NOW), '0.1.0', { withoutReceipts: true })
    expect(light).not.toContain('receiptUri')
    expect(light.length).toBeLessThan(full.length - 4 * 4000)
    expect(JSON.parse(light).omitted).toEqual(['receipts'])
    expect(JSON.parse(full).omitted).toBeUndefined()
  })

  it('se puede restaurar: los mismos registros sin foto, y la importación lo avisa', () => {
    const data = withReceipts()
    const r = parseBackup(fileText(data, new Date(NOW), '0.1.0', { withoutReceipts: true }))
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.withoutReceipts).toBe(true)
    expect(r.data.transactions.map((t) => t.id)).toEqual(data.transactions.map((t) => t.id))
    expect(r.data.transactions.every((t) => t.receiptUri === undefined)).toBe(true)
    expect(r.data.trash.map((e) => e.id)).toEqual(['r2'])
    expect(r.data.history.length).toBe(data.history.length)
    // Mismas cifras: la foto nunca participa en cálculos.
    expect(computeBudget(r.data, TODAY).availableMinor).toBe(computeBudget(data, TODAY).availableMinor)
    const normal = parseBackup(fileText(data, new Date(NOW), '0.1.0'))
    expect(normal.ok && normal.withoutReceipts).toBe(false)
    expect(normal.ok && normal.data).toEqual(data)
  })

  it('performExport usa un nombre distinto para la copia sin fotos', () => {
    let name = ''
    const r = performExport(withReceipts(), new Date(NOW), '0.1.0', (n) => (name = n), { withoutReceipts: true })
    expect(r.ok).toBe(true)
    expect(name).toBe(backupFileName(new Date(NOW), false, true))
    expect(name).toContain('sin-fotos')
  })
})
