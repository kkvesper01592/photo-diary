import { useCallback, useEffect, useMemo, useState } from 'react'
import { requestAccessToken, revokeToken, type AccessToken } from './auth'
import { AuthExpiredError, listCalendars, listEventsInRange, type CalendarEvent, type CalendarListEntry } from './calendarApi'
import { SCOPE_CALENDAR_READONLY } from '../config'
import { idbGet, idbSet } from '../lib/idb'
import { toDayEvent, type DayEvent } from '../lib/events'
import { ymd } from '../lib/dates'

const LOGGED_IN = 'photodiary.loggedIn' // 一度許可した端末では、2回目から確認画面を出さない

/** Google へのログインとカレンダー一覧(一覧は端末に覚えておき、ログイン前・オフラインでも使う) */
export function useGoogle() {
  const [token, setToken] = useState<AccessToken | null>(null)
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([])
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    idbGet<CalendarListEntry[]>('calendars').then((c) => c && setCalendars((cur) => (cur.length ? cur : c)))
  }, [])

  const login = useCallback(async () => {
    setError('')
    try {
      let silent = false
      try {
        silent = localStorage.getItem(LOGGED_IN) === '1'
      } catch {
        /* 保存できない環境では毎回確認画面 */
      }
      const t = await requestAccessToken(SCOPE_CALENDAR_READONLY, [], { silent })
      try {
        localStorage.setItem(LOGGED_IN, '1')
      } catch {
        /* 無視 */
      }
      const cals = (await listCalendars(t)).sort((a, b) => Number(!!b.primary) - Number(!!a.primary) || (a.summaryOverride || a.summary).localeCompare(b.summaryOverride || b.summary, 'ja'))
      setCalendars(cals)
      await idbSet('calendars', cals)
      setExpired(false)
      setToken(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const logout = useCallback(async () => {
    if (token) await revokeToken(token).catch(() => {})
    try {
      localStorage.removeItem(LOGGED_IN)
    } catch {
      /* 無視 */
    }
    setToken(null)
  }, [token])

  const onAuthError = useCallback((e: unknown) => {
    if (e instanceof AuthExpiredError) {
      setToken(null)
      setExpired(true)
      return true
    }
    return false
  }, [])

  return { token, calendars, error, expired, login, logout, onAuthError }
}

interface CachedRange {
  fetchedAt: string
  byCal: Record<string, CalendarEvent[]>
}

/** 表示中の期間の予定。ログイン中は Google から取り、端末にも覚えておく(ログイン前・オフラインはその控えを表示) */
export function useRangeEvents(
  token: AccessToken | null,
  calendars: CalendarListEntry[],
  hidden: string[],
  start: Date,
  end: Date,
  onAuthError: (e: unknown) => boolean,
) {
  const [data, setData] = useState<CachedRange | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const cacheKey = `events:${ymd(start)}:${ymd(end)}`
  const calIds = calendars.map((c) => c.id).join('\n')

  useEffect(() => {
    let alive = true
    setError('')
    idbGet<CachedRange>(cacheKey).then((c) => alive && setData(c ?? null))
    if (!token || !calendars.length) return () => void (alive = false)
    setLoading(true)
    ;(async () => {
      const byCal: Record<string, CalendarEvent[]> = {}
      const failed: string[] = []
      await Promise.all(
        calendars.map(async (c) => {
          try {
            byCal[c.id] = await listEventsInRange(token, c.id, start, end)
          } catch (e) {
            if (onAuthError(e)) throw e
            failed.push(c.summaryOverride || c.summary)
          }
        }),
      )
      const fresh: CachedRange = { fetchedAt: new Date().toISOString(), byCal }
      await idbSet(cacheKey, fresh)
      if (!alive) return
      setData(fresh)
      if (failed.length) setError(`次のカレンダーを読み込めませんでした: ${failed.join('、')}`)
    })()
      .catch((e) => alive && !onAuthError(e) && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false))
    return () => void (alive = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, calIds, cacheKey, reloadKey])

  const events = useMemo(() => {
    if (!data) return []
    const hid = new Set(hidden)
    const out: DayEvent[] = []
    for (const c of calendars) {
      if (hid.has(c.id)) continue
      for (const ev of data.byCal[c.id] ?? []) {
        const d = toDayEvent(c, ev)
        if (d) out.push(d)
      }
    }
    return out
  }, [data, calendars, hidden])

  return { events, loading, error, fetchedAt: data?.fetchedAt, fromCache: !token && !!data, reload: () => setReloadKey((k) => k + 1) }
}
