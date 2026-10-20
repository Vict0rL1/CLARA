/**
 * Historial local de cambios (Ajustes › Historial). Muestra qué cambió, cuándo y los valores
 * anteriores y nuevos, con acceso al registro. «Revertir» solo se ofrece si nada cambió
 * después; si no, se explica qué registro cambió. Ver domain/history.ts.
 */
import { useMemo, useState } from 'react'
import { canRevert, revertConflicts, revertDependents, revertEntry } from '../../domain/historyRevert'
import type { HistoryEntry } from '../../domain/types'
import type { Issue } from '../../domain/validation'
import { useT } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { validateAppData } from '../../storage/backup'
import { Alert, Badge, Card, EmptyState, PageHeader } from '../components/common'
import { ConfirmDialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { useFormat } from '../format'
import { issueMessage } from '../labels'
import { describeChange, type Line } from '../historyText'
import { href } from '../router'

const PAGE = 30

export function History() {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const run = useRun()
  const today = useToday()
  const toast = useToast()
  const [limit, setLimit] = useState(PAGE)
  const [confirm, setConfirm] = useState<HistoryEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const entries = useMemo(() => [...data.history].reverse(), [data.history])
  const shown = entries.slice(0, limit)

  const revert = async (entry: HistoryEntry) => {
    setConfirm(null)
    const { result, saved } = await run(
      (d, c) => {
        const r = revertEntry(d, entry.id, c)
        if (!r.ok) return r
        // El resultado se valida completo: nunca se guardan datos incoherentes (p. ej. un pago
        // liquidado dos veces o una devolución sin su compra).
        const v = validateAppData(JSON.parse(JSON.stringify(r.data)))
        return v.ok ? r : { ok: false as const, issues: v.issues as Issue[] }
      },
      { source: 'revert', revertOf: entry.id },
    )
    if (!result.ok) return setError(issueMessage(t, fmt, result.issues[0]!))
    setError(null)
    toast({ message: saved ? t('history.reverted') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
  }

  return (
    <div className="stack">
      <PageHeader title={t('history.title')} back={{ href: href('/ajustes'), label: t('nav.settings') }} />
      <Alert tone="info" title={t('history.localTitle')}>
        {t('history.localText', { date: fmt.timestamp(data.historyStartedAt), max: 1000 })}
      </Alert>
      {error && <Alert tone="critical" title={error} role="alert" />}
      {entries.length === 0 ? (
        <EmptyState icon="clock" title={t('history.empty')} text={t('history.emptyText')} />
      ) : (
        <ul className="item-list history-list" aria-label={t('history.title')}>
          {shown.map((entry) => {
            const lines = entry.changes.map((c) => describeChange(c, entry, data, t, fmt)).filter((l): l is Line => l !== null)
            const status = canRevert(data, entry, today)
            const conflicts = status === 'conflict' ? revertConflicts(data, entry, today) : []
            // F-02: lo que seguiría apuntando a un programado que la reversión eliminaría (misma regla que `revertEntry`).
            const dependents = status === 'dependents' ? revertDependents(data, entry, today) : []
            const original = entry.revertOf ? data.history.find((e) => e.id === entry.revertOf) : undefined
            return (
              <li key={entry.id}>
                <Card as="article" className="history-entry">
                  <p className="item__meta">
                    <Icon name="clock" size={14} /> {fmt.timestamp(entry.at)}
                    {entry.source === 'revert' && <Badge icon="refund">{t('history.badge.revert')}</Badge>}
                    {entry.source === 'plan' && <Badge icon="calendar">{t('history.badge.plan')}</Badge>}
                    {status === 'alreadyReverted' && <Badge tone="info" icon="check">{t('history.badge.reverted')}</Badge>}
                  </p>
                  {entry.source === 'replace' ? (
                    <p className="item__title">{t('history.replace')}</p>
                  ) : (
                    <ul className="stack-sm">
                      {lines.map((l, i) => (
                        <li key={i}>
                          <span className="item__title">{l.link ? <a href={href(l.link)}>{l.text}</a> : l.text}</span>
                          {l.details.length > 0 && (
                            <ul className="bullets history-details">
                              {l.details.map((d, j) => (
                                <li key={j}>{d}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {original && <p className="note">{t('history.revertOf', { date: fmt.timestamp(original.at) })}</p>}
                  {status === 'ok' && (
                    <div className="button-row">
                      <button type="button" className="btn btn--secondary btn--small" onClick={() => setConfirm(entry)}>
                        <Icon name="refund" size={16} />
                        {t('history.revert')}
                      </button>
                    </div>
                  )}
                  {status === 'conflict' && <p className="note note--icon">{tn('history.conflict', conflicts.length)}</p>}
                  {status === 'dependents' && (
                    <div className="stack-sm" data-testid="history-dependents">
                      <p className="note note--icon">{tn('history.dependents', dependents.length)}</p>
                      <ul className="bullets history-details">
                        {dependents.map((d) => (
                          <li key={`${d.kind}:${d.id}`}>{d.kind === 'snooze' ? t('history.dependent.snooze', { date: fmt.date(d.name, { compact: true, today }) }) : t(`history.dependent.${d.kind}`, { name: d.name })}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      {entries.length > shown.length && (
        <button type="button" className="btn btn--secondary" onClick={() => setLimit((l) => l + PAGE)}>
          {t('movements.showMore', { count: entries.length - shown.length })}
        </button>
      )}
      <ConfirmDialog
        open={!!confirm}
        title={t('history.confirmTitle')}
        confirmLabel={t('history.revert')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void revert(confirm)}
      >
        <p>{t('history.confirmText')}</p>
        {confirm && (
          <ul className="bullets">
            {confirm.changes
              .map((c) => describeChange(c, confirm, data, t, fmt))
              .filter((l): l is Line => l !== null)
              .map((l, i) => (
                <li key={i}>{l.text}</li>
              ))}
          </ul>
        )}
      </ConfirmDialog>
    </div>
  )
}
