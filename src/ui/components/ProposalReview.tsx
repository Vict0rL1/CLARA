import type { ProposalReview } from '../../domain/review'
import { useT } from '../../i18n'
import { useToday } from '../../state/hooks'
import { useFormat } from '../format'
import { signedMoney } from '../signedMoney'
import { planItemName } from '../labels'
import { href, withQuery } from '../router'
import { CheckboxField } from './fields'
import { Icon } from './Icon'

/**
 * Lo que la persona ve de una propuesta antes de confirmarla, igual venga de un CSV, de texto, de
 * voz o de una foto: posible duplicado (con enlace al existente), coincidencia con un pago
 * programado (vincular es decisión suya), efecto en el saldo de las cuentas (y en lo disponible, calculado,
 * cuando se vincula), regla que dio la categoría y
 * «ya registrado» si el id ya está guardado. Solo muestra: no registra nada.
 */
export function ProposalReviewView({ review, linked, onLink, returnTo, testId }: { review: ProposalReview; linked?: boolean; onLink?: (value: boolean) => void; returnTo: string; testId?: string }) {
  const { t } = useT()
  const fmt = useFormat()
  const today = useToday()
  const dup = review.duplicates[0]
  const match = review.scheduleMatch
  const written = review.issues.find((i) => i.code === 'writtenCurrency')
  return (
    <div className="review" data-testid={testId}>
      {written && (
        <p className="review__line review__line--warning" data-testid="review-currency">
          <Icon name="alert" size={16} /> {t('issue.writtenCurrency', { found: String(written.params?.found ?? ''), expected: String(written.params?.expected ?? '') })}
        </p>
      )}
      {review.alreadySaved && (
        <p className="review__line review__line--info">
          <Icon name="info" size={16} /> {t('review.alreadySaved')}
        </p>
      )}
      {dup && (
        <p className="review__line review__line--warning" data-testid="review-duplicate">
          <Icon name="alert" size={16} /> {t('review.duplicate', { date: fmt.date(dup.date, { compact: true, today }), amount: fmt.money(dup.amountMinor) })}{' '}
          <a href={href(withQuery(`/movimientos/editar/${dup.id}`, { returnTo }))}>{t('review.duplicateView')}</a>
        </p>
      )}
      {match && onLink && (
        <div className="review__line review__line--info" data-testid="review-schedule">
          <p>
            <Icon name="calendar" size={16} /> {t('review.scheduleMatch', { name: planItemName(match, t), date: fmt.date(match.date, { compact: true, today }) })}
          </p>
          <CheckboxField checked={!!linked} onChange={onLink} label={t('review.scheduleLink')} />
        </div>
      )}
      {review.rule && (
        <p className="review__line review__line--muted">
          <Icon name="sparkles" size={14} /> {t('review.rule', { pattern: review.rule.rule.pattern })}
          {review.rule.competitors.length > 0 && ` · ${t(review.rule.reason === 'oldest' ? 'review.ruleOldest' : 'review.ruleLongest', { count: review.rule.competitors.length + 1 })}`}
        </p>
      )}
      {review.ok && review.planned && (
        <p className="review__line review__line--muted" data-testid="review-effect">
          {t(review.kind === 'income' ? 'review.plannedIncome' : 'review.plannedExpense')}
        </p>
      )}
      {review.ok && !review.planned && (review.effectMinor !== 0 || review.availableEffectMinor !== undefined) && (
        <p className="review__line review__line--muted" data-testid="review-effect">
          {t('review.effect', { amount: signedMoney(fmt, review.effectMinor) })}
          {review.availableEffectMinor !== undefined &&
            ` · ${review.availableEffectMinor === 0 ? t('review.effectAvailableSame') : t('review.effectAvailable', { amount: signedMoney(fmt, review.availableEffectMinor) })}`}
        </p>
      )}
    </div>
  )
}
