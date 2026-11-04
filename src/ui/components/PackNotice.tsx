/**
 * Estado de un paquete de texto diferido (`usePack`): cargando, fallido con «Reintentar» y «Recargar la app», o
 * cargado en español porque el idioma pedido no cargó. Nunca enseña claves internas (auditoría del 2026-11-02, P3).
 */
import type { PackState } from '../../i18n/packs'
import { useT } from '../../i18n'
import { Alert } from './common'

export function PackNotice({ state }: { state: PackState }) {
  const { t } = useT()
  if (state.status === 'loading') {
    return (
      <p className="note" role="status" data-testid="pack-loading">
        {t('packs.loading')}
      </p>
    )
  }
  if (state.status === 'failed') {
    return (
      <div data-testid="pack-failed">
        <Alert
          tone="warning"
          title={t('packs.failedTitle')}
          role="alert"
          actions={
            <>
              <button type="button" className="btn btn--secondary btn--small" onClick={state.retry}>
                {t('packs.retry')}
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => window.location.reload()}>
                {t('packs.reload')}
              </button>
            </>
          }
        >
          {t('packs.failedText')}
        </Alert>
      </div>
    )
  }
  if (!state.fallback) return null
  return (
    <p className="note note--icon" role="status" data-testid="pack-fallback">
      {t('packs.fallbackNote')}{' '}
      <button type="button" className="btn btn--ghost btn--small" onClick={state.retry}>
        {t('packs.retry')}
      </button>
    </p>
  )
}
