/**
 * Avisos locales (§9) en el navegador: cada minuto (y al volver a la pestaña) se calculan los
 * avisos debidos con reglas puras (`domain/notifications.ts`), se descartan los ya mostrados
 * (claves en localStorage, por día) y se muestran con la Notification API si hay permiso.
 * Dentro de la app siempre quedan visibles en Ajustes › Notificaciones. Sin permiso o sin
 * soporte no se simula nada.
 */
import { useEffect, useMemo, useState } from 'react'
import { todayInTimeZone } from '../domain/dates'
import { dueNotices, type LocalNotice } from '../domain/notifications'
import type { AppData } from '../domain/types'
import { useT, type MessageKey } from '../i18n'
import { useData } from '../state/store'
import { useFormat } from './format'
import { planItemName, planTitle } from './labels'
import { navigate } from './router'

const SHOWN_KEY = 'clara.notified.v1'

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

function readShown(): Set<string> {
  try {
    const raw = localStorage.getItem(SHOWN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function writeShown(keys: Set<string>, today: string) {
  try {
    // Solo se conservan las de hoy (las claves llevan la fecha).
    // Las alertas de planes llevan el inicio del ciclo y los hitos de metas no llevan fecha: se conservan
    // para no repetirlos cada día.
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...keys].filter((k) => k.endsWith(today) || k.startsWith('plan') || k.startsWith('goal')).slice(-200)))
  } catch {
    // Sin almacenamiento: se repetirían al recargar; aceptable.
  }
}

function localClock(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${h}:${m}`
}

async function showSystemNotification(title: string, body: string, href: string, tag: string) {
  if (notificationPermission() !== 'granted') return
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (reg?.showNotification) {
      await reg.showNotification(title, { body, tag, data: { href }, icon: '/icon-192.png' })
      return
    }
    const n = new Notification(title, { body, tag })
    n.onclick = () => {
      window.focus()
      navigate(href)
      n.close()
    }
  } catch {
    // El navegador puede rechazarlo (p. ej. sin interacción previa): queda el aviso dentro de la app.
  }
}

/** Avisos debidos ahora (sin descartar los ya mostrados), para listarlos dentro de la app. */
export function useDueNotices(data: AppData, tick: number): LocalNotice[] {
  const { t } = useT()
  const fmt = useFormat()
  return useMemo(() => {
    const today = todayInTimeZone(data.settings.timeZone)
    const settings = data.settings.notifications
    if (!settings) return []
    return dueNotices(data, { today, now: localClock(data.settings.timeZone), settings }, { amount: (m) => fmt.money(m), name: (i) => planItemName(i, t), planName: (p) => planTitle(t, p) })
    // `tick` fuerza el recálculo cada minuto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, fmt, t, tick])
}

export function translateNotice(t: ReturnType<typeof useT>['t'], n: LocalNotice): { title: string; body: string } {
  return { title: t(n.titleKey as MessageKey, n.params), body: t(n.bodyKey as MessageKey, n.params) }
}

/** Monta el bucle de avisos. Se usa una sola vez en el shell. */
export function useLocalNotifications() {
  const data = useData()
  const { t } = useT()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((x) => x + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  const due = useDueNotices(data, tick)
  useEffect(() => {
    if (due.length === 0 || notificationPermission() !== 'granted') return
    const today = todayInTimeZone(data.settings.timeZone)
    const shown = readShown()
    const fresh = due.filter((n) => !shown.has(n.key))
    if (fresh.length === 0) return
    for (const n of fresh) {
      const { title, body } = translateNotice(t, n)
      void showSystemNotification(title, body, n.href, n.key)
      shown.add(n.key)
    }
    writeShown(shown, today)
  }, [due, data.settings.timeZone, t])
  return due
}
