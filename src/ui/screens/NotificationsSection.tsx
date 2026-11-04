/** Ajustes › Notificaciones (§9): avisos locales con horas de silencio; permiso explícito; nada simulado. */
import { useState } from 'react'
import { updateSettings } from '../../domain/operations'
import type { NotificationSettings } from '../../domain/types'
import { useT } from '../../i18n'
import { useRun } from '../../state/hooks'
import { useData } from '../../state/store'
import { TimePickerRow, Toggle } from '../components/base'
import { Alert, Card } from '../components/common'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { notificationPermission, requestNotificationPermission, translateNotice, useDueNotices } from '../notifications'
import { href } from '../router'

export function NotificationsSection() {
  const { t } = useT()
  const data = useData()
  const run = useRun()
  const toast = useToast()
  const [permission, setPermission] = useState(notificationPermission)
  const due = useDueNotices(data, 0)
  const settings = data.settings.notifications

  const set = async (patch: Partial<NotificationSettings>) => {
    const turningOn = Object.values(patch).some((v) => v === true)
    if (turningOn && permission === 'default') setPermission(await requestNotificationPermission())
    const { saved } = await run((d, c) => updateSettings(d, { notifications: { ...d.settings.notifications, ...patch } }, c))
    if (!saved) toast({ message: t('save.error.generic'), tone: 'critical' })
  }

  const test = async () => {
    const p = permission === 'default' ? await requestNotificationPermission() : permission
    setPermission(p)
    if (p !== 'granted') return
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
      if (reg?.showNotification) await reg.showNotification('Clara', { body: t('settings.notifications.testBody'), tag: 'clara-test' })
      else new Notification('Clara', { body: t('settings.notifications.testBody') })
    } catch {
      toast({ message: t('settings.notifications.permission.unsupported'), tone: 'critical' })
    }
  }

  return (
    <Card labelledBy="notificaciones">
      <h2 id="notificaciones" className="card__title">
        {t('settings.notifications.title')}
      </h2>
      <p className="note">{t('settings.notifications.intro')}</p>
      <p>
        <strong>{t('settings.notifications.permission')}:</strong> {t(`settings.notifications.permission.${permission}`)}
      </p>
      {permission === 'default' && (
        <button type="button" className="btn btn--secondary btn--small" onClick={() => void requestNotificationPermission().then(setPermission)}>
          {t('settings.notifications.request')}
        </button>
      )}
      <Toggle checked={settings.scheduledAlerts} onChange={(v) => void set({ scheduledAlerts: v })} label={t('settings.notifications.scheduled')} />
      <Toggle checked={settings.dailyReminder} onChange={(v) => void set({ dailyReminder: v })} label={t('settings.notifications.reminder')} hint={t('settings.notifications.reminderHint')} />
      {settings.dailyReminder && <TimePickerRow label={t('settings.notifications.time')} value={settings.dailyReminderTime} onChange={(v) => void set({ dailyReminderTime: v })} />}
      <Toggle checked={settings.dailySummary} onChange={(v) => void set({ dailySummary: v })} label={t('settings.notifications.summary')} />
      {settings.dailySummary && <TimePickerRow label={t('settings.notifications.time')} value={settings.dailySummaryTime} onChange={(v) => void set({ dailySummaryTime: v })} />}
      <Toggle checked={settings.planAlerts} onChange={(v) => void set({ planAlerts: v })} label={t('settings.notifications.plans')} hint={t('settings.notifications.plansHint')} />
      <Toggle checked={settings.quietHours} onChange={(v) => void set({ quietHours: v })} label={t('settings.notifications.quiet')} />
      {settings.quietHours && (
        <>
          <TimePickerRow label={t('settings.notifications.quietFrom')} value={settings.quietFrom} onChange={(v) => void set({ quietFrom: v })} />
          <TimePickerRow label={t('settings.notifications.quietTo')} value={settings.quietTo} onChange={(v) => void set({ quietTo: v })} />
        </>
      )}
      <button type="button" className="btn btn--ghost btn--small" onClick={() => void set({ scheduledAlerts: false, dailyReminder: false, dailySummary: false, planAlerts: false })} disabled={!settings.scheduledAlerts && !settings.dailyReminder && !settings.dailySummary && !settings.planAlerts}>
        <Icon name="x" size={16} />
        {t('settings.notifications.disableAll')}
      </button>
      <p className="note">{t('settings.notifications.timeZoneNote', { zone: data.settings.timeZone })}</p>
      <p className="field__label">{t('settings.notifications.inApp')}</p>
      {due.length === 0 ? (
        <p className="muted">{t('settings.notifications.none')}</p>
      ) : (
        <div className="stack-sm" data-testid="due-notices">
          {due.map((n) => {
            const { title, body } = translateNotice(t, n)
            return (
              <Alert key={n.key} tone="info" title={title} actions={<a className="btn btn--small btn--secondary" href={href(n.href)}>{t('notify.open')}</a>}>
                {body}
              </Alert>
            )
          })}
        </div>
      )}
      {permission !== 'unsupported' && permission !== 'denied' && (
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void test()}>
          <Icon name="bell" size={16} />
          {t('settings.notifications.test')}
        </button>
      )}
    </Card>
  )
}
