/** Términos y privacidad (§7.7 · Legal): textos propios del prototipo local, en los cuatro idiomas. */
import { useT } from '../../i18n'
import { usePackT } from '../../i18n/packs'
import { Card, PageHeader } from '../components/common'
import { href, type Route } from '../router'

const PAGES = { terminos: 'terms', privacidad: 'privacy' } as const
type Page = (typeof PAGES)[keyof typeof PAGES]
const SECTIONS: Record<Page, number> = { terms: 5, privacy: 6 }

export function Legal({ route }: { route: Route }) {
  const { t } = useT()
  // Los párrafos viven en un paquete diferido (fuera del JS inicial); la cabecera no.
  const legal = usePackT('legal')
  const page: Page = PAGES[route.segments[1] as keyof typeof PAGES] ?? 'terms'
  return (
    <div className="stack legal">
      <PageHeader title={t(`legal.${page}.title`)} back={{ href: href('/ajustes?seccion=legal'), label: t('settings.title') }} />
      <Card>
        <p className="note">{t('legal.updated')}</p>
        {legal &&
          Array.from({ length: SECTIONS[page] }, (_, i) => i + 1).map((n) => (
            <section key={n} className="stack-sm">
              <h2 className="section-title">{legal(`legal.${page}.${n}.title`)}</h2>
              <p>{legal(`legal.${page}.${n}.text`)}</p>
            </section>
          ))}
      </Card>
    </div>
  )
}
