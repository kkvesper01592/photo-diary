import type { AccessToken } from './auth'

// このモジュールは GET リクエストしか送らない。書き込み系の関数は意図的に存在しない。
const BASE = 'https://www.googleapis.com/calendar/v3'

export interface CalendarListEntry {
  id: string
  summary: string
  summaryOverride?: string
  backgroundColor?: string
  primary?: boolean
  accessRole: string
}

export interface EventDateTime {
  date?: string
  dateTime?: string
}

export interface CalendarEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: EventDateTime
  end?: EventDateTime
}

/** ログインの有効期限切れ(再ログインが必要) */
export class AuthExpiredError extends Error {
  constructor() {
    super('Google のログインの有効期限が切れました。もう一度ログインしてください')
  }
}

async function apiGet<T>(token: AccessToken, path: string, params: Record<string, string> = {}): Promise<T> {
  if (Date.now() > token.expiresAt - 30_000) throw new AuthExpiredError()
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token.value}` } })
  if (res.status === 401) throw new AuthExpiredError()
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
    } catch {
      /* 本文が JSON でない場合は無視 */
    }
    throw new Error(`Google API エラー ${res.status} ${detail}`.trim())
  }
  return res.json() as Promise<T>
}

async function getAllPages<T>(token: AccessToken, path: string, params: Record<string, string>): Promise<T[]> {
  const items: T[] = []
  let pageToken: string | undefined
  do {
    const page = await apiGet<{ items?: T[]; nextPageToken?: string }>(token, path, { ...params, ...(pageToken ? { pageToken } : {}) })
    items.push(...(page.items ?? []))
    pageToken = page.nextPageToken
  } while (pageToken)
  return items
}

export const listCalendars = (token: AccessToken) =>
  getAllPages<CalendarListEntry>(token, '/users/me/calendarList', { maxResults: '250' })

/** 期間内の予定(繰り返しは1回ずつに展開) */
export const listEventsInRange = (token: AccessToken, calendarId: string, timeMin: Date, timeMax: Date) =>
  getAllPages<CalendarEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
  })

/** 全期間の予定(繰り返しは1回ずつに展開。未来は2年先まで) */
export function listAllExpanded(token: AccessToken, calendarId: string) {
  const timeMax = new Date()
  timeMax.setFullYear(timeMax.getFullYear() + 2)
  return getAllPages<CalendarEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMax: timeMax.toISOString(),
    maxResults: '2500',
  })
}
