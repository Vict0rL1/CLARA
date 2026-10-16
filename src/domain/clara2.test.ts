/**
 * Clara 2.0 · fase 1 (cimientos): colchón de seguridad, esquema 13 y lo que se añada en esta fase.
 * Cada bloque fija el contrato con datos sintéticos.
 */
import { describe, expect, it } from 'vitest'
import { simulatePurchase } from './affordability'
import { computeBudget } from './budget'
import { committedFor, safeToSpend } from './periods'
import { createInitialData, deleteCategoryRules, saveAccount, saveCategoryRule, saveCategoryRules, saveSchedule, saveTransaction, updateSettings } from './operations'
import { allAccountBalances } from './balances'
import { DEFAULT_NOTIFICATIONS } from './defaults'
import { dueNotices } from './notifications'
import { closeDuePlans, planAlertLevels, planAlerts, savePlan } from './plans'
import { explainRuleMatch, suggestRuleFromCorrection, suggestRulesFromCorrections } from './rules'
import { canRevert, recordHistory, revertEntry } from './history'
import { whatChanged } from './whatChanged'
import { defaultSecondDay, nthOccurrence, occurrencesBetween, scanOccurrences } from './recurrence'
import type { AppData, Schedule } from './types'
import { isValidSecondDay, validateSchedule } from './validation'
import { SCHEMA_VERSION } from './types'
import { createBackup, parseBackup, validateAppData } from '../storage/backup'
import { MIGRATIONS, migrate } from '../storage/migrations'
import { account, baseData, bill, ctx, goal, income, schedule, tx } from '../test/fixtures'

const withBuffer = (d: AppData, bufferMinor: number): AppData => ({ ...d, settings: { ...d.settings, safeToSpend: { ...d.settings.safeToSpend, bufferMinor } } })

function sample(): AppData {
  return baseData({
    accounts: [account({ id: 'main', name: 'Cheques', anchor: { amountMinor: 200000, date: '2026-09-01', setAt: '2026-09-01T12:00:00.000Z' } })],
    schedules: [bill('2026-10-05', 50000, { id: 'rent', name: 'Renta' })],
    goals: [goal({ id: 'g', name: 'Viaje', targetMinor: 100000, allocations: [{ id: 'a1', amountMinor: 30000, date: '2026-09-10', createdAt: '2026-09-10T12:00:00.000Z', reason: 'contribution' }] })],
    settings: { ...baseData().settings, fallbackHorizonDays: 10 },
  })
}

describe('Clara 2.0 §10 · colchón de seguridad en «Puedes gastar»', () => {
  it('sin colchón (0) las cifras son las de siempre', () => {
    const d = sample()
    expect(d.settings.safeToSpend.bufferMinor).toBe(0)
    const b = computeBudget(d, ctx.today)
    expect(b.safetyBufferMinor).toBe(0)
    expect(b.availableMinor).toBe(b.baseMinor - b.reservedTotalMinor - b.goalsReservedMinor)
  })

  it('el colchón se resta del disponible y del importe por día y por semana; no toca saldos ni el gasto', () => {
    const d = sample()
    const before = computeBudget(d, ctx.today)
    const after = computeBudget(withBuffer(d, 15000), ctx.today)
    expect(after.safetyBufferMinor).toBe(15000)
    expect(after.availableMinor).toBe(before.availableMinor - 15000)
    // Disponible = base − pagos reservados − apartados − colchón, al céntimo.
    expect(after.availableMinor).toBe(after.baseMinor - after.reservedTotalMinor - after.goalsReservedMinor - after.safetyBufferMinor)
    expect(after.spendableMinor).toBe(before.spendableMinor)
    expect(after.dailyMinor).toBe(Math.floor(after.availableMinor / after.horizon!.days))
    expect(after.weeklyMinor).toBeLessThan(before.weeklyMinor!)
  })

  it('un colchón mayor que lo que queda deja el disponible en negativo y el importe por día en 0 (nunca se divide un negativo)', () => {
    const after = computeBudget(withBuffer(sample(), 10_000_000), ctx.today)
    expect(after.availableMinor).toBeLessThan(0)
    expect(after.dailyMinor).toBe(0)
    expect(after.weeklyMinor).toBe(0)
  })

  it('el «safe to spend» del periodo también lo resta siempre, aunque no se resten programados ni metas', () => {
    const settings = { ...sample().settings.safeToSpend, subtractScheduled: false, subtractGoalContributions: false, bufferMinor: 2500 }
    expect(committedFor(settings, 50000, 30000)).toBe(2500)
    expect(committedFor({ ...settings, subtractScheduled: true, subtractGoalContributions: true }, 50000, 30000)).toBe(82500)
    expect(safeToSpend(10000, committedFor(settings, 0, 0), 5).perDayMinor).toBe(1500)
  })

  it('«¿Me alcanza?» dice si solo cabe usando el colchón, y sin colchón los veredictos no cambian', () => {
    const d = sample()
    const base = computeBudget(d, ctx.today).availableMinor
    const buffered = withBuffer(d, 20000)
    expect(simulatePurchase(buffered, ctx.today, base - 10000).verdict).toBe('onlyWithBuffer')
    expect(simulatePurchase(buffered, ctx.today, base + 10000).verdict).toBe('onlyWithGoals')
    expect(simulatePurchase(buffered, ctx.today, base + 100000).verdict).toBe('doesNotFit')
    expect(simulatePurchase(d, ctx.today, base + 10000).verdict).toBe('onlyWithGoals')
  })

  it('se guarda con la operación de ajustes, se valida y sobrevive a una copia', () => {
    const r = updateSettings(sample(), { safeToSpend: { ...sample().settings.safeToSpend, bufferMinor: 12345 } }, ctx)
    if (!r.ok) throw new Error('settings')
    expect(r.data.settings.safeToSpend.bufferMinor).toBe(12345)
    const parsed = parseBackup(JSON.stringify(createBackup(r.data, new Date(ctx.now), '1.0.0')))
    expect(parsed.ok && parsed.data.settings.safeToSpend.bufferMinor).toBe(12345)
    for (const bad of [-1, 1.5, Number.NaN, 2_000_000_000_000]) {
      const v = validateAppData(JSON.parse(JSON.stringify(withBuffer(sample(), bad))))
      expect(v.ok, String(bad)).toBe(false)
    }
  })

  it('«¿Qué cambió?» atribuye el cambio del colchón a «ajustes», sin parte sin explicar, y se puede revertir', () => {
    const DAY2 = { today: '2026-09-29', now: '2026-09-29T15:00:00.000Z' }
    const start = { ...sample(), historyStartedAt: '2026-09-20T12:00:00.000Z' }
    const r = updateSettings(start, { safeToSpend: { ...start.settings.safeToSpend, bufferMinor: 5000 } }, DAY2)
    if (!r.ok) throw new Error('settings')
    const d = recordHistory(start, r.data, DAY2.now)
    const w = whatChanged(d, '2026-09-29', { kind: 'date', date: '2026-09-29' })
    if (w.status !== 'ok') throw new Error(w.status)
    expect(w.totalMinor).toBe(-5000)
    expect(w.steps.map((s) => [s.category, s.deltaMinor])).toEqual([['settings', -5000]])
    expect(w.unexplainedMinor).toBe(0)
    const back = revertEntry(d, d.history[d.history.length - 1]!.id, DAY2)
    if (!back.ok) throw new Error(JSON.stringify(back.issues))
    expect(back.data.settings.safeToSpend.bufferMinor).toBe(0)
  })

  it('una entrada de ajustes anterior a v13 (sin `safeToSpend`) se sigue pudiendo revertir', () => {
    const DAY2 = { today: '2026-09-29', now: '2026-09-29T15:00:00.000Z' }
    const start = { ...sample(), historyStartedAt: '2026-09-20T12:00:00.000Z' }
    const r = updateSettings(start, { fallbackHorizonDays: 20 }, DAY2)
    if (!r.ok) throw new Error('settings')
    const d = recordHistory(start, r.data, DAY2.now)
    const entry = d.history[d.history.length - 1]!
    // Como la guardó la versión 12: solo moneda, zona horaria y horizonte.
    const old = { ...entry, changes: entry.changes.map((c) => {
      const strip = (v: unknown) => { const { safeToSpend: _s, ...rest } = v as Record<string, unknown>; return rest }
      return { ...c, before: strip(c.before), after: strip(c.after) }
    }) }
    const legacy = { ...d, history: [...d.history.slice(0, -1), old] }
    expect(canRevert(legacy, old)).toBe('ok')
    const back = revertEntry(legacy, old.id, DAY2)
    expect(back.ok && back.data.settings.fallbackHorizonDays).toBe(10)
    expect(back.ok && back.data.settings.safeToSpend).toEqual(start.settings.safeToSpend)
  })

  it('un gasto nuevo baja el disponible lo mismo con colchón que sin él', () => {
    const d = withBuffer(sample(), 5000)
    const r = saveTransaction(d, { id: 'tx1', kind: 'expense', status: 'realized', amountMinor: 1234, date: ctx.today, accountId: 'main', categoryId: 'dining' }, ctx)
    if (!r.ok) throw new Error('tx')
    expect(computeBudget(r.data, ctx.today).availableMinor).toBe(computeBudget(d, ctx.today).availableMinor - 1234)
  })
})

describe('Clara 2.0 · esquema 13 y su migración', () => {
  it('v12 → v13 rellena el colchón con 0 (nada cambia) y conserva todo lo demás', () => {
    const v12 = JSON.parse(JSON.stringify({ ...sample(), schemaVersion: 12 })) as Record<string, unknown>
    const settings = v12.settings as Record<string, Record<string, unknown>>
    delete settings.safeToSpend!.bufferMinor
    const out = MIGRATIONS[12]!(v12)
    expect(out.schemaVersion).toBe(13)
    expect((out.settings as Record<string, Record<string, unknown>>).safeToSpend!.bufferMinor).toBe(0)
    const { settings: _s, schemaVersion: _v, ...rest } = out
    const { settings: _t, schemaVersion: _w, ...restIn } = v12
    expect(rest).toEqual(restIn)
    expect(validateAppData(out).ok).toBe(true)
  })

  it('un colchón ya presente no se toca; ajustes mal formados se conservan tal cual', () => {
    const keep = MIGRATIONS[12]!({ schemaVersion: 12, settings: { safeToSpend: { bufferMinor: 777 } } })
    expect((keep.settings as Record<string, Record<string, unknown>>).safeToSpend!.bufferMinor).toBe(777)
    expect(MIGRATIONS[12]!({ schemaVersion: 12, settings: 'x' })).toEqual({ schemaVersion: 13, settings: 'x' })
    expect(MIGRATIONS[12]!({ schemaVersion: 12, settings: { safeToSpend: null } })).toEqual({ schemaVersion: 13, settings: { safeToSpend: null } })
  })

  it('`migrate` lleva datos de la versión 12 hasta la actual con las mismas cifras', () => {
    const d = sample()
    const old = JSON.parse(JSON.stringify({ ...d, schemaVersion: 12 })) as Record<string, unknown>
    delete (old.settings as Record<string, Record<string, unknown>>).safeToSpend!.bufferMinor
    const out = migrate(old)
    expect(out.schemaVersion).toBe(SCHEMA_VERSION)
    const v = validateAppData(out)
    expect(v.ok).toBe(true)
    if (v.ok) expect(computeBudget(v.data, ctx.today).availableMinor).toBe(computeBudget(d, ctx.today).availableMinor)
  })
})

describe('Clara 2.0 §12 · dos veces al mes', () => {
  const twice = (startDate: string, secondDay: number, extra: Partial<Schedule> = {}) => ({ frequency: 'semimonthly' as const, startDate, secondDay, ...extra })

  it('15 y último día: febrero pasa al 28 (o 29 en bisiesto) y el mes siguiente vuelve al 31', () => {
    expect(occurrencesBetween(twice('2027-01-15', 31), '2027-01-01', '2027-04-30')).toEqual([
      '2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31', '2027-04-15', '2027-04-30',
    ])
    expect(occurrencesBetween(twice('2028-02-15', 31), '2028-02-01', '2028-03-31')).toEqual(['2028-02-15', '2028-02-29', '2028-03-15', '2028-03-31'])
  })

  it('si empieza en el día mayor, la siguiente es el día menor del mes siguiente', () => {
    expect([0, 1, 2, 3].map((n) => nthOccurrence(twice('2026-09-30', 15), n))).toEqual(['2026-09-30', '2026-10-15', '2026-10-30', '2026-11-15'])
    // 1 y 16 empezando el 16 de diciembre: cruza el año.
    expect(occurrencesBetween(twice('2026-12-16', 1), '2026-12-01', '2027-01-31')).toEqual(['2026-12-16', '2027-01-01', '2027-01-16'])
  })

  it('respeta la fecha de fin y nunca da una fecha anterior al inicio ni repetida', () => {
    const rule = twice('2026-09-01', 15, { endDate: '2026-11-10' })
    const dates = occurrencesBetween(rule, '2026-01-01', '2027-12-31')
    expect(dates).toEqual(['2026-09-01', '2026-09-15', '2026-10-01', '2026-10-15', '2026-11-01'])
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('una ventana lejana da lo mismo que recorrer desde el principio (el salto inicial no pierde fechas)', () => {
    const rule = twice('2020-01-31', 14)
    const all = occurrencesBetween(rule, '2020-01-01', '2031-12-31')
    // 144 meses × 2, menos el día 14 de enero de 2020 (anterior al inicio).
    expect(all.length).toBe(144 * 2 - 1)
    for (const [from, to] of [['2026-02-27', '2026-03-16'], ['2031-12-01', '2031-12-31'], ['2024-02-14', '2024-02-29']] as const) {
      expect(occurrencesBetween(rule, from, to), `${from}…${to}`).toEqual(all.filter((d) => d >= from && d <= to))
    }
    expect(scanOccurrences(rule, '2020-01-01', '2031-12-31', 10).truncated).toBe(true)
  })

  it('segundo día por defecto: 15 después, o 15 antes si no cabe', () => {
    expect(defaultSecondDay('2026-10-01')).toBe(16)
    expect(defaultSecondDay('2026-10-16')).toBe(31)
    expect(defaultSecondDay('2026-10-17')).toBe(2)
    expect(defaultSecondDay('2026-10-31')).toBe(16)
  })

  it('validación: el segundo día es obligatorio, entero 1–31 y a ≥ 7 días; en otras frecuencias no se admite', () => {
    const data = baseData({ accounts: [account({ id: 'main' })] })
    const issues = (s: Schedule) => validateSchedule(s, { data }).map((i) => `${i.path}:${i.code}`)
    expect(issues(schedule(twice('2026-10-01', 15)))).toEqual([])
    for (const bad of [0, 32, 1.5, Number.NaN, 5, 7 - 6]) expect(issues(schedule(twice('2026-10-01', bad))), String(bad)).toContain('secondDay:semimonthlyDays')
    expect(issues(schedule({ frequency: 'semimonthly', startDate: '2026-10-01' }))).toContain('secondDay:semimonthlyDays')
    expect(issues(schedule(twice('2026-10-01', 8)))).toEqual([])
    expect(issues(schedule({ frequency: 'monthly', secondDay: 15 }))).toContain('secondDay:invalidValue')
  })

  it('guardar sin segundo día usa el de por defecto; cambiar a otra frecuencia lo quita', () => {
    const data = baseData({ accounts: [account({ id: 'main' })] })
    const draft = { id: 's1', name: 'Sueldo', kind: 'income' as const, amountMinor: 150000, amountIsEstimate: false, accountId: 'main', categoryId: 'salary', frequency: 'semimonthly' as const, startDate: '2026-10-01', reminderDaysBefore: 0 }
    const r = saveSchedule(data, draft, ctx)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value.secondDay).toBe(16)
    const r2 = saveSchedule(r.data, { ...draft, frequency: 'monthly', secondDay: 16 }, ctx)
    if (!r2.ok) throw new Error('monthly')
    expect(r2.value.secondDay).toBeUndefined()
    const bad = saveSchedule(data, { ...draft, secondDay: 3 }, ctx)
    expect(bad.ok).toBe(false)
  })

  it('un sueldo los días 1 y 15 fija el horizonte en el próximo cobro y sobrevive a una copia', () => {
    const d = baseData({
      accounts: [account({ id: 'main', anchor: { amountMinor: 90000, date: '2026-09-01', setAt: '2026-09-01T12:00:00.000Z' } })],
      schedules: [income('2026-10-01', 150000, { id: 'pay', frequency: 'semimonthly', secondDay: 15 })],
    })
    expect(validateAppData(JSON.parse(JSON.stringify(d))).ok).toBe(true)
    const b = computeBudget(d, ctx.today)
    expect(b.horizon?.source).toBe('income')
    expect(b.horizon?.endDate).toBe('2026-10-01')
    expect(b.horizon?.days).toBe(3)
    // El día del ingreso no cuenta y los ingresos futuros nunca se suman.
    expect(b.availableMinor).toBe(90000)
    const parsed = parseBackup(JSON.stringify(createBackup(d, new Date(ctx.now), '1.0.0')))
    expect(parsed.ok && parsed.data.schedules[0]!.secondDay).toBe(15)
  })

  it('la configuración inicial acepta ingreso y pagos dos veces al mes con su segundo día', () => {
    const base = { currency: 'CAD', timeZone: 'America/Toronto', numberLocale: 'es-MX' as const, language: 'es' as const, accountName: 'Banco', balanceMinor: 100000, balanceDate: ctx.today, fallbackHorizonDays: null, reserve: null }
    const r = createInitialData({
      ...base,
      income: { name: 'Sueldo', amountMinor: 150000, date: '2026-10-01', frequency: 'semimonthly', isEstimate: false, secondDay: 15 },
      bills: [{ name: 'Seguro', amountMinor: 2000, date: '2026-10-15', frequency: 'semimonthly', secondDay: 31 }],
      periodType: 'untilIncome',
    }, ctx)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const pay = r.data.schedules.find((x) => x.kind === 'income')!
    expect(pay).toMatchObject({ frequency: 'semimonthly', secondDay: 15 })
    expect(r.data.schedules.find((x) => x.kind === 'expense')).toMatchObject({ frequency: 'semimonthly', secondDay: 31 })
    expect(computeBudget(r.data, ctx.today).horizon?.endDate).toBe('2026-10-01')
    // Un segundo día que choca con el primero se rechaza con su ruta, sin crear nada a medias.
    const bad = createInitialData({ ...base, income: { name: 'Sueldo', amountMinor: 150000, date: '2026-10-01', frequency: 'semimonthly', isEstimate: false, secondDay: 4 }, bills: [] }, ctx)
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.issues.map((i) => i.path)).toContain('income.secondDay')
    // Otra frecuencia ignora un segundo día que se hubiera quedado escrito.
    const monthly = createInitialData({ ...base, income: { name: 'Sueldo', amountMinor: 150000, date: '2026-10-01', frequency: 'monthly', isEstimate: false, secondDay: 4 }, bills: [] }, ctx)
    expect(monthly.ok && monthly.data.schedules[0]!.secondDay).toBeUndefined()
  })

  it('isValidSecondDay: la misma regla que usan los formularios', () => {
    expect(isValidSecondDay('2026-10-01', 8)).toBe(true)
    expect(isValidSecondDay('2026-10-01', 7)).toBe(false)
    expect(isValidSecondDay('2026-10-31', 24)).toBe(true)
    expect(isValidSecondDay('2026-10-31', 25)).toBe(false)
    for (const bad of [0, 32, 1.5, Number.NaN, '15', undefined]) expect(isValidSecondDay('2026-10-01', bad), String(bad)).toBe(false)
    // Sin fecha válida solo se comprueba el rango (la fecha tiene su propio error).
    expect(isValidSecondDay('', 3)).toBe(true)
  })

  it('una programación v12 (sin `secondDay`) sigue siendo válida tras migrar', () => {
    const v12 = JSON.parse(JSON.stringify({ ...baseData({ accounts: [account({ id: 'main' })], schedules: [bill('2026-10-05', 1000, { frequency: 'monthly' })] }), schemaVersion: 12 })) as Record<string, unknown>
    delete (v12.settings as Record<string, Record<string, unknown>>).safeToSpend!.bufferMinor
    const v = validateAppData(migrate(v12))
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.data.schedules[0]!.secondDay).toBeUndefined()
  })
})

describe('Clara 2.0 §2 · tipos de cuenta (monedero, prepagada, inversión) e institución', () => {
  const opening = (kind: 'wallet' | 'prepaid' | 'investment', includeInBudget: boolean, institution?: string) =>
    ({ id: `acc-${kind}`, name: kind, kind, includeInBudget, institution, openingBalanceMinor: 25000, openingDate: '2026-09-01' })

  it('se crean como cualquier cuenta: su saldo es dinero propio (no deuda) y cuentan solo si se incluyen', () => {
    let d = sample()
    const before = computeBudget(d, ctx.today)
    for (const [kind, include] of [['wallet', true], ['prepaid', true], ['investment', false]] as const) {
      const r = saveAccount(d, opening(kind, include, kind === 'wallet' ? '  PayPal ' : undefined), ctx)
      if (!r.ok) throw new Error(JSON.stringify(r.issues))
      d = r.data
    }
    expect(d.accounts.find((a) => a.id === 'acc-wallet')!.institution).toBe('PayPal')
    expect(d.accounts.find((a) => a.id === 'acc-prepaid')!.institution).toBeUndefined()
    // Monedero y prepagada incluidos suman su saldo; la inversión excluida no cambia «Puedes gastar».
    expect(computeBudget(d, ctx.today).availableMinor).toBe(before.availableMinor + 50000)
    expect(allAccountBalances(d).find((b) => b.account.id === 'acc-investment')!.balanceMinor).toBe(25000)
    expect(validateAppData(JSON.parse(JSON.stringify(d))).ok).toBe(true)
    const parsed = parseBackup(JSON.stringify(createBackup(d, new Date(ctx.now), '1.0.0')))
    expect(parsed.ok && parsed.data.accounts.find((a) => a.id === 'acc-wallet')!.institution).toBe('PayPal')
  })

  it('un gasto con la prepagada y una recarga (transferencia) no crean ingresos ni gastos de más', () => {
    const r = saveAccount(sample(), opening('prepaid', false), ctx)
    if (!r.ok) throw new Error('acc')
    const top = saveTransaction(r.data, { id: 'top', kind: 'transfer', status: 'realized', amountMinor: 5000, date: ctx.today, accountId: 'main', toAccountId: 'acc-prepaid' }, ctx)
    if (!top.ok) throw new Error('top')
    const bal = (d: AppData, id: string) => allAccountBalances(d).find((b) => b.account.id === id)!.balanceMinor
    expect(bal(top.data, 'acc-prepaid')).toBe(30000)
    expect(bal(top.data, 'main')).toBe(bal(r.data, 'main') - 5000)
  })

  it('la institución se valida (texto ≤ 40) y un tipo desconocido se rechaza', () => {
    const r = saveAccount(sample(), { ...opening('wallet', true), institution: 'x'.repeat(41) }, ctx)
    expect(r.ok).toBe(false)
    const d = sample()
    const bad = JSON.parse(JSON.stringify({ ...d, accounts: [{ ...d.accounts[0], kind: 'crypto' }] }))
    expect(validateAppData(bad).ok).toBe(false)
    const badInst = JSON.parse(JSON.stringify({ ...d, accounts: [{ ...d.accounts[0], institution: 42 }] }))
    expect(validateAppData(badInst).ok).toBe(false)
  })

  it('pasar de monedero a tarjeta de crédito sigue prohibido (cambiaría el sentido del saldo)', () => {
    const r = saveAccount(sample(), opening('wallet', true), ctx)
    if (!r.ok) throw new Error('acc')
    const r2 = saveAccount(r.data, { ...opening('wallet', true), kind: 'credit' }, ctx)
    expect(r2.ok).toBe(false)
  })
})

describe('Clara 2.0 §11 · avisos de límites al 50/75/90/100 %', () => {
  const draft = { id: 'p1', name: 'Comer fuera', categoryIds: ['dining'], amountMinor: 20000, periodType: 'month' as const, recurring: true, alertAt80: true, alertAt100: true }
  const spending = (amountMinor: number) => baseData({ transactions: amountMinor > 0 ? [tx({ id: 'a', categoryId: 'dining', amountMinor })] : [] })
  const withPlan = (amountMinor: number, extra: Partial<typeof draft> & { alertLevels?: (50 | 75 | 90)[] } = {}) => {
    const r = savePlan(spending(amountMinor), { ...draft, ...extra }, ctx)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return r.data
  }
  const levelAt = (amountMinor: number, extra: Parameters<typeof withPlan>[1] = {}) => planAlerts(withPlan(amountMinor, extra), ctx.today).map((a) => a.level)

  it('sin avisos tempranos todo sigue igual que antes (80 y 100)', () => {
    expect(levelAt(9_999)).toEqual([])
    expect(levelAt(15_999)).toEqual([])
    expect(levelAt(16_000)).toEqual([80])
    expect(levelAt(19_999)).toEqual([80])
    expect(levelAt(20_000)).toEqual([100])
    expect(levelAt(25_000, { alertAt100: false })).toEqual([80])
  })

  it('con 50/75/90 activados avisa del umbral más alto alcanzado, exacto en el límite (enteros)', () => {
    const levels = { alertLevels: [90, 50, 75] as (50 | 75 | 90)[] }
    expect(levelAt(9_999, levels)).toEqual([])
    expect(levelAt(10_000, levels)).toEqual([50])
    expect(levelAt(14_999, levels)).toEqual([50])
    expect(levelAt(15_000, levels)).toEqual([75])
    expect(levelAt(16_000, levels)).toEqual([80])
    expect(levelAt(18_000, levels)).toEqual([90])
    expect(levelAt(20_000, levels)).toEqual([100])
    // Un salto del 40 % al 95 % avisa una sola vez, del umbral más alto.
    expect(levelAt(19_000, { ...levels, alertAt80: false })).toEqual([90])
    // Se guardan ordenados y sin repetir.
    const saved = withPlan(0, { alertLevels: [90, 50, 90] as (50 | 75 | 90)[] })
    expect(saved.plans[0]!.alertLevels).toEqual([50, 90])
    expect(planAlertLevels(saved.plans[0]!)).toEqual([50, 80, 90, 100])
  })

  it('una notificación por umbral y ciclo, con el porcentaje en el texto; apagadas en Ajustes no hay nada', () => {
    const d = withPlan(15_500, { alertLevels: [50, 75] })
    const fmt = { amount: (m: number) => String(m), name: () => 'x', planName: (p: { name: string }) => p.name }
    const settings = { ...DEFAULT_NOTIFICATIONS, planAlerts: true }
    expect(dueNotices(d, { today: ctx.today, now: '08:00', settings }, fmt)).toMatchObject([
      { key: 'plan75:p1:2026-09-01', kind: 'planLevel', titleKey: 'notify.planLevel.title', params: { name: 'Comer fuera', percent: '75', spent: '15500', limit: '20000' } },
    ])
    expect(dueNotices(d, { today: ctx.today, now: '08:00', settings: DEFAULT_NOTIFICATIONS }, fmt)).toEqual([])
  })

  it('editar sin tocar los avisos los conserva; una lista vacía los quita; la renovación los hereda', () => {
    const d = withPlan(0, { alertLevels: [75] })
    const edited = savePlan(d, { ...draft, amountMinor: 30000 }, ctx)
    expect(edited.ok && edited.value.alertLevels).toEqual([75])
    const cleared = savePlan(d, { ...draft, alertLevels: [] }, ctx)
    expect(cleared.ok && cleared.value.alertLevels).toBeUndefined()
    const closed = closeDuePlans(d, { today: '2026-10-01', now: '2026-10-01T12:00:00.000Z' })
    expect(closed.ok && closed.value.renewed[0]!.alertLevels).toEqual([75])
  })

  it('validación: solo 50/75/90, sin repetir; datos v12 sin `alertLevels` siguen siendo válidos', () => {
    const d = withPlan(0)
    expect(d.plans[0]!.alertLevels).toBeUndefined()
    expect(validateAppData(JSON.parse(JSON.stringify(d))).ok).toBe(true)
    for (const bad of [[80], [60], [50, 50], '50', [Number.NaN]]) {
      const broken = JSON.parse(JSON.stringify({ ...d, plans: [{ ...d.plans[0], alertLevels: bad }] }))
      expect(validateAppData(broken).ok, JSON.stringify(bad)).toBe(false)
    }
    const good = withPlan(0, { alertLevels: [50, 90] })
    const parsed = parseBackup(JSON.stringify(createBackup(good, new Date(ctx.now), '1.0.0')))
    expect(parsed.ok && parsed.data.plans[0]!.alertLevels).toEqual([50, 90])
  })
})

describe('Clara 2.0 §7 · ofrecer recordar una corrección de categoría como regla', () => {
  const rule = (id: string, pattern: string, categoryId: string, kind: 'expense' | 'income' = 'expense') => ({ id, pattern, kind, categoryId, createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z' })
  const data = () => baseData({ categoryRules: [rule('r1', 'uber', 'transport'), rule('r2', 'cafe central', 'dining')] })

  it('corregir la categoría que proponía una regla ofrece una regla más específica, que gana sin romper la anterior', () => {
    const d = data()
    const before = JSON.stringify(d)
    const s = suggestRuleFromCorrection(d, { note: '  Uber   Eats ', kind: 'expense', categoryId: 'dining', previousCategoryId: 'transport' })
    expect(s).toEqual({ pattern: 'Uber Eats', kind: 'expense', categoryId: 'dining' })
    // Solo propone: los datos no cambian.
    expect(JSON.stringify(d)).toBe(before)
    const saved = saveCategoryRule(d, { id: 'r3', ...s! }, ctx)
    if (!saved.ok) throw new Error(JSON.stringify(saved.issues))
    expect(explainRuleMatch('uber eats pedido', 'expense', saved.data.categoryRules)?.rule.id).toBe('r3')
    expect(explainRuleMatch('uber al aeropuerto', 'expense', saved.data.categoryRules)?.rule.id).toBe('r1')
  })

  it('editar un movimiento y cambiar su categoría también cuenta como corrección (ingresos y devoluciones incluidos)', () => {
    expect(suggestRuleFromCorrection(data(), { note: 'Pago cliente ACME', kind: 'income', categoryId: 'freelance', previousCategoryId: 'salary' })).toEqual({ pattern: 'Pago cliente ACME', kind: 'income', categoryId: 'freelance' })
    expect(suggestRuleFromCorrection(data(), { note: 'Devolución tienda', kind: 'refund', categoryId: 'shopping', previousCategoryId: 'other_expense' })?.kind).toBe('expense')
  })

  it('no se ofrece nada si no hubo corrección, sin texto útil, con transferencias, ajustes o divisiones', () => {
    const d = data()
    const base = { note: 'Farmacia del barrio', kind: 'expense' as const, categoryId: 'health', previousCategoryId: 'other_expense' }
    expect(suggestRuleFromCorrection(d, base)).not.toBeNull()
    expect(suggestRuleFromCorrection(d, { ...base, previousCategoryId: undefined })).toBeNull()
    expect(suggestRuleFromCorrection(d, { ...base, previousCategoryId: 'health' })).toBeNull()
    expect(suggestRuleFromCorrection(d, { ...base, kind: 'transfer' })).toBeNull()
    expect(suggestRuleFromCorrection(d, { ...base, kind: 'adjustment' })).toBeNull()
    expect(suggestRuleFromCorrection(d, { ...base, hasSplits: true })).toBeNull()
    for (const note of [undefined, '', ' x ', '1234', '12,50 $', 'a'.repeat(41)]) expect(suggestRuleFromCorrection(d, { ...base, note }), String(note)).toBeNull()
    expect(suggestRuleFromCorrection(d, { ...base, categoryId: 'no-existe' })).toBeNull()
  })

  it('revisión del asistente: una propuesta por texto; dos correcciones contradictorias no proponen nada', () => {
    const d = data()
    const line = (note: string, categoryId: string, previousCategoryId = 'dining') => ({ note, kind: 'expense' as const, categoryId, previousCategoryId })
    const out = suggestRulesFromCorrections(d, [
      line('Café del museo', 'groceries'),
      line('café  DEL museo', 'groceries'), // mismo texto: una sola propuesta
      line('Panadería Sol', 'groceries', 'other_expense'),
      line('Kiosco', 'shopping'),
      line('KIOSCO', 'gifts'), // contradicción: ninguna
      line('Sin cambio', 'dining'), // no hubo corrección
    ])
    expect(out).toEqual([
      { pattern: 'Café del museo', kind: 'expense', categoryId: 'groceries' },
      { pattern: 'Panadería Sol', kind: 'expense', categoryId: 'groceries' },
    ])
  })

  it('guardar varias reglas es todo o nada y deshacer quita exactamente esas', () => {
    const d = data()
    const ok = saveCategoryRules(d, [{ id: 'n1', pattern: 'Café del museo', kind: 'expense', categoryId: 'groceries' }, { id: 'n2', pattern: 'Panadería Sol', kind: 'expense', categoryId: 'groceries' }], ctx)
    if (!ok.ok) throw new Error(JSON.stringify(ok.issues))
    expect(ok.data.categoryRules.map((r) => r.id)).toEqual(['r1', 'r2', 'n1', 'n2'])
    // La segunda repite un texto existente («cafe central»): no se guarda ninguna.
    const bad = saveCategoryRules(d, [{ id: 'n1', pattern: 'Café del museo', kind: 'expense', categoryId: 'groceries' }, { id: 'n3', pattern: 'CAFÉ central', kind: 'expense', categoryId: 'groceries' }], ctx)
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.issues[0]!.path).toBe('rules[1].pattern')
    const undo = deleteCategoryRules(ok.data, ['n1', 'n2', 'gone'], ctx)
    expect(undo.ok && undo.data.categoryRules.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(deleteCategoryRules(d, ['gone'], ctx)).toMatchObject({ ok: true, unchanged: true })
  })

  it('si ya hay una regla con ese mismo texto (sin acentos ni mayúsculas) no se ofrece otra', () => {
    expect(suggestRuleFromCorrection(data(), { note: 'CAFÉ  Central', kind: 'expense', categoryId: 'groceries', previousCategoryId: 'dining' })).toBeNull()
    // Con el mismo texto pero de otro tipo (ingreso) sí.
    expect(suggestRuleFromCorrection(data(), { note: 'CAFÉ  Central', kind: 'income', categoryId: 'freelance', previousCategoryId: 'salary' })).not.toBeNull()
  })
})
