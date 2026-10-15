/**
 * Clara 2.0 · fase 1 (cimientos): colchón de seguridad, esquema 13 y lo que se añada en esta fase.
 * Cada bloque fija el contrato con datos sintéticos.
 */
import { describe, expect, it } from 'vitest'
import { simulatePurchase } from './affordability'
import { computeBudget } from './budget'
import { committedFor, safeToSpend } from './periods'
import { saveAccount, saveSchedule, saveTransaction, updateSettings } from './operations'
import { allAccountBalances } from './balances'
import { defaultSecondDay, nthOccurrence, occurrencesBetween, scanOccurrences } from './recurrence'
import type { AppData, Schedule } from './types'
import { validateSchedule } from './validation'
import { SCHEMA_VERSION } from './types'
import { createBackup, parseBackup, validateAppData } from '../storage/backup'
import { MIGRATIONS, migrate } from '../storage/migrations'
import { account, baseData, bill, ctx, goal, income, schedule } from '../test/fixtures'

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
