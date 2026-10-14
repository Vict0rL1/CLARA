/**
 * Ajustes › Copias locales automáticas (§7.7): cada 24 h, últimas 10, antes de operaciones
 * críticas; «Hacer copia ahora»; lista con fecha y tamaño; restaurar con vista previa y
 * confirmación; borrar. Una copia local vive en este navegador: no sustituye a exportar.
 */
import { useState } from 'react'
import { parseBackup } from '../../../storage/backup'
import type { LocalBackupMeta } from '../../../storage/autoBackup'
import type { AppData } from '../../../domain/types'
import { useT, type MessageKey } from '../../../i18n'
import { useData } from '../../../state/store'
import { replaceWithUndo } from '../../../state/replaceUndo'
import { APP_VERSION, downloadText } from '../../backupActions'
import { Alert, Card } from '../../components/common'
import { ConfirmDialog } from '../../components/Dialog'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/toastContext'
import { useFormat } from '../../format'
import { localBackups, useLocalBackupList } from '../../useAutoBackup'

function sizeText(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function BackupsSection() {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const toast = useToast()
  const { list, refresh, available } = useLocalBackupList()
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState<{ meta: LocalBackupMeta; data: AppData } | null>(null)

  const backupNow = async () => {
    const b = localBackups()
    if (!b || busy) return
    setBusy(true)
    try {
      await b.save(data, 'manual', new Date(), APP_VERSION)
      refresh()
      toast({ message: t('localBackup.saved'), tone: 'good' })
    } catch {
      toast({ message: t('localBackup.failed'), tone: 'critical' })
    } finally {
      setBusy(false)
    }
  }

  const preview = async (meta: LocalBackupMeta) => {
    const b = localBackups()
    if (!b) return
    const json = await b.read(meta.id)
    const parsed = json ? parseBackup(json) : null
    if (!parsed || !parsed.ok) {
      toast({ message: t('localBackup.invalid'), tone: 'critical' })
      return
    }
    setRestoring({ meta, data: parsed.data })
  }

  const restore = async () => {
    const b = localBackups()
    if (!restoring || !b) return
    const target = restoring
    setRestoring(null)
    // Copia de lo actual ANTES de sustituirlo: restaurar es una operación crítica.
    try {
      await b.save(data, 'beforeRestore', new Date(), APP_VERSION)
    } catch {
      toast({ message: t('localBackup.failed'), tone: 'critical' })
      return
    }
    const { ok, undo } = await replaceWithUndo(target.data)
    refresh()
    toast({
      message: ok ? t('localBackup.restored') : t('save.error.generic'),
      tone: ok ? 'good' : 'critical',
      ...(ok
        ? {
            action: {
              label: t('common.undo'),
              onClick: async () => {
                // REC-01: deshacer solo si nada cambió desde la restauración; lo anterior sigue en «Antes de restaurar».
                const r = await undo()
                toast(
                  r === 'undone'
                    ? { message: t('localBackup.restoreUndone'), tone: 'good' }
                    : r === 'stale'
                      ? { message: t('replace.undoStale'), tone: 'critical', durationMs: 12_000 }
                      : { message: t('save.error.generic'), tone: 'critical' },
                )
              },
            },
          }
        : {}),
    })
  }

  const download = async (meta: LocalBackupMeta) => {
    const json = await localBackups()?.read(meta.id)
    if (json) downloadText(`clara-copia-local-${meta.createdAt.slice(0, 16).replace(/[:T]/g, '-')}.json`, json)
  }

  const remove = async (meta: LocalBackupMeta) => {
    await localBackups()?.remove(meta.id)
    refresh()
    toast({ message: t('localBackup.deleted'), tone: 'info' })
  }

  return (
    <Card labelledBy="local-backups-title">
      <h2 id="copias-locales" className="card__title">
        <span id="local-backups-title">{t('localBackup.title')}</span>
      </h2>
      <p className="note">{t('localBackup.intro')}</p>
      <Alert tone="neutral" icon="shield" title={t('localBackup.notRemote')} />
      {!available ? (
        <p className="note">{t('localBackup.unavailable')}</p>
      ) : (
        <>
          <div className="button-row">
            <button type="button" className="btn btn--secondary" onClick={() => void backupNow()} disabled={busy} data-testid="backup-now">
              <Icon name="shield" size={16} />
              {t('localBackup.now')}
            </button>
          </div>
          {list === null ? null : list.length === 0 ? (
            <p className="note">{t('localBackup.empty')}</p>
          ) : (
            <ul className="item-list" data-testid="local-backup-list">
              {list.map((b) => (
                <li key={b.id} className="item item--stacked">
                  <div className="item__row">
                    <span className="item__main">
                      <span className="item__title">{fmt.timestamp(b.createdAt)}</span>
                      <span className="item__meta">
                        {t(`localBackup.reason.${b.reason}` as MessageKey)} · {sizeText(b.size)} · {tn('localBackup.movements', b.counts.transactions)} · {tn('localBackup.accounts', b.counts.accounts)}
                        {b.budgetId !== data.budgetId ? ` · ${t('localBackup.otherBudget')}` : ''}
                      </span>
                    </span>
                  </div>
                  <div className="item__actions">
                    <button type="button" className="btn btn--small btn--primary" onClick={() => void preview(b)}>
                      {t('localBackup.restore')}
                      <span className="sr-only">: {fmt.timestamp(b.createdAt)}</span>
                    </button>
                    <button type="button" className="btn btn--small btn--ghost" onClick={() => void download(b)}>
                      <Icon name="download" size={16} />
                      {t('localBackup.download')}
                      <span className="sr-only">: {fmt.timestamp(b.createdAt)}</span>
                    </button>
                    <button type="button" className="btn btn--small btn--danger-ghost" onClick={() => void remove(b)}>
                      {t('common.delete')}
                      <span className="sr-only">: {fmt.timestamp(b.createdAt)}</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ConfirmDialog open={!!restoring} title={t('localBackup.restoreTitle')} confirmLabel={t('localBackup.restore')} onConfirm={() => void restore()} onCancel={() => setRestoring(null)} destructive>
        {restoring && (
          <>
            <p>{t('localBackup.restoreText', { when: fmt.timestamp(restoring.meta.createdAt) })}</p>
            <ul className="bullets">
              <li>{t('settings.backup.summaryCurrency', { currency: restoring.data.settings.currency })}</li>
              <li>{t('settings.backup.summaryCounts', { accounts: restoring.data.accounts.length, movements: restoring.data.transactions.length, schedules: restoring.data.schedules.length, goals: restoring.data.goals.length })}</li>
              <li>{t('localBackup.categoriesCount', { count: restoring.data.categories.length })}</li>
              {restoring.data.isDemo && <li>{t('settings.backup.summaryDemo')}</li>}
            </ul>
            <p className="note">{t('localBackup.restoreHint')}</p>
          </>
        )}
      </ConfirmDialog>
    </Card>
  )
}
