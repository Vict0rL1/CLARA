import { useMemo } from 'react'
import type { Language } from '../../../domain/types'
import { useT } from '../../../i18n'
import { packTranslator, usePack } from '../../../i18n/packs'
import { Alert, Card } from '../../components/common'
import { PackLangScope } from '../../components/PackLangScope'
import { PackNotice } from '../../components/PackNotice'
import { href } from '../../router'

/**
 * Ajustes › «Clara en este iPhone»: lo que en la web es «Instalar Clara», dentro de la app de iPhone (decisión 164).
 * Aquí no hay nada que instalar: se explica dónde están los datos, cómo traer los de la versión web, cómo se actualiza
 * y que con una cuenta gratuita de Apple caduca a los 7 días. Los textos van en el paquete diferido `nativeApp`, que
 * solo se pide dentro de la app.
 */
export function NativeAppSection() {
  const { t } = useT()
  const pack = usePack('nativeApp')
  return (
    <Card labelledBy="instalar">
      <h2 id="instalar" className="card__title">
        {t('install.title')}
      </h2>
      <div data-testid="native-app-guide">
        <PackNotice state={pack} />
        {pack.status === 'ready' && (
          <PackLangScope fallback={pack.fallback}>
            <NativeAppGuide texts={pack.texts} packLanguage={pack.language} />
          </PackLangScope>
        )}
      </div>
    </Card>
  )
}

function NativeAppGuide({ texts, packLanguage }: { texts: Record<string, string>; packLanguage: Language }) {
  // Dentro del ámbito del paquete: con el respaldo en español, este traductor ya es el español.
  const base = useT()
  const { t } = useMemo(() => packTranslator(texts, packLanguage, base), [texts, packLanguage, base])
  // Los nombres de la sección y de los botones salen de la interfaz: así las instrucciones dicen lo que se ve.
  const names = { backup: base.t('settings.toc.backup'), export: base.t('settings.backup.export'), import: base.t('settings.backup.import') }
  return (
    <>
      <p>{t('nativeApp.intro')}</p>
      <section className="stack-sm">
        <h3 className="section-title">{t('nativeApp.data.title')}</h3>
        <p>{t('nativeApp.data.text')}</p>
      </section>
      <section className="stack-sm">
        <h3 className="section-title">{t('nativeApp.bring.title')}</h3>
        <ol className="bullets">
          <li>{t('nativeApp.bring.step1', names)}</li>
          <li>{t('nativeApp.bring.step2')}</li>
          <li>{t('nativeApp.bring.step3', names)}</li>
        </ol>
        <p>
          <a href={href('/ajustes/copia')}>{t('nativeApp.bring.link', names)}</a>
        </p>
      </section>
      <section className="stack-sm">
        <h3 className="section-title">{t('nativeApp.update.title')}</h3>
        <p>{t('nativeApp.update.text')}</p>
      </section>
      <section className="stack-sm">
        <h3 className="section-title">{t('nativeApp.expiry.title')}</h3>
        <p>{t('nativeApp.expiry.text')}</p>
      </section>
      <Alert tone="info" icon="info" title={t('nativeApp.backupFirst')} />
    </>
  )
}
