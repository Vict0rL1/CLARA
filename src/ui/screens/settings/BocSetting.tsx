/**
 * Ajustes › Formato y moneda › Tasas del Banco de Canadá (Fase 3, decisión 181). Se carga aparte (`lazy` en
 * `Settings.tsx`) con sus textos en el paquete diferido `fx`: el JS inicial no crece.
 *
 * Apagado por defecto y de este dispositivo (`state/bocRates.ts`). Solo tiene sentido con presupuesto en CAD: con otra
 * moneda el interruptor no se ofrece y se dice por qué. Explica qué se envía (la moneda y dos fechas, nada de la
 * persona), que es una tasa indicativa, dónde se usa y que las tasas pedidas se guardan solo en el dispositivo.
 */
import { useMemo } from 'react'
import type { Language } from '../../../domain/types'
import { useT } from '../../../i18n'
import { packTranslator, usePack } from '../../../i18n/packs'
import { setBocEnabled, useBocEnabled } from '../../../state/bocRates'
import { useData } from '../../../state/store'
import { Toggle } from '../../components/base'
import { PackLangScope } from '../../components/PackLangScope'
import { PackNotice } from '../../components/PackNotice'
import { useToast } from '../../components/toastContext'

export default function BocSetting() {
  const pack = usePack('fx')
  if (pack.status === 'failed') return <PackNotice state={pack} />
  if (pack.status !== 'ready') return null
  return (
    <PackLangScope fallback={pack.fallback}>
      <BocBody texts={pack.texts} packLanguage={pack.language} />
    </PackLangScope>
  )
}

function BocBody({ texts, packLanguage }: { texts: Record<string, string>; packLanguage: Language }) {
  const base = useT()
  const { t } = useMemo(() => packTranslator(texts, packLanguage, base), [texts, packLanguage, base])
  const data = useData()
  const toast = useToast()
  const enabled = useBocEnabled()
  const budget = data.settings.currency
  const cad = budget === 'CAD'

  const change = (on: boolean) => {
    const ok = setBocEnabled(on)
    toast({ message: base.t(ok ? 'settings.saved' : 'save.error.generic'), tone: ok ? 'good' : 'critical' })
  }

  return (
    <section className="field stack-sm" aria-labelledby="boc-title" data-testid="boc-setting">
      <h3 className="field__label" id="boc-title">
        {t('fx.boc.title')}
      </h3>
      {cad ? (
        <Toggle checked={enabled} onChange={change} label={t('fx.boc.toggle')} hint={t('fx.boc.toggleHelp')} />
      ) : (
        <p className="field__hint" data-testid="boc-only-cad">
          {t('fx.boc.onlyCad', { budget })}
        </p>
      )}
      <p className="field__hint">{t('fx.boc.what')}</p>
      {cad && <p className="field__hint">{t('fx.boc.where')}</p>}
      {cad && <p className="field__hint">{t('fx.boc.cache')}</p>}
      <p className="field__hint">{t('fx.boc.source')}</p>
    </section>
  )
}
