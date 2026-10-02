import { useCallback, useEffect, useMemo, useState } from 'react'
import { requestAccessToken, revokeToken, type AccessToken } from './auth'
import { AuthExpiredError, listAllExpanded, listCalendars, type CalendarEvent, type CalendarListEntry } from './calendarApi'
import { SCOPE_CALENDAR_READONLY } from '../config'
import { idbGet, idbSet } from '../lib/idb'
import { indexByDay, toDayEvent, type DayEvent } from '../lib/events'

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

const ALL_EVENTS = 'allEvents'

interface AllEvents {
  fetchedAt: string
  byCal: Record<string, CalendarEvent[]>
  calendars?: CalendarListEntry[] // カレンダー一覧も一緒に控える(ブラウザのデータが消えても色・名前を出せるように)
}

/** 予定の控えの保存先(保存フォルダ)。ブラウザのデータとは別に、2か所に控える */
export interface EventsBackupStore {
  loadEventsBackup<T>(): Promise<T | undefined>
  saveEventsBackup(data: unknown): Promise<void>
}

const totalCount = (d: AllEvents) => Object.values(d.byCal).reduce((n, l) => n + l.length, 0)

// 端末に残す項目だけにする(容量を抑える)
const slim = (e: CalendarEvent): CalendarEvent => ({
  id: e.id,
  status: e.status,
  summary: e.summary,
  description: e.description,
  location: e.location,
  start: e.start,
  end: e.end,
})

/**
 * 全期間の予定。ログインしたときに Google から全部取り直して端末に保存し、
 * ログインしていないときも(次にログインするまで)その控えを表示する
 */
export function useAllEvents(
  store: EventsBackupStore,
  token: AccessToken | null,
  googleCalendars: CalendarListEntry[],
  hidden: string[],
  onAuthError: (e: unknown) => boolean,
) {
  const [data, setData] = useState<AllEvents | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [source, setSource] = useState<'browser' | 'folder' | 'google' | ''>('')
  const calendars = googleCalendars.length ? googleCalendars : (data?.calendars ?? [])
  const calIds = googleCalendars.map((c) => c.id).join('\n')

  // 起動時: ブラウザの控えと保存フォルダの控えのうち、新しいほうを使う。
  // ブラウザの控えが無い・古いときは保存フォルダから戻し、片方しか無いときはもう片方にも写す
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [b, f] = await Promise.all([idbGet<AllEvents>(ALL_EVENTS), store.loadEventsBackup<AllEvents>().catch(() => undefined)])
      const pick = !b ? f : !f ? b : f.fetchedAt > b.fetchedAt ? f : b
      if (!pick || !alive) return
      setData((cur) => cur ?? pick)
      setSource((s) => s || (pick === b ? 'browser' : 'folder'))
      if (pick !== b) await idbSet(ALL_EVENTS, pick).catch(() => {})
      if (!f && b && totalCount(b)) await store.saveEventsBackup(b).catch(() => {})
    })()
    return () => void (alive = false)
  }, [store])

  useEffect(() => {
    if (!token || !googleCalendars.length) return
    const calendars = googleCalendars
    let alive = true
    setLoading(true)
    setError('')
    ;(async () => {
      const byCal: Record<string, CalendarEvent[]> = {}
      const failed: string[] = []
      await Promise.all(
        calendars.map(async (c) => {
          try {
            byCal[c.id] = (await listAllExpanded(token, c.id)).map(slim)
          } catch (e) {
            if (onAuthError(e)) throw e
            failed.push(c.summaryOverride || c.summary)
          }
        }),
      )
      // 読めなかったカレンダーは、前回の控えを残す
      const prev = (await idbGet<AllEvents>(ALL_EVENTS))?.byCal ?? (await store.loadEventsBackup<AllEvents>().catch(() => undefined))?.byCal ?? {}
      for (const c of calendars) if (!byCal[c.id] && prev[c.id]) byCal[c.id] = prev[c.id]
      const fresh: AllEvents = { fetchedAt: new Date().toISOString(), byCal, calendars }
      // 2か所に控える(ブラウザ・保存フォルダ)。どちらかが失敗しても、もう片方は残す
      const results = await Promise.allSettled([idbSet(ALL_EVENTS, fresh), totalCount(fresh) ? store.saveEventsBackup(fresh) : Promise.resolve()])
      if (!alive) return
      setData(fresh)
      setSource('google')
      if (results[1].status === 'rejected') setError(`予定の控えを保存フォルダに保存できませんでした: ${String(results[1].reason)}`)
      if (failed.length) setError(`次のカレンダーを読み込めませんでした(前回の控えを表示しています): ${failed.join('、')}`)
    })()
      .catch((e) => alive && !onAuthError(e) && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false))
    return () => void (alive = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, calIds, reloadKey])

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

  const byDay = useMemo(() => indexByDay(events), [events])

  return { byDay, count: events.length, calendars, source, loading, error, fetchedAt: data?.fetchedAt, reload: () => setReloadKey((k) => k + 1) }
}
