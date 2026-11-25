/**
 * «Por revisar» (Fase 2 nativa): lo que llegó solo desde el iPhone, arriba de la bandeja de pendientes.
 *
 * - Movimientos registrados solos: ya cuentan. «Está bien» quita la marca; «Editar» abre el formulario (guardar también
 *   es revisar); «Fue rechazado» los manda a la papelera, con «Deshacer».
 * - Propuestas: no cuentan. «Registrar» las convierte en gasto con la hora del pago; si vinieron en otra moneda, con «¥»
 *   o sin importe claro, con el importe que la persona escribe en la moneda del presupuesto (cargo real) o, en una
 *   moneda del viaje en curso con tasa escrita, con esa tasa (Fase 3). Clara nunca inventa una tasa.
 *   «Descartar» las quita, con «Deshacer».
 * - Un pago convertido solo con la tasa del viaje dice el importe original, la tasa, su fecha y la comisión; uno
 *   convertido con la del Banco de Canadá lo dice («tasa indicativa del Banco de Canadá del <fecha>», decisión 181).
 * - Una propuesta en otra moneda sin tasa del viaje, con Ajustes › Tasas del Banco de Canadá encendido y presupuesto en
 *   CAD: «Pedir la tasa del Banco de Canadá» la pide para la fecha del pago, enseña la cuenta y «Registrar con esta
 *   tasa». Sin conexión o sin tasa, se dice y la propuesta sigue igual.
 *
 * Los textos van en el paquete diferido `capture` (fuera del JS inicial); mientras no carga, `PackNotice` lo dice.
 * Las reglas están en `domain/captureImport.ts`; aquí solo se muestran y se llaman.
 */
import { useMemo, useState } from 'react'
import { activeAccounts } from '../../domain/balances'
import { assignCardAccount, cardIsMapped, confirmReviews, dismissProposals, foreignAmount, registerProposal, reopenReviews, restoreProposals, type RegisterWith } from '../../domain/captureImport'
import { singleMarkedAmount } from '../../domain/bankAlert'
import { bocSeries, bocWindow, type BocRate } from '../../domain/boc'
import { convertToBudget } from '../../domain/fx'
import { minorToInputString } from '../../domain/money'
import { activeTrip, tripRate } from '../../domain/trips'
import { normalizeText } from '../../domain/text'
import { transactionsToReview } from '../../domain/captureReview'
import type { CaptureOrigin, CaptureProposal, Language, Transaction } from '../../domain/types'
import { useT } from '../../i18n'
import { packTranslator, usePack, type PackTranslate, type PackTranslatePlural } from '../../i18n/packs'
import { lookupBocRate, useBocEnabled } from '../../state/bocRates'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Badge, Card } from '../components/common'
import { MoneyField, SelectField } from '../components/fields'
import { Icon, type IconName } from '../components/Icon'
import { PackLangScope } from '../components/PackLangScope'
import { PackNotice } from '../components/PackNotice'
import { useToast } from '../components/toastContext'
import { useFormat } from '../format'
import { accountLabel, accountName, categoryLabel, issueMessage, transactionTitle } from '../labels'
import { feeLabel, rateLabel } from '../fxText'
import { moneyErrorMessage, parseMoneyText } from '../moneyText'
import { href, withQuery } from '../router'
import { useDeleteTransaction } from '../useDeleteTransaction'

const BACK = '/pendientes'
const SOURCE_ICON: Record<'apple_pay' | 'bank_text' | 'siri', IconName> = { apple_pay: 'creditCard', bank_text: 'bell', siri: 'mic' }
const sourceOf = (s: CaptureOrigin | Transaction['source']) => (s === 'apple_pay' || s === 'siri' ? s : 'bank_text')

/** La sección entera; nada si no hay nada por revisar. */
export function CaptureReview() {
  const data = useData()
  const pack = usePack('capture')
  const toReview = useMemo(() => transactionsToReview(data), [data])
  const proposals = data.captures?.proposals ?? []
  if (toReview.length + proposals.length === 0) return null
  return (
    <div className="stack-sm" data-testid="capture-review">
      <PackNotice state={pack} />
      {pack.status === 'ready' && (
        <PackLangScope fallback={pack.fallback}>
          <ReviewBody texts={pack.texts} packLanguage={pack.language} toReview={toReview} proposals={proposals} />
        </PackLangScope>
      )}
    </div>
  )
}

interface Texts {
  t: PackTranslate
  tn: PackTranslatePlural
}

function ReviewBody({ texts, packLanguage, toReview, proposals }: { texts: Record<string, string>; packLanguage: Language; toReview: Transaction[]; proposals: CaptureProposal[] }) {
  const base = useT()
  const tr = useMemo(() => packTranslator(texts, packLanguage, base), [texts, packLanguage, base])
  const run = useRun()
  const toast = useToast()
  const total = toReview.length + proposals.length

  const confirm = async (txs: Transaction[]) => {
    const before = txs.map((tx) => ({ id: tx.id, review: tx.review! }))
    const { result, saved } = await run((d, c) => confirmReviews(d, before.map((b) => b.id), c))
    const ok = result.ok && saved
    toast({
      message: ok ? tr.tn('capture.review.okToast', before.length) : base.t('save.error.generic'),
      tone: ok ? 'good' : 'critical',
      ...(ok ? { action: { label: base.t('common.undo'), onClick: () => void run((d, c) => reopenReviews(d, before, c)) } } : {}),
    })
  }

  return (
    <section className="stack-sm" aria-labelledby="inbox-review">
      <h2 id="inbox-review" className="section-title">
        <Icon name="eye" size={18} /> {tr.t('capture.review.title')} ({total})
      </h2>
      <p className="note">{tr.t('capture.review.intro')}</p>
      <NewCards toReview={toReview} proposals={proposals} tr={tr} />
      {toReview.length > 1 && (
        <button type="button" className="btn btn--secondary btn--small" onClick={() => void confirm(toReview)} data-testid="capture-all-ok">
          <Icon name="checkCircle" size={16} />
          {tr.t('capture.review.allOk', { count: toReview.length })}
        </button>
      )}
      <ul className="item-list">
        {toReview.map((tx) => (
          <li key={tx.id}>
            <ReviewedCard tx={tx} tr={tr} onOk={() => void confirm([tx])} />
          </li>
        ))}
        {proposals.map((p) => (
          <li key={p.captureId}>
            <ProposalCard proposal={p} tr={tr} />
          </li>
        ))}
      </ul>
      {toReview.length > 0 && <p className="note">{tr.t('capture.review.rejectedHelp')}</p>}
    </section>
  )
}

/**
 * La primera vez que llega un pago de una tarjeta sin cuenta asignada, se pregunta su cuenta (una vez por tarjeta). Lo
 * que espera revisión de esa tarjeta pasa a esa cuenta y los pagos siguientes entran solos (`assignCardAccount`).
 */
function NewCards({ toReview, proposals, tr }: { toReview: Transaction[]; proposals: CaptureProposal[]; tr: Texts }) {
  const data = useData()
  const cards = new Map<string, string>()
  for (const card of [...toReview.map((t) => t.review?.card), ...proposals.filter((p) => !p.test).map((p) => p.card)]) {
    if (card && !cardIsMapped(data, card) && !cards.has(normalizeText(card))) cards.set(normalizeText(card), card)
  }
  const accounts = activeAccounts(data.accounts)
  // Con una sola cuenta no hay nada que elegir.
  if (cards.size === 0 || accounts.length < 2) return null
  return (
    <>
      {[...cards.values()].map((card) => (
        <NewCard key={card} card={card} tr={tr} />
      ))}
    </>
  )
}

function NewCard({ card, tr }: { card: string; tr: Texts }) {
  const { t } = useT()
  const data = useData()
  const run = useRun()
  const toast = useToast()
  const accounts = activeAccounts(data.accounts)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const save = async () => {
    const { result, saved } = await run((d, c) => assignCardAccount(d, card, accountId, c))
    const ok = result.ok && saved
    toast({ message: ok ? tr.t('capture.card.savedToast', { card, account: accountName(data.accounts, accountId, t) }) : t('save.error.generic'), tone: ok ? 'good' : 'critical' })
  }
  return (
    <Card as="article" className="inbox-item">
      <span className="item__main">
        <span className="item__title">
          <Icon name="creditCard" size={16} /> {tr.t('capture.card.title', { card })}
        </span>
        <span className="item__meta">{tr.t('capture.card.question')}</span>
      </span>
      <SelectField label={tr.t('capture.card.account', { card })} value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accounts.map((a) => ({ value: a.id, label: accountLabel(a, t) }))} />
      <div className="button-row">
        <button type="button" className="btn btn--primary btn--small" onClick={() => void save()}>
          <Icon name="check" size={16} />
          {tr.t('capture.card.save')}
        </button>
      </div>
    </Card>
  )
}

/** Un movimiento que Clara registró sola: ya cuenta en las cifras. */
function ReviewedCard({ tx, tr, onOk }: { tx: Transaction; tr: Texts; onOk: () => void }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const deleteTx = useDeleteTransaction()
  const source = sourceOf(tx.source)
  return (
    <Card as="article" className="inbox-item">
      <span className="item__main">
        {/* El comercio es lo que identifica un pago capturado; sin él, el título de siempre. */}
        <span className="item__title">{tx.merchant ?? transactionTitle(tx, data.accounts, t)}</span>
        <span className="item__meta">
          {fmt.date(tx.date, { compact: true, today })} · {categoryLabel(t, tx.categoryId)} · {accountName(data.accounts, tx.accountId, t)}
        </span>
        <span className="item__badges">
          <Badge>−{fmt.money(tx.amountMinor)}</Badge>
          <Badge icon={SOURCE_ICON[source]}>{tr.t(`capture.source.${source}`)}</Badge>
          {tx.review?.card && <Badge icon="creditCard">{tx.review.card}</Badge>}
          <Badge tone="info" icon="check">
            {tr.t('capture.review.recorded')}
          </Badge>
        </span>
        {tx.original && (
          <span className="item__meta">
            {tr.t(
              tx.original.rateSource === 'boc'
                ? tx.original.feeBps
                  ? 'capture.review.convertedBocFee'
                  : 'capture.review.convertedBoc'
                : tx.original.feeBps
                  ? 'capture.review.convertedFee'
                  : 'capture.review.converted',
              {
              original: fmt.moneyIn(tx.original.amountMinor, tx.original.currency),
              rate: rateLabel(tx.original.rate, fmt.numberLocale),
              date: fmt.date(tx.original.rateDate, { compact: true, today }),
              fee: feeLabel(tx.original.feeBps ?? 0, fmt.numberLocale),
            })}
          </span>
        )}
        {tx.review?.rawText && <span className="item__meta">{tr.t('capture.review.rawText', { text: tx.review.rawText })}</span>}
      </span>
      <div className="button-row">
        <button type="button" className="btn btn--primary btn--small" onClick={onOk}>
          <Icon name="check" size={16} />
          {tr.t('capture.review.ok')}
        </button>
        <a className="btn btn--secondary btn--small" href={href(withQuery(`/movimientos/editar/${tx.id}`, { returnTo: BACK }))}>
          {tr.t('capture.review.edit')}
        </a>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void deleteTx(tx.id)}>
          <Icon name="trash" size={16} />
          {tr.t('capture.review.rejected')}
        </button>
      </div>
    </Card>
  )
}

/** Una captura que no se registró sola: no cuenta hasta que la persona la registra. */
function ProposalCard({ proposal: p, tr }: { proposal: CaptureProposal; tr: Texts }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const budget = data.settings.currency
  // Fase 4: un aviso del banco sin formato conocido. Si el texto tiene un único importe con su moneda y es la del
  // presupuesto, se escribe en el campo como sugerencia (se dice); la persona lo comprueba y registra.
  const textAlert = !p.test && p.reason === 'unparsed' && p.amount.kind === 'unreadable' && !!p.rawText
  const [suggested] = useState(() => {
    const guess = textAlert ? singleMarkedAmount(p.rawText!, data.settings) : null
    return guess?.amount.kind === 'budget' ? minorToInputString(guess.amount.minor, budget, fmt.numberLocale) : ''
  })
  const [text, setText] = useState(suggested)
  const [error, setError] = useState<string | null>(null)
  const source = sourceOf(p.origin)
  const name = p.merchant ?? tr.t('capture.proposal.noMerchant')
  // La prueba de Ajustes nunca se registra: solo se descarta.
  const needsAmount = !p.test && p.amount.kind !== 'budget'
  const other = p.similarTxId && data.transactions.some((x) => x.id === p.similarTxId) ? p.similarTxId : undefined
  // Fase 3: la tasa del viaje en curso el día del pago, si hay una escrita para esa moneda. Nunca otra.
  const trip = activeTrip(data, p.date)
  const foreign = p.test ? undefined : foreignAmount(p.amount, trip, fmt.numberLocale)
  const rate = foreign ? tripRate(trip?.trip, foreign.currency) : undefined
  const feeBps = trip?.trip?.feeBps ?? 0
  const withRate = foreign && rate ? convertToBudget(foreign.minor, foreign.currency, budget, rate.rate, feeBps) : null
  // Decisión 181: sin tasa del viaje, la del Banco de Canadá si está encendido (la pide la persona: «Pedir»).
  const bocOn = useBocEnabled()
  const bocOffer = bocOn && !p.test && !!foreign && !rate && bocSeries(budget, foreign.currency) !== null
  const [boc, setBoc] = useState<{ status: 'idle' | 'loading' | 'none' | 'offline' | 'error' } | { status: 'ok'; rate: BocRate }>({ status: 'idle' })
  const withBoc = foreign && boc.status === 'ok' ? convertToBudget(foreign.minor, foreign.currency, budget, boc.rate.rate, feeBps) : null
  const askBoc = async () => {
    if (!foreign) return
    setBoc({ status: 'loading' })
    const r = await lookupBocRate(budget, foreign.currency, p.date, today)
    setBoc(r.status === 'ok' ? { status: 'ok', rate: r.rate } : { status: r.status === 'unsupported' ? 'none' : r.status })
  }
  const why = p.test
    ? tr.t('capture.proposal.why.test')
    : p.reason === 'duplicate'
      ? tr.t('capture.proposal.why.duplicate')
      : textAlert
        ? tr.t('capture.proposal.why.unknownText', { budget })
        : p.amount.kind === 'unreadable'
          ? tr.t('capture.proposal.why.unparsed', { original: p.amount.text, budget })
          : p.reason === 'currency' && p.amount.kind === 'foreign'
            ? tr.t('capture.proposal.why.foreign', { currency: p.amount.currency, original: fmt.moneyIn(p.amount.minor, p.amount.currency), budget })
            : p.reason === 'currency' && p.amount.kind === 'ambiguous'
              ? tr.t('capture.proposal.why.ambiguous', { original: p.amount.text, budget })
              : data.settings.capture?.autoSave === false
                ? tr.t('capture.proposal.why.autoSaveOff')
                : tr.t('capture.proposal.why.manual')

  const register = async (how?: RegisterWith) => {
    let typed: RegisterWith | undefined = how
    if (needsAmount && how === undefined) {
      const parsed = parseMoneyText(text, fmt)
      if (!parsed.ok) return setError(moneyErrorMessage(t, parsed) ?? t('save.error.generic'))
      typed = parsed.minor
    }
    setError(null)
    const { result, saved } = await run((d, c) => registerProposal(d, p.captureId, c, typed))
    if (!result.ok) return setError(result.issues[0] ? issueMessage(t, fmt, result.issues[0]) : t('save.error.generic'))
    toast({ message: saved ? tr.t('capture.proposal.registeredToast', { name }) : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
  }
  const dismiss = async () => {
    const { result, saved } = await run((d, c) => dismissProposals(d, [p.captureId], c))
    const ok = result.ok && saved
    toast({
      message: ok ? tr.t('capture.proposal.dismissedToast') : t('save.error.generic'),
      tone: ok ? 'good' : 'critical',
      ...(ok ? { action: { label: t('common.undo'), onClick: () => void run((d, c) => restoreProposals(d, [p], c)) } } : {}),
    })
  }

  return (
    <Card as="article" className="inbox-item">
      <span className="item__main">
        <span className="item__title">{name}</span>
        <span className="item__meta">
          {fmt.date(p.date, { compact: true, today })} · {categoryLabel(t, p.categoryId)} · {accountName(data.accounts, p.accountId, t)}
        </span>
        <span className="item__badges">
          {p.amount.kind === 'budget' && <Badge>−{fmt.money(p.amount.minor)}</Badge>}
          {foreign && <Badge>−{fmt.moneyIn(foreign.minor, foreign.currency)}</Badge>}
          <Badge icon={SOURCE_ICON[source]}>{tr.t(`capture.source.${source}`)}</Badge>
          {p.card && <Badge icon="creditCard">{p.card}</Badge>}
          {p.test && (
            <Badge tone="info" icon="info">
              {tr.t('capture.proposal.test')}
            </Badge>
          )}
          <Badge tone="warning" icon="eye">
            {tr.t('capture.proposal.badge')}
          </Badge>
        </span>
        <span className="item__meta">{why}</span>
        {p.rawText && <span className="item__meta">{tr.t('capture.review.rawText', { text: p.rawText })}</span>}
      </span>
      {withRate !== null && rate && (
        <div className="stack-sm">
          <p className="item__meta">
            {tr.t(feeBps ? 'capture.proposal.tripRateFee' : 'capture.proposal.tripRate', {
              rate: rateLabel(rate.rate, fmt.numberLocale),
              date: fmt.date(rate.date, { compact: true, today }),
              fee: feeLabel(feeBps, fmt.numberLocale),
              amount: fmt.money(withRate),
            })}
          </p>
          <div className="button-row">
            <button type="button" className="btn btn--primary btn--small" onClick={() => void register({ rate: rate.rate, rateDate: rate.date, feeBps })}>
              <Icon name="plus" size={16} />
              {tr.t('capture.proposal.registerWithRate')}
            </button>
          </div>
          <p className="item__meta">{tr.t('capture.proposal.orActual')}</p>
        </div>
      )}
      {bocOffer && foreign && (
        <div className="stack-sm" data-testid="proposal-boc">
          {withBoc !== null && boc.status === 'ok' ? (
            <>
              <p className="item__meta">
                {tr.t(feeBps ? 'capture.proposal.bocRateFee' : 'capture.proposal.bocRate', {
                  rate: rateLabel(boc.rate.rate, fmt.numberLocale),
                  date: fmt.date(boc.rate.rateDate, { compact: true, today }),
                  fee: feeLabel(feeBps, fmt.numberLocale),
                  amount: fmt.money(withBoc),
                })}
              </p>
              <div className="button-row">
                <button type="button" className="btn btn--primary btn--small" onClick={() => void register({ rate: boc.rate.rate, rateDate: boc.rate.rateDate, feeBps, rateSource: 'boc' })}>
                  <Icon name="plus" size={16} />
                  {tr.t('capture.proposal.registerWithRate')}
                </button>
              </div>
            </>
          ) : (
            <div className="button-row">
              <button type="button" className="btn btn--secondary btn--small" onClick={() => void askBoc()} disabled={boc.status === 'loading'} aria-busy={boc.status === 'loading'}>
                <Icon name="globe" size={16} />
                {tr.t('capture.proposal.bocAsk')}
              </button>
            </div>
          )}
          <p className={boc.status === 'none' || boc.status === 'offline' || boc.status === 'error' ? 'field__error' : 'item__meta'} role="status">
            {(boc.status === 'none' || boc.status === 'offline' || boc.status === 'error') && <Icon name="alert" size={16} />}
            {boc.status === 'loading'
              ? tr.t('capture.proposal.bocLoading')
              : boc.status === 'none'
                ? tr.t('capture.proposal.bocNone', { currency: foreign.currency, from: fmt.date(bocWindow(p.date).start, { compact: true, today }), date: fmt.date(p.date, { compact: true, today }) })
                : boc.status === 'offline'
                  ? tr.t('capture.proposal.bocOffline')
                  : boc.status === 'error'
                    ? tr.t('capture.proposal.bocError')
                    : null}
          </p>
          {withBoc !== null && <p className="item__meta">{tr.t('capture.proposal.orActual')}</p>}
        </div>
      )}
      {needsAmount && (
        <MoneyField
          label={tr.t('capture.proposal.amountLabel', { budget })}
          hint={suggested && text === suggested ? tr.t('capture.proposal.suggested') : tr.t('capture.proposal.amountHelp')}
          value={text}
          onChange={setText}
          error={error}
          fmt={fmt}
          name={`capture-amount-${p.captureId}`}
        />
      )}
      {!needsAmount && error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        {!p.test && (
          <button type="button" className={`btn ${withRate !== null || withBoc !== null ? 'btn--secondary' : 'btn--primary'} btn--small`} onClick={() => void register()}>
            <Icon name="plus" size={16} />
            {tr.t('capture.proposal.register')}
          </button>
        )}
        {other && (
          <a className="btn btn--secondary btn--small" href={href(withQuery(`/movimientos/editar/${other}`, { returnTo: BACK }))}>
            {tr.t('capture.proposal.seeOther')}
          </a>
        )}
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void dismiss()}>
          <Icon name="x" size={16} />
          {tr.t('capture.proposal.dismiss')}
        </button>
      </div>
    </Card>
  )
}
