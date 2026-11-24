import { describe, expect, it } from 'vitest'
import { categoriesToCsv, csvSeparatorFor, joinCsvSections, plansToCsv, signedAmount, transactionsToCsv, safeText } from './csvExport'
import { NOW, tx } from '../test/fixtures'

const labels = { headers: ['Fecha', 'Tipo', 'Estado', 'Importe', 'Moneda', 'Categoría', 'Cuenta', 'Hacia', 'Nota', 'Comercio', 'Id'], kind: (t: ReturnType<typeof tx>) => t.kind, status: (t: ReturnType<typeof tx>) => t.status, category: (t: ReturnType<typeof tx>) => t.categoryId ?? '', account: (id?: string) => id ?? '' }

describe('exportación CSV', () => {
  it('una fila por movimiento, importes con signo y punto decimal, comillas escapadas, BOM y CRLF', () => {
    const csv = transactionsToCsv(
      [tx({ id: 'a', amountMinor: 1250, note: 'café, "con" leche', merchant: 'Starbucks' }), tx({ id: 'b', kind: 'income', categoryId: 'salary', amountMinor: 50000 }), tx({ id: 'c', kind: 'transfer', categoryId: undefined, toAccountId: 'sav', amountMinor: 1000 })],
      labels,
    )
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Fecha,Tipo,Estado,Importe,Moneda,Categoría,Cuenta,Hacia,Nota,Comercio,Id')
    expect(lines[1]).toBe('2026-09-28,expense,realized,-12.50,CAD,groceries,main,,"café, ""con"" leche",Starbucks,a')
    expect(lines[2]).toBe('2026-09-28,income,realized,500.00,CAD,salary,main,,,,b')
    expect(lines[3]).toBe('2026-09-28,transfer,realized,-10.00,CAD,,main,sav,,,c')
    expect(lines[4]).toBe('')
  })

  it('el ajuste de conciliación lleva el signo de su dirección', () => {
    expect(signedAmount(tx({ kind: 'adjustment', categoryId: undefined, adjustmentDirection: 'increase', amountMinor: 300 }))).toBe(300)
    expect(signedAmount(tx({ kind: 'adjustment', categoryId: undefined, adjustmentDirection: 'decrease', amountMinor: 300 }))).toBe(-300)
  })
})

describe('exportación CSV: categorías, planes, separador por locale y varias secciones', () => {
  it('usa «;» con coma decimal y mantiene el punto decimal de los importes', () => {
    expect(csvSeparatorFor(',')).toBe(';')
    expect(csvSeparatorFor('.')).toBe(',')
    const csv = transactionsToCsv([tx({ id: 'a', amountMinor: 1250 })], { ...labels, separator: ';' })
    expect(csv.slice(1).split('\r\n')[1]).toBe('2026-09-28;expense;realized;-12.50;CAD;groceries;main;;;;a')
  })

  it('categorías y planes en tablas propias; «todo» las une con títulos y un solo BOM', () => {
    const cat = { id: 'dining', kind: 'expense' as const, nameKey: 'category.dining', groupId: 'food', icon: 'utensils', color: 'orange' as const, archived: false, isCustom: false, sortOrder: 1 }
    const cats = categoriesToCsv([cat], { headers: ['Id', 'Nombre', 'Tipo', 'Grupo', 'Color', 'Icono', 'Archivada', 'Propia'], name: () => 'Restaurantes', kind: (c) => c.kind, group: (c) => c.groupId, yes: 'sí', no: 'no' })
    expect(cats.slice(1).split('\r\n')[1]).toBe('dining,Restaurantes,expense,food,orange,utensils,no,no')
    const plan = { id: 'p1', kind: 'limit' as const, name: 'Comer fuera', categoryIds: ['dining'], amountMinor: 20000, currency: 'CAD' as const, periodType: 'month' as const, startDate: '2026-09-01', endDate: '2026-09-30', recurring: true, status: 'completed' as const, alertAt80: true, alertAt100: true, result: { spentMinor: 25000, achieved: false, deltaMinor: -5000, closedAt: NOW }, createdAt: NOW, updatedAt: NOW }
    const plans = plansToCsv([plan], { headers: ['Id', 'Nombre', 'Categorías', 'Límite', 'Moneda', 'Periodo', 'Inicio', 'Fin', 'Recurrente', 'Estado', 'Gastado', 'Logrado'], name: (p) => p.name, period: (p) => p.periodType, status: (p) => p.status, categories: (p) => p.categoryIds.join(' '), yes: 'sí', no: 'no' })
    expect(plans.slice(1).split('\r\n')[1]).toBe('p1,Comer fuera,dining,200.00,CAD,month,2026-09-01,2026-09-30,sí,completed,250.00,no')
    const all = joinCsvSections([{ title: 'Categorías', csv: cats }, { title: 'Planes', csv: plans }])
    expect(all.startsWith('﻿')).toBe(true)
    expect(all.slice(1).includes('﻿')).toBe(false)
    expect(all.slice(1).split('\r\n')[0]).toBe('Categorías')
    expect(all.split('\r\n').filter((l) => l === 'Planes')).toHaveLength(1)
  })
})

describe('L1 · origen en el CSV', () => {
  it('con `source`, una columna final con el origen (p. ej. «Atajo»)', () => {
    const csv = transactionsToCsv([{ ...tx(), source: 'shortcut' } as ReturnType<typeof tx>], { ...labels, headers: [...labels.headers, 'Origen'], source: (t) => (t.source === 'shortcut' ? 'Atajo' : 'Manual') })
    const [head, row] = csv.replace('\uFEFF', '').split('\r\n')
    expect(head!.split(',').at(-1)).toBe('Origen')
    expect(row!.split(',').at(-1)).toBe('Atajo')
  })
})

describe('QA-07 · texto que una hoja de cálculo ejecutaría como fórmula', () => {
  const only = (csv: string) => csv.slice(1).split('\r\n')[1]!

  it('antepone un apóstrofo a notas, comercios y etiquetas que empiezan por =, +, −, @, tabulador o retorno (con o sin espacios); los importes siguen siendo números', () => {
    for (const [note, expected] of [
      ['=1+1', "'=1+1"],
      ['+1234', "'+1234"],
      ['-2 cafés', "'-2 cafés"],
      ['@SUM(A1)', "'@SUM(A1)"],
      [' =HYPERLINK("http://x")', "\"' =HYPERLINK(\"\"http://x\"\")\""],
      ['\t=1', "'\t=1"],
    ] as const) {
      const row = only(transactionsToCsv([tx({ id: 'a', amountMinor: 1000, note })], labels))
      expect(row, note).toBe(`2026-09-28,expense,realized,-10.00,CAD,groceries,main,,${expected},,a`)
      expect(row).not.toContain(`,${note.trim()},`)
    }
    const merchant = only(transactionsToCsv([tx({ id: 'b', merchant: '=cmd|calc' })], labels))
    expect(merchant).toContain(",'=cmd|calc,")
    const category = only(transactionsToCsv([tx({ id: 'c' })], { ...labels, category: () => '=X', account: () => '-Y' }))
    expect(category).toContain(",'=X,'-Y,")
  })

  it('el texto normal no cambia; las comillas se siguen escapando; los caracteres de control se quitan', () => {
    expect(safeText('café con leche')).toBe('café con leche')
    expect(safeText('a\u0000b\u0007c')).toBe('abc')
    expect(safeText(undefined)).toBe('')
    const row = only(transactionsToCsv([tx({ id: 'q', note: '="x"' })], labels))
    expect(row).toContain('"\'=""x"""')
  })

  it('también con separador «;» y en categorías, planes y títulos de sección', () => {
    const csv = transactionsToCsv([tx({ id: 'a', note: '=1+1' })], { ...labels, separator: ';' })
    expect(csv).toContain(";'=1+1;")
    const sections = joinCsvSections([{ title: '=título', csv: '﻿a,b\r\n' }])
    expect(sections.slice(1)).toMatch(/^'=título\r\n/)
  })
})

describe('Fase 3 · importe original en el CSV', () => {
  it('seis columnas tras el origen: importe con el mismo signo, moneda, tasa exacta, fecha, origen y comisión', () => {
    const yen = tx({ id: 'y', amountMinor: 1132, original: { currency: 'JPY', amountMinor: 1200, rate: '0.0092', rateDate: '2026-09-25', rateSource: 'manual', feeBps: 250 } })
    const actual = tx({ id: 'z', amountMinor: 1117, original: { currency: 'JPY', amountMinor: 1200, rate: '1117/120000', rateDate: '2026-09-28', rateSource: 'card_actual' } })
    const refund = tx({ id: 'r', kind: 'refund', amountMinor: 552, original: { currency: 'JPY', amountMinor: 600, rate: '0.0092', rateDate: '2026-09-25', rateSource: 'manual' } })
    const plain = tx({ id: 'p', amountMinor: 500 })
    const csv = transactionsToCsv([yen, actual, refund, plain], { ...labels, headers: [...labels.headers, 'Origen', 'Original', 'Moneda original', 'Tasa', 'Fecha de la tasa', 'Tasa de', 'Comisión'], source: () => 'Manual', rateSource: (s) => `src:${s}` })
    const lines = csv.slice(1).split('\r\n')
    expect(lines[1]).toBe('2026-09-28,expense,realized,-11.32,CAD,groceries,main,,,,y,Manual,-1200,JPY,0.0092,2026-09-25,src:manual,2.50')
    expect(lines[2]).toBe("2026-09-28,expense,realized,-11.17,CAD,groceries,main,,,,z,Manual,-1200,JPY,'1117/120000,2026-09-28,src:card_actual,")
    expect(lines[3]).toBe('2026-09-28,refund,realized,5.52,CAD,groceries,main,,,,r,Manual,600,JPY,0.0092,2026-09-25,src:manual,')
    expect(lines[4]).toBe('2026-09-28,expense,realized,-5.00,CAD,groceries,main,,,,p,Manual,,,,,,')
  })
})
