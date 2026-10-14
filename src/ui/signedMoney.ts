import type { useFormat } from './format'

/** Importe con signo explícito («+$12.00», «−$45.00», «$0.00»), como en el resto de la app. */
export function signedMoney(fmt: ReturnType<typeof useFormat>, minor: number): string {
  return minor < 0 ? `−${fmt.money(-minor)}` : minor > 0 ? `+${fmt.money(minor)}` : fmt.money(0)
}
