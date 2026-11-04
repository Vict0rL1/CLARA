/**
 * Parser local de texto a movimientos (§8): sin red, sin modelos. Reglas explícitas y
 * deterministas; devuelve una vista previa editable con un grado de confianza. Nunca registra
 * nada por sí mismo y nunca calcula saldos.
 *
 * Soporta: varias entradas por texto (líneas, «;», «,» y conectores «y / and / e / et»),
 * importes con separadores regionales, símbolos, «25k», «25 mil», números en palabras (es/en/pt/fr),
 * tipo (gasto/ingreso) por palabras clave, fechas relativas y explícitas, diccionario de
 * categorías en cuatro idiomas más aprendizaje a partir del historial de la persona.
 */
import { addDays, isValidLocalDate, parseLocalDate, toLocalDate, weekday } from './dates'
import { currencyDigits, currencyMarksAround, currencyMarksIn, markLabel, markMatchesCurrency, reconcileMarks, type TextMark } from './money'
import { normalizeText, rankRuleMatches } from './rules'
import type { AppData, Language, LocalDate, Transaction } from './types'

export interface ParsedEntry {
  /** «transfer» es solo una sugerencia: el asistente no registra transferencias como gasto (G4). */
  kind: 'expense' | 'income' | 'transfer'
  /** null si no se encontró un importe: la vista previa lo pide. */
  amountMinor: number | null
  description: string
  merchant?: string
  categoryId?: string
  date: LocalDate
  /** 0–1. */
  confidence: number
  /** Texto original de esta entrada. */
  raw: string
  /** Qué se detectó y qué se asumió (claves de i18n `parser.hint.*`). */
  hints: ParserHint[]
  /**
   * Moneda escrita que NO es la del presupuesto («café USD 10», «10 €», «EUR ten», «10 pesos» en
   * CAD): código ISO, el símbolo o el nombre tal cual. Nunca se convierte; el campo «Importe» la
   * conserva (`withCurrencyMark`) y la revisión bloquea la línea (AS-01, RT-01).
   */
  foreignCurrency?: string
  /**
   * Dos monedas escritas que no pueden ser la misma («coffee USD 10 CAD», «coffee EUR $10»), en el orden
   * en que se escribieron. Tampoco se convierte ni se elige una: el campo conserva las dos
   * (`withCurrencyMarks`) y la línea no se registra hasta corregirla (QA V2, CUR-01/02).
   */
  currencyConflict?: readonly [string, string]
}

export type ParserHint =
  | 'noAmount'
  | 'multipleAmounts'
  | 'transferKeyword'
  | 'assumedToday'
  | 'assumedExpense'
  | 'incomeKeyword'
  | 'dateDetected'
  | 'categoryDictionary'
  | 'categoryLearned'
  | 'categoryRule'
  | 'amountK'
  | 'amountWords'
  /* Recibos (foto) */
  | 'receiptTotal'
  | 'receiptLargest'
  | 'receiptNoAmount'
  | 'receiptDate'
  | 'receiptMerchant'
  | 'ocrUnavailable'

export interface ParseContext {
  today: LocalDate
  currency: string
  language: Language
  /** Categorías activas (id y tipo) para validar sugerencias. */
  categories: readonly { id: string; kind: 'expense' | 'income' }[]
  /** Palabra normalizada → categoría, aprendido del historial (`learnCategories`). */
  learned?: Record<string, string>
  /** Reglas de categoría de la persona (patrón normalizado → categoría). */
  /** Reglas de la persona; `createdAt` desempata patrones de igual longitud (la más antigua gana). */
  rules?: readonly { pattern: string; kind: 'expense' | 'income'; categoryId: string; createdAt?: string }[]
}

export const MAX_PARSER_LINES = 200

/* ---------- Palabras clave ---------- */

const INCOME_WORDS = [
  // es
  'cobre', 'cobro', 'me pagaron', 'me pago', 'ingreso', 'sueldo', 'salario', 'nomina', 'recibi', 'deposito', 'me depositaron', 'me transfirieron', 'gane', 'beca', 'bono', 'devolucion de impuestos',
  // en
  'got paid', 'paid me', 'income', 'salary', 'paycheck', 'payday', 'received', 'deposit', 'earned', 'refund from', 'bonus', 'scholarship', 'wage',
  // pt
  'recebi', 'salario', 'pagamento recebido', 'me pagaram', 'deposito', 'ganhei', 'bolsa',
  // fr
  'recu', 'salaire', 'paie', 'virement recu', 'on m a paye', 'gagne', 'bourse', 'prime',
]

/** Frases que describen un movimiento entre cuentas propias: se sugiere «Transferencia», nunca un gasto (G4). */
const TRANSFER_WORDS = [
  'transferencia a ahorros', 'transferencia a mi', 'transferi a', 'pase a ahorros', 'pase a mi cuenta', 'mande a ahorros', 'a mi cuenta de ahorros',
  'transfer to savings', 'transferred to savings', 'moved to savings', 'move to savings', 'transfer to my',
  'transferencia para poupanca', 'transferi para', 'passei para a poupanca',
  'virement epargne', 'virement vers', 'virement sur mon', 'vire sur mon',
]

const CATEGORY_WORDS: Record<string, readonly string[]> = {
  groceries: ['super', 'supermercado', 'mercado', 'despensa', 'walmart', 'costco', 'soriana', 'chedraui', 'exito', 'carulla', 'd1', 'lidl', 'aldi', 'carrefour', 'mercadona', 'groceries', 'grocery', 'supermarket', 'loblaws', 'metro', 'sobeys', 'feira', 'epicerie', 'courses'],
  dining: ['helado', 'heladeria', 'nieve', 'ice cream', 'sorvete', 'sorveteria', 'glace', 'gelato', 'cafe', 'coffee', 'starbucks', 'tim hortons', 'restaurante', 'restaurant', 'comida', 'almuerzo', 'cena', 'desayuno', 'lunch', 'dinner', 'breakfast', 'pizza', 'burger', 'hamburguesa', 'tacos', 'sushi', 'bar', 'cerveza', 'beer', 'uber eats', 'rappi', 'didi food', 'doordash', 'ifood', 'lanche', 'cafeteria', 'resto', 'dejeuner', 'diner'],
  transport: ['uber', 'didi', 'cabify', 'taxi', 'bus', 'metro', 'transporte', 'transport', 'pasaje', 'peaje', 'estacionamiento', 'parking', 'tren', 'train', 'bolt', 'lyft', 'onibus', 'passagem', 'transit', 'presto'],
  fuel: ['gasolina', 'gas', 'combustible', 'nafta', 'fuel', 'petrol', 'gasoline', 'diesel', 'gasolinera', 'essence', 'carburant', 'posto'],
  housing: ['renta', 'alquiler', 'arriendo', 'rent', 'hipoteca', 'mortgage', 'aluguel', 'loyer', 'condominio', 'administracion'],
  utilities: ['luz', 'electricidad', 'agua', 'gas natural', 'electricity', 'hydro', 'water bill', 'power bill', 'energia', 'electricite', 'eau', 'servicios'],
  phone_internet: ['internet', 'telefono', 'celular', 'movil', 'phone', 'mobile', 'wifi', 'telcel', 'movistar', 'claro', 'rogers', 'bell', 'telus', 'fido', 'plan de datos', 'recarga', 'vivo', 'tim', 'orange', 'free mobile'],
  subscriptions: ['netflix', 'spotify', 'disney', 'hbo', 'max', 'prime video', 'amazon prime', 'youtube premium', 'apple music', 'icloud', 'suscripcion', 'subscription', 'assinatura', 'abonnement', 'gym', 'gimnasio', 'crunchyroll', 'xbox', 'playstation', 'chatgpt'],
  shopping: ['ropa', 'zapatos', 'tenis', 'camisa', 'pantalon', 'clothes', 'shoes', 'shirt', 'amazon', 'mercado libre', 'shein', 'zara', 'h&m', 'compras', 'shopping', 'roupa', 'vetements', 'tienda', 'store'],
  entertainment: ['cine', 'pelicula', 'movie', 'cinema', 'concierto', 'concert', 'teatro', 'juego', 'videojuego', 'game', 'boletos', 'tickets', 'fiesta', 'party', 'salida', 'show', 'festa', 'sortie'],
  health: ['farmacia', 'pharmacy', 'medicina', 'medicamento', 'doctor', 'medico', 'dentista', 'dentist', 'consulta', 'hospital', 'clinica', 'lentes', 'terapia', 'therapy', 'remedio', 'pharmacie', 'medecin'],
  education: ['colegiatura', 'matricula', 'universidad', 'escuela', 'curso', 'libro', 'tuition', 'school', 'university', 'course', 'book', 'udemy', 'coursera', 'mensalidade', 'faculdade', 'ecole', 'universite', 'cours', 'livre'],
  personal: ['peluqueria', 'corte de pelo', 'barberia', 'salon', 'haircut', 'barber', 'manicure', 'spa', 'cosmeticos', 'maquillaje', 'makeup', 'skincare', 'cabeleireiro', 'coiffeur'],
  gifts: ['regalo', 'gift', 'cumpleanos', 'birthday', 'presente', 'cadeau', 'flores', 'flowers', 'donacion', 'donation'],
  children: ['guarderia', 'daycare', 'panales', 'diapers', 'hijos', 'ninos', 'kids', 'juguete', 'toy', 'escuela de los ninos', 'fralda', 'creche', 'enfants'],
  pets: ['mascota', 'perro', 'gato', 'veterinario', 'vet', 'croquetas', 'pet', 'dog', 'cat', 'pet food', 'cachorro', 'veterinaire', 'chien', 'chat'],
  salary: ['sueldo', 'salario', 'nomina', 'quincena', 'salary', 'paycheck', 'payday', 'wage', 'salaire', 'paie'],
  freelance: ['freelance', 'cliente', 'client', 'proyecto', 'project', 'factura', 'invoice', 'chamba', 'trabajo extra', 'side job', 'frete', 'mission'],
  bonus: ['bono', 'bonus', 'aguinaldo', 'prima', 'prime', 'decimo'],
  investments: ['dividendo', 'dividend', 'intereses', 'interest', 'inversion', 'investment', 'rendimiento', 'cetes', 'gic', 'rendimentos', 'placement'],
  rent_received: ['renta recibida', 'alquiler recibido', 'rent received', 'inquilino', 'tenant', 'aluguel recebido', 'loyer recu'],
  gift_income: ['me regalaron', 'regalo recibido', 'gift received', 'me dieron', 'ganhei de presente'],
  scholarship: ['beca', 'scholarship', 'bolsa de estudos', 'bourse'],
  government: ['subsidio', 'apoyo del gobierno', 'benefit', 'gst', 'child benefit', 'auxilio', 'allocation', 'caf'],
}

const NUMBER_WORDS: Record<string, number> = {
  // es
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900, mil: 1000, millon: 1000000, millones: 1000000,
  // en
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1000000,
  // pt
  um: 1, uma: 1, dois: 2, duas: 2, quatro: 4, seis6: 6, sete: 7, oito: 8, nove: 9, dez: 10, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta7: 70, oitenta: 80, cem: 100, duzentos: 200, quinhentos: 500, milhao: 1000000,
  // fr
  deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100, mille: 1000,
}

const RELATIVE_DAYS: Record<string, number> = {
  hoy: 0, ayer: -1, anteayer: -2, antier: -2, antesdeayer: -2,
  today: 0, yesterday: -1,
  hoje: 0, ontem: -1, anteontem: -2,
  aujourdhui: 0, hier: -1, avanthier: -2,
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  janeiro: 1, fevereiro: 2, marco: 3, maio: 5, junho: 6, julho: 7, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12, jan: 1, apr: 4, aug: 8, dec: 12, fev: 2, out: 10, dez: 12, fevr: 2, juil: 7,
}

/* ---------- Importes ---------- */

interface AmountMatch {
  minor: number
  /** Desde la primera marca de moneda pegada hasta la última: lo que sale de la descripción. */
  start: number
  end: number
  hint?: ParserHint
  /** Monedas escritas pegadas al importe (delante y detrás), con las definiciones de `money.ts`. */
  marks: TextMark[]
}

/** Letras ASCII pegadas delante del número: solo valen si son un código de moneda («GBP10», no «abc10»). */
function attachedPrefixOk(text: string, at: number): boolean {
  if (!/[A-Za-z]$/.test(text.slice(0, at))) return true
  return currencyMarksAround(text, at, at).some((m) => m.end === at)
}

/** Letras ASCII pegadas detrás del número: solo valen si son un código o nombre de moneda («10GBP», «10euros»). */
function attachedSuffixOk(text: string, at: number): boolean {
  if (!/^[A-Za-z]/.test(text.slice(at))) return true
  return currencyMarksAround(text, at, at).some((m) => m.start === at)
}

function withMarks(text: string, minor: number, start: number, end: number, hint?: ParserHint): AmountMatch {
  const marks = currencyMarksAround(text, start, end)
  return { minor, start: Math.min(start, ...marks.map((m) => m.start)), end: Math.max(end, ...marks.map((m) => m.end)), hint, marks }
}

/** «1.234,56», «1,234.56», «25.000» (miles), «25,50», «25.5», «$25», «25€», «GBP 25», «25k», «2.5k», «25 mil». */
function findAmount(text: string, digits: number): AmountMatch | null {
  const re = /(?<![\p{N}.,_])(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:([.,])(\d{1,2}))?(?:\s*(k|mil|m)(?![\p{L}\p{N}_]))?(?![\p{N}_])/giu
  let first: AmountMatch | null = null
  for (const m of text.matchAll(re)) {
    const [, intRaw, sep, frac, suffix] = m
    const start = m.index!
    const end = start + m[0].length
    // Letras pegadas al número («abc10», «10abc») no son un importe, salvo un código de moneda (RT-01).
    if (!attachedPrefixOk(text, start) || !attachedSuffixOk(text, end)) continue
    const integer = intRaw!.replace(/[.,\s]/g, '')
    let fraction = frac ?? ''
    let scale = 1
    let hint: ParserHint | undefined
    if (suffix) {
      const s = suffix.toLowerCase()
      scale = s === 'm' ? 1000000 : 1000
      hint = 'amountK'
    }
    let whole = Number(integer)
    if (!Number.isFinite(whole)) continue
    // «2.5k» → 2500: la fracción multiplica la escala.
    if (scale > 1 && fraction) {
      whole = whole * scale + Math.round((Number(`0.${fraction}`) * scale))
      fraction = ''
    } else {
      whole = whole * scale
    }
    const fracDigits = fraction.padEnd(digits, '0').slice(0, digits)
    const minor = whole * 10 ** digits + (digits > 0 && fracDigits ? Number(fracDigits) : 0)
    const found = withMarks(text, minor, start, end, hint)
    // Se prefiere el primer importe con moneda escrita, decimales o «k»; si no, el primero.
    if (found.marks.length > 0 || !!sep || !!suffix) return found
    first ??= found
  }
  return first
}

/** Números en palabras: «veinticinco», «twenty five», «dos mil quinientos», «cinquante» (con su moneda: «EUR ten»). */
function findWordAmount(text: string, digits: number): AmountMatch | null {
  const words = [...text.matchAll(/\S+/g)]
  let total = 0
  let current = 0
  let start = -1
  let end = -1
  let seen = false
  for (let i = 0; i < words.length; i++) {
    const w = normalizeText(words[i]![0]).replace(/^(y|and|e|et)$/, '')
    if (w === '') continue
    const v = NUMBER_WORDS[w]
    if (v === undefined) {
      if (seen) break
      continue
    }
    if (!seen) start = i
    seen = true
    end = i
    if (v === 100) current = current === 0 ? 100 : current * 100
    else if (v >= 1000) {
      total += (current === 0 ? 1 : current) * v
      current = 0
    } else current += v
  }
  if (!seen) return null
  total += current
  if (total === 0) return null
  const charStart = words[start]!.index!
  const charEnd = words[end]!.index! + words[end]![0].length
  return withMarks(text, total * 10 ** digits, charStart, charEnd, 'amountWords')
}

/**
 * Moneda escrita que NO es la del presupuesto (código, símbolo o nombre tal cual), o dos que se
 * contradicen. Se unen TODAS las marcas de la entrada, pegadas al importe y explícitas en el resto de la
 * frase («coffee (USD) 10», «paid in euros»), en orden de lectura (`reconcileMarks`, QA V2 CUR-01): un
 * código concreto acota a un símbolo genérico («coffee USD $10» → USD), nunca al revés. Nada se convierte
 * ni se asume la moneda del presupuesto.
 */
function writtenCurrencyOf(amount: AmountMatch | null, rest: string, currency: string): Pick<ParsedEntry, 'foreignCurrency' | 'currencyConflict'> {
  const far = currencyMarksIn(rest)
  const cut = amount ? amount.start : rest.length
  const marks = [...far.filter((m) => m.start < cut), ...(amount?.marks ?? []), ...far.filter((m) => m.start >= cut)]
  const mark = reconcileMarks(marks.map((m) => m.mark))
  if (!mark || markMatchesCurrency(mark, currency)) return {}
  if ('conflict' in mark) return { currencyConflict: [markLabel(mark.conflict[0]), markLabel(mark.conflict[1])] }
  return { foreignCurrency: markLabel(mark) }
}

/* ---------- Fechas ---------- */

function findDate(norm: string, today: LocalDate, language: Language = 'es'): { date: LocalDate; start: number; end: number } | null {
  // ISO o día/mes(/año)
  const iso = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(norm)
  if (iso && isValidLocalDate(iso[0])) return { date: iso[0], start: iso.index, end: iso.index + iso[0].length }
  const dmy = /(?<![\d.,])(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?![\d.,/-])/.exec(norm)
  if (dmy) {
    const d = Number(dmy[1])
    const mo = Number(dmy[2])
    const y = dmy[3] ? (dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])) : parseLocalDate(today).year
    const candidate = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (isValidLocalDate(candidate)) return { date: candidate, start: dmy.index, end: dmy.index + dmy[0].length }
  }
  // «15 de octubre», «15 oct» (día-mes) y «oct 15», «october 15» (mes-día). En inglés manda mes-día.
  const dayMonth = (): { date: LocalDate; start: number; end: number } | null => {
    for (const dm of norm.matchAll(/(?<!\d)(\d{1,2})(?:\s+(?:de|of|d))?\s+([a-z]{3,10})\.?(?:\s+(?:de|of|d)?\s*(\d{4}))?/g)) {
      if (!MONTHS[dm[2]!]) continue
      const y = dm[3] ? Number(dm[3]) : parseLocalDate(today).year
      const candidate = toLocalDate(y, MONTHS[dm[2]!]!, Number(dm[1]))
      if (isValidLocalDate(candidate)) return { date: candidate, start: dm.index!, end: dm.index! + dm[0].length }
    }
    return null
  }
  const monthDay = (): { date: LocalDate; start: number; end: number } | null => {
    for (const md of norm.matchAll(/([a-z]{3,10})\.?\s+(\d{1,2})(?!\d|[.,]\d)(?:,?\s+(\d{4}))?/g)) {
      if (!MONTHS[md[1]!]) continue
      const y = md[3] ? Number(md[3]) : parseLocalDate(today).year
      const candidate = toLocalDate(y, MONTHS[md[1]!]!, Number(md[2]))
      if (isValidLocalDate(candidate)) return { date: candidate, start: md.index!, end: md.index! + md[0].length }
    }
    return null
  }
  const named = language === 'en' ? (monthDay() ?? dayMonth()) : (dayMonth() ?? monthDay())
  if (named) return named
  // Relativas y días de la semana (siempre el más reciente, hoy incluido)
  const words = norm.split(' ')
  let pos = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.replace(/[^a-z]/g, '')
    const rel = RELATIVE_DAYS[w]
    if (rel !== undefined) return { date: addDays(today, rel), start: pos, end: pos + words[i]!.length }
    // «el lunes», «last monday», «on monday»
    const wd = WEEKDAYS[w]
    if (wd !== undefined) {
      const back = (weekday(today) - wd + 7) % 7
      const s = words[i - 1] && /^(el|last|on|le|na|no|this|este)$/.test(words[i - 1]!) ? pos - words[i - 1]!.length - 1 : pos
      return { date: addDays(today, -back), start: Math.max(0, s), end: pos + words[i]!.length }
    }
    pos += words[i]!.length + 1
  }
  return null
}

/* ---------- Categoría ---------- */

export function dictionaryCategory(norm: string, kind: 'expense' | 'income', allowed: Set<string>): string | undefined {
  let best: { id: string; len: number } | undefined
  for (const [id, words] of Object.entries(CATEGORY_WORDS)) {
    if (!allowed.has(id)) continue
    const isIncomeCat = ['salary', 'freelance', 'bonus', 'investments', 'rent_received', 'gift_income', 'scholarship', 'government', 'other_income'].includes(id)
    if (isIncomeCat !== (kind === 'income')) continue
    for (const w of words) {
      if (new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(norm) && (!best || w.length > best.len)) best = { id, len: w.length }
    }
  }
  return best?.id
}

/**
 * Aprende de los movimientos de la persona: cada palabra significativa de una nota se asocia a
 * la categoría con la que más veces se registró. Solo movimientos realizados; sin IA.
 */
export function learnCategories(data: Pick<AppData, 'transactions'>): Record<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const tx of data.transactions) {
    if (tx.status !== 'realized' || !tx.categoryId || !tx.note || tx.kind === 'transfer' || tx.kind === 'adjustment') continue
    for (const w of significantWords(normalizeText(`${tx.note} ${tx.merchant ?? ''}`))) {
      const m = counts.get(w) ?? new Map<string, number>()
      m.set(tx.categoryId, (m.get(tx.categoryId) ?? 0) + 1)
      counts.set(w, m)
    }
  }
  const out: Record<string, string> = {}
  for (const [w, m] of counts) {
    let bestId = ''
    let bestN = 0
    let total = 0
    for (const [id, n] of m) {
      total += n
      if (n > bestN) {
        bestN = n
        bestId = id
      }
    }
    // Solo si la asociación es clara (≥ 2 veces y mayoría).
    if (bestN >= 2 && bestN * 2 > total) out[w] = bestId
  }
  return out
}

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'por', 'para', 'un', 'una', 'y', 'the', 'a', 'an', 'at', 'in', 'on', 'for', 'and', 'of', 'to', 'do', 'da', 'no', 'na', 'com', 'le', 'les', 'au', 'aux', 'et', 'pour', 'chez', 'hoy', 'ayer', 'today', 'yesterday'])

export function significantWords(norm: string): string[] {
  return norm.split(/[^a-z0-9&]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
}

/* ---------- Entrada ---------- */

/** Todas las entradas del texto, sin el tope (para avisar de cuántas quedaron fuera). */
function splitAllEntries(text: string): string[] {
  const lines = text.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean)
  const out: string[] = []
  for (const line of lines) {
    // Divide por «,» o conectores solo si cada parte tiene un número: «café 25 y uber 80».
    // Una coma entre dos dígitos («1,450», «3,50») forma parte del importe y no separa (F2).
    const parts = line.split(/\s*(?:(?<!\d),|,(?!\d))\s*|\s+(?:y|and|e|et|\+)\s+/i)
    if (parts.length > 1 && parts.every((p) => /\d/.test(p) || /\b(cien|mil|hundred|thousand|cem|cent|mille)\b/i.test(p))) out.push(...parts.map((p) => p.trim()).filter(Boolean))
    else out.push(line)
  }
  return out
}

function splitEntries(text: string): string[] {
  return splitAllEntries(text).slice(0, MAX_PARSER_LINES)
}

/** Cuántas entradas hay en el texto (puede superar `MAX_PARSER_LINES`; `parseText` analiza las primeras). */
export function countEntries(text: string): number {
  return splitAllEntries(text).length
}

function detectMerchant(raw: string, cleaned: string): string | undefined {
  const m = /\b(?:en|at|chez|em|no|na|@)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&'.-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&'.-]*)*)/.exec(raw)
  if (m) return m[1]
  const cap = /(?:^|\s)([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&'.-]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&'.-]*)*)/.exec(cleaned)
  // Una palabra en mayúscula al principio de la frase no es necesariamente un comercio.
  if (cap && cap.index > 0) return cap[1]
  return undefined
}

export function parseEntry(raw: string, ctx: ParseContext): ParsedEntry {
  const digits = currencyDigits(ctx.currency)
  const hints: ParserHint[] = []
  let working = raw.trim()
  const norm = normalizeText(working)

  // Fecha (se quita del texto antes de buscar importes para que «15/10» no sea un importe).
  const date = findDate(norm, ctx.today, ctx.language)
  let dateValue = ctx.today
  if (date) {
    dateValue = date.date > ctx.today ? ctx.today : date.date
    hints.push('dateDetected')
    working = working.slice(0, date.start) + ' ' + working.slice(date.end)
  } else hints.push('assumedToday')

  // Importe
  const amount = findAmount(working, digits) ?? findWordAmount(working, digits)
  let description = working
  if (amount) {
    description = (working.slice(0, amount.start) + ' ' + working.slice(amount.end)).replace(/\s+/g, ' ').trim()
    if (amount.hint) hints.push(amount.hint)
    // «café 4.50 uber 12» sin separador: se toma el primero y la fila queda marcada para revisar (F1).
    if (findAmount(description, digits)) hints.push('multipleAmounts')
  } else hints.push('noAmount')

  // Tipo
  const normDesc = normalizeText(working)
  const isTransfer = TRANSFER_WORDS.some((w) => normDesc.includes(w))
  const isIncome = !isTransfer && INCOME_WORDS.some((w) => new RegExp(`(^|\\W)${w}(\\W|$)`).test(normDesc))
  const kind: 'expense' | 'income' = isIncome ? 'income' : 'expense'
  hints.push(isTransfer ? 'transferKeyword' : isIncome ? 'incomeKeyword' : 'assumedExpense')

  // Categoría: regla de la persona > aprendizaje > diccionario
  const allowed = new Set(ctx.categories.filter((c) => c.kind === kind).map((c) => c.id))
  let categoryId: string | undefined
  // Mismo resolutor que Ajustes › Reglas y la revisión: el patrón más largo gana, a igualdad la más antigua.
  const rule = rankRuleMatches(
    normDesc,
    (ctx.rules ?? []).filter((r) => r.kind === kind && allowed.has(r.categoryId)),
  )[0]
  if (rule) {
    categoryId = rule.categoryId
    hints.push('categoryRule')
  }
  if (!categoryId && ctx.learned) {
    for (const w of significantWords(normDesc)) {
      const id = ctx.learned[w]
      if (id && allowed.has(id)) {
        categoryId = id
        hints.push('categoryLearned')
        break
      }
    }
  }
  if (!categoryId) {
    categoryId = dictionaryCategory(normDesc, kind, allowed)
    if (categoryId) hints.push('categoryDictionary')
  }

  // Limpieza de la descripción: quita conectores sueltos y símbolos de moneda huérfanos.
  description = description
    .replace(/^[\s,.;:$€£-]+|[\s,.;:$€£-]+$/g, '')
    .replace(/\b(en|de|el|la|por|at|on|in|for|the|le|la|em|no|na|chez)\s*$/i, '')
    .trim()
  const merchant = detectMerchant(raw, description)
  if (merchant) {
    description = description
      .replace(new RegExp(`\\b(?:en|at|chez|em|no|na|@)\\s+${merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'), '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,.;:$€£-]+|[\s,.;:$€£-]+$/g, '')
      .trim()
  }
  if (!description) description = merchant ?? raw.trim()

  let confidence = amount ? 0.5 : 0.15
  if (hints.includes('categoryRule')) confidence += 0.3
  else if (hints.includes('categoryLearned')) confidence += 0.25
  else if (hints.includes('categoryDictionary')) confidence += 0.2
  if (date) confidence += 0.1
  if (isIncome) confidence += 0.05
  if (hints.includes('amountWords')) confidence -= 0.1
  if (!amount) confidence = Math.min(confidence, 0.25)
  if (hints.includes('multipleAmounts')) confidence = Math.min(confidence, 0.45)
  if (isTransfer) confidence = Math.min(confidence, 0.5)
  confidence = Math.max(0.05, Math.min(0.95, confidence))

  const written = writtenCurrencyOf(amount, amount ? working.slice(0, amount.start) + ' ' + working.slice(amount.end) : working, ctx.currency)
  return { kind: isTransfer ? 'transfer' : kind, amountMinor: amount?.minor ?? null, description, ...(merchant ? { merchant } : {}), ...(categoryId ? { categoryId } : {}), date: dateValue, confidence: Math.round(confidence * 100) / 100, raw: raw.trim(), hints, ...written }
}

/** Texto libre → entradas (máximo 200). */
export function parseText(text: string, ctx: ParseContext): ParsedEntry[] {
  return splitEntries(text).map((e) => parseEntry(e, ctx))
}

/** Convierte una entrada confirmada en un borrador de movimiento (sin id ni cuenta: los pone el formulario). */
export function entryToDraft(entry: ParsedEntry, source: Transaction['source'] = 'ai_text'): Pick<Transaction, 'kind' | 'amountMinor' | 'date' | 'note' | 'categoryId' | 'merchant' | 'source'> | null {
  if (entry.amountMinor === null || entry.amountMinor <= 0 || entry.kind === 'transfer') return null
  return { kind: entry.kind, amountMinor: entry.amountMinor, date: entry.date, note: entry.description, ...(entry.categoryId ? { categoryId: entry.categoryId } : {}), ...(entry.merchant ? { merchant: entry.merchant } : {}), source }
}
