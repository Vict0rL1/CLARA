/** Diálogo de favorito y fila de accesos rápidos (Inicio y formulario de movimientos). */
import { useState } from 'react'
import { categoriesForKind } from '../domain/categories'
import { sortedFavorites } from '../domain/favorites'
import { newId } from '../domain/ids'
import { saveFavorite, type FavoriteDraft } from '../domain/operations'
import type { Favorite } from '../domain/types'
import { FAVORITE_NAME_MAX, LIMITS, type Issue } from '../domain/validation'
import { useT } from '../i18n'
import { useRun } from '../state/hooks'
import { useData } from '../state/store'
import { Alert } from './components/common'
import { Dialog } from './components/Dialog'
import { MoneyField, Segmented, SelectField, TextField } from './components/fields'
import { Icon } from './components/Icon'
import { useToast } from './components/toastContext'
import { useFormat } from './format'
import { accountOptions, fieldError, issueMessage, otherIssues } from './labels'
import { moneyErrorMessage, parseMoneyText } from './moneyText'
import { href, withQuery } from './router'
import { CategoryPicker } from './components/CategoryPicker'

export function FavoriteDialog({
  favorite,
  initial,
  onClose,
}: {
  favorite: Favorite | null
  /** Para crear un favorito a partir de un movimiento o del formulario. */
  initial?: Partial<FavoriteDraft>
  onClose: () => void
}) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const run = useRun()
  const toast = useToast()
  const start = favorite ?? initial ?? {}
  // El id se fija al abrir: pulsar «Guardar» dos veces actualiza el mismo favorito.
  const [id] = useState(() => favorite?.id ?? newId())
  const [name, setName] = useState(start.name ?? '')
  const [kind, setKind] = useState<Favorite['kind']>(start.kind ?? 'expense')
  const [accountId, setAccountId] = useState(() => {
    const wanted = start.accountId
    return wanted && data.accounts.some((a) => a.id === wanted) ? wanted : ''
  })
  const [categoryId, setCategoryId] = useState(() => {
    const wanted = start.categoryId
    return wanted && categoriesForKind(start.kind ?? 'expense', data.categories, { prefs: data.categoryPrefs }).includes(wanted) ? wanted : ''
  })
  const [amountText, setAmountText] = useState(start.amountMinor !== undefined ? fmt.moneyInput(start.amountMinor) : '')
  const [note, setNote] = useState(start.note ?? '')
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    let amountMinor: number | undefined
    if (amountText.trim()) {
      const parsed = parseMoneyText(amountText, fmt)
      setAmountError(moneyErrorMessage(t, parsed))
      if (!parsed.ok) return
      amountMinor = parsed.minor
    } else setAmountError(null)
    if (busy) return
    setBusy(true)
    const { result, saved } = await run((d, c) => saveFavorite(d, { id, name, kind, accountId, categoryId, amountMinor, note }, c))
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('favorites.saved') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    onClose()
  }

  const choose = { value: '', label: t('favorites.choose') }
  const unknown = otherIssues(issues, ['name', 'accountId', 'categoryId', 'amountMinor', 'note'])
  return (
    <Dialog
      open
      onClose={onClose}
      title={favorite ? t('favorites.editTitle') : t('favorites.newTitle')}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <TextField label={t('fields.name')} value={name} maxLength={FAVORITE_NAME_MAX} onChange={(e) => setName(e.target.value)} error={fieldError(t, fmt, issues, 'name')} required autoFocus />
      <Segmented
        legend={t('fields.kind')}
        name="favkind"
        value={kind}
        onChange={(k) => {
          setKind(k)
          if (!categoriesForKind(k, data.categories, { prefs: data.categoryPrefs }).includes(categoryId)) setCategoryId('')
        }}
        options={[
          { value: 'expense', label: t('txKind.expense') },
          { value: 'income', label: t('txKind.income') },
        ]}
      />
      <SelectField
        label={t('fields.account')}
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        options={[...(accountId ? [] : [choose]), ...accountOptions(data.accounts, t, accountId)]}
        error={fieldError(t, fmt, issues, 'accountId')}
      />
      <CategoryPicker label={t('fields.category')} kind={kind} data={data} value={categoryId} onChange={setCategoryId} keep={favorite?.categoryId} error={fieldError(t, fmt, issues, 'categoryId')} />
      <MoneyField label={t('favorites.amountOptional')} hint={t('favorites.amountHint')} value={amountText} onChange={setAmountText} error={amountError ?? fieldError(t, fmt, issues, 'amountMinor')} fmt={fmt} />
      <TextField label={t('fields.noteOptional')} hint={t('favorites.noteHint')} value={note} maxLength={LIMITS.noteMax} onChange={(e) => setNote(e.target.value)} error={fieldError(t, fmt, issues, 'note')} />
      {unknown.length > 0 && (
        <Alert tone="critical" title={t('common.fixErrors')} role="alert">
          <ul>
            {unknown.map((i, idx) => (
              <li key={idx}>{issueMessage(t, fmt, i)}</li>
            ))}
          </ul>
        </Alert>
      )}
    </Dialog>
  )
}

/** Accesos compactos a los favoritos: abren el formulario, nunca guardan nada. */
export function FavoriteChips({ returnTo, limit = 6 }: { returnTo?: string; limit?: number }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const favorites = sortedFavorites(data)
  if (favorites.length === 0) return null
  return (
    <nav className="fav-chips" aria-label={t('favorites.quick')}>
      <ul>
        {favorites.slice(0, limit).map((f) => (
          <li key={f.id}>
            <a className="chip" href={href(withQuery('/movimientos/nuevo', { favorito: f.id, returnTo }))}>
              <Icon name={f.broken ? 'alert' : 'star'} size={16} />
              <span>{f.name}</span>
              {f.amountMinor !== undefined && <span className="chip__amount">{fmt.money(f.amountMinor)}</span>}
              {f.broken && <span className="sr-only"> ({t('favorites.broken')})</span>}
            </a>
          </li>
        ))}
        <li>
          <a className="chip chip--ghost" href={href('/movimientos/favoritos')}>
            <Icon name="sliders" size={16} />
            <span>{t('favorites.manage')}</span>
          </a>
        </li>
      </ul>
    </nav>
  )
}
