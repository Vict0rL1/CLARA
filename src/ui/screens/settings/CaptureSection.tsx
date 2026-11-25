/**
 * Ajustes › Captura automática (Fase 2 nativa, decisión 169). Solo existe dentro de la app de iPhone: en el navegador
 * no hay acción de Atajos que anote pagos, así que la sección ni se ofrece (`nativeOnly` en `sections.ts`).
 *
 * - «Guardar automáticamente»: encendido, un pago en la moneda del presupuesto entra como gasto «Por revisar»; apagado,
 *   como propuesta. Otra moneda o un posible duplicado siempre son propuesta (`domain/captureImport.ts`).
 * - Tarjeta → cuenta y la cuenta por defecto (solo cuentas activas).
 * - Guía para crear la automatización y «Probar», que escribe una prueba por el mismo camino que un pago real
 *   (`state/captureSync.ts`); la prueba nunca cuenta en ninguna cifra.
 * - Fase 4 (decisiones 183 y 185): guía de los avisos del banco por SMS («Registrar desde texto en Clara»), «Probar un
 *   aviso» (lee el texto pegado con `domain/bankAlert.ts` y dice qué haría Clara; no guarda nada) y «Nuevo gasto en un
 *   toque» (botón de Acción, Tocar atrás, Siri).
 *
 * Textos en el paquete diferido `capture`; el título de la sección está en el diccionario principal (índice y búsqueda).
 */
import { useMemo, useState } from 'react'
import { activeAccounts } from '../../../domain/balances'
import { BANK_ALERT_PATTERNS, readBankAlert, type BankAlertRead } from '../../../domain/bankAlert'
import type { CaptureAmount } from '../../../domain/captureQueue'
import { updateSettings } from '../../../domain/operations'
import { normalizeText } from '../../../domain/text'
import type { CaptureSettings, Language } from '../../../domain/types'
import { useT } from '../../../i18n'
import { packTranslator, usePack } from '../../../i18n/packs'
import { nativeServices } from '../../../platform'
import { useRun } from '../../../state/hooks'
import { useData } from '../../../state/store'
import { Toggle } from '../../components/base'
import { Alert, Card } from '../../components/common'
import { SelectField, TextAreaField, TextField } from '../../components/fields'
import { Icon } from '../../components/Icon'
import { PackLangScope } from '../../components/PackLangScope'
import { PackNotice } from '../../components/PackNotice'
import { useToast } from '../../components/toastContext'
import { useFormat } from '../../format'
import { accountLabel } from '../../labels'
import { href } from '../../router'

const DEFAULTS: CaptureSettings = { autoSave: true, cardAccounts: [] }

export function CaptureSection() {
  const { t } = useT()
  const pack = usePack('capture')
  return (
    <Card labelledBy="captura">
      <h2 id="captura" className="card__title">
        {t('settings.capture.title')}
      </h2>
      <PackNotice state={pack} />
      {pack.status === 'ready' && (
        <PackLangScope fallback={pack.fallback}>
          <CaptureBody texts={pack.texts} packLanguage={pack.language} />
        </PackLangScope>
      )}
    </Card>
  )
}

function CaptureBody({ texts, packLanguage }: { texts: Record<string, string>; packLanguage: Language }) {
  const base = useT()
  const { t } = useMemo(() => packTranslator(texts, packLanguage, base), [texts, packLanguage, base])
  const fmt = useFormat()
  const data = useData()
  const run = useRun()
  const toast = useToast()
  const capture = data.settings.capture ?? DEFAULTS
  const accounts = activeAccounts(data.accounts)
  const accountOptions = accounts.map((a) => ({ value: a.id, label: accountLabel(a, base.t) }))
  const [card, setCard] = useState('')
  const [cardAccount, setCardAccount] = useState(accounts[0]?.id ?? '')
  const [cardError, setCardError] = useState<string | null>(null)
  const [test, setTest] = useState<'idle' | 'running' | 'ok' | 'failed'>('idle')
  const [alertText, setAlertText] = useState('')
  const [alertRead, setAlertRead] = useState<BankAlertRead | null>(null)
  const [alertError, setAlertError] = useState<string | null>(null)

  const save = async (next: CaptureSettings) => {
    const { result, saved } = await run((d, c) => updateSettings(d, { capture: next }, c))
    const ok = result.ok && saved
    toast({ message: base.t(ok ? 'settings.saved' : 'save.error.generic'), tone: ok ? 'good' : 'critical' })
    return ok
  }

  const addCard = async () => {
    const name = card.replace(/\s+/g, ' ').trim()
    if (!name) return setCardError(t('capture.settings.cardEmpty'))
    if (capture.cardAccounts.some((m) => normalizeText(m.card) === normalizeText(name))) return setCardError(t('capture.settings.cardDuplicate'))
    setCardError(null)
    if (await save({ ...capture, cardAccounts: [...capture.cardAccounts, { card: name.slice(0, 64), accountId: cardAccount }] })) setCard('')
  }

  // «Probar un aviso»: solo lee el texto en memoria; no se guarda ni sale del iPhone.
  const readAlert = () => {
    if (!alertText.trim()) {
      setAlertRead(null)
      return setAlertError(t('capture.settings.smsTestEmpty'))
    }
    setAlertError(null)
    setAlertRead(readBankAlert(alertText, data.settings))
  }
  const amountText = (a: CaptureAmount, written?: string) =>
    a.kind === 'budget' ? fmt.money(a.minor) : a.kind === 'foreign' ? fmt.moneyIn(a.minor, a.currency) : (written ?? a.text)

  const runTest = async () => {
    setTest('running')
    const tester = nativeServices().captureTest
    setTest(tester && (await tester(t('capture.settings.testMerchant'))) ? 'ok' : 'failed')
  }

  return (
    <div className="stack-sm">
      <p className="note">{t('capture.settings.intro')}</p>
      <Toggle
        label={t('capture.settings.autoSave')}
        hint={t('capture.settings.autoSaveHelp', { currency: data.settings.currency })}
        checked={capture.autoSave}
        onChange={(on) => void save({ ...capture, autoSave: on })}
      />
      <SelectField
        label={t('capture.settings.defaultAccount')}
        hint={t('capture.settings.defaultAccountHelp')}
        value={capture.defaultAccountId && accounts.some((a) => a.id === capture.defaultAccountId) ? capture.defaultAccountId : ''}
        onChange={(e) => {
          const { defaultAccountId: _old, ...rest } = capture
          void save(e.target.value ? { ...rest, defaultAccountId: e.target.value } : rest)
        }}
        options={[{ value: '', label: t('capture.settings.firstActive') }, ...accountOptions]}
      />

      <h3 className="section-title">{t('capture.settings.cardsTitle')}</h3>
      <p className="field__hint">{t('capture.settings.cardsHelp')}</p>
      {capture.cardAccounts.length > 0 && (
        <ul className="item-list" data-testid="capture-cards">
          {capture.cardAccounts.map((m) => (
            <li key={m.card} className="item item--stacked">
              <SelectField
                label={t('capture.settings.cardAccount', { card: m.card })}
                value={m.accountId}
                onChange={(e) => void save({ ...capture, cardAccounts: capture.cardAccounts.map((x) => (x.card === m.card ? { ...x, accountId: e.target.value } : x)) })}
                options={accounts.some((a) => a.id === m.accountId) ? accountOptions : [{ value: m.accountId, label: '—' }, ...accountOptions]}
              />
              <button type="button" className="btn btn--ghost btn--small" onClick={() => void save({ ...capture, cardAccounts: capture.cardAccounts.filter((x) => x.card !== m.card) })}>
                <Icon name="trash" size={16} />
                {t('capture.settings.removeCard', { card: m.card })}
              </button>
            </li>
          ))}
        </ul>
      )}
      <TextField label={t('capture.settings.cardName')} value={card} onChange={(e) => setCard(e.target.value)} error={cardError} maxLength={64} autoComplete="off" />
      {accountOptions.length > 0 && (
        <SelectField label={t('capture.settings.newCardAccount')} value={cardAccount} onChange={(e) => setCardAccount(e.target.value)} options={accountOptions} />
      )}
      <button type="button" className="btn btn--secondary" onClick={() => void addCard()} disabled={accountOptions.length === 0}>
        <Icon name="plus" size={16} />
        {t('capture.settings.addCard')}
      </button>

      <h3 className="section-title">{t('capture.settings.guideTitle')}</h3>
      <ol className="bullets">
        {(['guide1', 'guide2', 'guide3', 'guide4', 'guide5'] as const).map((k) => (
          <li key={k}>{t(`capture.settings.${k}`)}</li>
        ))}
      </ol>
      <p className="note">{t('capture.settings.guideNote')}</p>

      <h3 className="section-title">{t('capture.settings.testTitle')}</h3>
      <p className="field__hint">{t('capture.settings.testHelp', { amount: fmt.money(1) })}</p>
      <button type="button" className="btn btn--secondary" onClick={() => void runTest()} disabled={test === 'running'} data-testid="capture-test">
        <Icon name="check" size={16} />
        {t('capture.settings.testButton')}
      </button>
      {test === 'ok' && (
        <Alert tone="good" title={t('capture.settings.testOk')}>
          <a href={href('/pendientes')}>{base.t('inbox.title')}</a>
        </Alert>
      )}
      {test === 'failed' && <Alert tone="critical" title={t('capture.settings.testFailed')} />}

      <h3 className="section-title">{t('capture.settings.smsTitle')}</h3>
      <p className="note">{t('capture.settings.smsHelp')}</p>
      <p className="note" data-testid="capture-sms-state">
        {t(BANK_ALERT_PATTERNS.length === 0 ? 'capture.settings.smsStateNone' : 'capture.settings.smsStateSome')}
      </p>
      <ol className="bullets">
        {(['sms1', 'sms2', 'sms3', 'sms4', 'sms5'] as const).map((k) => (
          <li key={k}>{t(`capture.settings.${k}`)}</li>
        ))}
      </ol>
      <p className="note">{t('capture.settings.smsNote')}</p>

      <h3 className="section-title">{t('capture.settings.smsTestTitle')}</h3>
      <TextAreaField
        label={t('capture.settings.smsTestLabel')}
        hint={t('capture.settings.smsTestHelp')}
        value={alertText}
        onChange={(e) => {
          setAlertText(e.target.value)
          setAlertRead(null)
        }}
        error={alertError}
        rows={3}
        maxLength={2000}
        autoComplete="off"
        spellCheck={false}
      />
      <button type="button" className="btn btn--secondary" onClick={readAlert} data-testid="capture-sms-test">
        <Icon name="search" size={16} />
        {t('capture.settings.smsTestButton')}
      </button>
      {alertRead && (
        <p className="note" role="status" data-testid="capture-sms-result">
          <Icon name="info" size={16} />{' '}
          {alertRead.kind === 'known'
            ? alertRead.merchant
              ? t('capture.settings.smsTestKnown', { amount: amountText(alertRead.amount), merchant: alertRead.merchant })
              : t('capture.settings.smsTestKnownNoMerchant', { amount: amountText(alertRead.amount) })
            : alertRead.guess
              ? t('capture.settings.smsTestGuess', { amount: amountText(alertRead.guess.amount, alertRead.guess.text) })
              : t('capture.settings.smsTestNoGuess')}
        </p>
      )}

      <h3 className="section-title">{t('capture.settings.oneTapTitle')}</h3>
      <p className="note">{t('capture.settings.oneTapHelp')}</p>
      <ul className="bullets">
        {(['oneTapAction', 'oneTapBackTap', 'oneTapSiri'] as const).map((k) => (
          <li key={k}>{t(`capture.settings.${k}`)}</li>
        ))}
      </ul>
    </div>
  )
}
